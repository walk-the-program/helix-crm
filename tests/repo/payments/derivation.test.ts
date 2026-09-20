/**
 * Payments drive an invoice's status, in both directions (PX-5 decision 5,
 * `documents.deriveInvoiceStatus`). Every document goes through `documents.ts`
 * and every payment through `payments.ts` - never a hand-written INSERT - so
 * this breaks the moment either repo's own shape changes rather than quietly
 * drifting from it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as deals from "../../../src/db/repos/deals";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import { ValidationError } from "../../../src/db/errors";

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

async function aDeal(title = "Derivation test deal"): Promise<string> {
  const deal = await deals.create({ title, stageId: await firstStageId() });
  return deal.id;
}

/** A draft invoice for `totalCents`, one untaxed line. */
async function draftInvoice(totalCents = 10_000): Promise<documents.Document> {
  const dealId = await aDeal();
  return documents.create({
    kind: "invoice",
    dealId,
    prefix: "INV",
    taxRateBp: 0,
    issuedOn: "2026-03-01",
    items: [{ name: "Service", qty: 1, unitCents: totalCents, taxable: false }],
  });
}

async function sentInvoice(totalCents = 10_000): Promise<documents.Document> {
  const created = await draftInvoice(totalCents);
  return documents.send(created.id, { at: "2026-03-01T09:00:00.000Z" });
}

describe("a payment moves a sent invoice to partial, then to paid", () => {
  it("part payment => partial; the rest => paid", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);

    await payments.create({ documentId: invoice.id, amountCents: 4_000, paidOn: "2026-03-05", method: "check" });
    let current = await documents.getOrThrow(invoice.id);
    expect(current.document.status).toBe("partial");
    expect(current.document.paidOn).toBeNull();
    expect(current.document.paidMethod).toBeNull();

    await payments.create({ documentId: invoice.id, amountCents: 6_000, paidOn: "2026-03-20", method: "transfer" });
    current = await documents.getOrThrow(invoice.id);
    expect(current.document.status).toBe("paid");
    // Settled: paid_on/paid_method now cache the LATEST payment's facts.
    expect(current.document.paidOn).toBe("2026-03-20");
    expect(current.document.paidMethod).toBe("transfer");
  });

  it("deleting the balance payment walks the invoice back to partial", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);
    await payments.create({ documentId: invoice.id, amountCents: 4_000, paidOn: "2026-03-05", method: "check" });
    const balance = await payments.create({
      documentId: invoice.id,
      amountCents: 6_000,
      paidOn: "2026-03-20",
      method: "transfer",
    });
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("paid");

    await payments.remove(balance.id);
    const current = await documents.getOrThrow(invoice.id);
    expect(current.document.status).toBe("partial");
    expect(current.document.paidOn).toBeNull();
    expect(current.document.paidMethod).toBeNull();
  });

  it("deleting the last payment returns the invoice to sent, clearing paid_on/paid_method", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);
    const only = await payments.create({
      documentId: invoice.id,
      amountCents: 10_000,
      paidOn: "2026-03-10",
      method: "cash",
    });
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("paid");

    await payments.remove(only.id);
    const current = await documents.getOrThrow(invoice.id);
    expect(current.document.status).toBe("sent");
    expect(current.document.paidOn).toBeNull();
    expect(current.document.paidMethod).toBeNull();
  });

  it("editing a payment's amount recomputes the invoice's status", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);
    const payment = await payments.create({
      documentId: invoice.id,
      amountCents: 4_000,
      paidOn: "2026-03-05",
      method: "check",
    });
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("partial");

    await payments.update(payment.id, { amountCents: 10_000 });
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("paid");

    await payments.update(payment.id, { amountCents: 1_000 });
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("partial");
  });
});

describe("a payment refuses documents that cannot take one", () => {
  it("refuses a draft, and says to send it first", async () => {
    h = await createSeededHarness();
    const draft = await draftInvoice(5_000);
    const err = (await payments
      .create({ documentId: draft.id, amountCents: 1_000, method: "cash" })
      .catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("Send it before recording a payment");
    expect(await payments.listForDocument(draft.id)).toEqual([]);
  });

  it("refuses a void invoice", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(5_000);
    await documents.markVoid(invoice.id);
    const err = (await payments
      .create({ documentId: invoice.id, amountCents: 1_000, method: "cash" })
      .catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("void");
  });

  it("refuses a quote", async () => {
    h = await createSeededHarness();
    const dealId = await aDeal();
    const quote = await documents.create({
      kind: "quote",
      dealId,
      prefix: "QUO",
      taxRateBp: 0,
      issuedOn: "2026-03-01",
      items: [{ name: "Service", qty: 1, unitCents: 5_000, taxable: false }],
    });
    await documents.send(quote.id);
    const err = (await payments
      .create({ documentId: quote.id, amountCents: 1_000, method: "cash" })
      .catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("Only an invoice can take a payment");
  });
});

describe("an invoice with payments cannot be voided", () => {
  it("refuses, and names removing the payments first as the way out", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(5_000);
    await payments.create({ documentId: invoice.id, amountCents: 2_000, method: "cash" });

    const err = (await documents.markVoid(invoice.id).catch((e: unknown) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain("cannot be voided");
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("partial");
  });

  it("succeeds once the payments are gone", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(5_000);
    const payment = await payments.create({ documentId: invoice.id, amountCents: 2_000, method: "cash" });
    await payments.remove(payment.id);

    const voided = await documents.markVoid(invoice.id);
    expect(voided.status).toBe("void");
  });
});
