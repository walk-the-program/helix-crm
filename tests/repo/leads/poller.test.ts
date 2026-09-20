/**
 * The poller's own state machine: F-LB-1 (a malformed page must not be
 * accepted as a success), F-LB-6 (a plain-object rejection must not read as
 * "[object Object]"), and F-LB-8's page-level counting.
 *
 * Unlike pollerIntegration.test.ts this never spawns tools/fake-site:
 * `setLeadsFetch` is handed a plain async function per test, which is enough
 * to drive every branch of `tick()` without a network round trip.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as contacts from "../../../src/db/repos/contacts";
import * as deals from "../../../src/db/repos/deals";
import * as leadSync from "../../../src/db/repos/leadSync";
import * as settings from "../../../src/db/repos/settings";
import { writeRegistry, resetRegistryCache } from "../../../src/app/appSettings";
import {
  setSecretStore,
  syncKeyFor,
  tauriSecretStore,
} from "../../../src/features/leads/lib/siteConnection";
import {
  __resetPollerForTests,
  getStatus,
  setLeadsFetch,
  setPageSize,
  tick,
} from "../../../src/features/leads/poller";
import type { LeadPage, LeadsFetch } from "../../../src/features/leads/lib/types";

const ORIGIN = "https://sorensenlandscaping.com";
const WORKSPACE_ID = "poller-unit-workspace";

let h: Harness | null = null;

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

beforeEach(async () => {
  h = await createSeededHarness();
  __resetPollerForTests();
  resetRegistryCache();
  await writeRegistry({
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: "Unit",
        path: ":memory:",
        lastPolledAt: null,
        lastBackupAt: null,
        archived: false,
      },
    ],
    lastOpened: WORKSPACE_ID,
    theme: "light",
    density: "comfortable",
    sidebar: { width: 240, collapsed: false },
  });
  const memory = memorySecretStore();
  memory.values.set(WORKSPACE_ID, "tok");
  setSecretStore(memory.store);
  await settings.set("siteOrigin", ORIGIN);
  setPageSize(200);
});

afterEach(() => {
  __resetPollerForTests();
  setSecretStore(tauriSecretStore);
  resetRegistryCache();
  h?.dispose();
  h = null;
});

/* -------------------------------------------------------------------------- */
/* F-LB-1: a malformed page is a failure, not a success                       */
/* -------------------------------------------------------------------------- */

describe("tick() - a malformed leads_fetch page (F-LB-1)", () => {
  it("`{ leads: 'not-an-array' }` creates nothing and is recorded as an error", async () => {
    const stub: LeadsFetch = async () =>
      ({ leads: "not-an-array", nextCursor: null }) as unknown as LeadPage;
    setLeadsFetch(stub);

    const outcome = await tick("manual");
    expect(outcome.error).toBeDefined();
    expect(outcome.created).toBe(0);

    const all = await deals.list({}, { limit: 100 });
    expect(all.total).toBe(0);

    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    expect(sync!.lastError).toBeTruthy();
    expect(sync!.lastError).not.toBe("null");
  });

  it("`{ leads: [{}] }` (no id) creates nothing and is recorded as an error", async () => {
    const stub: LeadsFetch = async () =>
      ({ leads: [{}], nextCursor: null }) as unknown as LeadPage;
    setLeadsFetch(stub);

    const outcome = await tick("manual");
    expect(outcome.error).toBeDefined();
    expect(outcome.created).toBe(0);

    const all = await deals.list({}, { limit: 100 });
    expect(all.total).toBe(0);
    const contactRows = await contacts.list({}, { limit: 100 });
    expect(contactRows.total).toBe(0);
  });

  it("a normal array is unaffected", async () => {
    const stub: LeadsFetch = async () => ({
      leads: [
        {
          id: "ok-1",
          createdAt: new Date().toISOString(),
          name: "Fine Lead",
          email: "fine@example.com",
          phone: null,
          service: "Lawn care",
          message: null,
          pageUrl: null,
        },
      ],
      nextCursor: null,
    });
    setLeadsFetch(stub);

    const outcome = await tick("manual");
    expect(outcome.error).toBeUndefined();
    expect(outcome.created).toBe(1);

    const all = await deals.list({}, { limit: 100 });
    expect(all.total).toBe(1);
  });

  it("does not advance the cursor on a rejected page", async () => {
    await leadSync.saveCursor(syncKeyFor(ORIGIN), "cursor-before");

    const stub: LeadsFetch = async () =>
      ({ leads: "not-an-array", nextCursor: "cursor-the-site-sent" }) as unknown as LeadPage;
    setLeadsFetch(stub);

    await tick("manual");

    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    expect(sync!.cursor).toBe("cursor-before");
  });
});

