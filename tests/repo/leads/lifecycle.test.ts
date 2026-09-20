/**
 * LR-REV, acceptance C2: the commercial lifecycle of one ClearPath client,
 * driven through the real poller against a real workspace.
 *
 * The only thing tying a paying website client to Helix is the CRM_API_TOKEN
 * on their site. So the states that matter commercially are the states of that
 * one string, and each of them has to leave the owner with a message he can
 * act on and Walker with a procedure (docs/OPERATIONS.md, "Commercial
 * lifecycle"). The six:
 *
 *   1 connected              leads arrive, cursor advances
 *   2 401 after a rotation   poll stops, banner says check the token, and the
 *                            new token resumes from the cursor - no lead lost
 *   3 404, no endpoint       the site answered; do not blame the connection
 *   4 site down              backs off, stays quiet for two tries
 *   5 disconnected           token gone from the keychain, poll off, data kept
 *   6 site gone forever      the owner is finally told he may disconnect
 *
 * `setLeadsFetch` stands in for the Rust command, exactly as poller.test.ts
 * does, so every branch runs without a network round trip.
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
import {
  describeStoredPollError,
  pollBannerCopy,
  type PollFailureKind,
} from "../../../src/features/leads/lib/pollMessages";
import {
  __resetPollerForTests,
  getStatus,
  refresh,
  setLeadsFetch,
  setPageSize,
  tick,
} from "../../../src/features/leads/poller";
import type { Lead, LeadPage } from "../../../src/features/leads/lib/types";

const ORIGIN = "https://sorensenlandscaping.com";
const WORKSPACE_ID = "rev-lifecycle-workspace";

let h: Harness | null = null;
let secrets: Map<string, string>;

function lead(id: string, at: string): Lead {
  return {
    id,
    createdAt: at,
    name: `Owner ${id}`,
    email: `owner${id}@example.com`,
    phone: null,
    service: "Spring cleanup",
    message: "Can you quote the back garden?",
    pageUrl: null,
  };
}

/** A rejection shaped exactly like a rejected Tauri command. */
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
        name: "Lifecycle",
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
  secrets.set(WORKSPACE_ID, "the-first-token");
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

/* -------------------------------------------------------------------------- */
/* 1. connected                                                               */
/* -------------------------------------------------------------------------- */

describe("state 1: connected", () => {
  it("turns the site's leads into deals and remembers where it stopped", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("101", "2026-09-01T09:00:00.000Z")],
      nextCursor: "cursor-after-101",
    }));

    const outcome = await tick("manual");

    expect(outcome.created).toBe(1);
    expect(outcome.error).toBeUndefined();
    expect(getStatus().lastError).toBeNull();
    expect(getStatus().bannerVisible).toBe(false);
    const row = await leadSync.get(syncKeyFor(ORIGIN));
    expect(row?.cursor).toBe("cursor-after-101");
    expect(row?.lastError).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. 401 after a rotation, then the new token                                */
/* -------------------------------------------------------------------------- */

