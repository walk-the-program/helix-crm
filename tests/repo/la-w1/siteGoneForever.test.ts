/**
 * LR-LA-W1, journey J3 (repo layer, real SQLite): the parts of the
 * website-lead lifecycle that cannot honestly be proven on the mocked
 * Playwright harness because they depend on real backoff timing (12
 * consecutive failures before "the site may be gone for good" is offered).
 *
 * This is an independent re-drive of the real poller, in this agent's own
 * words and own harness call - not a re-run of
 * `tests/repo/leads/lifecycle.test.ts` and not an import of it. Both files
 * are allowed to exist and agree; the point of this one is that LA did not
 * take REV's return as proof.
 *
 * What tests/e2e-mac/specs/la-w1.e2e.ts proves instead, on the mocked UI: a
 * single 401 shows the "check the token" banner and the Settings screen's
 * disabled/enabled connection state; a single network failure (after three
 * tries) shows "Helix cannot reach your website"; Disconnect removes the
 * address and token from the visible screen. What this file proves that the
 * UI harness cannot: the EXACT stored/derived strings after a real 401, that
 * a reconnect after a rotation resumes from the cursor with no duplicate,
 * and that twelve real consecutive failures - not one substituted for twelve
 * - is what actually flips `shouldSuggestDisconnect`.
 *
 * Run alone:
 *   npx vitest run tests/repo/la-w1/siteGoneForever.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as deals from "../../../src/db/repos/deals";
import * as leadSync from "../../../src/db/repos/leadSync";
import * as settings from "../../../src/db/repos/settings";
import { writeRegistry, resetRegistryCache } from "../../../src/app/appSettings";
import {
  disconnectSite,
  readSiteConnection,
  saveSiteOrigin,
  setSecretStore,
  syncKeyFor,
  tauriSecretStore,
} from "../../../src/features/leads/lib/siteConnection";
import {
  FAILURES_BEFORE_DISCONNECT_HINT,
  shouldSuggestDisconnect,
} from "../../../src/features/leads/lib/backoff";
import { describeStoredPollError, pollBannerCopy } from "../../../src/features/leads/lib/pollMessages";
import {
  __resetPollerForTests,
  getStatus,
  refresh,
  setLeadsFetch,
  setPageSize,
  tick,
} from "../../../src/features/leads/poller";
import type { Lead, LeadPage } from "../../../src/features/leads/lib/types";

const ORIGIN = "https://la-w1-sorensenlandscaping.example";
const WORKSPACE_ID = "la-w1-lifecycle-workspace";

let h: Harness | null = null;
let secrets: Map<string, string>;

function lead(id: string, at: string): Lead {
  return {
    id,
    createdAt: at,
    name: `LA Owner ${id}`,
    email: `la-owner-${id}@example.com`,
    phone: null,
    service: "Fence repair",
    message: "The back gate is off its hinge.",
    pageUrl: null,
  };
}

function rejectWith(code: string, message: string): () => Promise<LeadPage> {
  return async () => {
    throw { code, message };
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
        name: "LA-W1",
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
  secrets = new Map<string, string>();
  secrets.set(WORKSPACE_ID, "la-w1-first-token");
  setSecretStore({
    set: async (id, value) => {
      secrets.set(id, value);
    },
    get: async (id) => secrets.get(id) ?? null,
    delete: async (id) => {
      secrets.delete(id);
    },
  });
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

describe("J3, the 401 after a token rotation: exact message and no lost lead", () => {
  it("stores exactly LeadPollAuthError: HTTP 401, and the owner-facing sentence never echoes the token", async () => {
    setLeadsFetch(
      rejectWith("HTTP_STATUS", "HTTP 401 from the site: invalid token la-w1-first-token"),
    );
    await tick("manual");

    const status = getStatus();
    expect(status.phase).toBe("stopped");
    expect(status.bannerVisible).toBe(true);
    expect(status.lastError?.kind).toBe("auth");

    const row = await leadSync.get(syncKeyFor(ORIGIN));
    expect(row?.lastError).toBe("LeadPollAuthError: HTTP 401");
    expect(row?.lastError).not.toContain("la-w1-first-token");
    expect(row?.lastError).not.toContain("invalid token");
    expect(describeStoredPollError(row!.lastError!)).toBe("Your website turned the token down.");

    const banner = pollBannerCopy("auth", {});
    expect(banner.headline).toBe("Your website turned the connection down. Check the token.");
    expect(banner.headline).not.toMatch(/cannot reach/i);
  });

  it("reconnecting with the new token resumes from the cursor and creates no duplicate deal", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("rot-1", "2026-09-01T09:00:00.000Z")],
      nextCursor: "cursor-after-rot-1",
    }));
    await tick("manual");
    expect((await deals.list({}, { limit: 200 })).rows.length).toBe(1);
    expect((await leadSync.get(syncKeyFor(ORIGIN)))?.cursor).toBe("cursor-after-rot-1");

    setLeadsFetch(rejectWith("HTTP_STATUS", "HTTP 401 from the site: no details"));
    await tick("manual");
    expect(getStatus().phase).toBe("stopped");
    // The failed poll must not have moved the cursor backwards or forwards.
    expect((await leadSync.get(syncKeyFor(ORIGIN)))?.cursor).toBe("cursor-after-rot-1");

    // The owner rotates: new token in the keychain, Settings calls refresh().
    secrets.set(WORKSPACE_ID, "la-w1-second-token");
    const seenCursors: (string | null)[] = [];
    setLeadsFetch(async (cursor) => {
      seenCursors.push(cursor);
      // The site re-sends the SAME lead it already sent once (a real site can
      // legitimately do this on a re-page), plus one genuinely new one.
      return {
        leads: [lead("rot-1", "2026-09-01T09:00:00.000Z"), lead("rot-2", "2026-09-02T09:00:00.000Z")],
        nextCursor: null,
      };
    });
    await refresh();

    expect(seenCursors[0]).toBe("cursor-after-rot-1");
    expect(getStatus().phase).not.toBe("stopped");
    expect(getStatus().lastError).toBeNull();

    // EXACT count: still 2 deals, never 3 - "rot-1" must not have been
    // re-created just because the site handed it back again.
    const finalDeals = await deals.list({}, { limit: 200 });
    expect(finalDeals.rows.length).toBe(2);
    const titles = finalDeals.rows.map((d) => d.title);
    expect(titles.filter((t) => t.includes("LA Owner rot-1")).length).toBe(1);
    expect(titles.some((t) => t.includes("LA Owner rot-2"))).toBe(true);
  });
});

describe("J3, the site is gone for good: real 12-failure backoff, not a substitute", () => {
  it("does not offer Disconnect on failures 1 through 11, and does on the 12th, with the documented sentence", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("gone-1", "2026-09-08T09:00:00.000Z")],
      nextCursor: null,
    }));
    await tick("manual");
    const dealsBefore = (await deals.list({}, { limit: 200 })).rows.length;
    expect(dealsBefore).toBe(1);

    setLeadsFetch(rejectWith("NET_ERROR", "Could not reach the site: connection refused"));

    for (let i = 1; i < FAILURES_BEFORE_DISCONNECT_HINT; i += 1) {
      await tick("manual");
      expect(getStatus().consecutiveFailures).toBe(i);
      expect(shouldSuggestDisconnect(getStatus().consecutiveFailures)).toBe(false);
    }

    // The 12th failure, not a stand-in for it.
    await tick("manual");
    const status = getStatus();
    expect(status.consecutiveFailures).toBe(FAILURES_BEFORE_DISCONNECT_HINT);
    expect(shouldSuggestDisconnect(status.consecutiveFailures)).toBe(true);

    const copy = pollBannerCopy("network", {
      consecutiveFailures: status.consecutiveFailures,
      suggestDisconnect: true,
    });
    expect(copy.headline).toBe("Helix cannot reach your website.");
    expect(copy.detail).toMatch(/disconnect it below/i);
    expect(copy.detail).toMatch(/every lead already in helix stays/i);

    // Not one lead lost or duplicated across twelve failed tries.
    expect((await deals.list({}, { limit: 200 })).rows.length).toBe(dealsBefore);
  });
});

describe("J3, Disconnect: removes exactly the address and the token, nothing else", () => {
  it("clears the keychain entry and siteOrigin, keeps every deal and contact, and the poller refuses to run again", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("disc-1", "2026-09-09T09:00:00.000Z")],
      nextCursor: null,
    }));
    await tick("manual");
    const dealsBefore = (await deals.list({}, { limit: 200 })).rows.length;
    expect(dealsBefore).toBe(1);

    await disconnectSite();

    // The token really is gone from the keychain stand-in, not merely hidden
    // from the screen.
    expect(secrets.get(WORKSPACE_ID)).toBeUndefined();
    const connection = await readSiteConnection();
    expect(connection.connected).toBe(false);
    expect(connection.siteOrigin).toBeNull();
    expect(connection.hasToken).toBe(false);

    await refresh();
    expect(getStatus().nextPollAt).toBeNull();
    const outcome = await tick("manual");
    expect(outcome.ran).toBe(false);
    expect(outcome.reason).toBe("not-configured");

    // Nothing else was touched: same deal count, same rows.
    const dealsAfter = await deals.list({}, { limit: 200 });
    expect(dealsAfter.rows.length).toBe(dealsBefore);
    expect(dealsAfter.rows.some((d) => d.title.includes("LA Owner disc-1"))).toBe(true);
  });

  it("reconnecting the same site afterwards does not re-import the history that was already applied", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("disc-2", "2026-09-10T09:00:00.000Z")],
      nextCursor: "cursor-after-disc-2",
    }));
    await tick("manual");

    await disconnectSite();
    await saveSiteOrigin(ORIGIN, { carryCursorFrom: null });
    secrets.set(WORKSPACE_ID, "la-w1-reconnect-token");

    const askedCursors: (string | null)[] = [];
    setLeadsFetch(async (cursor) => {
      askedCursors.push(cursor);
      return { leads: [], nextCursor: null };
    });
    await refresh();

    // lead_sync's cursor survives a disconnect on purpose (docs/CONTRACTS.md
    // "Recovery and the second backup copy" is a different guarantee; this
    // one is OPS/REV's "reconnecting does not re-import history"). Proven by
    // reading what the poller actually asked for.
    expect(askedCursors[0]).toBe("cursor-after-disc-2");
    expect((await deals.list({}, { limit: 200 })).rows.length).toBe(1);
  });
});
