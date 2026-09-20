/**
 * The MRR arithmetic, on its own.
 *
 * The boundaries are the whole test: a plan that starts today, a plan that
 * ended today, and the twelve buckets the chart draws. All of it is string
 * date comparison, because dates without a time are stored as 'YYYY-MM-DD'.
 */
import { describe, expect, it } from "vitest";
import {
  isEarningOn,
  lastDayOfMonth,
  lastTwelveMonths,
  mrrAsOf,
  mrrMovement,
  mrrSeries,
  type RecurringDealRow,
} from "../../../src/db/repos/reports";

function deal(over: Partial<RecurringDealRow> = {}): RecurringDealRow {
  return {
    dealId: "d1",
    title: "A deal",
    monthlyCents: 15_000,
    oneTimeCents: 0,
    currency: "USD",
    startedOn: "2026-01-01",
    endedOn: null,
    contactId: null,
    contactName: null,
    companyId: null,
    companyName: null,
    ...over,
  };
}

describe("is this deal earning today", () => {
  it("counts a plan from the day it starts", () => {
    expect(isEarningOn(deal({ startedOn: "2026-09-19" }), "2026-09-19")).toBe(true);
  });

  it("does not count a plan that starts tomorrow", () => {
    expect(isEarningOn(deal({ startedOn: "2026-09-20" }), "2026-09-19")).toBe(false);
  });

  it("still counts a plan on the day it ends", () => {
    // "Ended on the 30th" means the 30th was paid for.
    expect(
      isEarningOn(deal({ startedOn: "2026-01-01", endedOn: "2026-09-19" }), "2026-09-19"),
    ).toBe(true);
  });

  it("stops counting it the day after", () => {
    expect(
      isEarningOn(deal({ startedOn: "2026-01-01", endedOn: "2026-09-19" }), "2026-09-20"),
    ).toBe(false);
  });

  it("counts a plan with no end date for ever", () => {
    expect(isEarningOn(deal({ startedOn: "2020-01-01" }), "2030-06-06")).toBe(true);
  });
});

describe("MRR on a date", () => {
  const rows = [
    deal({ dealId: "a", monthlyCents: 15_000, startedOn: "2026-01-01" }),
    deal({ dealId: "b", monthlyCents: 9_900, startedOn: "2026-06-15" }),
    deal({ dealId: "c", monthlyCents: 5_000, startedOn: "2026-02-01", endedOn: "2026-05-31" }),
  ];

  it("sums only the plans running that day", () => {
    expect(mrrAsOf(rows, "2026-01-15")).toBe(15_000);
    expect(mrrAsOf(rows, "2026-03-01")).toBe(20_000);
    expect(mrrAsOf(rows, "2026-06-30")).toBe(24_900);
  });

  it("is zero before anything started", () => {
    expect(mrrAsOf(rows, "2025-12-31")).toBe(0);
  });
});

describe("the twelve buckets", () => {
  it("ends on the month today falls in and runs back a year", () => {
    const months = lastTwelveMonths("2026-09-19");
    expect(months).toHaveLength(12);
    expect(months[0].bucket).toBe("2025-10");
    expect(months[11].bucket).toBe("2026-09");
  });

  it("reads a finished month on its last day", () => {
    const months = lastTwelveMonths("2026-09-19");
    expect(months[0].asOf).toBe("2025-10-31");
    // February, and a leap year the code never special-cases.
    expect(lastDayOfMonth("2024-02")).toBe("2024-02-29");
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28");
  });

  it("reads the current month as of today, not its last day", () => {
    // A chart whose final point is a month that has not happened yet always
    // looks like a collapse.
    const months = lastTwelveMonths("2026-09-19");
    expect(months[11].asOf).toBe("2026-09-19");
  });

  it("crosses the year boundary", () => {
    const months = lastTwelveMonths("2026-01-05");
    expect(months[0].bucket).toBe("2025-02");
    expect(months[11].bucket).toBe("2026-01");
  });

  it("draws a point for every month, including the empty ones", () => {
    const series = mrrSeries([deal({ startedOn: "2026-08-01" })], "2026-09-19");
    expect(series).toHaveLength(12);
    expect(series.filter((p) => p.mrrCents === 0)).toHaveLength(10);
    expect(series[11].mrrCents).toBe(15_000);
  });
});

describe("what moved this month", () => {
  const rows = [
    deal({ dealId: "a", monthlyCents: 15_000, startedOn: "2026-09-03" }),
    deal({ dealId: "b", monthlyCents: 9_900, startedOn: "2026-05-01", endedOn: "2026-09-30" }),
    deal({ dealId: "c", monthlyCents: 4_000, startedOn: "2026-08-31" }),
  ];

  it("counts what started and what stopped inside the month", () => {
    expect(mrrMovement(rows, "2026-09")).toEqual({
      newCents: 15_000,
      churnedCents: 9_900,
    });
  });

  it("leaves last month's alone", () => {
    expect(mrrMovement(rows, "2026-08")).toEqual({ newCents: 4_000, churnedCents: 0 });
  });

  it("counts a plan that started and stopped in the same month on both sides", () => {
    const short = [deal({ monthlyCents: 1_000, startedOn: "2026-09-02", endedOn: "2026-09-20" })];
    expect(mrrMovement(short, "2026-09")).toEqual({ newCents: 1_000, churnedCents: 1_000 });
  });
});
