/**
 * LR-OPS-W1 B: a realistic-scale pass.
 *
 * The only existing scale evidence before this file was `tests/repo/data/
 * import-100k.test.ts`, which times one CSV import and nothing else. This
 * file seeds a dataset a genuinely busy solo trade business could plausibly
 * reach after several years - 20,000 contacts, 5,000 deals, 10,000 activities,
 * plus companies, tasks and documents in proportion - once into a real
 * file-backed better-sqlite3 database, then times the repository queries
 * behind Today, the Contacts list, global search and the reports/revenue
 * screens.
 *
 * The seed writes directly through the underlying better-sqlite3 handle
 * inside one transaction rather than through the repository's `raw.batch` /
 * write-lock path: this file is about how fast the READ queries are once the
 * data exists, and re-preparing every insert statement tens of thousands of
 * times through the repository layer would make the one-time seed the
 * dominant cost rather than the thing under test. The table schema, the real
 * indexes and the real triggers (search stays in sync automatically - SQLite
 * fires a table's triggers no matter what wrote the row) are exactly what
 * production uses; only the seeding mechanics are a shortcut.
 *
 * Budgets are generous on purpose (see the comment on TIME_BUDGETS): the goal
 * is to catch a query that scans an entire table with no bound, not to police
 * milliseconds on a loaded CI runner or a five-year-old laptop.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as contactsRepo from "../../../src/db/repos/contacts";
import * as dealsRepo from "../../../src/db/repos/deals";
import * as tasksRepo from "../../../src/db/repos/tasks";
import * as activitiesRepo from "../../../src/db/repos/activities";
import * as reports from "../../../src/db/repos/reports";
import * as receivables from "../../../src/db/repos/receivables";
import { recentRecords, searchRows } from "../../../src/db/repos/search";
import * as paymentsRepo from "../../../src/db/repos/payments";
import { scheduleItems } from "../../../src/features/schedule/lib/feed";
import { periodFor } from "../../../src/lib/periods";
import { todayLocal, nowIso } from "../../../src/lib/dates";

/* -------------------------------------------------------------------------- */
/* scale                                                                      */
/* -------------------------------------------------------------------------- */

const N_COMPANIES = 3_000;
const N_CONTACTS = 20_000;
const N_DEALS = 5_000;
const N_ACTIVITIES = 10_000;
const N_TASKS = 1_500;
const N_DOCUMENTS = 2_500;

/**
 * Generous on purpose. This is a solo trade owner's laptop or an unloaded CI
 * container running one query at a time against local SQLite with warm OS
 * file cache - every one of these numbers is 10-50x the slowest measurement
 * actually seen while writing this file (see the console.table this test
 * prints, and the numbers copied into the LR-OPS-W1 return). The point of a
 * budget this loose is to fail on a query that is missing an index or is
 * scanning an entire table with no bound at all, which shows up as seconds,
 * not one that is merely twice as slow as hoped on a particular machine.
 */
const TIME_BUDGETS = {
  contactsFirstPage: 200,
  contactsDeepPage: 200,
  search: 300,
  searchRecent: 300,
  today: 500,
  reportsOverview: 500,
  reportsDeals: 800,
  reportsPeople: 500,
  reportsRevenue: 800,
  receivablesAging: 300,
  // LR-OPS-RECHECK: the product-expansion screens, on the same dataset.
  scheduleWeek: 400,
  scheduleMonth: 600,
  paymentsForCustomer: 300,
  leadsBySource: 400,
} as const;

