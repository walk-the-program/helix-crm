/**
 * The website lead poller.
 *
 *   [idle] --launch / 5 min timer--> [fetching] --200--> [applying, one tx]
 *          --> [idle, cursor saved, lastPolledAt mirrored into helix.json]
 *          --401/403--> [stopped: banner "check the token", timer off until
 *                        the settings change]
 *          --network--> [idle, retry in 1, 2, 4, 8 min; banner after 3 in a row]
 *
 * docs/PLAN.md, Core item 10 and the LEAD POLL state machine.
 *
 * Rules this file is holding to:
 *   - no site configured -> the timer never starts at all;
 *   - a tick is skipped while `timersPaused()` (an import or a merge owns the
 *     write lock; a poll must not queue behind it);
 *   - a tick pages with `leads_fetch(cursor, 200)` until `nextCursor` is null
 *     or the page came back short, and saves the cursor after each page, so an
 *     interrupted run resumes where it stopped;
 *   - `leads_fetch` arrives as a dependency, so the integration test can point
 *     it at tools/fake-site and the e2e harness at its stub;
 *   - start/end/counts/errors go to the log plugin.
 */
import { timersPaused, subscribeTimers } from "@/db/writeLock";
import { touchWorkspace } from "@/app/appSettings";
import { queryClient, qk } from "@/app/queryClient";
import * as leadSync from "@/db/repos/leadSync";
import { nowIso } from "@/lib/dates";
import {
  FAILURES_BEFORE_BANNER,
  POLL_INTERVAL_MS,
  isAuthStatus,
  nextDelayMs,
  shouldShowNetworkBanner,
  statusFromError,
} from "@/features/leads/lib/backoff";
import { applyLeadPage, prepareApply } from "@/features/leads/lib/applyLeads";
import {
  assertValidLeadPage,
  invokeLeadsFetch,
  isStalledCursor,
  LeadShapeError,
  MAX_PAGE,
} from "@/features/leads/lib/leadsFetch";
import { pollLog } from "@/features/leads/lib/log";
import {
  currentWorkspaceId,
  readSiteConnection,
  syncKeyFor,
} from "@/features/leads/lib/siteConnection";
import {
  IDLE_STATUS,
  type LeadsFetch,
  type PollError,
  type PollStatus,
} from "@/features/leads/lib/types";

/* -------------------------------------------------------------------------- */
/* the store                                                                  */
/* -------------------------------------------------------------------------- */

type Listener = () => void;

let status: PollStatus = { ...IDLE_STATUS };
const listeners = new Set<Listener>();

function publish(patch: Partial<PollStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

/** useSyncExternalStore-friendly. Today and Diagnostics read this. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStatus(): PollStatus {
  return status;
}

/* -------------------------------------------------------------------------- */
/* the timer                                                                  */
/* -------------------------------------------------------------------------- */

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let running = false;
let consecutiveFailures = 0;
let unsubscribeTimers: (() => void) | null = null;

/** Swappable so tests can inject a fetch of their own. */
let fetchLeads: LeadsFetch = invokeLeadsFetch;

export function setLeadsFetch(fn: LeadsFetch): void {
  fetchLeads = fn;
}

/**
 * How many leads to ask for per request. The contract caps this at 200 and the
 * app always asks for the maximum; the integration test turns it down so that
 * a modest seed still takes several round trips and the paging loop is really
 * exercised rather than short-circuited on the first response.
 */
let pageSize = MAX_PAGE;

export function setPageSize(size: number): void {
  pageSize = Math.min(MAX_PAGE, Math.max(1, Math.trunc(size)));
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleIn(delayMs: number): void {
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    void tick("timer");
  }, delayMs);
  publish({ nextPollAt: new Date(Date.now() + delayMs).toISOString() });
}

/* -------------------------------------------------------------------------- */
/* one tick                                                                   */
/* -------------------------------------------------------------------------- */

export type TickOutcome = {
  ran: boolean;
  reason?: "not-configured" | "paused" | "already-running" | "no-stage";
  created: number;
  skipped: number;
  pages: number;
  /** Leads a page carried with no usable id - dropped, never a deal (F-LB-8). */
  invalid: number;
  error?: PollError;
};

