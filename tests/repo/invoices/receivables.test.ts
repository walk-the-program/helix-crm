/**
 * `src/db/repos/receivables.ts` against the real migrated schema.
 *
 * Every document is created through `documents.ts`'s own `create`, `send` and
 * `markPaid` rather than hand-written INSERTs, so this test breaks the moment
 * the document repo's own shape changes rather than silently drifting from
 * it. Contacts and companies go through their own repos for the same reason.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as deals from "../../../src/db/repos/deals";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import { addDaysToDateString } from "../../../src/lib/dates";
import {
  AGING_BUCKETS,
  aging,
  bucketFor,
  collectedThisMonth,
  outstanding,
} from "../../../src/db/repos/receivables";

let h: Harness | null = null;

beforeEach(async () => {
  // Seeded (not just createHarness): every invoice below now belongs to a
  // deal (the money model, round 3), and a deal needs a real pipeline stage
  // to be created against.
  h = await createSeededHarness();
});

afterEach(() => {
  h?.dispose();
  h = null;
});

/* -------------------------------------------------------------------------- */
/* seeding helpers                                                            */
/* -------------------------------------------------------------------------- */

async function makeContact(firstName: string, lastName: string): Promise<string> {
  const contact = await contacts.create({ firstName, lastName });
  return contact.id;
}

async function makeCompany(name: string): Promise<string> {
  const company = await companies.create({ name });
  return company.id;
}

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  return all[0].id;
}

type InvoiceOptions = {
  contactId?: string | null;
  companyId?: string | null;
  dueOn?: string | null;
  totalCents: number;
  issuedOn?: string;
};

/**
 * A draft invoice, one line, no tax, so `totalCents` is exactly the line.
 *
 * The money model says a document's customer is its deal's customer, never
 * its own, so this seeds a deal with the requested contact/company first and
 * hangs the invoice off that - the document repo copies them across itself.
 */
async function createInvoice(options: InvoiceOptions): Promise<documents.Document> {
  const deal = await deals.create({
    title: "Receivables test deal",
    stageId: await firstStageId(),
    contactId: options.contactId ?? null,
    companyId: options.companyId ?? null,
  });
  return documents.create({
    kind: "invoice",
    dealId: deal.id,
    prefix: "INV",
    taxRateBp: 0,
    issuedOn: options.issuedOn ?? "2026-01-01",
    dueOn: options.dueOn ?? null,
    items: [
      {
        name: "Service",
        qty: 1,
        unitCents: options.totalCents,
        taxable: false,
      },
    ],
  });
}

/** Draft -> sent, with `dueOn` already fixed at creation so `send` leaves it alone. */
async function sentInvoice(options: InvoiceOptions): Promise<documents.Document> {
  const created = await createInvoice(options);
  return documents.send(created.id, { at: `${options.issuedOn ?? "2026-01-01"}T09:00:00.000Z` });
}

async function paidInvoice(
  options: InvoiceOptions & { paidOn: string },
): Promise<documents.Document> {
  const sent = await sentInvoice(options);
  await payments.recordFullPayment(sent.id, { paidOn: options.paidOn });
  return (await documents.getOrThrow(sent.id)).document;
}

/* -------------------------------------------------------------------------- */
/* bucketFor                                                                  */
/* -------------------------------------------------------------------------- */

describe("bucketFor", () => {
  const reference = "2026-03-31";

  it("is current with no due date at all", () => {
    expect(bucketFor(null, reference)).toBe("current");
  });

  it("is current when due today", () => {
    expect(bucketFor(reference, reference)).toBe("current");
  });

  it("is current when due tomorrow", () => {
    expect(bucketFor(addDaysToDateString(reference, 1), reference)).toBe("current");
  });

  it("is 1-30 at 1 day over", () => {
    expect(bucketFor(addDaysToDateString(reference, -1), reference)).toBe("1-30");
  });

  it("is 1-30 at exactly 30 days over", () => {
    expect(bucketFor(addDaysToDateString(reference, -30), reference)).toBe("1-30");
  });

  it("is 31-60 at exactly 31 days over", () => {
    expect(bucketFor(addDaysToDateString(reference, -31), reference)).toBe("31-60");
  });

  it("is 31-60 at exactly 60 days over", () => {
    expect(bucketFor(addDaysToDateString(reference, -60), reference)).toBe("31-60");
  });

  it("is 61-90 at exactly 61 days over", () => {
    expect(bucketFor(addDaysToDateString(reference, -61), reference)).toBe("61-90");
  });

  it("is 61-90 at exactly 90 days over", () => {
    expect(bucketFor(addDaysToDateString(reference, -90), reference)).toBe("61-90");
  });

  it("is 90+ at exactly 91 days over", () => {
    expect(bucketFor(addDaysToDateString(reference, -91), reference)).toBe("90+");
  });
});

