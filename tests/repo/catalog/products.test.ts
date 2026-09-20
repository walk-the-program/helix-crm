/**
 * The product (service) catalog repository against a real SQLite file.
 *
 * The part worth testing hardest is the recurring/interval cross-field rule:
 * reports sum MRR by trusting that a recurring row always has an interval, so
 * every path that can change `kind` or `interval` is covered here. Usage and
 * removeOrDeactivate are the other load-bearing piece - a product already
 * quoted on a deal must never lose the price history that points at it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as products from "../../../src/db/repos/products";
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

/** Insert a deal_items row directly, the way a deal's line-item form would. */
async function insertDealItem(opts: {
  dealId: string;
  productId: string;
  kind?: "one_time" | "recurring";
  deletedAt?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  await raw.execute(
    `INSERT INTO deal_items
       (id, deal_id, product_id, name, kind, interval, qty,
        suggested_unit_cents, actual_unit_cents, taxable, position,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.dealId,
      opts.productId,
      "Line item",
      opts.kind ?? "one_time",
      null,
      1,
      1000,
      1000,
      0,
      0,
      at,
      at,
      opts.deletedAt ?? null,
    ],
  );
  return id;
}

describe("products: create/get/list", () => {
  it("round-trips, and null description and taxable false survive", async () => {
    h = await createSeededHarness();
    const created = await products.create({
      name: "Gutter cleaning",
      unitPriceCents: 15000,
    });

    expect(created.description).toBeNull();
    expect(created.taxable).toBe(false);
    expect(created.active).toBe(true);

    const fetched = await products.getOrThrow(created.id);
    expect(fetched).toEqual(created);

    const { rows } = await products.list();
    expect(rows.map((p) => p.id)).toEqual([created.id]);
  });

  it("keeps a real description when one is given", async () => {
    h = await createSeededHarness();
    const created = await products.create({
      name: "Roof inspection",
      description: "Full roof and gutter walk-through",
      unitPriceCents: 25000,
    });
    expect(created.description).toBe("Full roof and gutter walk-through");
  });
});

describe("products: the recurring/interval cross-field rule", () => {
  it("defaults a recurring product with no interval to month", async () => {
    h = await createSeededHarness();
    const created = await products.create({
      name: "Monthly maintenance",
      kind: "recurring",
      unitPriceCents: 5000,
    });
    expect(created.kind).toBe("recurring");
    expect(created.interval).toBe("month");
  });

  it("keeps an explicit interval on a recurring product", async () => {
    h = await createSeededHarness();
    const created = await products.create({
      name: "Annual plan",
      kind: "recurring",
      interval: "year",
      unitPriceCents: 50000,
    });
    expect(created.interval).toBe("year");
  });

  it("nulls the interval on a one-time product even if one is given", async () => {
    h = await createSeededHarness();
    const created = await products.create({
      name: "One-off job",
      kind: "one_time",
      interval: "year",
      unitPriceCents: 8000,
    });
    expect(created.kind).toBe("one_time");
    expect(created.interval).toBeNull();
  });

  it("nulls the interval when a recurring product is updated to one_time", async () => {
    h = await createSeededHarness();
    const created = await products.create({
      name: "Monthly plan",
      kind: "recurring",
      unitPriceCents: 5000,
    });
    expect(created.interval).toBe("month");

    const updated = await products.update(created.id, { kind: "one_time" });
    expect(updated.kind).toBe("one_time");
    expect(updated.interval).toBeNull();
  });

  it("fills in an interval when a one-time product is updated to recurring", async () => {
    h = await createSeededHarness();
    const created = await products.create({
      name: "Now recurring",
      kind: "one_time",
      unitPriceCents: 3000,
    });
    const updated = await products.update(created.id, { kind: "recurring" });
    expect(updated.kind).toBe("recurring");
    expect(updated.interval).toBe("month");
  });
});

describe("products: list ordering and filters", () => {
  it("orders by position then created_at, and filters activeOnly", async () => {
    h = await createSeededHarness();
    const a = await products.create({ name: "A", unitPriceCents: 100 });
    const b = await products.create({ name: "B", unitPriceCents: 200 });
    const c = await products.create({ name: "C", unitPriceCents: 300 });
    await products.update(b.id, { active: false });

    const all = await products.list();
    expect(all.rows.map((p) => p.name)).toEqual(["A", "B", "C"]);

    const active = await products.list({ activeOnly: true });
    expect(active.rows.map((p) => p.name)).toEqual(["A", "C"]);
    expect(active.rows.some((p) => p.id === a.id || p.id === c.id)).toBe(true);
  });

  it("filters by kind and by a name search", async () => {
    h = await createSeededHarness();
    await products.create({ name: "Gutter cleaning", unitPriceCents: 100 });
    await products.create({
      name: "Monthly plan",
      kind: "recurring",
      unitPriceCents: 200,
    });

    const recurring = await products.list({ kind: "recurring" });
    expect(recurring.rows.map((p) => p.name)).toEqual(["Monthly plan"]);

    const searched = await products.list({ search: "gutter" });
    expect(searched.rows.map((p) => p.name)).toEqual(["Gutter cleaning"]);
  });
});

describe("products: reorder", () => {
  it("rewrites positions to 0..n-1 in the given order", async () => {
    h = await createSeededHarness();
    const a = await products.create({ name: "A", unitPriceCents: 100 });
    const b = await products.create({ name: "B", unitPriceCents: 100 });
    const c = await products.create({ name: "C", unitPriceCents: 100 });

    await products.reorder([c.id, a.id, b.id]);

    const { rows } = await products.list();
    expect(rows.map((p) => p.name)).toEqual(["C", "A", "B"]);
    expect(rows.map((p) => p.position)).toEqual([0, 1, 2]);
  });
});

describe("products: usageCount", () => {
  it("counts only live deal_items rows, and drops when one is soft-deleted", async () => {
    h = await createSeededHarness();
    const product = await products.create({ name: "Sod install", unitPriceCents: 9000 });
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Backyard job", stageId });

    expect(await products.usageCount(product.id)).toBe(0);

    const itemId = await insertDealItem({ dealId: deal.id, productId: product.id });
    expect(await products.usageCount(product.id)).toBe(1);

    await raw.execute(`UPDATE deal_items SET deleted_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      itemId,
    ]);
    expect(await products.usageCount(product.id)).toBe(0);
  });
});

