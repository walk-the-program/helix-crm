/**
 * The five queries behind /reports/people in src/db/repos/reports.ts, each
 * asserted on a hand-built history.
 *
 * Contacts, companies, sources and deals are inserted directly with
 * `raw.execute`, the same way tests/repo/leads/reportViews.test.ts builds its
 * deals: the repos (`src/db/repos/contacts.ts`, `companies.ts`, `sources.ts`,
 * `deals.ts`) all stamp `created_at` with `now()` themselves and take no
 * override, but these tests are about *when* a record arrived and *when* a
 * deal closed, so the timestamps have to be explicit and controllable.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import { newId } from "../../../src/lib/ids";
import {
  loadPeopleReport,
  newPeopleByMonth,
  peopleBySource,
  peopleTotals,
  topCompanies,
} from "../../../src/db/repos/reports";
import { customPeriod, type Period } from "../../../src/lib/periods";

let h: Harness | null = null;
let stageIds: Record<string, string> = {};

/** A range wide enough to hold everything these tests write. */
const ALL_TIME: Period = {
  id: "custom",
  label: "all",
  from: "2000-01-01T00:00:00.000Z",
  to: "2099-01-01T00:00:00.000Z",
};

/** March 2026, the period most of these tests scope to. */
const MARCH: Period = customPeriod("2026-03-01", "2026-03-31")!;

beforeEach(async () => {
  h = await createSeededHarness();
  const pipeline = await pipelines.getDefaultOrThrow();
  stageIds = {};
  for (const stage of await stages.list(pipeline.id)) stageIds[stage.name] = stage.id;
});

afterEach(() => {
  h?.dispose();
  h = null;
});

/* -------------------------------------------------------------------------- */
/* seed helpers - direct inserts, so created_at/closed_at are ours to set     */
/* -------------------------------------------------------------------------- */

