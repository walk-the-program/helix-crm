/**
 * CPO-LA-IMPL-W3 (F-LC-3 / ruling R6b): trash.ts grows three more entity
 * types, and a deal a real document still refers to cannot be purged.
 *
 * A new file rather than an addition to trash.test.ts, since the working
 * tree is shared with several other agents editing that file's neighbours
 * right now.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import * as trash from "../../src/db/repos/trash";
import * as deals from "../../src/db/repos/deals";
import * as documents from "../../src/db/repos/documents";
import * as products from "../../src/db/repos/products";
import * as customFields from "../../src/db/repos/customFields";
import * as pipelines from "../../src/db/repos/pipelines";
import * as stages from "../../src/db/repos/stages";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const [stage] = await stages.list(pipeline.id);
  return stage.id;
}

async function makeInvoice(dealId: string): Promise<documents.Document> {
  return documents.create({
    kind: "invoice",
    dealId,
    taxRateBp: 0,
    items: [{ name: "Line item", qty: 1, unitCents: 1000 }],
  });
}

describe("trash: product, custom_field and document", () => {
  it("lists, restores and purges a soft-deleted product, labelled 'Service <name>'", async () => {
    h = await createSeededHarness();
    const product = await products.create({ name: "Gutter cleaning", unitPriceCents: 5000 });
    await products.softDelete(product.id);

    const items = await trash.list("product");
    const found = items.find((i) => i.entityId === product.id);
    expect(found).toBeDefined();
    expect(found?.label).toBe("Service Gutter cleaning");

    await trash.restore("product", product.id);
    expect((await products.get(product.id))?.deletedAt).toBeNull();

    await products.softDelete(product.id);
    await trash.purge("product", product.id);
    expect(await products.get(product.id)).toBeNull();
  });

  it("lists, restores and purges a soft-deleted custom field, labelled 'Field <name>'", async () => {
    h = await createSeededHarness();
    const field = await customFields.create({
      entityType: "contact",
      name: "Favorite color",
      kind: "text",
    });
    await customFields.softDelete(field.id);

    const items = await trash.list("custom_field");
    const found = items.find((i) => i.entityId === field.id);
    expect(found).toBeDefined();
    expect(found?.label).toBe("Field Favorite color");

    await trash.restore("custom_field", field.id);
    expect((await customFields.get(field.id))?.deletedAt).toBeNull();

    await customFields.softDelete(field.id);
    await trash.purge("custom_field", field.id);
    expect(await customFields.get(field.id)).toBeNull();
  });

  it("lists, restores and purges a soft-deleted document, labelled by kind and number", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Deal for a document", stageId });
    const invoice = await makeInvoice(deal.id);
    await documents.softDelete(invoice.id);

    const items = await trash.list("document");
    const found = items.find((i) => i.entityId === invoice.id);
    expect(found).toBeDefined();
    expect(found?.label).toBe(`Invoice ${invoice.number}`);

    await trash.restore("document", invoice.id);
    expect((await documents.get(invoice.id))?.document.deletedAt).toBeNull();

    await documents.softDelete(invoice.id);
    await trash.purge("document", invoice.id);
    expect(await documents.get(invoice.id)).toBeNull();
  });

  it("labels a soft-deleted quote 'Quote <number>'", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Deal for a quote", stageId });
    const quote = await documents.create({
      kind: "quote",
      dealId: deal.id,
      taxRateBp: 0,
      items: [{ name: "Line item", qty: 1, unitCents: 1000 }],
    });
    await documents.softDelete(quote.id);

    const items = await trash.list("document");
    const found = items.find((i) => i.entityId === quote.id);
    expect(found?.label).toBe(`Quote ${quote.number}`);
  });
});

describe("trash: a deal a real document refers to (ruling R6b)", () => {
  it("marks the deal blocked by a SENT invoice's number, and refuses to purge it", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Blocked deal", stageId });
    const invoice = await makeInvoice(deal.id);
    await documents.send(invoice.id);

    await deals.softDelete(deal.id);

    const items = await trash.list("deal");
    const found = items.find((i) => i.entityId === deal.id);
    expect(found).toBeDefined();
    expect(found?.blockedBy).toBe(invoice.number);

    await expect(trash.purge("deal", deal.id)).rejects.toThrow(
      new RegExp(invoice.number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    // Restoring a blocked deal still works: only purge is refused.
    await trash.restore("deal", deal.id);
    const restored = await deals.get(deal.id);
    expect(restored?.deletedAt).toBeNull();
  });

  it("does not block on a DRAFT invoice", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Draft-only deal", stageId });
    await makeInvoice(deal.id); // left in draft

    await deals.softDelete(deal.id);

    const items = await trash.list("deal");
    const found = items.find((i) => i.entityId === deal.id);
    expect(found?.blockedBy ?? null).toBeNull();

    // Purge succeeds: nothing left the building.
    await trash.purge("deal", deal.id);
    expect(await deals.get(deal.id)).toBeNull();
  });

  it("does not block on a VOID invoice", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Voided deal", stageId });
    const invoice = await makeInvoice(deal.id);
    await documents.send(invoice.id);
    await documents.markVoid(invoice.id);

    await deals.softDelete(deal.id);

    const items = await trash.list("deal");
    const found = items.find((i) => i.entityId === deal.id);
    expect(found?.blockedBy ?? null).toBeNull();

    await trash.purge("deal", deal.id);
    expect(await deals.get(deal.id)).toBeNull();
  });
});

describe("trash: the 30-day expiry sweep skips a blocked deal", () => {
  it("expired() leaves the blocked deal out, and purging every item it returns never throws", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();

    const blockedDeal = await deals.create({ title: "Expired but blocked", stageId });
    const invoice = await makeInvoice(blockedDeal.id);
    await documents.send(invoice.id);
    await deals.softDelete(blockedDeal.id);

    const freeDeal = await deals.create({ title: "Expired and free", stageId });
    await deals.softDelete(freeDeal.id);

    const oldIso = "2024-01-01T00:00:00.000Z";
    await raw.execute(`UPDATE deals SET deleted_at = ? WHERE id IN (?, ?)`, [
      oldIso,
      blockedDeal.id,
      freeDeal.id,
    ]);

    const today = "2024-02-10"; // 40 days after the backdated deletion
    const expiredItems = await trash.expired(30, today);
    const expiredDealIds = expiredItems
      .filter((i) => i.entityType === "deal")
      .map((i) => i.entityId);

    expect(expiredDealIds).toContain(freeDeal.id);
    expect(expiredDealIds).not.toContain(blockedDeal.id);

    // The sweep: purge everything expired() handed back, with no per-item
    // try/catch of its own. Must not throw.
    await expect(
      (async () => {
        for (const item of expiredItems) {
          await trash.purge(item.entityType, item.entityId);
        }
      })(),
    ).resolves.toBeUndefined();

    expect(await deals.get(freeDeal.id)).toBeNull();
    // The blocked deal was never handed to the sweep, so it survives.
    expect(await deals.get(blockedDeal.id)).not.toBeNull();

    // Purging it directly is still refused.
    await expect(trash.purge("deal", blockedDeal.id)).rejects.toThrow();
  });
});
