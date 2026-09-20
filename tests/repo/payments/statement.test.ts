/**
 * `money.statementRows`: a customer statement for one inclusive local range.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as deals from "../../../src/db/repos/deals";
import * as companies from "../../../src/db/repos/companies";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import { statementRows } from "../../../src/db/repos/money";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  return all[0].id;
}

async function invoiceFor(
  companyId: string,
  totalCents: number,
  issuedOn: string,
): Promise<documents.Document> {
  const deal = await deals.create({
    title: "Statement test deal",
    stageId: await firstStageId(),
    companyId,
  });
  const created = await documents.create({
    kind: "invoice",
    dealId: deal.id,
    prefix: "INV",
    taxRateBp: 0,
    issuedOn,
    items: [{ name: "Service", qty: 1, unitCents: totalCents, taxable: false }],
  });
  return documents.send(created.id, { at: `${issuedOn}T09:00:00.000Z` });
}

describe("statementRows", () => {
  it("carries an opening balance, an in-period invoice, two payments, and a closing balance that adds up", async () => {
    h = await createSeededHarness();
    const companyId = (await companies.create({ name: "Statement Co" })).id;

    // Before the window: an invoice issued in February, part-paid in
    // February. What is left of it becomes the opening balance.
    const openingInvoice = await invoiceFor(companyId, 20_000, "2026-02-01");
    await payments.create({ documentId: openingInvoice.id, amountCents: 12_000, paidOn: "2026-02-15", method: "check" });

    // Inside the window (1 March to 31 March): one new invoice, and two
    // payments - one against the new invoice, one against the opening one.
    const marchInvoice = await invoiceFor(companyId, 15_000, "2026-03-05");
    await payments.create({ documentId: marchInvoice.id, amountCents: 5_000, paidOn: "2026-03-10", method: "cash" });
    await payments.create({
      documentId: openingInvoice.id,
      amountCents: 8_000,
      paidOn: "2026-03-20",
      method: "transfer",
      reference: "4412",
    });

    const result = await statementRows({ companyId }, "2026-03-01", "2026-03-31");

    // Opening: the Feb invoice ($20,000) less what was paid before March
    // ($12,000) = $8,000.
    expect(result.openingBalanceCents).toBe(20_000 - 12_000);

    // Rows: the March invoice (a charge), then the two March payments.
    expect(result.rows.map((r) => r.kind)).toEqual(
      expect.arrayContaining(["invoice", "payment", "payment"]),
    );
    expect(result.rows).toHaveLength(3);

    const invoiceRow = result.rows.find((r) => r.kind === "invoice")!;
    expect(invoiceRow.documentId).toBe(marchInvoice.id);
    expect(invoiceRow.chargeCents).toBe(15_000);
    expect(invoiceRow.label).toBe(marchInvoice.number);

    const referencedPayment = result.rows.find((r) => r.label.includes("4412"))!;
    expect(referencedPayment.kind).toBe("payment");
    expect(referencedPayment.paidCents).toBe(8_000);
    expect(referencedPayment.documentId).toBe(openingInvoice.id);

    expect(result.chargedCents).toBe(15_000);
    expect(result.paidCents).toBe(5_000 + 8_000);
    expect(result.closingBalanceCents).toBe(
      result.openingBalanceCents + result.chargedCents - result.paidCents,
    );

    // The running balance on the last row is the closing balance.
    expect(result.rows[result.rows.length - 1].balanceCents).toBe(result.closingBalanceCents);
  });

  it("an empty customer answers zeros and no rows", async () => {
    h = await createSeededHarness();
    const result = await statementRows({}, "2026-03-01", "2026-03-31");
    expect(result).toEqual({
      openingBalanceCents: 0,
      rows: [],
      closingBalanceCents: 0,
      chargedCents: 0,
      paidCents: 0,
    });
  });

  it("a period with no activity answers opening === closing and no rows", async () => {
    h = await createSeededHarness();
    const companyId = (await companies.create({ name: "Quiet Co" })).id;
    const invoice = await invoiceFor(companyId, 10_000, "2026-01-01");
    await payments.recordFullPayment(invoice.id, { paidOn: "2026-01-05" });

    const result = await statementRows({ companyId }, "2026-06-01", "2026-06-30");
    expect(result.rows).toEqual([]);
    expect(result.openingBalanceCents).toBe(result.closingBalanceCents);
    // Fully paid in January and nothing moved since: the balance carried
    // into an unrelated June window is zero.
    expect(result.openingBalanceCents).toBe(0);
  });
});
