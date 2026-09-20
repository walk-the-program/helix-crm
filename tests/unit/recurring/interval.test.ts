/**
 * Interval advancement: the arithmetic a recurring reminder lives or dies by.
 *
 * The cases that matter are the ones a naive `setMonth()` gets wrong - the end
 * of a month, February, a leap year - and the "advance past today" rule, which
 * is what stops a missed weekly reminder from coming back due yesterday.
 */
import { describe, expect, it } from "vitest";
import {
  advanceDate,
  advancePastToday,
  describeInterval,
} from "@/db/repos/recurring";

describe("advanceDate: weeks", () => {
  it("adds seven days per week", () => {
    expect(advanceDate("2026-09-19", 1, "week")).toBe("2026-09-26");
    expect(advanceDate("2026-09-19", 2, "week")).toBe("2026-10-03");
  });

  it("crosses a month and a year boundary", () => {
    expect(advanceDate("2026-12-28", 1, "week")).toBe("2027-01-04");
  });

  it("crosses the end of February in a leap year", () => {
    expect(advanceDate("2028-02-26", 1, "week")).toBe("2028-03-04");
  });
});

describe("advanceDate: months", () => {
  it("keeps the day of the month", () => {
    expect(advanceDate("2026-04-12", 1, "month")).toBe("2026-05-12");
    expect(advanceDate("2026-04-12", 3, "month")).toBe("2026-07-12");
  });

  it("clamps to the last day of a shorter month rather than rolling over", () => {
    // The bug this exists for: 31 January plus one month is 3 March with
    // setMonth, which walks a monthly reminder out of its own month.
    expect(advanceDate("2026-01-31", 1, "month")).toBe("2026-02-28");
    expect(advanceDate("2026-03-31", 1, "month")).toBe("2026-04-30");
    expect(advanceDate("2026-05-31", 1, "month")).toBe("2026-06-30");
  });

  it("clamps to 29 February in a leap year", () => {
    expect(advanceDate("2028-01-31", 1, "month")).toBe("2028-02-29");
    expect(advanceDate("2027-12-31", 2, "month")).toBe("2028-02-29");
  });

  it("does not drift: the clamped date does not shorten the next step", () => {
    // 31 Jan -> 28 Feb -> 28 Mar. The clamp is applied to the stored date, so a
    // monthly rule that lands on a short month keeps that day afterwards. This
    // is the documented trade: no drift forward, and no memory of the 31st.
    const first = advanceDate("2026-01-31", 1, "month");
    expect(first).toBe("2026-02-28");
    expect(advanceDate(first, 1, "month")).toBe("2026-03-28");
  });

  it("crosses a year with a multi-month interval", () => {
    expect(advanceDate("2026-11-15", 3, "month")).toBe("2027-02-15");
    expect(advanceDate("2026-11-15", 14, "month")).toBe("2028-01-15");
  });
});

describe("advanceDate: years", () => {
  it("adds whole years", () => {
    expect(advanceDate("2026-04-12", 1, "year")).toBe("2027-04-12");
    expect(advanceDate("2026-04-12", 2, "year")).toBe("2028-04-12");
  });

  it("clamps 29 February to 28 February in a common year", () => {
    expect(advanceDate("2028-02-29", 1, "year")).toBe("2029-02-28");
  });

  it("keeps 29 February when the target year is also a leap year", () => {
    expect(advanceDate("2028-02-29", 4, "year")).toBe("2032-02-29");
  });
});

describe("advanceDate: bad input", () => {
  it("returns the input unchanged when it is not a real date", () => {
    expect(advanceDate("not-a-date", 1, "year")).toBe("not-a-date");
    expect(advanceDate("2026-02-31", 1, "month")).toBe("2026-02-31");
    expect(advanceDate("", 1, "week")).toBe("");
  });

  it("treats an interval below one as one", () => {
    expect(advanceDate("2026-09-19", 0, "week")).toBe("2026-09-26");
    expect(advanceDate("2026-09-19", -3, "week")).toBe("2026-09-26");
  });
});

describe("advancePastToday", () => {
  it("is one step when the next occurrence is already in the future", () => {
    expect(advancePastToday("2026-09-19", 1, "year", "2026-09-19")).toBe("2027-09-19");
  });

  it("skips every occurrence that is still in the past", () => {
    // A fortnightly reminder last done in April, marked done in September: the
    // next one is the first fortnight that has not happened yet, not April plus
    // two weeks.
    const next = advancePastToday("2026-04-06", 2, "week", "2026-09-19");
    expect(next > "2026-09-19").toBe(true);
    // 6 April is a Monday, so the series is every other Monday and the first
    // one left is 21 September.
    expect(next).toBe("2026-09-21");
  });

  it("lands strictly after the reference day, never on it", () => {
    expect(advancePastToday("2026-09-05", 2, "week", "2026-09-19")).toBe("2026-10-03");
  });

  it("returns the input unchanged when the date cannot be read", () => {
    expect(advancePastToday("nonsense", 1, "month", "2026-09-19")).toBe("nonsense");
  });
});

describe("describeInterval", () => {
  it("says it the way the owner would", () => {
    expect(describeInterval(1, "year")).toBe("Every year");
    expect(describeInterval(1, "month")).toBe("Every month");
    expect(describeInterval(1, "week")).toBe("Every week");
    expect(describeInterval(3, "month")).toBe("Every 3 months");
    expect(describeInterval(2, "week")).toBe("Every 2 weeks");
  });
});
