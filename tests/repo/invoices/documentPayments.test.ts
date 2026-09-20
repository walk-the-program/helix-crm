/**
 * The delete paths a payment made dangerous.
 *
 * `payments.document_id` is ON DELETE RESTRICT, which is deliberate: nothing
 * may destroy the record of what a customer paid as a side effect of deleting
 * something else. The cost of that constraint is that every path which removes
 * a document has to take the money in hand on purpose, and there are four:
 * `documents.softDelete`/`restore`, `documents.purge`, `trash.purge` (which
 * builds its own DELETE and is what the 30-day sweep calls), and the example
 * workspace's own removal SQL. The first version of the payments table broke
 * the last of those - the example could not be removed at all, because its
 * paid invoice now had a payment behind it.
 *
 * So these tests are not about payments. They are about an invoice with money
 * against it surviving, and then leaving, correctly.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as deals from "../../../src/db/repos/deals";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as trash from "../../../src/db/repos/trash";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  return (await stages.list(pipeline.id))[0].id;
}

/** A sent invoice for $1,200 with a $500 deposit against it. */
async function partlyPaidInvoice(): Promise<{ id: string; paymentId: string }> {
  const deal = await deals.create({ title: "Retaining wall", stageId: await firstStageId() });
  const invoice = await documents.create({
    kind: "invoice",
    dealId: deal.id,
    prefix: "INV",
    items: [{ name: "Wall", qty: 1, unitCents: 120000, taxable: false }],
  });
  await documents.send(invoice.id);
  const payment = await payments.create({
    documentId: invoice.id,
    amountCents: 50000,
    method: "check",
    reference: "4412",
  });
  return { id: invoice.id, paymentId: payment.id };
}

async function paymentRowCount(documentId: string, live: boolean): Promise<number> {
  const rows = await raw.query(
    live
      ? `SELECT count(*) FROM payments WHERE document_id = ? AND deleted_at IS NULL`
      : `SELECT count(*) FROM payments WHERE document_id = ?`,
    [documentId],
  );
  return Number(rows[0][0]);
}

describe("an invoice with payments, through the delete paths", () => {
  it("keeps its payments through the Trash and back, counting for nothing while it is there", async () => {
    h = await createSeededHarness();
    const { id, paymentId } = await partlyPaidInvoice();
    expect((await documents.getOrThrow(id)).document.status).toBe("partial");

    await documents.softDelete(id);
    // The payment row stays; it is unreachable because every money query
    // joins documents and tests deleted_at, not because the row went away.
    expect(await paymentRowCount(id, true)).toBe(1);
    expect(await payments.listForDeal((await documents.getOrThrow(id)).document.dealId!)).toEqual([]);

    await documents.restore(id);
    const back = await payments.listForDocument(id);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(paymentId);
    expect(back[0].amountCents).toBe(50000);
    // And the invoice is the same invoice it was: partly paid, not reset.
    expect((await documents.getOrThrow(id)).document.status).toBe("partial");
  });

  it("leaves a payment the owner removed by hand removed when the invoice comes back", async () => {
    h = await createSeededHarness();
    const { id, paymentId } = await partlyPaidInvoice();
    const second = await payments.create({
      documentId: id,
      amountCents: 20000,
      method: "cash",
    });

    // The regression this file exists for: a cascade keyed on the deleted_at
    // instant resurrected this one, because `remove` and `softDelete` landed
    // in the same millisecond.
    await payments.remove(paymentId);
    await documents.softDelete(id);
    await documents.restore(id);

    const back = await payments.listForDocument(id);
    expect(back.map((p) => p.id)).toEqual([second.id]);
  });

  it("purges the payments with the invoice rather than being refused by the constraint", async () => {
    h = await createSeededHarness();
    const { id } = await partlyPaidInvoice();
    await documents.softDelete(id);

    await documents.purge(id);
    expect(await paymentRowCount(id, false)).toBe(0);
    const rows = await raw.query(`SELECT count(*) FROM documents WHERE id = ?`, [id]);
    expect(Number(rows[0][0])).toBe(0);
  });

  it("empties the Trash through trash.purge, which the 30-day sweep uses", async () => {
    h = await createSeededHarness();
    const { id } = await partlyPaidInvoice();
    await documents.softDelete(id);

    await trash.purge("document", id);
    expect(await paymentRowCount(id, false)).toBe(0);
    const rows = await raw.query(`SELECT count(*) FROM documents WHERE id = ?`, [id]);
    expect(Number(rows[0][0])).toBe(0);
  });

  it("still refuses a bare DELETE that would orphan the money", async () => {
    h = await createSeededHarness();
    const { id } = await partlyPaidInvoice();
    // The constraint is the safety net under all four paths above: prove it is
    // actually armed, or the tests above prove only that the code is polite.
    await expect(
      raw.execute(`DELETE FROM documents WHERE id = ?`, [id]),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});
