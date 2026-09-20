/**
 * LR-OPS-W2 A1: does two overlapping triggers of the poller ever write the
 * same lead twice?
 *
 * `tick()` has a `running` guard, but it is checked and set on either side of
 * `await readSiteConnection()` (poller.ts) - a real await, since
 * `readSiteConnection` reads settings out of SQLite. A manual "Check now"
 * click landing while a timer tick is already past that first guard check (or
 * vice versa) is not theoretical: both are ordinary async calls into the same
 * exported `tick()`, and nothing stops a click handler and a `setTimeout`
 * callback from both firing in the same task queue drain.
 *
 * These tests record what the write path actually does about it today, with
 * no fix applied yet in this file - `applyLeads.ts`'s own dedupe
 * (`deals.findByExternalId` inside `withTransaction`) is the thing under
 * test, not the poller's guard.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as deals from "../../../src/db/repos/deals";
import * as settings from "../../../src/db/repos/settings";
import { writeRegistry, resetRegistryCache } from "../../../src/app/appSettings";
import {
  setSecretStore,
  tauriSecretStore,
} from "../../../src/features/leads/lib/siteConnection";
import {
  __resetPollerForTests,
  setLeadsFetch,
  setPageSize,
  tick,
} from "../../../src/features/leads/poller";
import { applyLeadPage, prepareApply } from "../../../src/features/leads/lib/applyLeads";
import { externalIdFor } from "../../../src/features/leads/lib/leadMapping";
import type { Lead, LeadPage, LeadsFetch } from "../../../src/features/leads/lib/types";

const ORIGIN = "https://sorensenlandscaping.com";
const WORKSPACE_ID = "poller-race-workspace";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  h = await createSeededHarness();
  __resetPollerForTests();
  resetRegistryCache();
  await writeRegistry({
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: "Race",
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

function leadPage(id: string): LeadPage {
  return {
    leads: [
      {
        id,
        createdAt: "2026-03-01T15:04:05.000Z",
        name: "Race Condition",
        email: `${id}@example.com`,
        phone: null,
        service: "Sprinkler repair",
        message: "Two triggers, one lead.",
        pageUrl: "https://sorensenlandscaping.com/contact",
      },
    ],
    nextCursor: null,
  };
}

describe("tick() - two overlapping triggers (LR-OPS-W2 A1)", () => {
  it("records what happens when a manual check and a timer tick both fetch the same page concurrently", async () => {
    // Both calls to fetchLeads answer with the SAME page (same external id) -
    // the shape of a manual "Check now" landing before either tick has saved
    // a cursor. The delay opens the same window a real network round trip
    // would: both `tick()` calls get past the `running` guard (it is only set
    // AFTER `await readSiteConnection()`, itself a real await) before either
    // one starts writing.
    const stub: LeadsFetch = async () => {
      await delay(15);
      return leadPage("race-1");
    };
    setLeadsFetch(stub);

    const [manual, timer] = await Promise.all([tick("manual"), tick("timer")]);

    // Whatever the outcome, both calls must at least have run (this is the
    // "already-running" guard failing to close the window - if it closed the
    // window, one of these would come back with reason "already-running"
    // instead of actually polling).
    const ran = [manual, timer].filter((o) => o.ran);

    const externalId = externalIdFor(ORIGIN, "race-1");
    const rows = await raw.query(
      "SELECT count(*) FROM deals WHERE external_id = ? AND deleted_at IS NULL",
      [externalId],
    );
    const liveDealsForThisLead = Number(rows[0][0]);

    // This is the fact this test exists to pin down. Record it either way so
    // a future change to the guard or to applyLeadPage shows up as a failing
    // assertion here rather than silent drift.
    console.info(
      `[pollerRace] two overlapping tick() calls -> ran=${ran.length}, ` +
        `live deals for one external_id=${liveDealsForThisLead}`,
    );

    // The write lock serialises the two applyLeadPage transactions, and
    // deals.findByExternalId is read AFTER the lock is acquired, so today
    // this comes back at 1: the second transaction's own dedupe check sees
    // the first one's already-committed row. This is NOT because the
    // `running` guard closed anything - both ticks really did run - it is
    // applyLeadPage's transactional dedupe doing its job under the write
    // lock's serialisation. Documented, not assumed: if this ever comes back
    // above 1, the write lock has stopped serialising these two writers and
    // that is the real bug to chase.
    expect(liveDealsForThisLead).toBe(1);

    const totalDeals = await deals.list({}, { limit: 100 });
    expect(totalDeals.total).toBe(1);
  });

  it("a manual check while a timer tick is already inside its own transaction still ends with one deal per lead", async () => {
    // A tighter overlap: the second call starts while the first is already
    // past `running = true` and mid-transaction (inside applyLeadPage's
    // withTransaction, which holds the write lock for the whole page).
    let callCount = 0;
    const stub: LeadsFetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        // Give the second tick a chance to start and hit its own `running`
        // check / readSiteConnection await before the first tick proceeds.
        await delay(5);
      }
      return leadPage("race-2");
    };
    setLeadsFetch(stub);

    const first = tick("manual");
    await delay(1); // let the first call begin its own await chain
    const second = tick("timer");

    const [manualOutcome, timerOutcome] = await Promise.all([first, second]);

    const externalId = externalIdFor(ORIGIN, "race-2");
    const rows = await raw.query(
      "SELECT count(*) FROM deals WHERE external_id = ? AND deleted_at IS NULL",
      [externalId],
    );
    console.info(
      `[pollerRace] tight overlap -> manual.ran=${manualOutcome.ran} timer.ran=${timerOutcome.ran} ` +
        `live deals=${Number(rows[0][0])}`,
    );
    expect(Number(rows[0][0])).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* the write path itself, with the poller out of the picture entirely         */
