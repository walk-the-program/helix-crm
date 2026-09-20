/**
 * The poller, end to end, against the real fake site.
 *
 *   tools/fake-site (this test starts and stops it on 4711, --seed 25)
 *        ^ http, Bearer token
 *        |
 *   httpLeadsFetch  <- injected in place of the Rust leads_fetch command
 *        |
 *   poller.tick()  ->  applyLeadPage  ->  better-sqlite3 (the repo harness)
 *
 * This is the only test that proves the paging loop: 25 seeded leads do not
 * fit in one response at a small page size, the cursor has to be carried back,
 * and the seed deliberately contains a `createdAt` tie so the cursor's
 * tie-break rule gets exercised on the way through.
 *
 * Process hygiene: the child is spawned here and killed here, and nothing else
 * on the machine is touched. If 4711 is already in use the fake site exits 1
 * and this test says so rather than hanging.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as deals from "../../../src/db/repos/deals";
import * as leadSync from "../../../src/db/repos/leadSync";
import * as settings from "../../../src/db/repos/settings";
import { writeRegistry, readRegistry, resetRegistryCache } from "../../../src/app/appSettings";
import {
  setSecretStore,
  syncKeyFor,
  tauriSecretStore,
} from "../../../src/features/leads/lib/siteConnection";
import { httpLeadsFetch } from "../../../src/features/leads/lib/leadsFetch";
import {
  __resetPollerForTests,
  getStatus,
  setLeadsFetch,
  setPageSize,
  tick,
} from "../../../src/features/leads/poller";
import type { LeadsFetch } from "../../../src/features/leads/lib/types";

const PORT = 4711;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = "dev-token";
const SEEDED = 25;
const PAGE = 7;
const WORKSPACE_ID = "poller-integration-workspace";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let site: ChildProcess | null = null;
let h: Harness | null = null;

/** Poll the health of the child rather than sleeping a fixed amount. */
async function waitForSite(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (site?.exitCode !== null && site?.exitCode !== undefined) {
      throw new Error(
        `fake-site exited with code ${site.exitCode} - is port ${PORT} already in use?`,
      );
    }
    try {
      const response = await fetch(`${ORIGIN}/api/crm/leads?limit=1`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error("fake-site did not come up in time");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  site = spawn(
    process.execPath,
    [join(repoRoot, "tools", "fake-site", "server.mjs"), "--seed", String(SEEDED), "--port", String(PORT)],
    { cwd: repoRoot, stdio: "ignore", env: { ...process.env, FAKE_SITE_TOKEN: TOKEN } },
  );
  await waitForSite();
}, 30_000);

afterAll(() => {
  // Only the child this test started, and only ever by its handle.
  site?.kill("SIGINT");
  site = null;
});

/** In-memory keychain: there is no Tauri runtime under Vitest. */
function memorySecretStore() {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      set: async (id: string, value: string) => {
        values.set(id, value);
      },
      get: async (id: string) => values.get(id) ?? null,
      delete: async (id: string) => {
        values.delete(id);
      },
    },
  };
}

let fetchLeads: LeadsFetch;

/** Every lead the fake site is holding right now, paged through directly. */
async function countLeadsOnSite(): Promise<number> {
  let cursor: string | null = null;
  let total = 0;
  for (;;) {
    const page = await fetchLeads(cursor, PAGE);
    total += page.leads.length;
    cursor = page.nextCursor;
    if (cursor === null || page.leads.length < PAGE) return total;
  }
}

beforeEach(async () => {
  h = await createSeededHarness();
  __resetPollerForTests();

  // The poller reads the open workspace from helix.json to mirror lastPolledAt
  // into it; in a plain Node process that registry is an in-memory stand-in.
  resetRegistryCache();
  await writeRegistry({
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: "Integration",
        path: ":memory:",
        lastPolledAt: null,
        lastBackupAt: null,
        archived: false,
      },
    ],
    lastOpened: WORKSPACE_ID,
    theme: "light",
    density: "comfortable",
    // Added by R3-L1 with the sidebar width/collapsed keys (round 3, criterion 7).
    sidebar: { width: 240, collapsed: false },
  });

  const memory = memorySecretStore();
  memory.values.set(WORKSPACE_ID, TOKEN);
  setSecretStore(memory.store);

  await settings.set("siteOrigin", ORIGIN);

  // Small pages on purpose: 25 leads must take several round trips, so the
  // cursor really has to be carried back rather than the whole seed arriving
  // in one response.
  fetchLeads = httpLeadsFetch(ORIGIN, TOKEN);
  setLeadsFetch(fetchLeads);
  setPageSize(PAGE);
});

afterEach(() => {
  __resetPollerForTests();
  setSecretStore(tauriSecretStore);
  resetRegistryCache();
  h?.dispose();
  h = null;
});