describe("products: softDelete", () => {
  it("throws when the product is on a deal", async () => {
    h = await createSeededHarness();
    const product = await products.create({ name: "Fence repair", unitPriceCents: 12000 });
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Fence job", stageId });
    await insertDealItem({ dealId: deal.id, productId: product.id });

    await expect(products.softDelete(product.id)).rejects.toThrow(ValidationError);
    expect(await products.get(product.id)).not.toBeNull();
  });

  it("succeeds when the product is not referenced", async () => {
    h = await createSeededHarness();
    const product = await products.create({ name: "Unused service", unitPriceCents: 500 });
    await products.softDelete(product.id);
    const found = await products.get(product.id);
    expect(found?.deletedAt).not.toBeNull();
  });
});

describe("products: removeOrDeactivate", () => {
  it("deactivates a referenced product instead of deleting it", async () => {
    h = await createSeededHarness();
    const product = await products.create({ name: "Referenced plan", unitPriceCents: 4000 });
    const stageId = await firstStageId();
    const deal = await deals.create({ title: "Some deal", stageId });
    await insertDealItem({ dealId: deal.id, productId: product.id });

    const result = await products.removeOrDeactivate(product.id);
    expect(result.outcome).toBe("deactivated");

    const found = await products.getOrThrow(product.id);
    expect(found.active).toBe(false);
    expect(found.deletedAt).toBeNull();
  });

  it("deletes an unreferenced product", async () => {
    h = await createSeededHarness();
    const product = await products.create({ name: "Unreferenced service", unitPriceCents: 2000 });

    const result = await products.removeOrDeactivate(product.id);
    expect(result.outcome).toBe("deleted");

    const found = await products.getOrThrow(product.id);
    expect(found.deletedAt).not.toBeNull();
  });
});

describe("products: dealCounts", () => {
  it("counts DISTINCT live deals per product, over the whole catalog in one query", async () => {
    h = await createSeededHarness();
    const mowing = await products.create({ name: "Mowing", unitPriceCents: 5000 });
    const edging = await products.create({ name: "Edging", unitPriceCents: 2000 });
    const unused = await products.create({ name: "Unused", unitPriceCents: 1000 });
    const stageId = await firstStageId();
    const dealA = await deals.create({ title: "Yard A", stageId });
    const dealB = await deals.create({ title: "Yard B", stageId });

    // Two different deals use "Mowing" - counts as 2.
    await insertDealItem({ dealId: dealA.id, productId: mowing.id });
    await insertDealItem({ dealId: dealB.id, productId: mowing.id });
    // The same deal uses "Edging" twice (two lines) - still counts as 1 deal.
    await insertDealItem({ dealId: dealA.id, productId: edging.id });
    await insertDealItem({ dealId: dealA.id, productId: edging.id });
    // "Unused" is never referenced.

    const counts = await products.dealCounts();
    expect(counts.get(mowing.id)).toBe(2);
    expect(counts.get(edging.id)).toBe(1);
    expect(counts.has(unused.id)).toBe(false);
  });

  it("ignores a soft-deleted line and a soft-deleted deal", async () => {
    h = await createSeededHarness();
    const product = await products.create({ name: "Sod install", unitPriceCents: 9000 });
    const stageId = await firstStageId();
    const liveDeal = await deals.create({ title: "Live deal", stageId });
    const goneDeal = await deals.create({ title: "Deleted deal", stageId });

    await insertDealItem({ dealId: liveDeal.id, productId: product.id });
    const deletedLineDealItem = await insertDealItem({
      dealId: liveDeal.id,
      productId: product.id,
      deletedAt: new Date().toISOString(),
    });
    await insertDealItem({ dealId: goneDeal.id, productId: product.id });
    await raw.execute(`UPDATE deals SET deleted_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      goneDeal.id,
    ]);

    const counts = await products.dealCounts();
    expect(counts.get(product.id)).toBe(1);
    expect(deletedLineDealItem).toBeTruthy();
  });
});

describe("products: productStatements", () => {
  it("produces an insert that applies through raw.batch", async () => {
    h = await createSeededHarness();
    const { id, statements } = products.productStatements({
      name: "Onboarding starter",
      kind: "recurring",
      unitPriceCents: 7500,
      position: 0,
    });

    await raw.batch(statements);

    const created = await products.getOrThrow(id);
    expect(created.name).toBe("Onboarding starter");
    expect(created.kind).toBe("recurring");
    expect(created.interval).toBe("month");
    expect(created.unitPriceCents).toBe(7500);
  });
});
