/**
 * The deals report's queries.
 *
 * The three that can be got wrong quietly:
 *
 *   - a trailing window has to be zero-filled and has to agree with SQLite
 *     about which Monday a Thursday belongs to;
 *   - a won rate with nothing closed is not 0%, it is no answer at all, and
 *     the divisor must never be zero;
 *   - time to win is a median, so it must not be dragged by one ancient deal.
 *
 * Rows go in with SQL rather than through the repositories: these queries are
 * all about `created_at` and `closed_at`, and every write helper stamps "now".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import {
  dealsSummary,
  lastWeeks,
  loadDealsReport,
  median,
  mondayOf,
  newDealsTrend,
} from "../../../src/db/repos/reports";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createSeededHarness();
});

afterEach(() => {
  h?.dispose();
  h = null;
});

async function stageId(name: string): Promise<string> {
  const rows = await raw.query(`SELECT id FROM stages WHERE name = ?`, [name]);
  return String(rows[0][0]);
}

async function insertDeal(options: {
  id: string;
  stage: string;
  valueCents?: number;
  createdAt: string;
  closedAt?: string | null;
  deletedAt?: string | null;
}): Promise<void> {
  await raw.execute(
    `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at,
                        position, closed_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?, ?, ?)`,
    [
      options.id,
      options.id,
      options.valueCents ?? 0,
      await stageId(options.stage),
      options.createdAt,
      options.closedAt ?? null,
      options.createdAt,
      options.createdAt,
      options.deletedAt ?? null,
    ],
  );
}

/** March 2026, the way the period picker builds it. */
const MARCH = {
  id: "month" as const,
  label: "This month",
  from: new Date(2026, 2, 1).toISOString(),
  to: new Date(2026, 3, 1).toISOString(),
};