/* -------------------------------------------------------------------------- */
/* F-LB-6: the error text shown to the owner is never "[object Object]"       */
/* -------------------------------------------------------------------------- */

describe("tick() - reading a rejected invoke's message (F-LB-6)", () => {
  it("reads .message off a plain {code, message} rejection, the real Tauri v2 shape", async () => {
    const stub: LeadsFetch = () =>
      Promise.reject({ code: "HTTP_STATUS", message: "The website answered HTTP 401." });
    setLeadsFetch(stub);

    const outcome = await tick("manual");
    expect(outcome.error?.kind).toBe("auth");

    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    // On a 401/403 the site's own answer is deliberately NOT carried through
    // (F-SEC-6): a rejection body commonly echoes the credential it rejected,
    // and lead_sync.last_error is read back onto the Settings screen. The
    // status is what the owner acts on. The original point of this test - that
    // a plain `{code, message}` rejection is not stringified to
    // "[object Object]" - is still what the last two assertions check.
    expect(sync!.lastError).toBe("LeadPollAuthError: HTTP 401");
    expect(sync!.lastError).not.toContain("[object Object]");
    // The existing e2e assertion this must keep passing.
    expect(sync!.lastError).toMatch(/^LeadPollAuthError/);
  });

  it("still uses .message for a real Error", async () => {
    setLeadsFetch(() => Promise.reject(new Error("getaddrinfo ENOTFOUND")));

    await tick("manual");
    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    expect(sync!.lastError).toContain("getaddrinfo ENOTFOUND");
    expect(sync!.lastError).not.toContain("[object Object]");
  });

  it("stringifies a bare string rejection to itself", async () => {
    setLeadsFetch(() => Promise.reject("just a string"));

    await tick("manual");
    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    expect(sync!.lastError).toContain("just a string");
  });

  it("falls back to String() for a rejection with no usable message", async () => {
    setLeadsFetch(() => Promise.reject({ code: "WEIRD" }));

    await tick("manual");
    const sync = await leadSync.get(syncKeyFor(ORIGIN));
    // No good message to read - at least it is not silently swallowed.
    expect(sync!.lastError).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* F-LB-8: invalid leads are counted at the tick level too                    */
/* -------------------------------------------------------------------------- */

describe("tick() - invalid leads are counted (F-LB-8)", () => {
  it("reports how many leads in a page had no usable id", async () => {
    const stub: LeadsFetch = async () =>
      ({
        leads: [
          { id: "", name: "No Id One", email: "n1@example.com" },
          { id: "  ", name: "No Id Two", email: "n2@example.com" },
        ],
        nextCursor: null,
      }) as unknown as LeadPage;
    setLeadsFetch(stub);

    // This particular shape is rejected wholesale by assertValidLeadPage
    // (F-LB-1), so it never reaches applyLeadPage's own counter - confirmed
    // here as the "recorded as an error" case, with applyLeads.test.ts
    // covering the counter itself directly.
    const outcome = await tick("manual");
    expect(outcome.error).toBeDefined();
    expect(outcome.created).toBe(0);
  });
});

describe("tick() - this file's own setup", () => {
  it("does not run at all with no site configured", async () => {
    await settings.set("siteOrigin", null);
    const outcome = await tick("manual");
    expect(outcome.reason).toBe("not-configured");
    expect(getStatus().configured).toBe(false);
  });
});
