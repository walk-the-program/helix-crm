/**
 * `payments.create`'s balance guard (PX-5, `assertWithinBalance`): a payment
 * bigger than the balance is refused unless the caller says `allowOverpayment`
 * on purpose, and the refusal itself must not leave anything behind - the
 * transaction-rollback check every write path in this repo needs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as deals from "../../../src/db/repos/deals";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import { ValidationError } from "../../../src/db/errors";
import { addDaysToDateString, todayLocal } from "../../../src/lib/dates";

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

async function sentInvoice(totalCents = 10_000): Promise<documents.Document> {
  const deal = await deals.create({ title: "Overpayment test deal", stageId: await firstStageId() });
  const created = await documents.create({
    kind: "invoice",
    dealId: deal.id,
    prefix: "INV",
    taxRateBp: 0,
    issuedOn: "2026-03-01",
    items: [{ name: "Service", qty: 1, unitCents: totalCents, taxable: false }],
  });
  return documents.send(created.id, { at: "2026-03-01T09:00:00.000Z" });
}

describe("a payment over the balance", () => {
  it("is refused, names the balance in the message, and writes nothing", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);

    const err = (await payments
      .create({ documentId: invoice.id, amountCents: 15_000, paidOn: "2026-03-05", method: "cash" })
      .catch((e: unknown) => e)) as ValidationError;

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("$100.00"); // the balance
    expect(err.message).toContain("$150.00"); // the amount offered

    // Nothing was written: no payment row, and the invoice is exactly as it
    // was before the refused write reached the transaction.
    expect(await payments.listForDocument(invoice.id)).toEqual([]);
    const current = await documents.getOrThrow(invoice.id);
    expect(current.document.status).toBe("sent");
    expect(current.document.paidOn).toBeNull();
  });

  it("succeeds with allowOverpayment, and the invoice reads paid", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);

    const payment = await payments.create(
      { documentId: invoice.id, amountCents: 15_000, paidOn: "2026-03-05", method: "cash" },
      { allowOverpayment: true },
    );
    expect(payment.amountCents).toBe(15_000);

    const current = await documents.getOrThrow(invoice.id);
    expect(current.document.status).toBe("paid");
    expect(await payments.listForDocument(invoice.id)).toHaveLength(1);
  });

  it("an already-paid invoice's refusal says it is already paid in full", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(5_000);
    await payments.create({ documentId: invoice.id, amountCents: 5_000, method: "cash" });

    const err = (await payments
      .create({ documentId: invoice.id, amountCents: 100, method: "cash" })
      .catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues.some((i) => i.message.includes("already paid in full"))).toBe(true);
  });
});

describe("a payment dated in the future", () => {
  it("is refused", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);
    const tomorrow = addDaysToDateString(todayLocal(), 1);

    const err = (await payments
      .create({ documentId: invoice.id, amountCents: 1_000, paidOn: tomorrow, method: "cash" })
      .catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(await payments.listForDocument(invoice.id)).toEqual([]);
  });
});

describe("a zero or negative payment", () => {
  it("refuses zero", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);
    const err = (await payments
      .create({ documentId: invoice.id, amountCents: 0, method: "cash" })
      .catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
  });

  it("refuses negative", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);
    const err = (await payments
      .create({ documentId: invoice.id, amountCents: -500, method: "cash" })
      .catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(await payments.listForDocument(invoice.id)).toEqual([]);
  });
});