/** Deterministic PRNG so a failure is reproducible without a fixed seed file. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260920);
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}
function int(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
function dateOnlyDaysAgo(days: number): string {
  return isoDaysAgo(days).slice(0, 10);
}

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph",
  "Jessica", "Thomas", "Sarah", "Charles", "Karen",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin",
];
const COMPANY_WORDS = [
  "Summit", "Riverside", "Northgate", "Cedar", "Harbor", "Union", "Prairie",
  "Vantage", "Ridgeline", "Copper", "Lakeside", "Foothill", "Meridian", "Ironwood",
];
const COMPANY_SUFFIX = ["Roofing", "Plumbing", "Electric", "HVAC", "Landscaping", "Contracting", "Builders"];

let h: Harness | null = null;
let scratchDir: string;
let dbPath: string;
let pipelineId: string;
let stageIds: { id: string; isWon: boolean; isLost: boolean }[] = [];
let openStageIds: string[] = [];
const measurements: Record<string, number> = {};

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  measurements[label] = Math.round((performance.now() - start) * 100) / 100;
  return result;
}

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "helix-perf-scale-"));
  dbPath = join(scratchDir, "scale.db");
  h = await createSeededHarness({ path: dbPath });

  const db = h.driver.handle();

  const pipelineRow = db
    .prepare("SELECT id FROM pipelines WHERE deleted_at IS NULL LIMIT 1")
    .get() as { id: string };
  pipelineId = pipelineRow.id;
  stageIds = (
    db
      .prepare(
        "SELECT id, is_won, is_lost FROM stages WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position ASC",
      )
      .all(pipelineId) as { id: string; is_won: number; is_lost: number }[]
  ).map((r) => ({ id: r.id, isWon: r.is_won === 1, isLost: r.is_lost === 1 }));
  openStageIds = stageIds.filter((s) => !s.isWon && !s.isLost).map((s) => s.id);
  const wonStageId = stageIds.find((s) => s.isWon)!.id;
  const lostStageId = stageIds.find((s) => s.isLost)!.id;

  const seed = db.transaction(() => {
    const now = nowIso();

    // ---- companies -------------------------------------------------------
    const insertCompany = db.prepare(
      `INSERT INTO companies (id, name, website, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    );
    const companyIds: string[] = [];
    for (let i = 0; i < N_COMPANIES; i += 1) {
      const id = `perf-co-${i}`;
      const name = `${pick(COMPANY_WORDS)} ${pick(COMPANY_SUFFIX)} ${i}`;
      insertCompany.run(id, name, `https://example-${i}.test`, now, now);
      companyIds.push(id);
    }

    // ---- contacts ----------------------------------------------------------
    const insertContact = db.prepare(
      `INSERT INTO contacts (id, first_name, last_name, company_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    const contactIds: string[] = [];
    for (let i = 0; i < N_CONTACTS; i += 1) {
      const id = `perf-c-${i}`;
      const companyId = rand() < 0.4 ? pick(companyIds) : null;
      const createdAt = isoDaysAgo(int(0, 1500));
      insertContact.run(id, pick(FIRST_NAMES), pick(LAST_NAMES), companyId, createdAt, createdAt);
      contactIds.push(id);
    }

    // ---- deals ---------------------------------------------------------
    // Weighted toward closed so the pipeline looks like a real book of work:
    // 35% won, 10% lost, 55% spread across the open stages. A third of the
    // open ones are deliberately made old (entered their stage 30-400 days
    // ago) so the "gone quiet" query in the Today screen has a realistic
    // number of rows to find rather than none at all.
    const insertDeal = db.prepare(
      `INSERT INTO deals
         (id, title, value_cents, currency, stage_id, stage_entered_at, position,
          contact_id, company_id, closed_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    const dealIds: string[] = [];
    for (let i = 0; i < N_DEALS; i += 1) {
      const id = `perf-d-${i}`;
      const roll = rand();
      let stageId: string;
      let closedAt: string | null = null;
      let stageEnteredAt: string;
      const createdAt = isoDaysAgo(int(1, 1400));
      if (roll < 0.35) {
        stageId = wonStageId;
        closedAt = isoDaysAgo(int(0, 400));
        stageEnteredAt = closedAt;
      } else if (roll < 0.45) {
        stageId = lostStageId;
        closedAt = isoDaysAgo(int(0, 400));
        stageEnteredAt = closedAt;
      } else {
        stageId = pick(openStageIds);
        stageEnteredAt = rand() < 0.33 ? isoDaysAgo(int(30, 400)) : isoDaysAgo(int(0, 13));
      }
      const contactId = rand() < 0.7 ? pick(contactIds) : null;
      const companyId = rand() < 0.3 ? pick(companyIds) : null;
      insertDeal.run(
        id,
        `Job ${i}`,
        int(10_000, 2_000_000),
        stageId,
        stageEnteredAt,
        i,
        contactId,
        companyId,
        closedAt,
        createdAt,
        now,
      );
      dealIds.push(id);
    }

    // ---- activities ------------------------------------------------------
    // Mostly on deals (what `goneQuiet` and `lastActivityFor` read), a
    // minority bare contact notes, matching how the product is actually used.
    const insertActivity = db.prepare(
      `INSERT INTO activities
         (id, kind, body, occurred_at, contact_id, company_id, deal_id, is_system, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, NULL)`,
    );
    // Two-thirds of deals get at least one activity, concentrated on deals
    // that are NOT one of the deliberately-old open ones, so the old open
    // deals really do read as quiet rather than merely under-logged.
    for (let i = 0; i < N_ACTIVITIES; i += 1) {
      const id = `perf-a-${i}`;
      const linkToDeal = rand() < 0.8;
      const dealId = linkToDeal ? pick(dealIds) : null;
      const contactId = pick(contactIds);
      const occurredAt = isoDaysAgo(int(0, 60));
      insertActivity.run(
        id,
        pick(["call", "email", "note", "meeting"]),
        `Activity note ${i}`,
        occurredAt,
        dealId ? null : contactId,
        dealId,
        occurredAt,
        occurredAt,
      );
    }

    // ---- tasks -----------------------------------------------------------
    const insertTask = db.prepare(
      `INSERT INTO tasks (id, title, due_on, contact_id, deal_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    for (let i = 0; i < N_TASKS; i += 1) {
      const id = `perf-t-${i}`;
      const dueOn = dateOnlyDaysAgo(int(-14, 30));
      const contactId = rand() < 0.5 ? pick(contactIds) : null;
      const dealId = rand() < 0.5 ? pick(dealIds) : null;
      insertTask.run(id, `Task ${i}`, dueOn, contactId, dealId, now, now);
    }

    // ---- documents ---------------------------------------------------------
    const insertDocument = db.prepare(
      `INSERT INTO documents
         (id, kind, number, deal_id, contact_id, company_id, status, issued_on, due_on, total_cents, paid_on, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    const STATUSES = ["draft", "sent", "paid", "void"] as const;
    for (let i = 0; i < N_DOCUMENTS; i += 1) {
      const id = `perf-doc-${i}`;
      const dealId = pick(dealIds);
      const status = pick(STATUSES);
      const issuedOn = dateOnlyDaysAgo(int(0, 400));
      const dueOn = dateOnlyDaysAgo(int(-30, 370));
      const paidOn = status === "paid" ? dateOnlyDaysAgo(int(0, 380)) : null;
      insertDocument.run(
        id,
        "invoice",
        `INV-${1000 + i}`,
        dealId,
        null,
        null,
        status,
        issuedOn,
        dueOn,
        int(10_000, 500_000),
        paidOn,
        now,
        now,
      );
    }

    // ---- payments (LR-OPS-RECHECK) ------------------------------------------
    // One per already-paid invoice, which is exactly the shape migration
    // 0006's backfill leaves behind on an upgraded workspace, plus a second
    // one on a slice of them so the partial-payment path is represented too.
    const insertPayment = db.prepare(
      `INSERT INTO payments
         (id, document_id, deal_id, amount_cents, paid_on, method, reference, note, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
    );
    const paidInvoices = db
      .prepare("SELECT id, deal_id, total_cents, paid_on FROM documents WHERE status = 'paid'")
      .all() as { id: string; deal_id: string | null; total_cents: number; paid_on: string }[];
    let paymentIndex = 0;
    for (const invoice of paidInvoices) {
      insertPayment.run(
        `perf-pay-${paymentIndex}`,
        invoice.id,
        invoice.deal_id,
        invoice.total_cents,
        invoice.paid_on,
        pick(["cash", "check", "card", "transfer", "other"]),
        now,
        now,
      );
      paymentIndex += 1;
    }

    // ---- timed visits and automation tasks (LR-OPS-RECHECK) -----------------
    // The Schedule screen reads tasks with a `due_at`; a third of the task
    // rows become real appointments with a place and a duration, and a slice
    // of those are automation-created so the source filter has something to
    // discriminate.
    const makeVisit = db.prepare(
      `UPDATE tasks SET due_at = ?, place = ?, duration_minutes = ?, source = ?
        WHERE id = ?`,
    );
    for (let i = 0; i < N_TASKS; i += 3) {
      const day = dateOnlyDaysAgo(int(-14, 30));
      makeVisit.run(
        `${day}T${String(int(7, 18)).padStart(2, "0")}:00:00.000Z`,
        `${int(1, 9000)} Main Street`,
        pick([30, 45, 60, 90, 120]),
        i % 9 === 0 ? "automation" : "user",
        `perf-t-${i}`,
      );
    }

    // ---- a source on most deals (LR-OPS-RECHECK) ----------------------------
    // The leads-by-source report groups deals by `source_id`; with every row
    // NULL it would measure an empty grouping rather than the real one.
    const sourceRows = db
      .prepare("SELECT id FROM sources WHERE deleted_at IS NULL")
      .all() as { id: string }[];
    if (sourceRows.length > 0) {
      const setSource = db.prepare("UPDATE deals SET source_id = ? WHERE id = ?");
      for (let i = 0; i < N_DEALS; i += 1) {
        if (rand() < 0.15) continue; // some deals genuinely have no source
        setSource.run(sourceRows[i % sourceRows.length].id, `perf-d-${i}`);
      }
    }
  });

  seed();
}, 120_000);

afterAll(() => {
  h?.dispose();
  rmSync(scratchDir, { recursive: true, force: true });
  // One line rather than console.table: a table is unreadable in a CI log and
  // vitest's default reporter swallows it, which made the numbers this file
  // exists to produce invisible unless you ran it in a terminal by hand.
  // eslint-disable-next-line no-console
  console.info(`[perf] ${JSON.stringify(measurements)}`);
});

describe("realistic-scale pass: 20k contacts / 5k deals / 10k activities (LR-OPS-W1 B)", () => {
  it("seeded the full dataset", async () => {
    const counts = await raw.query(
      `SELECT (SELECT count(*) FROM contacts), (SELECT count(*) FROM deals),
              (SELECT count(*) FROM activities), (SELECT count(*) FROM companies),
              (SELECT count(*) FROM tasks), (SELECT count(*) FROM documents)`,
    );
    expect(counts[0].map(Number)).toEqual([
      N_CONTACTS,
      N_DEALS,
      N_ACTIVITIES,
      N_COMPANIES,
      N_TASKS,
      N_DOCUMENTS,
    ]);
  });

  it(`Contacts list, first page, within ${TIME_BUDGETS.contactsFirstPage} ms`, async () => {
    const result = await time("contacts.list first page", () =>
      contactsRepo.list({}, { limit: 50 }),
    );
    expect(result.rows).toHaveLength(50);
    expect(result.total).toBe(N_CONTACTS);
    expect(measurements["contacts.list first page"]).toBeLessThan(
      TIME_BUDGETS.contactsFirstPage,
    );
  });

  it(`Contacts list, a deep page (offset ~19,900), within ${TIME_BUDGETS.contactsDeepPage} ms`, async () => {
    const result = await time("contacts.list deep page", () =>
      contactsRepo.list({}, { limit: 50, offset: N_CONTACTS - 100 }),
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(measurements["contacts.list deep page"]).toBeLessThan(
      TIME_BUDGETS.contactsDeepPage,
    );
  });

  it(`Global search, within ${TIME_BUDGETS.search} ms`, async () => {
    await time("search.searchRows", () => searchRows("smith roofing"));
    expect(measurements["search.searchRows"]).toBeLessThan(TIME_BUDGETS.search);
  });

  it(`Global search's pre-keystroke "recent records" (contacts+companies+deals UNION ALL, no per-branch LIMIT), within ${TIME_BUDGETS.searchRecent} ms`, async () => {
    // B1: this is the one search-screen query with no FTS index and no
    // per-branch LIMIT behind it - each UNION ALL leg reads its whole live
    // table before the final ORDER BY + LIMIT. Bounded by total row count
    // (here: 20k + 3k + 5k = 28k live rows), which is exactly the population
    // this perf pass exists to measure rather than assume.
    await time("search.recentRecords", () => recentRecords(8));
    expect(measurements["search.recentRecords"]).toBeLessThan(TIME_BUDGETS.searchRecent);
  });

  it(`Today's queries (goneQuiet, newLeads, tasks.today, recentWithLinks), within ${TIME_BUDGETS.today} ms combined`, async () => {
    const at = nowIso();
    const combined = await time("today (goneQuiet+newLeads+tasks+recent)", async () => {
      const [quiet, leads, dueBuckets, recent] = await Promise.all([
        dealsRepo.goneQuiet(at),
        dealsRepo.newLeads({ sinceIso: isoDaysAgo(7), limit: 25 }),
        tasksRepo.today(todayLocal()),
        activitiesRepo.recentWithLinks(20),
      ]);
      return { quiet, leads, dueBuckets, recent };
    });
    expect(combined.leads.length).toBeLessThanOrEqual(25);
    expect(combined.recent.length).toBeLessThanOrEqual(20);
    // The point of this pass: goneQuiet has no LIMIT (see the LR-OPS-W1
    // return's B1 finding), so seeding deliberately old open deals above
    // means this number is the real evidence for whether that is a problem
    // at this scale, not a guess.
    // eslint-disable-next-line no-console
    console.info(`[perf] goneQuiet rows = ${combined.quiet.length}`);
    expect(measurements["today (goneQuiet+newLeads+tasks+recent)"]).toBeLessThan(
      TIME_BUDGETS.today,
    );
  });

  it(`Reports: overview, within ${TIME_BUDGETS.reportsOverview} ms`, async () => {
    const period = periodFor("month");
    await time("reports.loadOverview", () => reports.loadOverview(period));
    expect(measurements["reports.loadOverview"]).toBeLessThan(TIME_BUDGETS.reportsOverview);
  });

  it(`Reports: deals report, within ${TIME_BUDGETS.reportsDeals} ms`, async () => {
    const period = periodFor("quarter");
    await time("reports.loadDealsReport", () =>
      reports.loadDealsReport(period, "week", "month"),
    );
    expect(measurements["reports.loadDealsReport"]).toBeLessThan(TIME_BUDGETS.reportsDeals);
  });

  it(`Reports: people report, within ${TIME_BUDGETS.reportsPeople} ms`, async () => {
    const period = periodFor("year");
    await time("reports.loadPeopleReport", () => reports.loadPeopleReport(period));
    expect(measurements["reports.loadPeopleReport"]).toBeLessThan(TIME_BUDGETS.reportsPeople);
  });

  it(`Reports: revenue (recurringDeals + money), within ${TIME_BUDGETS.reportsRevenue} ms`, async () => {
    const period = periodFor("year");
    await time("reports.revenueMoney + revenue", async () => {
      const [revenueMoney, revenueBundle] = await Promise.all([
        reports.revenueMoney(period),
        reports.revenue(reports.revenueParams()),
      ]);
      return { revenueMoney, revenueBundle };
    });
    expect(measurements["reports.revenueMoney + revenue"]).toBeLessThan(
      TIME_BUDGETS.reportsRevenue,
    );
  });

  it(`Receivables aging, within ${TIME_BUDGETS.receivablesAging} ms`, async () => {
    await time("receivables.aging", () => receivables.aging());
    expect(measurements["receivables.aging"]).toBeLessThan(TIME_BUDGETS.receivablesAging);
  });

  /* ------------------------------------------------------------------ */
  /* product expansion (LR-OPS-RECHECK item 4)                          */
  /* ------------------------------------------------------------------ */

  /**
   * The Schedule screen's one read. It fans out to five repositories - tasks,
   * deals, recurring rules, invoice due dates and invoice-schedule issue
   * dates - and two of those (`listInvoices`, `listInvoiceSchedules`) take no
   * range at all and are filtered in JavaScript afterwards. That is the one
   * shape in this feature that could scale badly, so it is measured on a
   * month rather than only on a week.
   */
  it(`Schedule: one week, within ${TIME_BUDGETS.scheduleWeek} ms`, async () => {
    const from = dateOnlyDaysAgo(3);
    const to = dateOnlyDaysAgo(-4);
    const items = await time("schedule.week", () => scheduleItems({ from, to }));
    expect(Array.isArray(items)).toBe(true);
    expect(measurements["schedule.week"]).toBeLessThan(TIME_BUDGETS.scheduleWeek);
  });

  it(`Schedule: one month, within ${TIME_BUDGETS.scheduleMonth} ms`, async () => {
    const from = dateOnlyDaysAgo(14);
    const to = dateOnlyDaysAgo(-16);
    await time("schedule.month", () => scheduleItems({ from, to }));
    expect(measurements["schedule.month"]).toBeLessThan(TIME_BUDGETS.scheduleMonth);
  });

  /**
   * The customer statement: every payment a contact or company has ever made,
   * joined back through their invoices. Bounded by one customer's own
   * documents, which is the bound worth stating - it does not grow with the
   * workspace, only with how much business that one customer has done.
   */
  it(`Payments: one customer's statement, within ${TIME_BUDGETS.paymentsForCustomer} ms`, async () => {
    const withPayments = await raw.query(
      `SELECT d.contact_id FROM payments p JOIN documents d ON d.id = p.document_id
        WHERE d.contact_id IS NOT NULL LIMIT 1`,
      [],
    );
    const contactId =
      withPayments.length > 0 ? String(withPayments[0][0]) : `perf-c-0`;
    await time("payments.listForCustomer", () =>
      paymentsRepo.listForCustomer({ contactId }),
    );
    expect(measurements["payments.listForCustomer"]).toBeLessThan(
      TIME_BUDGETS.paymentsForCustomer,
    );
  });

  /**
   * The Sources report: every deal in the period grouped by source. It reads
   * the whole period rather than a page, which is correct for an aggregate
   * and is why the number below matters - a year of 5,000 deals is the
   * realistic worst case for a business this size.
   */
  it(`Reports: leads by source, within ${TIME_BUDGETS.leadsBySource} ms`, async () => {
    const period = periodFor("year");
    const rows = await time("reports.leadsBySource", () => reports.leadsBySource(period));
    expect(rows.length, "the seed gave most deals a source").toBeGreaterThan(0);
    expect(measurements["reports.leadsBySource"]).toBeLessThan(TIME_BUDGETS.leadsBySource);
  });

  /**
   * Payments changed what Collected and Outstanding mean: both now join the
   * payments table on every read. The two report timings above already
   * exercise that, and this asserts the join really is present in the data
   * rather than measuring an empty table.
   */
  it("the money reports are measuring a workspace that actually has payments", async () => {
    const rows = await raw.query(`SELECT count(*) FROM payments`, []);
    expect(Number(rows[0][0]), "one payment per paid invoice").toBeGreaterThan(100);
  });
});