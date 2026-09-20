/**
 * The money model: Quoted, Open, Won, Invoiced, Collected, Outstanding.
 *
 * The properties worth holding still, because every money screen in the
 * product reads these words from this one module:
 *
 *   - Quoted is the DEAL'S value, not the sum of its quote documents: a trade
 *     owner prices the job on the deal and mostly never raises a separate
 *     quote at all, and the deal page used to read "Quoted $0" for a job the
 *     board valued at $14,800;
 *   - Open is the same value while the deal is still live, so it matches the
 *     pipeline figure on the reports;
 *   - over a period, Quoted and Open fall on the day the deal was created,
 *     Won on the day it closed, Invoiced on issue and Collected on payment;
 *   - a draft and a voided invoice are not a billing;
 *   - Collected falls on `paid_on` and Invoiced on `issued_on`, so a period
 *     can collect more than it billed;
 *   - Outstanding over a deal is exactly Invoiced minus Collected, while over
 *     a period it is what that period issued and has not been paid for;
 *   - a deal with three invoices does not multiply its own won value by three.
 *
 * Rows are inserted with SQL rather than through the repositories: a report
 * test needs to choose its own `issued_on`, `paid_on` and `closed_at`, and the
 * write helpers all stamp "now".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import {
  customerMoney,
  dealMoney,
  perDealMoney,
  periodMoney,
  NO_DEAL_ROW_ID,
} from "../../../src/db/repos/money";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createSeededHarness();
});

afterEach(() => {
  h?.dispose();
  h = null;
});

/** The seeded pipeline's stages, by name. */
async function stageId(name: string): Promise<string> {
  const rows = await raw.query(`SELECT id FROM stages WHERE name = ?`, [name]);
  return String(rows[0][0]);
}

async function insertCompany(id: string, name: string): Promise<void> {
  await raw.execute(
    `INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [id, name, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  );
}

async function insertDeal(options: {
  id: string;
  title?: string;
  valueCents?: number;
  stage: string;
  createdAt?: string;
  closedAt?: string | null;
  companyId?: string | null;
  deletedAt?: string | null;
}): Promise<void> {
  const at = options.createdAt ?? "2026-03-02T10:00:00.000Z";
  await raw.execute(
    `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at,
                        position, company_id, closed_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      options.id,
      options.title ?? options.id,
      options.valueCents ?? 0,
      await stageId(options.stage),
      at,
      options.companyId ?? null,
      options.closedAt ?? null,
      at,
      at,
      options.deletedAt ?? null,
    ],
  );
}

let documentSeq = 0;

