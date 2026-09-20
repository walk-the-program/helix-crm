/**
 * Deal line items against a real database.
 *
 * The thing under test is the invariant: after any change to a deal's lines,
 * the deal's four derived columns agree with them, in the same transaction.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as deals from "../../../src/db/repos/deals";
import * as dealItems from "../../../src/db/repos/dealItems";
import * as products from "../../../src/db/repos/products";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";

let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
});

type Fixture = {
  dealId: string;
  firstStageId: string;
  wonStageId: string;
};

async function fixture(): Promise<Fixture> {
  const pipeline = (await pipelines.list())[0];
  const all = await stages.list(pipeline.id);
  const firstStageId = all[0].id;
  const wonStageId = all.find((s) => s.isWon)!.id;
  const deal = await deals.create({ title: "Riverside patio", stageId: firstStageId });
  return { dealId: deal.id, firstStageId, wonStageId };
}

/** The four derived columns, read straight from the row. */
async function derived(dealId: string) {
  const rows = await raw.query(
    `SELECT d.one_time_cents           AS d_one_time_cents,
            d.recurring_monthly_cents  AS d_recurring_monthly_cents,
            d.suggested_total_cents    AS d_suggested_total_cents,
            d.value_cents              AS d_value_cents,
            d.recurring_started_on     AS d_recurring_started_on,
            d.recurring_ended_on       AS d_recurring_ended_on
     FROM deals d WHERE d.id = ?`,
    [dealId],
  );
  const r = rows[0];
  return {
    oneTimeCents: Number(r[0]),
    recurringMonthlyCents: Number(r[1]),
    suggestedTotalCents: Number(r[2]),
    valueCents: Number(r[3]),
    recurringStartedOn: r[4] === null ? null : String(r[4]),
    recurringEndedOn: r[5] === null ? null : String(r[5]),
  };
}

describe("adding lines", () => {
  beforeEach(async () => {
    h = await createSeededHarness();
  });

  it("copies the catalog price onto the line and leaves the actual equal to it", async () => {
    const f = await fixture();
    const product = await products.create({
      name: "Patio installation",
      kind: "one_time",
      unitPriceCents: 210_000,
    });

    const item = await dealItems.addFromProduct(f.dealId, product.id);

    expect(item.name).toBe("Patio installation");
    expect(item.suggestedUnitCents).toBe(210_000);
    expect(item.actualUnitCents).toBe(210_000);
    expect(item.productId).toBe(product.id);
  });

  it("writes the deal's money in the same breath as the line", async () => {
    const f = await fixture();
    const install = await products.create({
      name: "Patio installation",
      kind: "one_time",
      unitPriceCents: 150_000,
    });
    const upkeep = await products.create({
      name: "Monthly upkeep",
      kind: "recurring",
      interval: "month",
      unitPriceCents: 15_000,
    });

    await dealItems.addFromProduct(f.dealId, install.id);
    await dealItems.addFromProduct(f.dealId, upkeep.id);

    expect(await derived(f.dealId)).toMatchObject({
      oneTimeCents: 150_000,
      recurringMonthlyCents: 15_000,
      suggestedTotalCents: 330_000,
      valueCents: 330_000,
    });
  });

  it("puts the annual value on value_cents, so the pipeline still sums", async () => {
    const f = await fixture();
    await dealItems.add({
      dealId: f.dealId,
      name: "Monthly upkeep",
      kind: "recurring",
      interval: "month",
      suggestedUnitCents: 15_000,
    });

    const deal = await deals.getOrThrow(f.dealId);
    expect(deal.valueCents).toBe(180_000);
  });

  it("normalises a yearly line to a month", async () => {
    const f = await fixture();
    await dealItems.add({
      dealId: f.dealId,
      name: "Annual service plan",
      kind: "recurring",
      interval: "year",
      suggestedUnitCents: 24_900,
    });

    const d = await derived(f.dealId);
    expect(d.recurringMonthlyCents).toBe(2_075);
    expect(d.valueCents).toBe(24_900);
  });

  it("forces the interval to match the kind", async () => {
    const f = await fixture();
    const recurring = await dealItems.add({
      dealId: f.dealId,
      name: "Upkeep",
      kind: "recurring",
      suggestedUnitCents: 100,
    });
    const once = await dealItems.add({
      dealId: f.dealId,
      name: "Install",
      kind: "one_time",
      interval: "month",
      suggestedUnitCents: 100,
    });

    expect(recurring.interval).toBe("month");
    expect(once.interval).toBeNull();
  });
});

