/**
 * The website lead poller.
 *
 *   [idle] --launch / 5 min timer--> [fetching] --200--> [applying, one tx]
 *          --> [idle, cursor saved, lastPolledAt mirrored into helix.json]
 *          --401/403--> [stopped: banner "check the token", timer off until
 *                        the settings change]
 *          --keychain--> [stopped: banner "save the token again", timer off]
 *          --404--> [idle, retry, banner at once: the site has no lead feed]
 *          --400--> [idle, cursor dropped, start again from the first lead]
 *          --other HTTP--> [idle, retry, banner at once: the site answered]
 *          --no answer--> [idle, retry in 1, 2, 4, 8 min; banner after 3 in a row]
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
  nextDelayMs,
  shouldShowNetworkBanner,
  statusFromError,
} from "@/features/leads/lib/backoff";
import {
  STORED_PREFIX,
  classifyPollFailure,
  type PollFailureKind,
} from "@/features/leads/lib/pollMessages";
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
import { messageFrom } from "@/lib/errors";

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

/**
 * `setTimeout` does not fire during macOS sleep and fires once, late, on
 * wake - it never queues up multiple catch-up firings for the time that
 * passed (LR-OPS-W2 B1). For a five-minute poll interval that is the right
 * behaviour with no extra machinery: a laptop closed for six hours wakes up,
 * this fires once as soon as the event loop resumes, `tick()` runs (or is
 * skipped for the ordinary reasons - not configured, paused, already
 * running), and `rescheduleAfterTick()` puts the next one five minutes out
 * from THEN. Nothing here ever runs twice for one sleep, and nothing here
 * ever stops permanently because of one: every path through `tick()` -
 * success, a network error, an auth stop (which intentionally does not
 * reschedule; that is `refresh()`'s job) - reaches its own `finally` and
 * either reschedules or leaves the stopped state exactly as visible as it
 * already was.
 */
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
 * The error branches of the state machine, one per person who can fix it
 * (`lib/pollMessages.ts` holds the words; this holds the behaviour).
 *
 *   401 / 403   stop the timer, banner now. Nothing the app does on its own
 *               fixes a rejected token.
 *   keychain    stop the timer, banner now. Same reason, different door.
 *   404         keep retrying so it heals when ClearPath redeploys, but
 *               banner at once: this is not a blip.
 *   400         drop the cursor and start again from the first lead, once.
 *               Re-reading history is safe; staying stuck was not.
 *   other HTTP  back off, banner at once - the site answered, so silence
 *               would be hiding a real answer.
 *   no answer   back off 1, 2, 4, 8 minutes, stay silent until the third
 *               failure in a row. A laptop that drove through a canyon must
 *               not put a banner on the screen.
 */
