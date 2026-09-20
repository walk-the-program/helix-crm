/**
 * The documents repository: numbering, totals, the status rules, and the one
 * status change that creates something (an accepted quote becoming an
 * invoice).
 *
 * The numbering test is the one that matters most. A duplicate or a skipped
 * invoice number is the kind of bug an owner finds at the end of the tax year,
 * and the unique index on (kind, number) means a duplicate is a hard failure
 * rather than a quiet one - so the concurrency case below is written to fail
 * loudly if the sequence and the insert ever stop sharing a transaction.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as deals from "../../../src/db/repos/deals";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as activities from "../../../src/db/repos/activities";
import * as settings from "../../../src/db/repos/settings";
import { NotFoundError, ValidationError } from "../../../src/db/errors";
import { newId } from "../../../src/lib/ids";
import { todayLocal } from "../../../src/lib/dates";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const YEAR = Number(todayLocal().slice(0, 4));

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  return all[0].id;
}

/** deal_items has no repository of its own yet, so the test writes the rows. */
async function addDealItem(
  dealId: string,
  values: {
    name: string;
    qty?: number;
    actualUnitCents: number;
    taxable?: boolean;
    kind?: "one_time" | "recurring";
    interval?: "month" | "year" | null;
    position?: number;
  },
): Promise<void> {
  await raw.execute(
    `INSERT INTO deal_items
       (id, deal_id, name, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      dealId,
      values.name,
      values.kind ?? "one_time",
      values.interval ?? null,
      values.qty ?? 1,
      values.actualUnitCents,
      values.actualUnitCents,
      values.taxable ? 1 : 0,
      values.position ?? 0,
    ],
  );
}

async function aDeal(title = "Kitchen rewire"): Promise<string> {
  const deal = await deals.create({ title, stageId: await firstStageId() });
  return deal.id;
}

function lines(...unitCents: number[]): documents.NewDocumentItem[] {
  return unitCents.map((cents, index) => ({
    name: `Line ${index + 1}`,
    qty: 1,
    unitCents: cents,
    taxable: false,
  }));
}

/* -------------------------------------------------------------------------- */

describe("documents: the workspace's own word (F-P2-LB-2)", () => {
  it("says job, not deal, in a workspace that calls them jobs", async () => {
    h = await createSeededHarness();
    await settings.set("vocabulary", "jobs");
    const dealId = await aDeal("Nothing priced");

    // Raising a document from a deal with no lines. The workspace's word is
    // in the FIELD message, which is the half the owner actually sees
    // (F-LB-22); the top-level one stays generic.
    const fromDeal = await documents
      .createFromDeal(dealId, { kind: "invoice", prefix: "INV", taxRateBp: 0 })
      .catch((err: unknown) => err as ValidationError);
    expect((fromDeal as ValidationError).issues[0].message).toContain("job");
    expect((fromDeal as ValidationError).issues[0].message).not.toContain("deal");

    // A deposit on a deal with no one-off work.
    const deposit = await documents
      .createDeposit(dealId, { amountCents: 1_000, prefix: "INV" })
      .catch((err: unknown) => err as ValidationError);
    expect((deposit as ValidationError).issues[0].message).toContain("job");

    // An empty deal id never reaches insertDocument - the schema rejects it
    // first, and a zod message is built once at module load, so it cannot know
    // the workspace's word. It is phrased not to need one.
    const noDeal = await documents
      .create({ kind: "invoice", dealId: "", prefix: "INV", items: lines(1000) })
      .catch((err: unknown) => err as ValidationError);
    expect((noDeal as ValidationError).issues[0].message).not.toContain("deal");
  });

  it("falls back to deal when the workspace has never chosen", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Nothing priced");
    const err = await documents
      .createFromDeal(dealId, { kind: "invoice", prefix: "INV", taxRateBp: 0 })
      .catch((e: unknown) => e as ValidationError);
    expect((err as ValidationError).issues[0].message).toContain("deal");
  });
});

describe("documents: deposits and the balance (F-LB-7)", () => {
  it("a deposit and its balance add up to the job's one-time value, to the cent", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Retaining wall");
    await addDealItem(dealId, { name: "Blockwork", actualUnitCents: 145_000, position: 0 });
    await addDealItem(dealId, { name: "Haulage", qty: 3, actualUnitCents: 11_111, position: 1 });
    // A monthly line must not affect any of this: it is billed by the schedule.
    await addDealItem(dealId, {
      name: "Monthly upkeep",
      actualUnitCents: 18_000,
      kind: "recurring",
      interval: "month",
      position: 2,
    });

    const before = await documents.remainingOneTime(dealId);
    const oneTime = 145_000 + 33_333;
    expect(before.oneTimeCents).toBe(oneTime);
    expect(before.invoicedCents).toBe(0);
    expect(before.remainingCents).toBe(oneTime);

    // Half down, rounded to the cent.
    const depositCents = Math.round(oneTime / 2);
    const deposit = await documents.createDeposit(dealId, {
      amountCents: depositCents,
      prefix: "INV",
    });
    expect(deposit.totalCents).toBe(depositCents);
    const depositItems = await documents.listItems(deposit.id);
    expect(depositItems).toHaveLength(1);
    expect(depositItems[0].name).toBe("Deposit");

    // A draft deposit is not billed yet, so nothing is credited.
    expect((await documents.remainingOneTime(dealId)).invoicedCents).toBe(0);
    await documents.send(deposit.id);
    expect((await documents.remainingOneTime(dealId)).invoicedCents).toBe(depositCents);

    const balance = await documents.createFromDeal(dealId, {
      kind: "invoice",
      prefix: "INV",
      taxRateBp: 0,
      creditPriorInvoices: true,
    });
    const balanceItems = await documents.listItems(balance.id);
    // The deal's two one-time lines, then the credit naming the deposit.
    expect(balanceItems).toHaveLength(3);
    expect(balanceItems[2].name).toBe(`Less already invoiced (${deposit.number})`);
    expect(balanceItems[2].unitCents).toBe(-depositCents);
    expect(balanceItems[2].taxable).toBe(false);

    // The whole point: the two invoices are the job, exactly.
    expect(deposit.totalCents + balance.totalCents).toBe(oneTime);
  });

  it("credits two partial invoices, and a voided one not at all", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Sod and grading");
    await addDealItem(dealId, { name: "Sod", actualUnitCents: 90_000, position: 0 });

    const first = await documents.createDeposit(dealId, { amountCents: 20_000, prefix: "INV" });
    await documents.send(first.id);
    const second = await documents.createDeposit(dealId, { amountCents: 30_000, prefix: "INV" });
    await documents.send(second.id);
    const dead = await documents.createDeposit(dealId, { amountCents: 5_000, prefix: "INV" });
    await documents.send(dead.id);
    await documents.markVoid(dead.id);

    const balance = await documents.createFromDeal(dealId, {
      kind: "invoice",
      prefix: "INV",
      taxRateBp: 0,
      creditPriorInvoices: true,
    });
    const items = await documents.listItems(balance.id);
    expect(items[1].name).toBe(`Less already invoiced (${first.number}, ${second.number})`);
    expect(items[1].unitCents).toBe(-50_000);
    expect(first.totalCents + second.totalCents + balance.totalCents).toBe(90_000);
  });

  it("refuses a deposit bigger than what is left, and one on a deal with no one-off work", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Too much");
    await addDealItem(dealId, { name: "Edging", actualUnitCents: 10_000, position: 0 });

    await expect(
      documents.createDeposit(dealId, { amountCents: 10_001, prefix: "INV" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      documents.createDeposit(dealId, { amountCents: 0, prefix: "INV" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const monthlyOnly = await aDeal("Upkeep only");
    await addDealItem(monthlyOnly, {
      name: "Monthly upkeep",
      actualUnitCents: 18_000,
      kind: "recurring",
      interval: "month",
      position: 0,
    });
    await expect(
      documents.createDeposit(monthlyOnly, { amountCents: 5_000, prefix: "INV" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("adds no credit line when nothing has been billed yet", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Clean slate");
    await addDealItem(dealId, { name: "Mulch", actualUnitCents: 45_000, position: 0 });

    const invoice = await documents.createFromDeal(dealId, {
      kind: "invoice",
      prefix: "INV",
      taxRateBp: 0,
      creditPriorInvoices: true,
    });
    const items = await documents.listItems(invoice.id);
    expect(items).toHaveLength(1);
    expect(invoice.totalCents).toBe(45_000);
  });
});

describe("documents: numbering", () => {
  it("counts up per kind, with the prefix and the year", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const a = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(1000) });
    const b = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(1000) });
    expect(a.number).toBe(`INV-${YEAR}-0001`);
    expect(b.number).toBe(`INV-${YEAR}-0002`);
  });

  it("keeps a separate sequence for quotes", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(1000) });
    const quote = await documents.create({
      kind: "quote",
      dealId,
      prefix: "QUO",
      items: lines(1000),
    });
    const secondInvoice = await documents.create({
      kind: "invoice",
      dealId,
      prefix: "INV",
      items: lines(1000),
    });
    expect(quote.number).toBe(`QUO-${YEAR}-0001`);
    expect(secondInvoice.number).toBe(`INV-${YEAR}-0002`);
  });

  it("has no gaps and no duplicates when ten creates are fired at once", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    // Fired without awaiting in turn: the write lock is what has to serialise
    // these. If the sequence read ever escapes the transaction, two of them
    // take the same number and the unique index rejects the second.
    const created = await Promise.all(
      Array.from({ length: 10 }, () =>
        documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(500) }),
      ),
    );
    const numbers = created.map((d) => d.number).sort();
    expect(new Set(numbers).size).toBe(10);
    expect(numbers).toEqual(
      Array.from({ length: 10 }, (_, i) => `INV-${YEAR}-${String(i + 1).padStart(4, "0")}`),
    );
  });

  it("does not hand a voided invoice's number back out", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const first = await documents.create({
      kind: "invoice",
      dealId,
      prefix: "INV",
      items: lines(1000),
    });
    await documents.markVoid(first.id);
    const second = await documents.create({
      kind: "invoice",
      dealId,
      prefix: "INV",
      items: lines(1000),
    });
    expect(second.number).toBe(`INV-${YEAR}-0002`);
  });
});

describe("documents: totals and tax", () => {
  it("sums qty times unit and leaves tax at zero with no rate", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({
      kind: "invoice",
      dealId,
      prefix: "INV",
      items: [
        { name: "Callout", qty: 1, unitCents: 9500, taxable: false },
        { name: "Hours", qty: 3, unitCents: 6500, taxable: false },
      ],
    });
    expect(doc.subtotalCents).toBe(9500 + 19500);
    expect(doc.taxCents).toBe(0);
    expect(doc.totalCents).toBe(29000);
  });

  it("charges tax on the taxable lines only, rounded once over the whole", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({
      kind: "invoice",
      dealId,
      prefix: "INV",
      taxRateBp: 825,
      items: [
        { name: "Parts", qty: 1, unitCents: 10_000, taxable: true },
        { name: "Labour", qty: 1, unitCents: 10_000, taxable: false },
      ],
    });
    expect(doc.subtotalCents).toBe(20_000);
    // 8.25% of the 10000 taxable cents, and nothing on the labour.
    expect(doc.taxCents).toBe(825);
    expect(doc.totalCents).toBe(20_825);
  });

  it("rounds the whole taxable subtotal rather than each line", async () => {
    // Three lines of 3.33 at 8.25%: per-line rounding gives 3 x 27 = 81,
    // rounding the 999-cent subtotal once gives 82. The second is what the
    // customer's own arithmetic produces.
    expect(
      documents.computeTotals(
        [
          { qty: 1, unitCents: 333, taxable: true },
          { qty: 1, unitCents: 333, taxable: true },
          { qty: 1, unitCents: 333, taxable: true },
        ],
        825,
      ),
    ).toEqual({ subtotalCents: 999, taxCents: 82, totalCents: 1081 });
  });

  it("rewrites the totals when the lines are replaced", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({
      kind: "invoice",
      dealId,
      prefix: "INV",
      taxRateBp: 1000,
      items: [{ name: "One", qty: 1, unitCents: 1000, taxable: true }],
    });
    expect(doc.totalCents).toBe(1100);

    const updated = await documents.replaceItems(doc.id, [
      { name: "Two", qty: 2, unitCents: 2500, taxable: true },
    ]);
    expect(updated.subtotalCents).toBe(5000);
    expect(updated.taxCents).toBe(500);
    expect(updated.totalCents).toBe(5500);
  });
});

describe("documents: status rules", () => {
  it("allows draft to sent and sent to paid, and stamps each", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(5000) });
    expect(doc.status).toBe("draft");

    const sent = await documents.send(doc.id, { dueDays: 14 });
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toBeTruthy();
    expect(sent.dueOn).toBeTruthy();

    // Paid is derived from a payment now, not typed: one payment for the
    // whole total lands the invoice in `paid`, and the document's own
    // `paid_on`/`paid_method` are kept as a cache of that payment.
    await payments.create({
      documentId: doc.id,
      amountCents: 5000,
      paidOn: "2026-09-01",
      method: "transfer",
      note: "cleared",
    });
    const paid = (await documents.getOrThrow(doc.id)).document;
    expect(paid.status).toBe("paid");
    expect(paid.paidOn).toBe("2026-09-01");
    expect(paid.paidMethod).toBe("transfer");
  });

  it("refuses to pay an invoice that was never sent", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(5000) });
    await expect(payments.recordFullPayment(doc.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to send an invoice twice, and refuses to pay a void one", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(5000) });
    await documents.send(doc.id);
    await expect(documents.send(doc.id)).rejects.toBeInstanceOf(ValidationError);

    const other = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(100) });
    await documents.send(other.id);
    await documents.markVoid(other.id);
    await expect(payments.recordFullPayment(other.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows an invoice to be corrected after it is paid, but never a voided one", async () => {
    h = await createSeededHarness();
    expect(documents.canTransition("invoice", "draft", "void")).toBe(true);
    expect(documents.canTransition("invoice", "sent", "void")).toBe(true);
    // Paid is recoverable: marking the wrong invoice paid used to be
    // permanent, and wrong Collected figures with it.
    expect(documents.canTransition("invoice", "paid", "void")).toBe(true);
    expect(documents.canTransition("invoice", "paid", "sent")).toBe(true);
    // Void is the one end state. A written-off billing stays written off.
    expect(documents.canTransition("invoice", "void", "sent")).toBe(false);
    expect(documents.canTransition("invoice", "void", "paid")).toBe(false);
    // A draft was never sent, so it cannot skip straight to paid.
    expect(documents.canTransition("invoice", "draft", "paid")).toBe(false);
    expect(documents.canTransition("quote", "sent", "accepted")).toBe(true);
    expect(documents.canTransition("quote", "draft", "accepted")).toBe(false);
    expect(documents.canTransition("invoice", "sent", "accepted")).toBe(false);
  });

  it("refuses to edit the lines of anything that has left draft", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(1000) });
    await documents.send(doc.id);
    await expect(
      documents.replaceItems(doc.id, [{ name: "Sneaky", qty: 1, unitCents: 1, taxable: false }]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("documents: from a deal", () => {
  it("copies the deal's lines at the price the deal agreed", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    await addDealItem(dealId, { name: "Consumer unit", actualUnitCents: 42_000, position: 0 });
    await addDealItem(dealId, {
      name: "Labour",
      qty: 6,
      actualUnitCents: 6_500,
      taxable: true,
      position: 1,
    });

    const invoice = await documents.createFromDeal(dealId, {
      kind: "invoice",
      prefix: "INV",
      taxRateBp: 1000,
      dueDays: 14,
    });
    const loaded = await documents.getOrThrow(invoice.id);
    expect(loaded.items).toHaveLength(2);
    expect(loaded.items[0].name).toBe("Consumer unit");
    expect(loaded.items[1].qty).toBe(6);
    expect(invoice.subtotalCents).toBe(42_000 + 39_000);
    expect(invoice.taxCents).toBe(3_900);
    expect(invoice.dealId).toBe(dealId);
  });

  it("puts recurring lines on a quote and keeps them off the invoice", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Monthly maintenance");
    await addDealItem(dealId, { name: "Install", actualUnitCents: 30_000, position: 0 });
    await addDealItem(dealId, {
      name: "Monthly service",
      actualUnitCents: 9_900,
      kind: "recurring",
      interval: "month",
      position: 1,
    });

    const quote = await documents.createFromDeal(dealId, {
      kind: "quote",
      prefix: "QUO",
      taxRateBp: 0,
    });
    const quoteLoaded = await documents.getOrThrow(quote.id);
    expect(quoteLoaded.items).toHaveLength(2);
    expect(quoteLoaded.items[1].kind).toBe("recurring");
    expect(quoteLoaded.items[1].interval).toBe("month");
    expect(quote.validUntil).toBeTruthy();

    const invoice = await documents.createFromDeal(dealId, {
      kind: "invoice",
      prefix: "INV",
      taxRateBp: 0,
    });
    const invoiceLoaded = await documents.getOrThrow(invoice.id);
    expect(invoiceLoaded.items).toHaveLength(1);
    expect(invoiceLoaded.items[0].name).toBe("Install");
    expect(invoice.totalCents).toBe(30_000);
  });

  it("refuses when the deal has nothing on it", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Empty");
    await expect(
      documents.createFromDeal(dealId, { kind: "invoice", prefix: "INV", taxRateBp: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("carries the deal's customer onto the document", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Ridgeway Farms" });
    const contact = await contacts.create({ firstName: "Dale", lastName: "Petrov" });
    const deal = await deals.create({
      title: "Yard lighting",
      stageId: await firstStageId(),
      contactId: contact.id,
      companyId: company.id,
    });
    await addDealItem(deal.id, { name: "Floodlights", actualUnitCents: 18_000 });

    const invoice = await documents.createFromDeal(deal.id, {
      kind: "invoice",
      prefix: "INV",
      taxRateBp: 0,
    });
    expect(invoice.companyName).toBe("Ridgeway Farms");
    expect(invoice.contactLastName).toBe("Petrov");
  });
});

describe("documents: accepting a quote", () => {
  it("creates the invoice, links it, and does both or neither", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Loft conversion");
    await addDealItem(dealId, { name: "Stage one", actualUnitCents: 250_000, taxable: true });

    const quote = await documents.createFromDeal(dealId, {
      kind: "quote",
      prefix: "QUO",
      taxRateBp: 500,
    });
    await documents.send(quote.id);

    const result = await documents.accept(quote.id, { prefix: "INV", dueDays: 30 });
    expect(result.quote.status).toBe("accepted");
    expect(result.invoice).not.toBeNull();
    expect(result.quote.convertedToId).toBe(result.invoice?.id);
    expect(result.invoice?.kind).toBe("invoice");
    expect(result.invoice?.number).toBe(`INV-${YEAR}-0001`);
    // The money crosses over exactly, tax and all.
    expect(result.invoice?.totalCents).toBe(quote.totalCents);
    expect(result.invoice?.dealId).toBe(dealId);
    expect(result.invoice?.dueOn).toBeTruthy();
  });

  it("accepts a recurring-only quote without raising an invoice for it", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Grounds care");
    await addDealItem(dealId, {
      name: "Monthly grounds care",
      actualUnitCents: 24_000,
      kind: "recurring",
      interval: "month",
    });

    const quote = await documents.createFromDeal(dealId, {
      kind: "quote",
      prefix: "QUO",
      taxRateBp: 0,
    });
    await documents.send(quote.id);

    const result = await documents.accept(quote.id, { prefix: "INV" });
    expect(result.quote.status).toBe("accepted");
    // The schedule bills the monthly line; invoicing it here as well would
    // charge the first month twice.
    expect(result.invoice).toBeNull();
    expect(result.quote.convertedToId).toBeNull();
  });

  it("refuses to accept an invoice", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const invoice = await documents.create({
      kind: "invoice",
      dealId,
      prefix: "INV",
      items: lines(1000),
    });
    await documents.send(invoice.id);
    await expect(
      documents.accept(invoice.id, { prefix: "INV" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to accept a quote that was never sent", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const quote = await documents.create({
      kind: "quote",
      dealId,
      prefix: "QUO",
      items: lines(1000),
    });
    await expect(documents.accept(quote.id, { prefix: "INV" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("documents: listing", () => {
  it("filters unpaid to invoices that are draft or sent", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const draft = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(100) });
    const sent = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(200) });
    const paid = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(300) });
    const quote = await documents.create({ kind: "quote", dealId, prefix: "QUO", items: lines(400) });
    await documents.send(sent.id);
    await documents.send(paid.id);
    await payments.recordFullPayment(paid.id);

    const unpaid = await documents.list({ unpaidOnly: true });
    const ids = unpaid.rows.map((row) => row.id);
    expect(ids).toContain(draft.id);
    expect(ids).toContain(sent.id);
    expect(ids).not.toContain(paid.id);
    expect(ids).not.toContain(quote.id);
    expect(unpaid.total).toBe(2);
  });

  it("leaves a soft-deleted document out unless it is asked for", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(100) });
    await documents.softDelete(doc.id);
    expect((await documents.list({})).rows).toHaveLength(0);
    expect((await documents.list({ includeDeleted: true })).rows).toHaveLength(1);
    await documents.restore(doc.id);
    expect((await documents.list({})).rows).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Money model (round 3): every document belongs to a deal.                   */
/* -------------------------------------------------------------------------- */

describe("documents: the money model - a document belongs to a deal", () => {
  it("refuses to create without a deal, says what to do about it, and writes nothing", async () => {
    h = await createSeededHarness();

    // Omitted entirely - bypassing the type the way a caller ignoring TS
    // still could - is rejected too.
    await expect(
      documents.create({
        kind: "invoice",
        prefix: "INV",
        items: lines(1000),
      } as unknown as documents.NewDocument),
    ).rejects.toBeInstanceOf(ValidationError);

    // Explicitly empty hits the schema's own message. It no longer names the
    // deal, and deliberately: a zod message is built once at module load, so
    // it cannot ask the workspace whether it calls them deals, jobs or quotes
    // (F-P2-LB-2). It says what the owner has to do instead, and the
    // vocabulary-aware sentence is the one insertDocument throws.
    try {
      await documents.create({ kind: "invoice", dealId: "", prefix: "INV", items: lines(1000) });
      expect.unreachable("create should have thrown");
    } catch (err) {
      const validation = err as InstanceType<typeof ValidationError>;
      expect(validation.issues.some((issue) => /Pick what this document is for/.test(issue.message))).toBe(true);
    }

    expect((await documents.list({ includeDeleted: true })).rows).toHaveLength(0);
  });

  it("stores the deal's contact and company even when the input passes different ones", async () => {
    h = await createSeededHarness();
    const dealCompany = await companies.create({ name: "Deal Co" });
    const dealContact = await contacts.create({ firstName: "Deal", lastName: "Contact" });
    const otherCompany = await companies.create({ name: "Other Co" });
    const otherContact = await contacts.create({ firstName: "Other", lastName: "Contact" });
    const deal = await deals.create({
      title: "Money model - mismatched input",
      stageId: await firstStageId(),
      contactId: dealContact.id,
      companyId: dealCompany.id,
    });

    const doc = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      contactId: otherContact.id,
      companyId: otherCompany.id,
      prefix: "INV",
      items: lines(1000),
    });

    expect(doc.contactId).toBe(dealContact.id);
    expect(doc.companyId).toBe(dealCompany.id);
  });

  it("raises NotFoundError for a deal that does not exist, and writes nothing", async () => {
    h = await createSeededHarness();
    await expect(
      documents.create({
        kind: "invoice",
        dealId: "not-a-real-deal",
        prefix: "INV",
        items: lines(1000),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await documents.list({ includeDeleted: true })).rows).toHaveLength(0);
  });

  it("createFromDeal still produces a document linked to the deal with the deal's customer", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Fromdeal Co" });
    const contact = await contacts.create({ firstName: "From", lastName: "Deal" });
    const deal = await deals.create({
      title: "createFromDeal keeps the link",
      stageId: await firstStageId(),
      contactId: contact.id,
      companyId: company.id,
    });
    await addDealItem(deal.id, { name: "Install", actualUnitCents: 20_000 });

    const invoice = await documents.createFromDeal(deal.id, {
      kind: "invoice",
      prefix: "INV",
      taxRateBp: 0,
    });
    expect(invoice.dealId).toBe(deal.id);
    expect(invoice.contactId).toBe(contact.id);
    expect(invoice.companyId).toBe(company.id);
  });

  it("syncCustomerFromDeal updates every live document to the deal's current customer, and is idempotent", async () => {
    h = await createSeededHarness();
    const companyA = await companies.create({ name: "Company A" });
    const companyB = await companies.create({ name: "Company B" });
    const contactA = await contacts.create({ firstName: "A", lastName: "One" });
    const contactB = await contacts.create({ firstName: "B", lastName: "Two" });
    const deal = await deals.create({
      title: "Sync test",
      stageId: await firstStageId(),
      contactId: contactA.id,
      companyId: companyA.id,
    });
    const docOne = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      prefix: "INV",
      items: lines(1000),
    });
    const docTwo = await documents.create({
      kind: "quote",
      dealId: deal.id,
      prefix: "QUO",
      items: lines(500),
    });

    // deals.update now runs this sync itself once the customer changes
    // (round 3, "Money model"), so by here the documents have already
    // followed and syncCustomerFromDeal has nothing left to do.
    await deals.update(deal.id, { contactId: contactB.id, companyId: companyB.id });
    expect((await documents.syncCustomerFromDeal(deal.id)).changed).toBe(0);

    const reloadedOne = await documents.getOrThrow(docOne.id);
    const reloadedTwo = await documents.getOrThrow(docTwo.id);
    expect(reloadedOne.document.contactId).toBe(contactB.id);
    expect(reloadedOne.document.companyId).toBe(companyB.id);
    expect(reloadedTwo.document.contactId).toBe(contactB.id);
    expect(reloadedTwo.document.companyId).toBe(companyB.id);

    // And it still does the work when documents have drifted on their own -
    // a row written before the deal_id rule, or restored from a backup. The
    // drift is arranged directly, because no repository call can produce it
    // any more.
    await raw.execute(
      `UPDATE documents SET contact_id = ?, company_id = ? WHERE deal_id = ?`,
      [contactA.id, companyA.id, deal.id],
    );
    expect((await documents.syncCustomerFromDeal(deal.id)).changed).toBe(2);
    expect((await documents.getOrThrow(docOne.id)).document.companyId).toBe(companyB.id);
    expect((await documents.getOrThrow(docTwo.id)).document.companyId).toBe(companyB.id);

    // Nothing left to change: a second call is a no-op.
    expect((await documents.syncCustomerFromDeal(deal.id)).changed).toBe(0);
  });

  it("does NOT re-address a document the customer has already received", async () => {
    h = await createSeededHarness();
    const companyA = await companies.create({ name: "Original Co" });
    const companyB = await companies.create({ name: "Corrected Co" });
    const deal = await deals.create({
      title: "Already sent",
      stageId: await firstStageId(),
      companyId: companyA.id,
    });
    const draft = await documents.create({ kind: "invoice", dealId: deal.id, prefix: "INV", items: lines(1000) });
    const sent = await documents.create({ kind: "invoice", dealId: deal.id, prefix: "INV", items: lines(2000) });
    const paid = await documents.create({ kind: "invoice", dealId: deal.id, prefix: "INV", items: lines(3000) });
    await documents.send(sent.id);
    await documents.send(paid.id);
    await payments.recordFullPayment(paid.id);

    const result = await documents.syncCustomerFromDeal(deal.id);
    // The deal has not moved yet, so nothing at all should have happened.
    expect(result.changed).toBe(0);
    expect(result.keptNumbers).toEqual([]);

    await deals.update(deal.id, { companyId: companyB.id });
    const after = await documents.syncCustomerFromDeal(deal.id);
    expect(after.changed).toBe(0);
    // The sent and the paid one are named so the caller can say so; the draft
    // has already followed the deal.
    expect(after.keptNumbers.sort()).toEqual([sent.number, paid.number].sort());

    expect((await documents.getOrThrow(draft.id)).document.companyId).toBe(companyB.id);
    expect((await documents.getOrThrow(sent.id)).document.companyId).toBe(companyA.id);
    expect((await documents.getOrThrow(paid.id)).document.companyId).toBe(companyA.id);
  });

  it("clears a draft's stale PDF when its bill-to changes", async () => {
    h = await createSeededHarness();
    const companyA = await companies.create({ name: "Before Co" });
    const companyB = await companies.create({ name: "After Co" });
    const deal = await deals.create({
      title: "Stale pdf",
      stageId: await firstStageId(),
      companyId: companyA.id,
    });
    const draft = await documents.create({ kind: "invoice", dealId: deal.id, prefix: "INV", items: lines(1000) });
    await documents.setPdfPath(draft.id, "/tmp/before.pdf");

    await deals.update(deal.id, { companyId: companyB.id });

    const reloaded = await documents.getOrThrow(draft.id);
    expect(reloaded.document.companyId).toBe(companyB.id);
    expect(reloaded.document.pdfPath).toBeNull();
  });

  it("a paid invoice can be marked unpaid, and voided, and never reuses its number", async () => {
    h = await createSeededHarness();
    const deal = await deals.create({ title: "Wrong one", stageId: await firstStageId() });
    const invoice = await documents.create({ kind: "invoice", dealId: deal.id, prefix: "INV", items: lines(5000) });
    await documents.send(invoice.id);
    await payments.recordFullPayment(invoice.id, { method: "check", note: "Cheque 4471" });

    // "Marked unpaid" is now "every payment taken off it", and the status
    // follows the payments rather than being edited behind their back.
    await payments.clearForDocument(invoice.id);
    const unpaid = (await documents.getOrThrow(invoice.id)).document;
    expect(unpaid.status).toBe("sent");
    expect(unpaid.paidOn).toBeNull();
    expect(unpaid.paidMethod).toBeNull();
    expect(unpaid.number).toBe(invoice.number);

    // It is owed again, so it can be paid again or written off.
    await payments.recordFullPayment(invoice.id);
    await payments.clearForDocument(invoice.id);
    const voided = await documents.markVoid(invoice.id);
    expect(voided.status).toBe("void");

    // The next invoice does not get the voided one's number back.
    const next = await documents.create({ kind: "invoice", dealId: deal.id, prefix: "INV", items: lines(100) });
    expect(next.number).not.toBe(invoice.number);
  });

  it("syncCustomerFromDeal leaves a soft-deleted document alone", async () => {
    h = await createSeededHarness();
    const companyA = await companies.create({ name: "Keep Co" });
    const companyB = await companies.create({ name: "New Co" });
    const deal = await deals.create({
      title: "Trash test",
      stageId: await firstStageId(),
      companyId: companyA.id,
    });
    const doc = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      prefix: "INV",
      items: lines(1000),
    });
    await documents.softDelete(doc.id);

    await deals.update(deal.id, { companyId: companyB.id });
    const result = await documents.syncCustomerFromDeal(deal.id);
    expect(result.changed).toBe(0);

    const reloaded = await documents.getOrThrow(doc.id);
    expect(reloaded.document.companyId).toBe(companyA.id);
  });

  it("accepts a quote with no deal, carrying the quote's own contact and company onto the invoice", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Legacy Co" });
    const contact = await contacts.create({ firstName: "Legacy", lastName: "Contact" });
    const deal = await deals.create({
      title: "About to be orphaned",
      stageId: await firstStageId(),
      contactId: contact.id,
      companyId: company.id,
    });
    const quote = await documents.create({
      kind: "quote",
      dealId: deal.id,
      prefix: "QUO",
      items: lines(5000),
    });
    // Simulate a quote written before this round: its deal_id is null, the
    // way an old row can be, while its own contact/company (copied off the
    // deal at the time, back when that was the only way) remain on the row.
    await raw.execute(`UPDATE documents SET deal_id = NULL WHERE id = ?`, [quote.id]);
    await documents.send(quote.id);

    const result = await documents.accept(quote.id, { prefix: "INV" });
    expect(result.invoice).not.toBeNull();
    expect(result.invoice?.dealId).toBeNull();
    expect(result.invoice?.contactId).toBe(contact.id);
    expect(result.invoice?.companyId).toBe(company.id);
  });
});

/* -------------------------------------------------------------------------- */
/* documentActivityBody: pure, no database                                    */
/* -------------------------------------------------------------------------- */

describe("documentActivityBody", () => {
  const money = { currency: "USD", locale: "en-US" } as const;

  it("describes a created invoice and a created quote, each with its money", () => {
    expect(
      documents.documentActivityBody("created", {
        kind: "invoice",
        number: "INV-2026-0003",
        totalCents: 104_236,
        ...money,
      }),
    ).toBe("Invoice INV-2026-0003 created · $1,042.36");
    expect(
      documents.documentActivityBody("created", {
        kind: "quote",
        number: "QUO-2026-0007",
        totalCents: 100,
        ...money,
      }),
    ).toBe("Quote QUO-2026-0007 created · $1.00");
  });

  it("describes a sent document", () => {
    expect(
      documents.documentActivityBody("sent", {
        kind: "invoice",
        number: "INV-2026-0003",
        totalCents: 104_236,
        ...money,
      }),
    ).toBe("Invoice INV-2026-0003 sent · $1,042.36");
  });

  it("describes a paid document, with and without a method", () => {
    expect(
      documents.documentActivityBody("paid", {
        kind: "invoice",
        number: "INV-2026-0003",
        totalCents: 104_236,
        method: "bank transfer",
        ...money,
      }),
    ).toBe("Paid $1,042.36 by bank transfer");
    expect(
      documents.documentActivityBody("paid", {
        kind: "invoice",
        number: "INV-2026-0003",
        totalCents: 104_236,
        method: null,
        ...money,
      }),
    ).toBe("Paid $1,042.36");
  });

  it("describes a voided document", () => {
    expect(
      documents.documentActivityBody("void", {
        kind: "invoice",
        number: "INV-2026-0003",
        totalCents: 104_236,
        ...money,
      }),
    ).toBe("Invoice INV-2026-0003 voided");
  });

  it("describes an accepted quote, with and without the invoice it became", () => {
    expect(
      documents.documentActivityBody("accepted", {
        kind: "quote",
        number: "QUO-2026-0007",
        totalCents: 100_000,
        becameNumber: "INV-2026-0009",
        ...money,
      }),
    ).toBe("Quote QUO-2026-0007 accepted · became INV-2026-0009");
    expect(
      documents.documentActivityBody("accepted", {
        kind: "quote",
        number: "QUO-2026-0007",
        totalCents: 100_000,
        becameNumber: null,
        ...money,
      }),
    ).toBe("Quote QUO-2026-0007 accepted");
  });

  it("describes a declined quote", () => {
    expect(
      documents.documentActivityBody("declined", {
        kind: "quote",
        number: "QUO-2026-0007",
        totalCents: 100_000,
        ...money,
      }),
    ).toBe("Quote QUO-2026-0007 declined");
  });
});

/* -------------------------------------------------------------------------- */
/* One activities row per create and per status-changing write.               */
/* -------------------------------------------------------------------------- */

describe("documents: activity", () => {
  it("records one activity for a create, carrying the deal id and the amount", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const before = await activities.list({ dealId });
    const doc = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(1000) });
    const after = await activities.list({ dealId });

    expect(after.total).toBe(before.total + 1);
    const entry = after.rows.find((r) => !before.rows.some((b) => b.id === r.id));
    expect(entry).toBeTruthy();
    expect(entry?.isSystem).toBe(true);
    expect(entry?.dealId).toBe(dealId);
    expect(entry?.body).toContain(doc.number);
    expect(entry?.body).toContain("created");
  });

  it("records one activity each for sending and for paying, and paying records the amount", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(5000) });

    const afterCreate = await activities.list({ dealId });
    await documents.send(doc.id);
    const afterSend = await activities.list({ dealId });
    expect(afterSend.total).toBe(afterCreate.total + 1);
    expect(afterSend.rows.some((r) => r.body.includes("sent"))).toBe(true);

    await payments.recordFullPayment(doc.id, { method: "transfer" });
    const afterPaid = await activities.list({ dealId });
    // One user action, one timeline line: the payment writes it, and the
    // status change it causes writes nothing of its own.
    expect(afterPaid.total).toBe(afterSend.total + 1);
    expect(
      afterPaid.rows.some((r) => r.body.includes("Paid") && r.body.includes("bank transfer")),
    ).toBe(true);
  });

  it("records one activity for voiding", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const doc = await documents.create({ kind: "invoice", dealId, prefix: "INV", items: lines(1000) });
    const before = await activities.list({ dealId });
    await documents.markVoid(doc.id);
    const after = await activities.list({ dealId });
    expect(after.total).toBe(before.total + 1);
    expect(after.rows.some((r) => r.body.includes("voided"))).toBe(true);
  });

  it("records one activity for accepting a quote, naming the invoice it became", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal("Loft conversion, take two");
    await addDealItem(dealId, { name: "Stage one", actualUnitCents: 100_000 });
    const quote = await documents.createFromDeal(dealId, {
      kind: "quote",
      prefix: "QUO",
      taxRateBp: 0,
    });
    await documents.send(quote.id);

    const before = await activities.list({ dealId });
    const result = await documents.accept(quote.id, { prefix: "INV" });
    const after = await activities.list({ dealId });

    // One "accepted" line for the quote - the invoice it produced does not
    // also get its own "created" line, since the accepted line names it.
    expect(after.total).toBe(before.total + 1);
    expect(
      after.rows.some(
        (r) => r.body.includes("accepted") && r.body.includes(result.invoice!.number),
      ),
    ).toBe(true);
  });

  it("records one activity for declining a quote", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const quote = await documents.create({ kind: "quote", dealId, prefix: "QUO", items: lines(1000) });
    await documents.send(quote.id);
    const before = await activities.list({ dealId });
    await documents.decline(quote.id);
    const after = await activities.list({ dealId });
    expect(after.total).toBe(before.total + 1);
    expect(after.rows.some((r) => r.body.includes("declined"))).toBe(true);
  });
});