const EMPTY_OUTCOME: TickOutcome = {
  ran: false,
  created: 0,
  skipped: 0,
  pages: 0,
  invalid: 0,
};

/**
 * One poll. Safe to call at any time: it refuses to overlap itself, refuses
 * while the timers are paused, and reschedules itself when it is done.
 *
 * @param trigger "boot" | "timer" | "manual" - only used for the log line.
 */
export async function tick(
  trigger: "boot" | "timer" | "manual" = "manual",
): Promise<TickOutcome> {
  if (running) return { ...EMPTY_OUTCOME, reason: "already-running" };

  const connection = await readSiteConnection();
  if (!connection.connected || !connection.siteOrigin) {
    publish({
      configured: false,
      siteOrigin: connection.siteOrigin,
      phase: "idle",
      nextPollAt: null,
    });
    clearTimer();
    return { ...EMPTY_OUTCOME, reason: "not-configured" };
  }

  const origin = connection.siteOrigin;
  const syncKey = syncKeyFor(origin);
  publish({ configured: true, siteOrigin: origin });

  // An import or a merge holds the write lock and has paused the timers. Do
  // not queue behind it; come back on the next beat.
  if (timersPaused()) {
    if (trigger !== "manual") scheduleIn(POLL_INTERVAL_MS);
    return { ...EMPTY_OUTCOME, reason: "paused" };
  }

  running = true;
  publish({ phase: "fetching" });
  pollLog.info(`poll start (${trigger}) site=${origin}`);

  let created = 0;
  let skipped = 0;
  let pages = 0;
  let invalid = 0;

  try {
    const context = await prepareApply();
    if (!context) {
      running = false;
      publish({ phase: "idle" });
      pollLog.warn("poll skipped: this workspace has no pipeline stage yet");
      return { ...EMPTY_OUTCOME, reason: "no-stage" };
    }

    const sync = await leadSync.ensure(syncKey);
    let cursor: string | null = sync.cursor;

    // Page until the site says it has nothing more, or hands back a short
    // page (which means the same thing and saves one round trip).
    for (;;) {
      publish({ phase: "fetching" });
      const page = await fetchLeads(cursor, pageSize);
      pages += 1;

      // Checked before anything else touches this page: a malformed shape
      // must not advance the cursor or be reported as a success (CPO audit,
      // F-LB-1). Thrown here, it falls straight into the catch below and
      // through the same failure path a network or auth error takes.
      assertValidLeadPage(page);

      // A site whose `nextCursor` echoes the cursor it was just asked with
      // will never reach the end this way - paging on unconditionally would
      // spin this tick forever (LR-SEC-W1 item 4). Caught before this page
      // is applied, so the failure path below is exactly the one every other
      // hostile shape takes: nothing from this page is saved, and the
      // cursor already on file is untouched.
      if (isStalledCursor(cursor, page.nextCursor)) {
        throw new LeadShapeError(
          "Your website answered with the same page marker it was just asked for and never reached the end of the list. Nothing was saved; check the site's cursor handling.",
        );
      }

      publish({ phase: "applying" });
      const applied = await applyLeadPage(page.leads, origin, {
        ...context,
        // Later pages land after the ones already written this tick.
        nextPosition: context.nextPosition + created,
      });
      created += applied.created;
      skipped += applied.skipped;
      invalid += applied.invalid;

      // The cursor is saved after every page, so an interrupted run resumes
      // instead of re-reading from the beginning.
      cursor = page.nextCursor;
      await leadSync.saveCursor(syncKey, cursor);

      // A short page means the same thing as a null cursor and saves a round
      // trip: the site had nothing more to give.
      if (cursor === null || page.leads.length < pageSize) break;
    }

    consecutiveFailures = 0;
    const polledAt = nowIso();
    await mirrorLastPolledAt(polledAt);

    publish({
      phase: "idle",
      lastPolledAt: polledAt,
      lastError: null,
      consecutiveFailures: 0,
      lastCreated: created,
      lastSkipped: skipped,
      bannerVisible: false,
    });
    if (created > 0) invalidateAffectedQueries();
    pollLog.info(
      `poll end (${trigger}) pages=${pages} created=${created} skipped=${skipped} invalid=${invalid}`,
    );
    return { ran: true, created, skipped, pages, invalid };
  } catch (err) {
    const error = await recordFailure(err, syncKey);
    return { ran: true, created, skipped, pages, invalid, error };
  } finally {
    running = false;
    if (status.phase !== "stopped") rescheduleAfterTick();
  }
}