describe("state 2: the site token was rotated", () => {
  it("stops the poll and tells the owner to check the token, not his internet", async () => {
    setLeadsFetch(rejectWith("HTTP_STATUS", "HTTP 401 from the site: no details"));

    await tick("manual");

    const status = getStatus();
    expect(status.phase).toBe("stopped");
    expect(status.nextPollAt).toBeNull();
    expect(status.bannerVisible).toBe(true);
    expect(status.lastError?.kind).toBe("auth");

    const copy = pollBannerCopy(status.lastError!.kind as PollFailureKind, {});
    expect(copy.headline).toContain("turned the connection down");
    expect(copy.headline).not.toMatch(/cannot reach/i);

    const row = await leadSync.get(syncKeyFor(ORIGIN));
    // Stored in Helix's words for Diagnostics, read back in the owner's.
    expect(row?.lastError).toBe("LeadPollAuthError: HTTP 401");
    expect(describeStoredPollError(row!.lastError!)).toBe(
      "Your website turned the token down.",
    );
  });

  it("never writes the rejected token or the site's 401 body anywhere", async () => {
    setLeadsFetch(
      rejectWith("HTTP_STATUS", "HTTP 401 from the site: invalid token the-first-token"),
    );
    await tick("manual");
    const row = await leadSync.get(syncKeyFor(ORIGIN));
    expect(row?.lastError).not.toContain("the-first-token");
    expect(row?.lastError).not.toContain("invalid token");
  });

  it("resumes from the cursor once the new token is saved, losing no lead", async () => {
    // Two leads arrive and are applied, then the token is rotated on the site.
    setLeadsFetch(async () => ({
      leads: [lead("201", "2026-09-01T09:00:00.000Z")],
      nextCursor: "cursor-after-201",
    }));
    await tick("manual");
    expect((await leadSync.get(syncKeyFor(ORIGIN)))?.cursor).toBe("cursor-after-201");

    setLeadsFetch(rejectWith("HTTP_STATUS", "HTTP 401 from the site: no details"));
    await tick("manual");
    expect(getStatus().phase).toBe("stopped");
    // The failed poll must not have moved the cursor.
    expect((await leadSync.get(syncKeyFor(ORIGIN)))?.cursor).toBe("cursor-after-201");

    // The owner pastes the new token and saves; `refresh()` is what Settings
    // calls, and it is the only thing that revives a timer a 401 stopped.
    const seen: (string | null)[] = [];
    secrets.set(WORKSPACE_ID, "the-second-token");
    setLeadsFetch(async (cursor) => {
      seen.push(cursor);
      return {
        leads: [lead("202", "2026-09-02T09:00:00.000Z")],
        nextCursor: null,
      };
    });
    await refresh();

    // It asked the site to carry on from where it stopped, not from the top:
    // nothing that arrived during the outage is skipped, and nothing already
    // applied is read again.
    expect(seen[0]).toBe("cursor-after-201");
    expect(getStatus().phase).not.toBe("stopped");
    expect(getStatus().lastError).toBeNull();
    const live = await deals.list({}, { limit: 200 });
    expect(live.rows.some((d) => d.title.includes("Owner 202"))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. the site has no lead endpoint                                           */
/* -------------------------------------------------------------------------- */

describe("state 3: the site was deployed without the lead endpoint", () => {
  it("says the site is not set up yet instead of blaming the connection", async () => {
    setLeadsFetch(rejectWith("HTTP_STATUS", "HTTP 404 from the site: Not Found"));

    await tick("manual");

    const status = getStatus();
    expect(status.lastError?.kind).toBe("endpoint");
    // Told at once, not after three silent tries: this is not a blip and
    // waiting changes nothing.
    expect(status.bannerVisible).toBe(true);
    expect(status.consecutiveFailures).toBe(1);

    const copy = pollBannerCopy("endpoint");
    expect(copy.headline).not.toMatch(/cannot reach/i);
    expect(copy.detail).toMatch(/ClearPath/);

    const row = await leadSync.get(syncKeyFor(ORIGIN));
    expect(row?.lastError).toBe("LeadPollEndpointError: HTTP 404");
    // The site's 404 page is third-party text and is never kept.
    expect(row?.lastError).not.toContain("Not Found");
  });

  it("keeps retrying, so it heals by itself the moment the endpoint ships", async () => {
    setLeadsFetch(rejectWith("HTTP_STATUS", "HTTP 404 from the site: Not Found"));
    await tick("manual");
    expect(getStatus().phase).not.toBe("stopped");

    setLeadsFetch(async () => ({
      leads: [lead("301", "2026-09-03T09:00:00.000Z")],
      nextCursor: null,
    }));
    const outcome = await tick("manual");
    expect(outcome.created).toBe(1);
    expect(getStatus().lastError).toBeNull();
    expect(getStatus().bannerVisible).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 3b. the site cannot read the marker Helix sent                             */
/* -------------------------------------------------------------------------- */

describe("state 3b: the site could not read Helix's page marker", () => {
  it("drops the cursor once so the poll is not stuck on it forever", async () => {
    await leadSync.ensure(syncKeyFor(ORIGIN));
    await leadSync.saveCursor(syncKeyFor(ORIGIN), "a-cursor-the-site-cannot-read");

    setLeadsFetch(rejectWith("HTTP_STATUS", "HTTP 400 from the site: bad cursor"));
    await tick("manual");

    expect(getStatus().lastError?.kind).toBe("cursor");
    // The whole point: the next request cannot repeat the marker that failed.
    expect((await leadSync.get(syncKeyFor(ORIGIN)))?.cursor).toBeNull();

    const asked: (string | null)[] = [];
    setLeadsFetch(async (cursor) => {
      asked.push(cursor);
      return { leads: [lead("401", "2026-09-04T09:00:00.000Z")], nextCursor: null };
    });
    await tick("manual");
    expect(asked[0]).toBeNull();
    expect(getStatus().lastError).toBeNull();
  });

  it("re-reading history from the beginning creates no second deal", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("501", "2026-09-05T09:00:00.000Z")],
      nextCursor: "cursor-after-501",
    }));
    await tick("manual");
    const before = (await deals.list({}, { limit: 200 })).rows.length;

    setLeadsFetch(rejectWith("HTTP_STATUS", "HTTP 400 from the site: bad cursor"));
    await tick("manual");

    // Exactly what a restart from the top looks like: the same lead again.
    setLeadsFetch(async () => ({
      leads: [lead("501", "2026-09-05T09:00:00.000Z")],
      nextCursor: null,
    }));
    const outcome = await tick("manual");

    expect(outcome.created).toBe(0);
    expect((await deals.list({}, { limit: 200 })).rows.length).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. the site is down                                                        */
/* -------------------------------------------------------------------------- */

describe("state 4: the site is down", () => {
  it("stays quiet for two tries, then says it cannot reach the website", async () => {
    setLeadsFetch(rejectWith("NET_ERROR", "Could not reach the site: dns error"));

    await tick("manual");
    expect(getStatus().bannerVisible).toBe(false);
    await tick("manual");
    expect(getStatus().bannerVisible).toBe(false);
    await tick("manual");
    expect(getStatus().bannerVisible).toBe(true);
    expect(getStatus().lastError?.kind).toBe("network");
    expect(pollBannerCopy("network", { consecutiveFailures: 3 }).headline).toBe(
      "Helix cannot reach your website.",
    );
  });

  it("a site having a bad day is reported as the site's error, at once", async () => {
    setLeadsFetch(rejectWith("HTTP_STATUS", "HTTP 502 from the site: bad gateway"));
    await tick("manual");
    expect(getStatus().lastError?.kind).toBe("site");
    expect(getStatus().bannerVisible).toBe(true);
    expect(getStatus().lastError?.status).toBe(502);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. disconnected                                                            */
/* -------------------------------------------------------------------------- */

describe("state 5: the owner disconnects the website", () => {
  it("clears the token from the keychain, stops the poll, and keeps every lead", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("601", "2026-09-06T09:00:00.000Z")],
      nextCursor: null,
    }));
    await tick("manual");
    const dealsBefore = (await deals.list({}, { limit: 200 })).rows.length;
    expect(dealsBefore).toBeGreaterThan(0);

    await disconnectSite();
    await refresh();

    // The token really is gone from the keychain, not merely hidden.
    expect(secrets.get(WORKSPACE_ID)).toBeUndefined();
    const connection = await readSiteConnection();
    expect(connection.connected).toBe(false);
    expect(connection.siteOrigin).toBeNull();
    expect(connection.hasToken).toBe(false);

    // The timer is off and the poller refuses to run.
    expect(getStatus().nextPollAt).toBeNull();
    const outcome = await tick("manual");
    expect(outcome.ran).toBe(false);
    expect(outcome.reason).toBe("not-configured");

    // And nothing the site ever sent was touched. This is the promise the
    // Disconnect dialog makes, and the one a client leaving ClearPath relies on.
    expect((await deals.list({}, { limit: 200 })).rows.length).toBe(dealsBefore);
  });

  it("reconnecting the same site does not re-import history the owner deleted", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("701", "2026-09-07T09:00:00.000Z")],
      nextCursor: "cursor-after-701",
    }));
    await tick("manual");

    await disconnectSite();
    await settings.set("siteOrigin", ORIGIN);
    secrets.set(WORKSPACE_ID, "a-new-token");

    const asked: (string | null)[] = [];
    setLeadsFetch(async (cursor) => {
      asked.push(cursor);
      return { leads: [], nextCursor: null };
    });
    await refresh();
    expect(asked[0]).toBe("cursor-after-701");
  });
});

/* -------------------------------------------------------------------------- */
/* 6. the site is gone for good                                               */
/* -------------------------------------------------------------------------- */

describe("state 6: the site is gone for good", () => {
  it("eventually tells the owner he may disconnect, and never loses his data", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("801", "2026-09-08T09:00:00.000Z")],
      nextCursor: null,
    }));
    await tick("manual");
    const dealsBefore = (await deals.list({}, { limit: 200 })).rows.length;

    setLeadsFetch(rejectWith("NET_ERROR", "Could not reach the site: connection refused"));
    for (let i = 0; i < FAILURES_BEFORE_DISCONNECT_HINT; i += 1) {
      await tick("manual");
    }

    const status = getStatus();
    expect(status.consecutiveFailures).toBe(FAILURES_BEFORE_DISCONNECT_HINT);
    expect(shouldSuggestDisconnect(status.consecutiveFailures)).toBe(true);

    const copy = pollBannerCopy("network", {
      consecutiveFailures: status.consecutiveFailures,
      suggestDisconnect: shouldSuggestDisconnect(status.consecutiveFailures),
    });
    expect(copy.detail).toMatch(/disconnect it below/i);

    // The client keeps Helix and everything in it. No ClearPath action - not
    // taking the site down, not revoking the token - touches this.
    expect((await deals.list({}, { limit: 200 })).rows.length).toBe(dealsBefore);
  });

  it("does not offer Disconnect while the site is merely having an outage", async () => {
    setLeadsFetch(rejectWith("NET_ERROR", "Could not reach the site: timeout"));
    for (let i = 0; i < 4; i += 1) await tick("manual");
    expect(shouldSuggestDisconnect(getStatus().consecutiveFailures)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 3c. the site moved to a new address                                        */
/* -------------------------------------------------------------------------- */

describe("state 3c: the website changed address", () => {
  const MOVED = "https://www.sorensenlandscaping.com";

  it("carries the place-in-the-list over, so no lead arrives twice", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("901", "2026-09-09T09:00:00.000Z")],
      nextCursor: "cursor-after-901",
    }));
    await tick("manual");
    const dealsBefore = (await deals.list({}, { limit: 200 })).rows.length;

    // Staging to live, or apex to www: the owner types the new address and
    // says it is the same website.
    await saveSiteOrigin(MOVED, { carryCursorFrom: ORIGIN });

    const asked: (string | null)[] = [];
    setLeadsFetch(async (cursor) => {
      asked.push(cursor);
      return { leads: [], nextCursor: null };
    });
    await refresh();

    // The new address picks up exactly where the old one stopped, so the
    // site never re-sends history under ids Helix has not seen before.
    expect(asked[0]).toBe("cursor-after-901");
    expect((await deals.list({}, { limit: 200 })).rows.length).toBe(dealsBefore);
  });

  it("a genuinely different website is read from the beginning", async () => {
    setLeadsFetch(async () => ({
      leads: [lead("902", "2026-09-09T09:00:00.000Z")],
      nextCursor: "cursor-after-902",
    }));
    await tick("manual");

    await saveSiteOrigin("https://a-completely-different-business.com");

    const asked: (string | null)[] = [];
    setLeadsFetch(async (cursor) => {
      asked.push(cursor);
      return { leads: [], nextCursor: null };
    });
    await refresh();
    expect(asked[0]).toBeNull();
  });

  it("never rewinds an address Helix is already following", async () => {
    // Both addresses have history. Carrying the old cursor over the new one
    // would re-read the new site from an older point than it has reached.
    setLeadsFetch(async () => ({ leads: [], nextCursor: "old-cursor" }));
    await leadSync.ensure(syncKeyFor(ORIGIN));
    await leadSync.saveCursor(syncKeyFor(ORIGIN), "old-cursor");
    await leadSync.ensure(syncKeyFor(MOVED));
    await leadSync.saveCursor(syncKeyFor(MOVED), "newer-cursor");

    await saveSiteOrigin(MOVED, { carryCursorFrom: ORIGIN });

    expect((await leadSync.get(syncKeyFor(MOVED)))?.cursor).toBe("newer-cursor");
  });
});