describe("changing lines", () => {
  beforeEach(async () => {
    h = await createSeededHarness();
  });

  it("shows the discount when the owner charges less than the catalog", async () => {
    const f = await fixture();
    const item = await dealItems.add({
      dealId: f.dealId,
      name: "Patio installation",
      kind: "one_time",
      suggestedUnitCents: 210_000,
    });

    await dealItems.update(item.id, { actualUnitCents: 165_000 });

    const d = await derived(f.dealId);
    expect(d.suggestedTotalCents).toBe(210_000);
    expect(d.valueCents).toBe(165_000);
    expect(d.suggestedTotalCents - d.valueCents).toBe(45_000);
  });

  it("recomputes on a quantity change", async () => {
    const f = await fixture();
    const item = await dealItems.add({
      dealId: f.dealId,
      name: "Service call",
      kind: "one_time",
      suggestedUnitCents: 8_900,
    });

    await dealItems.update(item.id, { qty: 3 });

    expect((await derived(f.dealId)).valueCents).toBe(26_700);
  });

  it("recomputes when a line is removed", async () => {
    const f = await fixture();
    const a = await dealItems.add({
      dealId: f.dealId,
      name: "Install",
      kind: "one_time",
      suggestedUnitCents: 100_000,
    });
    await dealItems.add({
      dealId: f.dealId,
      name: "Upkeep",
      kind: "recurring",
      interval: "month",
      suggestedUnitCents: 10_000,
    });

    await dealItems.remove(a.id);

    const d = await derived(f.dealId);
    expect(d.oneTimeCents).toBe(0);
    expect(d.recurringMonthlyCents).toBe(10_000);
    expect(d.valueCents).toBe(120_000);
    expect(await dealItems.list(f.dealId)).toHaveLength(1);
  });

  it("goes back to zero when the last line goes", async () => {
    const f = await fixture();
    const item = await dealItems.add({
      dealId: f.dealId,
      name: "Install",
      kind: "one_time",
      suggestedUnitCents: 100_000,
    });
    await dealItems.remove(item.id);

    expect(await derived(f.dealId)).toMatchObject({
      oneTimeCents: 0,
      recurringMonthlyCents: 0,
      suggestedTotalCents: 0,
      valueCents: 0,
    });
  });

  it("keeps the line when the catalog service is deleted underneath it", async () => {
    const f = await fixture();
    const product = await products.create({
      name: "Patio installation",
      kind: "one_time",
      unitPriceCents: 150_000,
    });
    const item = await dealItems.addFromProduct(f.dealId, product.id);
    await products.purge(product.id);

    const after = await dealItems.getOrThrow(item.id);
    expect(after.name).toBe("Patio installation");
    expect(after.actualUnitCents).toBe(150_000);
    expect(after.productId).toBeNull();
  });

  it("puts the lines in the order given", async () => {
    const f = await fixture();
    const a = await dealItems.add({ dealId: f.dealId, name: "A", suggestedUnitCents: 1 });
    const b = await dealItems.add({ dealId: f.dealId, name: "B", suggestedUnitCents: 1 });

    await dealItems.reorder(f.dealId, [b.id, a.id]);

    expect((await dealItems.list(f.dealId)).map((i) => i.name)).toEqual(["B", "A"]);
  });
});

describe("winning and ending the recurring revenue", () => {
  beforeEach(async () => {
    h = await createSeededHarness();
  });

  it("starts the clock when a deal with recurring lines is won", async () => {
    const f = await fixture();
    await dealItems.add({
      dealId: f.dealId,
      name: "Monthly upkeep",
      kind: "recurring",
      interval: "month",
      suggestedUnitCents: 15_000,
    });
    expect((await derived(f.dealId)).recurringStartedOn).toBeNull();

    await deals.moveToStage(f.dealId, f.wonStageId);
    await dealItems.recompute(f.dealId);

    expect((await derived(f.dealId)).recurringStartedOn).not.toBeNull();
  });

  it("starts nothing when the won deal has no recurring lines", async () => {
    const f = await fixture();
    await dealItems.add({
      dealId: f.dealId,
      name: "Patio installation",
      kind: "one_time",
      suggestedUnitCents: 150_000,
    });

    await deals.moveToStage(f.dealId, f.wonStageId);
    await dealItems.recompute(f.dealId);

    expect((await derived(f.dealId)).recurringStartedOn).toBeNull();
  });

  it("does not move a start date that is already set", async () => {
    const f = await fixture();
    await dealItems.add({
      dealId: f.dealId,
      name: "Upkeep",
      kind: "recurring",
      interval: "month",
      suggestedUnitCents: 15_000,
    });
    await deals.moveToStage(f.dealId, f.wonStageId);
    await dealItems.recompute(f.dealId, { on: "2026-03-01" });

    await dealItems.recompute(f.dealId, { on: "2026-09-19" });

    expect((await derived(f.dealId)).recurringStartedOn).toBe("2026-03-01");
  });

  it("ends the recurring revenue without touching what was sold", async () => {
    const f = await fixture();
    await dealItems.add({
      dealId: f.dealId,
      name: "Upkeep",
      kind: "recurring",
      interval: "month",
      suggestedUnitCents: 15_000,
    });
    await deals.moveToStage(f.dealId, f.wonStageId);
    await dealItems.recompute(f.dealId, { on: "2026-03-01" });

    await dealItems.endRecurring(f.dealId, { on: "2026-09-30" });

    const d = await derived(f.dealId);
    expect(d.recurringEndedOn).toBe("2026-09-30");
    expect(d.recurringMonthlyCents).toBe(15_000);
    expect(await dealItems.list(f.dealId)).toHaveLength(1);
  });

  it("puts a deal ended by mistake back on the books", async () => {
    const f = await fixture();
    await dealItems.add({
      dealId: f.dealId,
      name: "Upkeep",
      kind: "recurring",
      interval: "month",
      suggestedUnitCents: 15_000,
    });
    await deals.moveToStage(f.dealId, f.wonStageId);
    await dealItems.endRecurring(f.dealId, { on: "2026-09-30" });

    await dealItems.resumeRecurring(f.dealId);

    expect((await derived(f.dealId)).recurringEndedOn).toBeNull();
  });
});