async function recordFailure(err: unknown, syncKey: string): Promise<PollError> {
  const stat = statusFromError(err);
  const raw = messageFrom(err);
  // A LeadShapeError is the site answering 200 with something Helix cannot
  // use. It has no status, but it is emphatically not "your internet is
  // down" - it is the site's problem, and the error already carries the
  // sentence that says so.
  const siteAnswered = err instanceof LeadShapeError;
  const kind = classifyPollFailure(stat, { siteAnswered, code: codeFrom(err) });

  if (kind === "auth") {
    const error: PollError = {
      kind,
      status: stat,
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
    await saveError(syncKey, `${STORED_PREFIX.auth}: HTTP ${stat}`);
    pollLog.error(`LeadPollAuthError HTTP ${stat}`);
    return error;
  }

  if (kind === "config") {
    // The keychain refused between `readSiteConnection`'s check and the
    // request. Retrying on a timer cannot fix it, and the owner has to be
    // sent to the keychain prompt, not to his website (LR-REV, F-REV-6).
    const error: PollError = {
      kind,
      status: null,
      message:
        "Helix could not read your website token from this computer. Open Settings, then Website, and save the token again.",
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
    await saveError(syncKey, `${STORED_PREFIX.config}: the keychain refused`);
    pollLog.error("LeadPollConfigError: the keychain refused");
    return error;
  }

  if (kind === "endpoint") {
    // 404: Helix reached the site and the site has no lead feed on it. Most
    // often a ClearPath site deployed without CRM_API_TOKEN's endpoint block,
    // or with the route registered after the /api catch-all. Keep retrying -
    // that is what makes it heal by itself the moment Walker redeploys - but
    // say so at once rather than after three silent tries, because this is
    // not a blip and nothing the owner does will change it (F-REV-1).
    consecutiveFailures += 1;
    const error: PollError = {
      kind,
      status: stat,
      message:
        "Your website is not set up to send leads yet. Ask ClearPath to switch on the lead connection.",
    };
    publish({
      phase: "idle",
      lastError: error,
      consecutiveFailures,
      bannerVisible: true,
    });
    // No body: a 404 body is the site's own 404 page, which is long, useless
    // and third-party text.
    await saveError(syncKey, `${STORED_PREFIX.endpoint}: HTTP ${stat}`);
    pollLog.error(`LeadPollEndpointError HTTP ${stat}`);
    return error;
  }

  if (kind === "cursor") {
    // 400 is, by the site contract, exactly one thing: the site could not
    // read the `after` marker Helix sent it. Before LR-REV this backed off
    // like any other failure and then sent the same unreadable cursor every
    // eight minutes forever - an unrecoverable stop that survived even a
    // disconnect and reconnect, because `disconnectSite` deliberately keeps
    // the lead_sync row (F-REV-2). Drop the cursor once and start again from
    // the first lead. That is safe precisely because applying a page is
    // idempotent: `applyLeadPage` matches on `deals.external_id`, which
    // carries a partial UNIQUE index (drizzle/0005), so a re-read of history
    // creates nothing and overwrites nothing the owner has edited.
    consecutiveFailures += 1;
    try {
      await leadSync.saveCursor(syncKey, null);
    } catch (resetErr) {
      pollLog.warn(`could not reset the lead cursor: ${String(resetErr)}`);
    }
    const error: PollError = {
      kind,
      status: stat,
      message:
        "Your website could not read where Helix left off. Helix will start again from your first lead; nothing will be duplicated.",
    };
    publish({
      phase: "idle",
      lastError: error,
      consecutiveFailures,
      bannerVisible: true,
    });
    await saveError(syncKey, `${STORED_PREFIX.cursor}: HTTP ${stat}`);
    pollLog.error(`LeadPollCursorError HTTP ${stat}: cursor reset`);
    return error;
  }

  consecutiveFailures += 1;
  const visible =
    kind === "site" ? true : shouldShowNetworkBanner(consecutiveFailures);
  const error: PollError =
    kind === "site"
      ? {
          kind,
          status: stat,
          // A LeadShapeError already says what is wrong in the owner's own
          // words; there is nothing better to write over it, so it becomes
          // both the toast and the banner's second line.
          message: siteAnswered
            ? raw
            : `Your website answered with an error (${stat}). Helix keeps trying on its own.`,
          detail: siteAnswered ? raw : null,
        }
      : {
          kind: "network",
          status: null,
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
  await saveError(syncKey, `${storedPrefixFor(kind)}: ${raw}`);
  const level = visible ? "error" : "warn";
  pollLog[level](
    kind === "site"
      ? `LeadPollSiteError (HTTP ${stat ?? "no status"})`
      : `LeadPollNetworkError (${consecutiveFailures}/${FAILURES_BEFORE_BANNER})`,
  );
  return error;
}

function storedPrefixFor(kind: PollFailureKind): string {
  return STORED_PREFIX[kind] ?? STORED_PREFIX.network;
}

/** The `code` a rejected Tauri command carries, when it carries one. */
function codeFrom(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
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