function rescheduleAfterTick(): void {
  if (!started) return;
  scheduleIn(nextDelayMs(consecutiveFailures));
}

async function mirrorLastPolledAt(at: string): Promise<void> {
  try {
    const workspaceId = await currentWorkspaceId();
    if (workspaceId) await touchWorkspace(workspaceId, { lastPolledAt: at });
  } catch (err) {
    // helix.json is a mirror, not the source of truth: lead_sync already has
    // the real value. A failure here is worth a log line and nothing more.
    pollLog.warn(`could not mirror lastPolledAt into helix.json: ${String(err)}`);
  }
}

/** New deals and contacts: everything showing them has to refetch. */
function invalidateAffectedQueries(): void {
  void queryClient.invalidateQueries({ queryKey: ["deals"] });
  void queryClient.invalidateQueries({ queryKey: ["contacts"] });
  void queryClient.invalidateQueries({ queryKey: ["activities"] });
  void queryClient.invalidateQueries({ queryKey: ["board"] });
  void queryClient.invalidateQueries({ queryKey: qk.today() });
  void queryClient.invalidateQueries({ queryKey: ["reports"] });
}

/**
 * The two error branches of the state machine.
 *
 *   401 / 403  -> stop the timer, show the banner now. Nothing the app can do
 *                 on its own will fix a rejected token.
 *   anything else -> back off 1, 2, 4, 8 minutes, stay silent until the third
 *                 failure in a row. A laptop that drove through a canyon must
 *                 not put a banner on the screen.
 */
async function recordFailure(err: unknown, syncKey: string): Promise<PollError> {
  const stat = statusFromError(err);
  const raw = messageFrom(err);

  if (isAuthStatus(stat)) {
    const error: PollError = {
      kind: "auth",
      message:
        "Your website turned the connection down. Check the token in Settings, then try again.",
    };
    consecutiveFailures = 0;
    clearTimer();
    publish({
      phase: "stopped",
      lastError: error,
      bannerVisible: true,
      consecutiveFailures: 0,
      nextPollAt: null,
    });
    // Never the site's own response body here, even redacted (Rust already
    // withholds it for 401/403 - see leads.rs `fetch_page_with_limits`).
    // Plenty of frameworks echo the rejected credential straight back, and
    // this status alone is enough for the owner to act on: check the token
    // in Settings. `lead_sync.last_error` and helix.log (plaintext, and
    // exactly what Diagnostics invites the owner to send to support) must
    // never carry it (LR-SEC-W1 item 9, 2026-09-20).
    await saveError(syncKey, `LeadPollAuthError: HTTP ${stat}`);
    pollLog.error(`LeadPollAuthError HTTP ${stat}`);
    return error;
  }

  consecutiveFailures += 1;
  const visible = shouldShowNetworkBanner(consecutiveFailures);
  const error: PollError = {
    kind: "network",
    message: `Helix has not been able to reach your website (${consecutiveFailures} tries). It will keep trying.`,
  };
  publish({
    phase: "idle",
    lastError: error,
    consecutiveFailures,
    bannerVisible: visible,
  });
  // `raw` (the Rust HTTP_STATUS detail, or a transport message) is kept in
  // `saveError` on purpose: `lead_sync.last_error` lives inside the
  // SQLCipher-encrypted database and surfaces in Settings -> Website, which
  // is exactly where an owner debugging their own broken site needs the
  // site's answer. It is left OUT of pollLog: the token in it is already
  // redacted (leads.rs), but the rest of a non-auth detail is still
  // arbitrary third-party text - a framework 500 can serialise the row it
  // choked on, which can be a customer's name or email - and helix.log is
  // plaintext on disk, exactly what Diagnostics invites the owner to send to
  // support. The log's job is to record that a poll failed and how often,
  // not to quote the far end (LR-SEC-W1 item 9 correction, 2026-09-20).
  await saveError(syncKey, `LeadPollNetworkError: ${raw}`);
  const level = visible ? "error" : "warn";
  pollLog[level](
    `LeadPollNetworkError (${consecutiveFailures}/${FAILURES_BEFORE_BANNER})`,
  );
  return error;
}