describe("median", () => {
  it("is the middle of an odd list and the mean of the middle two of an even one", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("is null for an empty list rather than zero or NaN", () => {
    expect(median([])).toBeNull();
  });
});

describe("week buckets", () => {
  it("puts every day of a week on the same Monday", () => {
    // 2026-03-02 is a Monday; 2026-03-08 is the Sunday that ends its week.
    expect(mondayOf("2026-03-02")).toBe("2026-03-02");
    expect(mondayOf("2026-03-05")).toBe("2026-03-02");
    expect(mondayOf("2026-03-08")).toBe("2026-03-02");
    expect(mondayOf("2026-03-09")).toBe("2026-03-09");
  });

  it("returns twelve consecutive Mondays, oldest first", () => {
    const weeks = lastWeeks("2026-03-05");
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toBe("2026-03-02");
    expect(weeks[0]).toBe("2025-12-15");
    for (let i = 1; i < weeks.length; i += 1) {
      const gap =
        (Date.parse(`${weeks[i]}T00:00:00Z`) - Date.parse(`${weeks[i - 1]}T00:00:00Z`)) / 86_400_000;
      expect(gap).toBe(7);
    }
  });
});

describe("newDealsTrend", () => {
  it("counts deals into the right week and zero-fills the quiet ones", async () => {
    await insertDeal({ id: "a", stage: "New", createdAt: "2026-03-02T09:00:00.000Z", valueCents: 100_00 });
    await insertDeal({ id: "b", stage: "New", createdAt: "2026-03-05T23:00:00.000Z", valueCents: 50_00 });
    await insertDeal({ id: "c", stage: "New", createdAt: "2026-02-24T09:00:00.000Z", valueCents: 25_00 });

    const rows = await newDealsTrend("week", "2026-03-05");
    expect(rows).toHaveLength(12);
    const byBucket = new Map(rows.map((row) => [row.bucket, row]));
    expect(byBucket.get("2026-03-02")).toEqual({
      bucket: "2026-03-02",
      count: 2,
      valueCents: 150_00,
    });
    expect(byBucket.get("2026-02-23")).toEqual({
      bucket: "2026-02-23",
      count: 1,
      valueCents: 25_00,
    });
    // The week between them had nothing in it and is still a row.
    expect(byBucket.get("2026-02-16")).toEqual({
      bucket: "2026-02-16",
      count: 0,
      valueCents: 0,
    });
  });

  it("buckets by month and leaves out soft-deleted deals", async () => {
    await insertDeal({ id: "d", stage: "New", createdAt: "2026-03-10T09:00:00.000Z" });
    await insertDeal({
      id: "e",
      stage: "New",
      createdAt: "2026-03-11T09:00:00.000Z",
      deletedAt: "2026-03-12T09:00:00.000Z",
    });

    const rows = await newDealsTrend("month", "2026-03-15");
    expect(rows).toHaveLength(12);
    expect(rows[11].bucket).toBe("2026-03");
    expect(rows[11].count).toBe(1);
  });

  it("is twelve zeroes on an empty workspace", async () => {
    const rows = await newDealsTrend("week", "2026-03-05");
    expect(rows.every((row) => row.count === 0 && row.valueCents === 0)).toBe(true);
  });
});

describe("dealsSummary", () => {
  it("computes the won rate, the average win and the median time to win", async () => {
    // Two won, one lost. Won values 200 and 400 -> average 300.
    // Days to win: 10 and 20 -> median 15.
    //
    // Every timestamp is midday UTC so it falls inside March whatever the
    // machine's timezone: a period is built from the owner's LOCAL midnight,
    // so a deal stamped 00:00Z on the 1st is February's in Denver.
    await insertDeal({
      id: "w1",
      stage: "Won",
      valueCents: 200_00,
      createdAt: "2026-03-03T12:00:00.000Z",
      closedAt: "2026-03-13T12:00:00.000Z",
    });
    await insertDeal({
      id: "w2",
      stage: "Won",
      valueCents: 400_00,
      createdAt: "2026-03-03T12:00:00.000Z",
      closedAt: "2026-03-23T12:00:00.000Z",
    });
    await insertDeal({
      id: "l1",
      stage: "Lost",
      valueCents: 900_00,
      createdAt: "2026-03-04T12:00:00.000Z",
      closedAt: "2026-03-14T12:00:00.000Z",
    });

    const summary = await dealsSummary(MARCH);
    expect(summary.wonCount).toBe(2);
    expect(summary.lostCount).toBe(1);
    expect(summary.closedCount).toBe(3);
    expect(summary.wonRate).toBeCloseTo(2 / 3, 10);
    expect(summary.wonValueCents).toBe(600_00);
    expect(summary.averageWonCents).toBe(300_00);
    expect(summary.medianDaysToWin).toBe(15);
    expect(summary.newCount).toBe(3);
    expect(summary.newValueCents).toBe(1_500_00);
  });

  it("has no won rate at all when nothing closed, and never divides by zero", async () => {
    await insertDeal({ id: "open", stage: "New", valueCents: 100_00, createdAt: "2026-03-04T12:00:00.000Z" });

    const summary = await dealsSummary(MARCH);
    expect(summary.closedCount).toBe(0);
    expect(summary.wonRate).toBeNull();
    expect(summary.averageWonCents).toBeNull();
    expect(summary.medianDaysToWin).toBeNull();
    expect(summary.newCount).toBe(1);
  });

  it("is all zeroes and nulls on an empty workspace", async () => {
    const summary = await dealsSummary(MARCH);
    expect(summary).toEqual({
      newCount: 0,
      newValueCents: 0,
      wonCount: 0,
      lostCount: 0,
      closedCount: 0,
      wonRate: null,
      wonValueCents: 0,
      averageWonCents: null,
      medianDaysToWin: null,
    });
  });

  it("counts a deal closed outside the period in neither the rate nor the average", async () => {
    await insertDeal({
      id: "feb",
      stage: "Won",
      valueCents: 1_000_00,
      createdAt: "2026-02-01T00:00:00.000Z",
      closedAt: "2026-02-10T00:00:00.000Z",
    });

    const summary = await dealsSummary(MARCH);
    expect(summary.closedCount).toBe(0);
    expect(summary.wonRate).toBeNull();
  });
});

describe("loadDealsReport", () => {
  it("returns the summary, the trend and the five cards in one call", async () => {
    await insertDeal({
      id: "one",
      stage: "Won",
      valueCents: 100_00,
      createdAt: "2026-03-02T12:00:00.000Z",
      closedAt: "2026-03-12T12:00:00.000Z",
    });

    const report = await loadDealsReport(MARCH, "week", "month", "2026-03-15");
    expect(report.grain).toBe("week");
    expect(report.trend).toHaveLength(12);
    expect(report.summary.wonCount).toBe(1);
    // Four open stages are seeded; the won and lost ones are not "open".
    expect(report.openByStage.length).toBeGreaterThan(0);
    expect(report.wonLost.map((row) => row.bucket)).toEqual(["2026-03"]);
    expect(Array.isArray(report.sources)).toBe(true);
    expect(Array.isArray(report.conversion)).toBe(true);
    expect(Array.isArray(report.dwell)).toBe(true);
  });
});