async function insertDocument(options: {
  id: string;
  kind: "quote" | "invoice";
  status: string;
  totalCents: number;
  dealId?: string | null;
  companyId?: string | null;
  issuedOn?: string | null;
  paidOn?: string | null;
  deletedAt?: string | null;
}): Promise<void> {
  documentSeq += 1;
  await raw.execute(
    `INSERT INTO documents (id, kind, number, deal_id, company_id, status, issued_on,
                            subtotal_cents, tax_rate_bp, tax_cents, total_cents,
                            paid_on, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    [
      options.id,
      options.kind,
      `${options.kind === "quote" ? "Q" : "INV"}-${documentSeq}`,
      options.dealId ?? null,
      options.companyId ?? null,
      options.status,
      options.issuedOn ?? null,
      options.totalCents,
      options.totalCents,
      options.paidOn ?? null,
      "2026-03-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      options.deletedAt ?? null,
    ],
  );
}

/** March 2026, as the period picker builds it: half-open local instants. */
const MARCH = {
  from: new Date(2026, 2, 1).toISOString(),
  to: new Date(2026, 3, 1).toISOString(),
};

describe("dealMoney", () => {
  it("counts sent and paid invoices, and neither drafts nor voids", async () => {
    await insertDeal({ id: "d1", valueCents: 500_00, stage: "Won", closedAt: "2026-03-10T00:00:00.000Z" });
    await insertDocument({ id: "q1", kind: "quote", status: "sent", totalCents: 600_00, dealId: "d1", issuedOn: "2026-03-02" });
    await insertDocument({ id: "q2", kind: "quote", status: "draft", totalCents: 999_00, dealId: "d1", issuedOn: "2026-03-02" });
    await insertDocument({ id: "i1", kind: "invoice", status: "paid", totalCents: 300_00, dealId: "d1", issuedOn: "2026-03-05", paidOn: "2026-03-20" });
    await insertDocument({ id: "i2", kind: "invoice", status: "sent", totalCents: 200_00, dealId: "d1", issuedOn: "2026-03-06" });
    await insertDocument({ id: "i3", kind: "invoice", status: "draft", totalCents: 111_00, dealId: "d1" });
    await insertDocument({ id: "i4", kind: "invoice", status: "void", totalCents: 222_00, dealId: "d1", issuedOn: "2026-03-07" });

    const money = await dealMoney("d1");

    // Quoted is the deal's own value, not the $600 quote document above it.
    expect(money.quotedCents).toBe(500_00);
    // A deal in a won stage is not open.
    expect(money.openCents).toBe(0);
    expect(money.wonCents).toBe(500_00);
    expect(money.invoicedCents).toBe(500_00);
    expect(money.collectedCents).toBe(300_00);
    // Over a deal the two definitions of outstanding agree exactly.
    expect(money.outstandingCents).toBe(200_00);
    expect(money.outstandingCents).toBe(money.invoicedCents - money.collectedCents);
  });

  it("carries its value as Quoted and Open before anybody has billed it", async () => {
    await insertDeal({ id: "d2", valueCents: 100_00, stage: "New" });
    expect(await dealMoney("d2")).toEqual({
      quotedCents: 100_00,
      openCents: 100_00,
      wonCents: 0,
      invoicedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
    });
  });

  it("is all zeroes for an unknown id", async () => {
    expect(await dealMoney("nope")).toEqual({
      quotedCents: 0,
      openCents: 0,
      wonCents: 0,
      invoicedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
    });
  });

  it("does not count a lost deal as open, but still counts it as quoted", async () => {
    await insertDeal({ id: "d-lost", valueCents: 800_00, stage: "Lost" });
    const money = await dealMoney("d-lost");
    expect(money.quotedCents).toBe(800_00);
    expect(money.openCents).toBe(0);
    expect(money.wonCents).toBe(0);
  });

  it("ignores a soft-deleted invoice and a soft-deleted deal's won value", async () => {
    await insertDeal({
      id: "d3",
      valueCents: 400_00,
      stage: "Won",
      closedAt: "2026-03-10T00:00:00.000Z",
      deletedAt: "2026-03-11T00:00:00.000Z",
    });
    await insertDocument({ id: "i5", kind: "invoice", status: "sent", totalCents: 50_00, dealId: "d3", issuedOn: "2026-03-05", deletedAt: "2026-03-06T00:00:00.000Z" });

    const money = await dealMoney("d3");
    expect(money.quotedCents).toBe(0);
    expect(money.openCents).toBe(0);
    expect(money.wonCents).toBe(0);
    expect(money.invoicedCents).toBe(0);
  });
});

describe("customerMoney", () => {
  it("adds up a company's deals and documents, and counts a row carrying both ids once", async () => {
    await insertCompany("co1", "Harker Builders");
    await insertDeal({ id: "d4", valueCents: 250_00, stage: "Won", closedAt: "2026-03-09T00:00:00.000Z", companyId: "co1" });
    await insertDocument({ id: "i6", kind: "invoice", status: "paid", totalCents: 250_00, dealId: "d4", companyId: "co1", issuedOn: "2026-03-09", paidOn: "2026-03-15" });

    const money = await customerMoney({ companyId: "co1" });
    expect(money.quotedCents).toBe(250_00);
    expect(money.openCents).toBe(0);
    expect(money.wonCents).toBe(250_00);
    expect(money.invoicedCents).toBe(250_00);
    expect(money.collectedCents).toBe(250_00);
    expect(money.outstandingCents).toBe(0);
  });

  it("adds up a company's open deals into openCents", async () => {
    await insertCompany("co-open", "Vance Property");
    await insertDeal({ id: "d-o1", valueCents: 300_00, stage: "New", companyId: "co-open" });
    await insertDeal({ id: "d-o2", valueCents: 200_00, stage: "Scheduled", companyId: "co-open" });
    await insertDeal({ id: "d-o3", valueCents: 900_00, stage: "Won", closedAt: "2026-03-09T00:00:00.000Z", companyId: "co-open" });
    await insertDeal({ id: "d-o4", valueCents: 400_00, stage: "Lost", companyId: "co-open" });

    const money = await customerMoney({ companyId: "co-open" });
    expect(money.openCents).toBe(500_00);
    expect(money.wonCents).toBe(900_00);
    // Quoted is everything ever offered, lost deals included.
    expect(money.quotedCents).toBe(1_800_00);
  });

  it("is zero for an empty reference rather than the whole workspace", async () => {
    await insertCompany("co2", "Nobody");
    await insertDeal({ id: "d5", valueCents: 900_00, stage: "Won", closedAt: "2026-03-09T00:00:00.000Z", companyId: "co2" });

    expect(await customerMoney({})).toEqual({
      quotedCents: 0,
      openCents: 0,
      wonCents: 0,
      invoicedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
    });
  });
});

describe("periodMoney", () => {
  it("bills on issued_on and collects on paid_on, so a month can collect more than it billed", async () => {
    // February's invoice, paid in March.
    await insertDocument({ id: "i7", kind: "invoice", status: "paid", totalCents: 800_00, issuedOn: "2026-02-20", paidOn: "2026-03-04" });
    // March's invoice, still unpaid.
    await insertDocument({ id: "i8", kind: "invoice", status: "sent", totalCents: 100_00, issuedOn: "2026-03-12" });

    const money = await periodMoney(MARCH.from, MARCH.to);
    expect(money.invoicedCents).toBe(100_00);
    expect(money.collectedCents).toBe(800_00);
    // Outstanding is what March issued and has not been paid for, never
    // invoiced minus collected across two different clocks.
    expect(money.outstandingCents).toBe(100_00);
  });

  it("puts a deal's won value in the month it closed in", async () => {
    await insertDeal({ id: "d6", valueCents: 700_00, stage: "Won", closedAt: "2026-03-31T18:00:00.000Z" });
    await insertDeal({ id: "d7", valueCents: 300_00, stage: "Won", closedAt: "2026-04-02T18:00:00.000Z" });

    expect((await periodMoney(MARCH.from, MARCH.to)).wonCents).toBe(700_00);
  });

  it("quotes a deal in the month it was created, and wins it in the month it closed", async () => {
    // Created in February, won in March: quoted last month, won this month.
    await insertDeal({
      id: "d-feb",
      valueCents: 600_00,
      stage: "Won",
      createdAt: "2026-02-14T10:00:00.000Z",
      closedAt: "2026-03-05T00:00:00.000Z",
    });
    // Created in March and still open: quoted and open this month.
    await insertDeal({ id: "d-mar", valueCents: 250_00, stage: "New", createdAt: "2026-03-06T10:00:00.000Z" });

    const money = await periodMoney(MARCH.from, MARCH.to);
    expect(money.quotedCents).toBe(250_00);
    expect(money.openCents).toBe(250_00);
    expect(money.wonCents).toBe(600_00);
  });

  it("is all zeroes on an empty workspace", async () => {
    const money = await periodMoney(MARCH.from, MARCH.to);
    expect(money).toEqual({
      quotedCents: 0,
      openCents: 0,
      wonCents: 0,
      invoicedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
    });
  });
});

describe("perDealMoney", () => {
  it("does not multiply a deal's won value by the number of its invoices", async () => {
    await insertDeal({ id: "d8", title: "Back garden", valueCents: 1_000_00, stage: "Won", closedAt: "2026-03-10T00:00:00.000Z" });
    for (const id of ["a", "b", "c"]) {
      await insertDocument({ id: `i-${id}`, kind: "invoice", status: "sent", totalCents: 100_00, dealId: "d8", issuedOn: "2026-03-11" });
    }

    const rows = await perDealMoney(MARCH.from, MARCH.to);
    expect(rows).toHaveLength(1);
    expect(rows[0].dealId).toBe("d8");
    expect(rows[0].quotedCents).toBe(1_000_00);
    expect(rows[0].wonCents).toBe(1_000_00);
    expect(rows[0].invoicedCents).toBe(300_00);
  });

  it("names the company as the customer, and counts a deal created in the period as quoted", async () => {
    await insertCompany("co3", "Oak Ridge HOA");
    await insertDeal({ id: "d9", valueCents: 200_00, stage: "Won", closedAt: "2026-03-10T00:00:00.000Z", companyId: "co3" });
    // Created in March and still open: quoted in the period, so it is a row.
    await insertDeal({ id: "d10", valueCents: 500_00, stage: "New" });
    // Created long before the period and never touched since: not a row.
    await insertDeal({ id: "d10b", valueCents: 700_00, stage: "New", createdAt: "2025-11-04T10:00:00.000Z" });

    const rows = await perDealMoney(MARCH.from, MARCH.to);
    expect(rows.map((row) => row.dealId)).toEqual(["d9", "d10"]);
    expect(rows[0].customerName).toBe("Oak Ridge HOA");
    expect(rows[1].quotedCents).toBe(500_00);
    expect(rows[1].openCents).toBe(500_00);
  });

  it("sums to the headline when a document has no deal, through a 'No job' row", async () => {
    await insertDeal({ id: "d12", valueCents: 0, stage: "Scheduled" });
    await insertDocument({ id: "i10", kind: "invoice", status: "sent", totalCents: 100_00, dealId: "d12", issuedOn: "2026-03-04" });
    // The pre-round-3 document: no deal at all.
    await insertDocument({ id: "i11", kind: "invoice", status: "sent", totalCents: 70_00, issuedOn: "2026-03-05" });

    const rows = await perDealMoney(MARCH.from, MARCH.to);
    const headline = await periodMoney(MARCH.from, MARCH.to);

    const noJob = rows.find((row) => row.dealId === NO_DEAL_ROW_ID);
    expect(noJob).toBeDefined();
    expect(noJob!.title).toBe("No job");
    expect(noJob!.invoicedCents).toBe(70_00);
    expect(rows.reduce((sum, row) => sum + row.invoicedCents, 0)).toBe(headline.invoicedCents);
  });

  it("keeps a trashed deal's sent invoice in the 'No job' row rather than losing it", async () => {
    await insertDeal({
      id: "d13",
      valueCents: 900_00,
      stage: "Won",
      closedAt: "2026-03-08T00:00:00.000Z",
      deletedAt: "2026-03-09T00:00:00.000Z",
    });
    await insertDocument({ id: "i12", kind: "invoice", status: "sent", totalCents: 250_00, dealId: "d13", issuedOn: "2026-03-08" });

    const rows = await perDealMoney(MARCH.from, MARCH.to);
    const headline = await periodMoney(MARCH.from, MARCH.to);

    expect(rows.map((row) => row.dealId)).toEqual([NO_DEAL_ROW_ID]);
    expect(rows[0].invoicedCents).toBe(250_00);
    expect(rows.reduce((sum, row) => sum + row.invoicedCents, 0)).toBe(headline.invoicedCents);
    // The trashed deal carries no value into any column.
    expect(rows[0].quotedCents).toBe(0);
    expect(rows[0].wonCents).toBe(0);
  });

  it("adds no 'No job' row when every document belongs to a live deal", async () => {
    await insertDeal({ id: "d14", valueCents: 100_00, stage: "New" });
    const rows = await perDealMoney(MARCH.from, MARCH.to);
    expect(rows.some((row) => row.dealId === NO_DEAL_ROW_ID)).toBe(false);
  });

  it("includes an open deal that was invoiced in the period", async () => {
    await insertDeal({ id: "d11", valueCents: 0, stage: "Scheduled" });
    await insertDocument({ id: "i9", kind: "invoice", status: "sent", totalCents: 75_00, dealId: "d11", issuedOn: "2026-03-14" });

    const rows = await perDealMoney(MARCH.from, MARCH.to);
    expect(rows.map((row) => row.dealId)).toEqual(["d11"]);
    expect(rows[0].wonCents).toBe(0);
    expect(rows[0].invoicedCents).toBe(75_00);
    expect(rows[0].customerName).toBeNull();
  });
});