/**
 * The readable text out of whatever a rejected `invoke()` carries.
 *
 * Tauri v2 rejects a command with a plain `{ code, message }` object, not an
 * `Error` (docs/CONTRACTS.md's binding facts for this task) - so
 * `err instanceof Error` was false for the one shape this poller sees the
 * most, and `String(err)` on a plain object gives "[object Object]". Settings
 * → Website was showing "LeadPollAuthError: HTTP 401 - [object Object]"
 * instead of the site's real answer (CPO audit, F-LB-6).
 */
function messageFrom(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(err);
}

async function saveError(syncKey: string, message: string): Promise<void> {
  try {
    await leadSync.recordError(syncKey, message);
  } catch (err) {
    pollLog.warn(`could not record the poll error: ${String(err)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Called from the feature's `onBoot`, after the first paint. Idempotent: a
 * second call while the poller is already running does nothing.
 *
 * With no site configured the timer never starts; `refresh()` is what turns it
 * on once the owner saves an address and a token.
 */
export async function start(): Promise<void> {
  if (started) return;
  started = true;

  // A long write pauses the timers. When it finishes, come back promptly
  // rather than waiting out the rest of a five-minute sleep.
  unsubscribeTimers = subscribeTimers(() => {
    if (!started || timersPaused() || running) return;
    if (status.phase === "stopped") return;
    scheduleIn(1_000);
  });

  const connection = await readSiteConnection();
  publish({ configured: connection.connected, siteOrigin: connection.siteOrigin });
  await hydrateFromLeadSync(connection.siteOrigin);

  if (!connection.connected) {
    pollLog.info("poller idle: no website is connected");
    return;
  }
  await tick("boot");
}

/** Read what the last run left behind, so the UI is right before the first tick. */
async function hydrateFromLeadSync(origin: string | null): Promise<void> {
  if (!origin) return;
  try {
    const row = await leadSync.get(syncKeyFor(origin));
    if (!row) return;
    publish({
      lastPolledAt: row.lastPolledAt,
      lastError: row.lastError
        ? {
            kind: row.lastError.startsWith("LeadPollAuthError") ? "auth" : "network",
            message: row.lastError,
          }
        : null,
    });
  } catch {
    // A missing lead_sync row is the normal first-run case.
  }
}

/**
 * Called after the site settings change: a saved origin, a new token, or a
 * disconnect. This is the only thing that restarts a timer stopped by a 401.
 */
export async function refresh(): Promise<void> {
  consecutiveFailures = 0;
  const connection = await readSiteConnection();
  publish({
    configured: connection.connected,
    siteOrigin: connection.siteOrigin,
    lastError: null,
    bannerVisible: false,
    consecutiveFailures: 0,
    phase: "idle",
  });
  if (!connection.connected) {
    clearTimer();
    publish({ nextPollAt: null });
    return;
  }
  await hydrateFromLeadSync(connection.siteOrigin);
  if (!started) {
    await start();
    return;
  }
  // Poll straight away rather than waiting out a five-minute sleep: the owner
  // has just told Helix where his website is and expects his leads now. This
  // is also the only path that revives a timer a 401 stopped.
  await tick("manual");
}

/** Stop everything. Used on workspace switch and by the tests. */
export function stop(): void {
  clearTimer();
  started = false;
  running = false;
  consecutiveFailures = 0;
  unsubscribeTimers?.();
  unsubscribeTimers = null;
  status = { ...IDLE_STATUS };
  for (const listener of listeners) listener();
}

/** Test seam: the poller's internals, reset between cases. */
export function __resetPollerForTests(): void {
  stop();
  fetchLeads = invokeLeadsFetch;
  pageSize = MAX_PAGE;
}

export { POLL_INTERVAL_MS };
