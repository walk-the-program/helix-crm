/**
 * The revenue report's queries against a real database.
 *
 * The pure arithmetic is covered in tests/unit/revenue/mrr.test.ts; what is
 * tested here is what the SQL lets through: only won deals, never a deleted
 * one, upfront money counted on the day the deal was won.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as deals from "../../../src/db/repos/deals";
import * as dealItems from "../../../src/db/repos/dealItems";
import * as reports from "../../../src/db/repos/reports";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const TODAY = "2026-09-19";

/** A period covering all of one month, as the half-open ISO range reports use. */
function month(year: number, monthIndex: number) {
  return {
    id: "month" as const,
    label: "A month",
    from: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    to: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString(),
  };
}

async function stageIds() {
  const pipeline = (await pipelines.list())[0];
  const all = await stages.list(pipeline.id);
  return { open: all[0].id, won: all.find((s) => s.isWon)!.id, lost: all.find((s) => s.isLost)!.id };
}

/**
 * A won deal earning `monthlyCents` a month from `startedOn`.
 *
 * `closed_at` and the recurring dates are written directly, because the point
 * of most of these tests is a date in the past and the repository quite
 * correctly stamps today.
 */
async function wonRecurringDeal(input: {
  title: string;
  monthlyCents: number;
  oneTimeCents?: number;
  startedOn: string;
  endedOn?: string | null;
  closedAt?: string;
}): Promise<string> {
  const ids = await stageIds();
  const deal = await deals.create({ title: input.title, stageId: ids.open });
  if (input.oneTimeCents) {
    await dealItems.add({
      dealId: deal.id,
      name: "Install",
      kind: "one_time",
      suggestedUnitCents: input.oneTimeCents,
    });
  }
  await dealItems.add({
    dealId: deal.id,
    name: "Upkeep",
    kind: "recurring",
    interval: "month",
    suggestedUnitCents: input.monthlyCents,
  });
  await deals.moveToStage(deal.id, ids.won);
  await raw.execute(
    `UPDATE deals SET recurring_started_on = ?, recurring_ended_on = ?, closed_at = ? WHERE id = ?`,
    [
      input.startedOn,
      input.endedOn ?? null,
      input.closedAt ?? `${input.startedOn}T12:00:00.000Z`,
      deal.id,
    ],
  );
  return deal.id;
}

describe("which deals count", () => {
  beforeEach(async () => {
    h = await createSeededHarness();
  });

  it("counts a won deal that is earning today", async () => {
    await wonRecurringDeal({ title: "Riverside", monthlyCents: 15_000, startedOn: "2026-01-01" });
    const rows = await reports.recurringDeals();
    expect(rows).toHaveLength(1);
    expect(reports.mrrAsOf(rows, TODAY)).toBe(15_000);
  });

  it("leaves out a deal that is still open", async () => {
    const ids = await stageIds();
    const deal = await deals.create({ title: "Not won yet", stageId: ids.open });
    await dealItems.add({
      dealId: deal.id,
      name: "Upkeep",
      kind: "recurring",
      interval: "month",
      suggestedUnitCents: 15_000,
    });
    // A start date on an open deal cannot happen through the repository, but
    // the query must not rely on that.
    await raw.execute(`UPDATE deals SET recurring_started_on = ? WHERE id = ?`, [
      "2026-01-01",
      deal.id,
    ]);

    expect(await reports.recurringDeals()).toHaveLength(0);
  });

  it("leaves out a deleted deal", async () => {
    const id = await wonRecurringDeal({
      title: "Gone",
      monthlyCents: 15_000,
      startedOn: "2026-01-01",
    });
    await deals.softDelete(id);

    expect(await reports.recurringDeals()).toHaveLength(0);
  });

  it("leaves out a won deal with nothing recurring on it", async () => {
    const ids = await stageIds();
    const deal = await deals.create({ title: "One and done", stageId: ids.open });
    await dealItems.add({
      dealId: deal.id,
      name: "Install",
      kind: "one_time",
      suggestedUnitCents: 150_000,
    });
    await deals.moveToStage(deal.id, ids.won);

    expect(await reports.recurringDeals()).toHaveLength(0);
  });

  it("keeps an ended deal in the history but out of today's number", async () => {
    await wonRecurringDeal({
      title: "Cancelled",
      monthlyCents: 9_900,
      startedOn: "2026-01-01",
      endedOn: "2026-06-30",
    });
    const rows = await reports.recurringDeals();

    expect(rows).toHaveLength(1);
    expect(reports.mrrAsOf(rows, "2026-06-30")).toBe(9_900);
    expect(reports.mrrAsOf(rows, TODAY)).toBe(0);
  });
});

describe("the whole report", () => {
  beforeEach(async () => {
    h = await createSeededHarness();
  });

  it("puts MRR, ARR and the movement together", async () => {
    await wonRecurringDeal({ title: "Riverside", monthlyCents: 15_000, startedOn: "2026-01-01" });
    await wonRecurringDeal({ title: "Hillcrest", monthlyCents: 9_900, startedOn: "2026-09-03" });
    await wonRecurringDeal({
      title: "Oakfield",
      monthlyCents: 5_000,
      startedOn: "2026-02-01",
      endedOn: "2026-09-10",
    });

    const bundle = await reports.revenue({
      today: TODAY,
      month: month(2026, 8),
      quarter: month(2026, 8),
      year: month(2026, 8),
    });

    expect(bundle.mrrCents).toBe(24_900);
    expect(bundle.arrCents).toBe(298_800);
    expect(bundle.newMrrCents).toBe(9_900);
    expect(bundle.churnedMrrCents).toBe(5_000);
    expect(bundle.active.map((d) => d.title)).toEqual(["Riverside", "Hillcrest"]);
    expect(bundle.byMonth).toHaveLength(12);
    expect(bundle.byMonth[11].mrrCents).toBe(24_900);
  });

  it("counts upfront money on the day the deal was won", async () => {
    await wonRecurringDeal({
      title: "Riverside",
      monthlyCents: 15_000,
      oneTimeCents: 150_000,
      startedOn: "2026-09-02",
      closedAt: "2026-09-02T17:00:00.000Z",
    });
    await wonRecurringDeal({
      title: "Last year",
      monthlyCents: 1_000,
      oneTimeCents: 900_000,
      startedOn: "2025-04-04",
      closedAt: "2025-04-04T17:00:00.000Z",
    });

    const bundle = await reports.revenue({
      today: TODAY,
      month: month(2026, 8),
      // Q3 is July to October, and the year is all of 2026.
      quarter: { ...month(2026, 6), to: new Date(Date.UTC(2026, 9, 1)).toISOString() },
      year: { ...month(2026, 0), to: new Date(Date.UTC(2027, 0, 1)).toISOString() },
    });

    expect(bundle.upfrontMonthCents).toBe(150_000);
    expect(bundle.upfrontQuarterCents).toBe(150_000);
    expect(bundle.upfrontYearCents).toBe(150_000);
  });

  it("is all zeroes on an empty workspace", async () => {
    const bundle = await reports.revenue({
      today: TODAY,
      month: month(2026, 8),
      quarter: { ...month(2026, 6), to: new Date(Date.UTC(2026, 9, 1)).toISOString() },
      year: { ...month(2026, 0), to: new Date(Date.UTC(2027, 0, 1)).toISOString() },
    });

    expect(bundle.mrrCents).toBe(0);
    expect(bundle.arrCents).toBe(0);
    expect(bundle.active).toEqual([]);
    expect(bundle.byMonth.every((p) => p.mrrCents === 0)).toBe(true);
  });
});