/* -------------------------------------------------------------------------- */
/* aging                                                                      */
/* -------------------------------------------------------------------------- */

describe("aging", () => {
  it("always returns all five buckets, zeroed, when there is nothing outstanding", async () => {
    const result = await aging("2026-03-31");
    expect(result.rows.map((r) => r.bucket)).toEqual([...AGING_BUCKETS]);
    for (const row of result.rows) {
      expect(row.count).toBe(0);
      expect(row.cents).toBe(0);
    }
    expect(result.totalCents).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  it("sums counts and cents into the right bucket, with all five present", async () => {
    const reference = "2026-03-31";
    const companyId = await makeCompany("Green Lawns LLC");

    // current: due today.
    await sentInvoice({ companyId, dueOn: reference, totalCents: 10_000 });
    // 1-30: 15 days over.
    await sentInvoice({
      companyId,
      dueOn: addDaysToDateString(reference, -15),
      totalCents: 5_000,
    });
    await sentInvoice({
      companyId,
      dueOn: addDaysToDateString(reference, -15),
      totalCents: 2_500,
    });
    // 31-60: 45 days over.
    await sentInvoice({
      companyId,
      dueOn: addDaysToDateString(reference, -45),
      totalCents: 20_000,
    });
    // 61-90: 75 days over.
    await sentInvoice({
      companyId,
      dueOn: addDaysToDateString(reference, -75),
      totalCents: 30_000,
    });
    // 90+: 120 days over.
    await sentInvoice({
      companyId,
      dueOn: addDaysToDateString(reference, -120),
      totalCents: 40_000,
    });

    const result = await aging(reference);
    expect(result.rows.map((r) => r.bucket)).toEqual([...AGING_BUCKETS]);

    const byBucket = Object.fromEntries(result.rows.map((r) => [r.bucket, r]));
    expect(byBucket.current).toEqual({ bucket: "current", count: 1, cents: 10_000 });
    expect(byBucket["1-30"]).toEqual({ bucket: "1-30", count: 2, cents: 7_500 });
    expect(byBucket["31-60"]).toEqual({ bucket: "31-60", count: 1, cents: 20_000 });
    expect(byBucket["61-90"]).toEqual({ bucket: "61-90", count: 1, cents: 30_000 });
    expect(byBucket["90+"]).toEqual({ bucket: "90+", count: 1, cents: 40_000 });

    expect(result.totalCount).toBe(6);
    expect(result.totalCents).toBe(10_000 + 7_500 + 20_000 + 30_000 + 40_000);
  });

  it("excludes a draft, a paid invoice, a void invoice, a soft-deleted invoice and a quote", async () => {
    const reference = "2026-03-31";
    const companyId = await makeCompany("Excluded Co");

    // Draft: never sent.
    await createInvoice({ companyId, dueOn: reference, totalCents: 1_111 });

    // Paid: settled.
    await paidInvoice({ companyId, dueOn: reference, totalCents: 2_222, paidOn: reference });

    // Void.
    const voided = await sentInvoice({ companyId, dueOn: reference, totalCents: 3_333 });
    await documents.markVoid(voided.id);

    // Soft-deleted.
    const deleted = await sentInvoice({ companyId, dueOn: reference, totalCents: 4_444 });
    await documents.softDelete(deleted.id);

    // A quote, sent, otherwise identical - never counted, it is not an invoice.
    const quoteDeal = await deals.create({
      title: "Excluded quote's deal",
      stageId: await firstStageId(),
      companyId,
    });
    const quote = await documents.create({
      kind: "quote",
      dealId: quoteDeal.id,
      prefix: "QUO",
      taxRateBp: 0,
      issuedOn: "2026-01-01",
      items: [{ name: "Service", qty: 1, unitCents: 5_555, taxable: false }],
    });
    await documents.send(quote.id);

    // The one invoice that should actually count, to prove the query still works.
    await sentInvoice({ companyId, dueOn: reference, totalCents: 9_000 });

    const result = await aging(reference);
    expect(result.totalCount).toBe(1);
    expect(result.totalCents).toBe(9_000);

    const rows = await outstanding(reference);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalCents).toBe(9_000);
  });
});

/* -------------------------------------------------------------------------- */
/* outstanding                                                                */
/* -------------------------------------------------------------------------- */

describe("outstanding", () => {
  it("excludes a draft, a paid invoice, a void invoice, a soft-deleted invoice and a quote", async () => {
    // Covered above alongside aging(), which asserts the same exclusions on
    // the same seed - kept here too so this file matches its own table of
    // contents, not just aging's.
    const reference = "2026-03-31";
    const companyId = await makeCompany("Also Excluded Co");
    await createInvoice({ companyId, dueOn: reference, totalCents: 1 });
    const rows = await outstanding(reference);
    expect(rows.find((r) => r.totalCents === 1)).toBeUndefined();
  });

  it("orders oldest due date first", async () => {
    const reference = "2026-03-31";
    const companyId = await makeCompany("Order Co");

    const newest = await sentInvoice({
      companyId,
      dueOn: addDaysToDateString(reference, -5),
      totalCents: 100,
    });
    const oldest = await sentInvoice({
      companyId,
      dueOn: addDaysToDateString(reference, -50),
      totalCents: 200,
    });
    const middle = await sentInvoice({
      companyId,
      dueOn: addDaysToDateString(reference, -20),
      totalCents: 300,
    });

    const rows = await outstanding(reference);
    expect(rows.map((r) => r.id)).toEqual([oldest.id, middle.id, newest.id]);
  });

  it("resolves the customer from the company", async () => {
    const companyId = await makeCompany("Riverbend Landscaping");
    const invoice = await sentInvoice({
      companyId,
      dueOn: "2026-03-31",
      totalCents: 500,
    });
    const rows = await outstanding("2026-03-31");
    expect(rows.find((r) => r.id === invoice.id)?.customer).toBe("Riverbend Landscaping");
  });

  it("resolves the customer from the contact when there is no company", async () => {
    const contactId = await makeContact("Priya", "Nair");
    const invoice = await sentInvoice({
      contactId,
      dueOn: "2026-03-31",
      totalCents: 500,
    });
    const rows = await outstanding("2026-03-31");
    expect(rows.find((r) => r.id === invoice.id)?.customer).toBe("Priya Nair");
  });

  it("falls back to 'No customer' when there is neither", async () => {
    const invoice = await sentInvoice({ dueOn: "2026-03-31", totalCents: 500 });
    const rows = await outstanding("2026-03-31");
    expect(rows.find((r) => r.id === invoice.id)?.customer).toBe("No customer");
  });
});

/* -------------------------------------------------------------------------- */
/* collectedThisMonth                                                        */
/* -------------------------------------------------------------------------- */

describe("collectedThisMonth", () => {
  it("counts an invoice paid this month and excludes one paid last month", async () => {
    const companyId = await makeCompany("Collections Co");
    await paidInvoice({
      companyId,
      dueOn: "2026-03-01",
      totalCents: 1_000,
      paidOn: "2026-03-15",
    });
    await paidInvoice({
      companyId,
      dueOn: "2026-02-01",
      totalCents: 9_999,
      paidOn: "2026-02-20",
    });

    const result = await collectedThisMonth("2026-03-31");
    expect(result.count).toBe(1);
    expect(result.cents).toBe(1_000);
  });

  it("counts an invoice paid on the first day of the month", async () => {
    const companyId = await makeCompany("First Day Co");
    await paidInvoice({
      companyId,
      dueOn: "2026-03-01",
      totalCents: 1_500,
      paidOn: "2026-03-01",
    });
    const result = await collectedThisMonth("2026-03-31");
    expect(result.count).toBe(1);
    expect(result.cents).toBe(1_500);
  });

  it("counts an invoice paid on the last day of the month", async () => {
    const companyId = await makeCompany("Last Day Co");
    await paidInvoice({
      companyId,
      dueOn: "2026-03-01",
      totalCents: 2_500,
      paidOn: "2026-03-31",
    });
    const result = await collectedThisMonth("2026-03-01");
    expect(result.count).toBe(1);
    expect(result.cents).toBe(2_500);
  });
});
