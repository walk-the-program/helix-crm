/**
 * `payments.remove` / `payments.restore`: the invoice's status has to walk
 * back in both directions, and the undo trail (`change_log`) has to carry the
 * rows an undo toast needs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as deals from "../../../src/db/repos/deals";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as changeLog from "../../../src/db/changeLog";

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
  const deal = await deals.create({ title: "Undo test deal", stageId: await firstStageId() });
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

describe("payments.remove / payments.restore", () => {
  it("removing the only payment sends the invoice back to sent; restoring it returns to paid", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(10_000);
    const payment = await payments.create({
      documentId: invoice.id,
      amountCents: 10_000,
      paidOn: "2026-03-10",
      method: "cash",
    });
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("paid");

    await payments.remove(payment.id);
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("sent");
    expect(await payments.listForDocument(invoice.id)).toEqual([]);

    await payments.restore(payment.id);
    const restored = await documents.getOrThrow(invoice.id);
    expect(restored.document.status).toBe("paid");
    const rows = await payments.listForDocument(invoice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(payment.id);
    expect(rows[0].amountCents).toBe(10_000);
  });

  it("removing the balance payment (of two) walks the invoice back to partial; restoring walks it forward to paid again", async () => {
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
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("partial");

    await payments.restore(balance.id);
    expect((await documents.getOrThrow(invoice.id)).document.status).toBe("paid");
  });

  it("writes a 'delete' change_log row on remove and a 'create' row from the original write", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(5_000);
    const payment = await payments.create({ documentId: invoice.id, amountCents: 5_000, method: "cash" });
    await payments.remove(payment.id);

    const entries = await changeLog.listForEntity("payment", payment.id);
    const ops = entries.map((e) => e.op);
    expect(ops).toContain("create");
    expect(ops).toContain("delete");
    expect(entries.every((e) => e.entityType === "payment")).toBe(true);

    const deleteEntry = entries.find((e) => e.op === "delete")!;
    expect(deleteEntry.before).toEqual({ deletedAt: null });
  });

  it("restore appends its own 'restore' row rather than rewriting the 'delete' one", async () => {
    h = await createSeededHarness();
    const invoice = await sentInvoice(5_000);
    const payment = await payments.create({ documentId: invoice.id, amountCents: 5_000, method: "cash" });
    await payments.remove(payment.id);
    await payments.restore(payment.id);

    const ops = (await changeLog.listForEntity("payment", payment.id)).map((e) => e.op);
    expect(ops).toEqual(expect.arrayContaining(["create", "delete", "restore"]));
  });
});