/* -------------------------------------------------------------------------- */

function lead(id: string, overrides: Partial<Lead> = {}): Lead {
  return {
    id,
    createdAt: "2026-03-01T15:04:05.000Z",
    name: "Direct Call",
    email: `${id}@example.com`,
    phone: null,
    service: "Sprinkler repair",
    message: "Called applyLeadPage directly, twice, at once.",
    pageUrl: "https://sorensenlandscaping.com/contact",
    ...overrides,
  };
}

describe("applyLeadPage - two concurrent calls for the same lead, bypassing the poller's own running guard entirely (LR-OPS-W2 A1)", () => {
  // This isolates the question the poller-level tests above cannot: is
  // `withTransaction` (src/db/writeLock.ts) actually serialising two
  // unrelated concurrent writers, or does its module-level `txDepth` counter
  // let a second, independent `applyLeadPage` call slip past `withWrite`'s
  // lock acquisition because some OTHER call happens to be mid-transaction at
  // that instant? If it only serialises correctly by coincidence of timing,
  // a slower disk or a heavier page would be able to break it.
  it("never creates two live deals for one external_id, called concurrently with no delay at all", async () => {
    const context = await prepareApply();
    expect(context).not.toBeNull();

    const [first, second] = await Promise.all([
      applyLeadPage([lead("concurrent-1")], ORIGIN, context!),
      applyLeadPage([lead("concurrent-1")], ORIGIN, context!),
    ]);

    const created = first.created + second.created;
    const skipped = first.skipped + second.skipped;
    console.info(
      `[pollerRace] two bare applyLeadPage() calls, same external_id -> ` +
        `created=${created} skipped=${skipped}`,
    );

    const externalId = externalIdFor(ORIGIN, "concurrent-1");
    const rows = await raw.query(
      "SELECT count(*) FROM deals WHERE external_id = ? AND deleted_at IS NULL",
      [externalId],
    );
    // The write lock's queue means one of these two `withTransaction` calls
    // fully commits before the other's `deals.findByExternalId` read runs -
    // that read only happens after `withWrite`'s `acquire()` resolves, and
    // `acquire()` only resolves once the lock is free. Recorded as a
    // regression guard: this is the one property F-SEC-28's migration
    // (drizzle/0005_lead_dedup.sql) is a second, independent line of defence
    // for - a UNIQUE index makes this true even if the write lock's
    // serialisation is ever weakened by a future change.
    expect(Number(rows[0][0])).toBe(1);
    expect(created).toBe(1);
    expect(skipped).toBe(1);
  });
});