async function insertSource(opts: { name: string; deletedAt?: string | null }): Promise<string> {
  const id = newId();
  await raw.execute(
    `INSERT INTO sources (id, name, kind, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'manual', ?, ?, ?)`,
    [id, opts.name, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", opts.deletedAt ?? null],
  );
  return id;
}

async function insertContact(opts: {
  createdAt: string;
  companyId?: string | null;
  sourceId?: string | null;
  deletedAt?: string | null;
}): Promise<string> {
  const id = newId();
  await raw.execute(
    `INSERT INTO contacts
       (id, first_name, last_name, company_id, source_id, created_at, updated_at, deleted_at)
     VALUES (?, 'Test', 'Contact', ?, ?, ?, ?, ?)`,
    [
      id,
      opts.companyId ?? null,
      opts.sourceId ?? null,
      opts.createdAt,
      opts.createdAt,
      opts.deletedAt ?? null,
    ],
  );
  return id;
}

async function insertCompany(opts: {
  createdAt: string;
  sourceId?: string | null;
  deletedAt?: string | null;
  name?: string;
}): Promise<string> {
  const id = newId();
  await raw.execute(
    `INSERT INTO companies (id, name, source_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.name ?? "Test Co",
      opts.sourceId ?? null,
      opts.createdAt,
      opts.createdAt,
      opts.deletedAt ?? null,
    ],
  );
  return id;
}

async function insertDeal(opts: {
  stage: string;
  valueCents?: number;
  createdAt: string;
  closedAt?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  deletedAt?: string | null;
}): Promise<string> {
  const id = newId();
  await raw.execute(
    `INSERT INTO deals
       (id, title, value_cents, stage_id, stage_entered_at, contact_id, company_id,
        closed_at, created_at, updated_at, deleted_at)
     VALUES (?, 'Test deal', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.valueCents ?? 0,
      stageIds[opts.stage],
      opts.createdAt,
      opts.contactId ?? null,
      opts.companyId ?? null,
      opts.closedAt ?? null,
      opts.createdAt,
      opts.createdAt,
      opts.deletedAt ?? null,
    ],
  );
  return id;
}

/* -------------------------------------------------------------------------- */

describe("peopleTotals", () => {
  it("counts contacts and companies, excludes soft-deleted rows, and counts new-in-period on created_at", async () => {
    // In period.
    await insertContact({ createdAt: "2026-03-05T10:00:00.000Z" });
    await insertCompany({ createdAt: "2026-03-06T10:00:00.000Z" });
    // Outside the period.
    await insertContact({ createdAt: "2026-01-01T10:00:00.000Z" });
    // Soft-deleted: must not count toward contacts/companies at all, in or
    // out of the period.
    await insertContact({
      createdAt: "2026-03-07T10:00:00.000Z",
      deletedAt: "2026-03-08T10:00:00.000Z",
    });
    await insertCompany({
      createdAt: "2026-03-07T10:00:00.000Z",
      deletedAt: "2026-03-08T10:00:00.000Z",
    });

    const totals = await peopleTotals(MARCH);

    expect(totals.contacts).toBe(2);
    expect(totals.companies).toBe(1);
    expect(totals.newContacts).toBe(1);
    expect(totals.newCompanies).toBe(1);
  });

  it("counts a contact with two deals once, not twice, in contactsWithDeal", async () => {
    const contactId = await insertContact({ createdAt: "2026-01-01T10:00:00.000Z" });
    await insertContact({ createdAt: "2026-01-02T10:00:00.000Z" }); // no deals
    await insertDeal({
      stage: "New",
      createdAt: "2026-01-05T10:00:00.000Z",
      contactId,
    });
    await insertDeal({
      stage: "Quoted",
      createdAt: "2026-01-06T10:00:00.000Z",
      contactId,
    });

    const companyId = await insertCompany({ createdAt: "2026-01-01T10:00:00.000Z" });
    await insertDeal({
      stage: "New",
      createdAt: "2026-01-07T10:00:00.000Z",
      companyId,
    });

    const totals = await peopleTotals(ALL_TIME);

    expect(totals.contacts).toBe(2);
    expect(totals.contactsWithDeal).toBe(1);
    expect(totals.companiesWithDeal).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("newPeopleByMonth", () => {
  it("zero-fills a month nobody was added in and returns exactly 12 buckets, oldest first", async () => {
    const today = "2026-06-15";

    // Two contacts and a company in January; nothing in March; a company in
    // June (the current month).
    await insertContact({ createdAt: "2026-01-10T10:00:00.000Z" });
    await insertContact({ createdAt: "2026-01-20T10:00:00.000Z" });
    await insertCompany({ createdAt: "2026-01-15T10:00:00.000Z" });
    await insertCompany({ createdAt: "2026-06-01T10:00:00.000Z" });

    const rows = await newPeopleByMonth(today, 12);

    expect(rows).toHaveLength(12);
    expect(rows[0].bucket).toBe("2025-07");
    expect(rows[rows.length - 1].bucket).toBe("2026-06");

    const march = rows.find((r) => r.bucket === "2026-03");
    expect(march).toBeDefined();
    expect(march!.contacts).toBe(0);
    expect(march!.companies).toBe(0);

    const january = rows.find((r) => r.bucket === "2026-01")!;
    expect(january.contacts).toBe(2);
    expect(january.companies).toBe(1);

    const june = rows.find((r) => r.bucket === "2026-06")!;
    expect(june.companies).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("peopleBySource", () => {
  it("puts a contact with no source, and a contact whose source was soft-deleted, in a single Unknown row", async () => {
    const website = await insertSource({ name: "Website" });
    const removedSource = await insertSource({
      name: "Old campaign",
      deletedAt: "2026-02-01T00:00:00.000Z",
    });

    await insertContact({ createdAt: "2026-03-01T10:00:00.000Z", sourceId: website });
    await insertContact({ createdAt: "2026-03-02T10:00:00.000Z", sourceId: null });
    await insertContact({ createdAt: "2026-03-03T10:00:00.000Z", sourceId: removedSource });
    await insertCompany({ createdAt: "2026-03-04T10:00:00.000Z", sourceId: null });

    const rows = await peopleBySource(MARCH);
    const byName = Object.fromEntries(rows.map((r) => [r.sourceName, r]));

    expect(Object.keys(byName).filter((name) => name === "Unknown")).toHaveLength(1);
    expect(byName.Website.contacts).toBe(1);
    expect(byName.Unknown.contacts).toBe(2);
    expect(byName.Unknown.companies).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("topCompanies", () => {
  it("orders by won value descending, excludes a company with nothing won and nothing open, and respects the limit", async () => {
    const companyA = await insertCompany({ createdAt: "2026-01-01T10:00:00.000Z", name: "Big Won" });
    await insertDeal({
      stage: "Won",
      valueCents: 500_000,
      createdAt: "2026-02-01T10:00:00.000Z",
      closedAt: "2026-03-10T10:00:00.000Z",
      companyId: companyA,
    });
    await insertDeal({
      stage: "Quoted",
      valueCents: 75_000,
      createdAt: "2026-03-02T10:00:00.000Z",
      companyId: companyA,
    });

    const companyB = await insertCompany({ createdAt: "2026-01-01T10:00:00.000Z", name: "Small Won" });
    await insertDeal({
      stage: "Won",
      valueCents: 100_000,
      createdAt: "2026-02-01T10:00:00.000Z",
      closedAt: "2026-03-11T10:00:00.000Z",
      companyId: companyB,
    });

    // Nothing won, nothing open: a lost deal only.
    const companyC = await insertCompany({ createdAt: "2026-01-01T10:00:00.000Z", name: "Nothing" });
    await insertDeal({
      stage: "Lost",
      valueCents: 200_000,
      createdAt: "2026-02-01T10:00:00.000Z",
      closedAt: "2026-03-12T10:00:00.000Z",
      companyId: companyC,
    });

    const rows = await topCompanies(MARCH, 10);
    expect(rows.map((r) => r.name)).toEqual(["Big Won", "Small Won"]);

    const bigWon = rows[0];
    expect(bigWon.wonCount).toBe(1);
    expect(bigWon.wonValueCents).toBe(500_000);
    expect(bigWon.openCount).toBe(1);
    expect(bigWon.openValueCents).toBe(75_000);

    const limited = await topCompanies(MARCH, 1);
    expect(limited).toHaveLength(1);
    expect(limited[0].name).toBe("Big Won");
  });
});

/* -------------------------------------------------------------------------- */

describe("an empty database", () => {
  it("returns zeroes and empty arrays from every query, and none of them throw", async () => {
    const totals = await peopleTotals(MARCH);
    expect(totals).toEqual({
      contacts: 0,
      companies: 0,
      contactsWithDeal: 0,
      companiesWithDeal: 0,
      newContacts: 0,
      newCompanies: 0,
    });

    const byMonth = await newPeopleByMonth("2026-06-15", 12);
    expect(byMonth).toHaveLength(12);
    expect(byMonth.every((row) => row.contacts === 0 && row.companies === 0)).toBe(true);

    const bySource = await peopleBySource(MARCH);
    expect(bySource).toEqual([]);

    const top = await topCompanies(MARCH, 10);
    expect(top).toEqual([]);

    const report = await loadPeopleReport(MARCH, "2026-06-15");
    expect(report.totals.contacts).toBe(0);
    expect(report.byMonth).toHaveLength(12);
    expect(report.bySource).toEqual([]);
    expect(report.topCompanies).toEqual([]);
  });
});