describe("the poller against tools/fake-site", () => {
  it("pages through every seeded lead and stops", async () => {
    const outcome = await tick("manual");

    expect(outcome.ran).toBe(true);
    expect(outcome.error).toBeUndefined();
    expect(outcome.created).toBe(SEEDED);
    expect(outcome.skipped).toBe(0);
    // 25 leads at 7 a page: 7, 7, 7, 4 - the short page ends the loop.
    expect(outcome.pages).toBe(Math.ceil(SEEDED / PAGE));

    const all = await deals.list({}, { limit: 100 });
    expect(all.total).toBe(SEEDED);

    // Every deal carries its external_id, and they are all different: the
    // seed's deliberate createdAt tie did not cost a lead or duplicate one.
    const externalIds = await raw.query(
      `SELECT d.external_id FROM deals d WHERE d.deleted_at IS NULL`,
    );
    const unique = new Set(externalIds.map((r) => String(r[0])));
    expect(unique.size).toBe(SEEDED);
    for (const id of unique) expect(id.startsWith(`${ORIGIN}:`)).toBe(true);
  });

  it("saves the cursor and mirrors lastPolledAt into helix.json", async () => {
    await tick("manual");

    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    expect(sync).not.toBeNull();
    expect(sync!.lastError).toBeNull();
    expect(sync!.lastPolledAt).toBeTruthy();
    // The last page was short, so the site said "caught up".
    expect(sync!.cursor).toBeNull();

    const registry = await readRegistry();
    expect(registry.workspaces[0].lastPolledAt).toBeTruthy();

    expect(getStatus().lastError).toBeNull();
    expect(getStatus().lastCreated).toBe(SEEDED);
    expect(getStatus().phase).toBe("idle");
  });

  it("re-polling right afterwards writes nothing new", async () => {
    await tick("manual");
    const second = await tick("manual");

    // The cursor came back null, so the second poll starts from the beginning
    // again and every lead is recognised by its external_id.
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(SEEDED);

    const all = await deals.list({}, { limit: 100 });
    expect(all.total).toBe(SEEDED);
  });

  it("picks up only what is new after a lead is posted to the site", async () => {
    await tick("manual");

    const posted = await fetch(`${ORIGIN}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Rhonda Alcott",
        email: "rhonda@example.com",
        phone: "(435) 555-0123",
        service: "Snow removal",
        message: "Driveway and the walk to the shop, please.",
        pageUrl: `${ORIGIN}/contact`,
      }),
    });
    expect(posted.status).toBe(201);

    const second = await tick("manual");
    expect(second.created).toBe(1);

    const all = await deals.list({}, { limit: 100 });
    expect(all.total).toBe(SEEDED + 1);
    const titles = all.rows.map((d) => d.title);
    expect(titles).toContain("Snow removal - Rhonda Alcott");
  });

  it("resumes from a saved cursor instead of re-reading the whole site", async () => {
    // The site is shared by every case in this file and one of them posts an
    // extra lead, so count what is actually there rather than assuming 25.
    const onTheSite = await countLeadsOnSite();

    // Arrange a cursor as if an earlier run had already taken the first page.
    const firstPage = await fetchLeads(null, PAGE);
    expect(firstPage.leads).toHaveLength(PAGE);
    expect(firstPage.nextCursor).not.toBeNull();
    await leadSync.saveCursor(syncKeyFor(ORIGIN), firstPage.nextCursor);

    const outcome = await tick("manual");
    expect(outcome.created).toBe(onTheSite - PAGE);
    expect(outcome.skipped).toBe(0);

    const all = await deals.list({}, { limit: 200 });
    expect(all.total).toBe(onTheSite - PAGE);
  });

  it("stops and shows the banner when the site rejects the token", async () => {
    setLeadsFetch(httpLeadsFetch(ORIGIN, "the-wrong-token"));

    const outcome = await tick("manual");
    expect(outcome.error?.kind).toBe("auth");

    const status = getStatus();
    expect(status.phase).toBe("stopped");
    expect(status.bannerVisible).toBe(true);
    expect(status.nextPollAt).toBeNull();

    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    expect(sync!.lastError).toContain("LeadPollAuthError");

    const all = await deals.list({}, { limit: 100 });
    expect(all.total).toBe(0);
  });

  it("stays silent for the first two network failures and speaks on the third", async () => {
    setLeadsFetch(() => Promise.reject(new Error("getaddrinfo ENOTFOUND")));

    await tick("manual");
    expect(getStatus().consecutiveFailures).toBe(1);
    expect(getStatus().bannerVisible).toBe(false);

    await tick("manual");
    expect(getStatus().bannerVisible).toBe(false);

    await tick("manual");
    expect(getStatus().consecutiveFailures).toBe(3);
    expect(getStatus().bannerVisible).toBe(true);
    // A network failure does not stop the poller; it only slows it down.
    expect(getStatus().phase).toBe("idle");

    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    expect(sync!.lastError).toContain("LeadPollNetworkError");
  });

  it("does not run at all with no site configured", async () => {
    await settings.set("siteOrigin", null);
    const outcome = await tick("manual");
    expect(outcome.ran).toBe(false);
    expect(outcome.reason).toBe("not-configured");
    expect(getStatus().configured).toBe(false);
  });
});
