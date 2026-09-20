/**
 * Monday-first week arithmetic, exercised on the boundary it exists to get
 * right: a week that crosses a daylight-saving change still has to have
 * seven distinct, consecutive days.
 *
 * TZ is pinned to US Eastern - a zone that actually observes DST - rather
 * than left to whatever machine runs the suite, because that is the one
 * thing that would let this bug hide.
 */
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import {
  addDays,
  addWeeksToDate,
  dayLabel,
  dayNumberLabel,
  isSameDay,
  shortDayLabel,
  startOfWeekMonday,
  weekDays,
  weekRangeLabel,
} from "@/features/schedule/lib/week";

describe("startOfWeekMonday", () => {
  it("finds the Monday of the week a Sunday falls in", () => {
    // 2026-09-20 is a Sunday.
    expect(startOfWeekMonday("2026-09-20")).toBe("2026-09-14");
  });

  it("leaves a Monday unchanged", () => {
    expect(startOfWeekMonday("2026-09-14")).toBe("2026-09-14");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(startOfWeekMonday("not-a-date")).toBe("not-a-date");
  });
});

describe("weekDays", () => {
  it("lists Monday through Sunday", () => {
    expect(weekDays("2026-09-14")).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
  });

  it("has seven distinct consecutive days across the spring-forward boundary", () => {
    // 2026-03-08 is the US spring-forward Sunday: clocks skip 2:00am-3:00am.
    const days = weekDays("2026-03-02");
    expect(days).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    expect(new Set(days).size).toBe(7);
  });

  it("has seven distinct consecutive days across the fall-back boundary", () => {
    // 2026-11-01 is the US fall-back Sunday: clocks repeat 1:00am-2:00am.
    const days = weekDays("2026-10-26");
    expect(days).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(new Set(days).size).toBe(7);
  });

  it("returns seven copies of the input when it cannot be parsed", () => {
    expect(weekDays("nonsense")).toEqual(Array(7).fill("nonsense"));
  });
});

describe("addWeeksToDate", () => {
  it("adds whole weeks", () => {
    expect(addWeeksToDate("2026-09-14", 2)).toBe("2026-09-28");
  });

  it("lands on the same weekday across the spring-forward boundary", () => {
    // 2026-03-01 and 2026-03-08 are both Sundays; the week between them holds
    // the boundary the previous test's fixture starts on.
    expect(addWeeksToDate("2026-03-01", 1)).toBe("2026-03-08");
  });

  it("lands on the same weekday across the fall-back boundary", () => {
    expect(addWeeksToDate("2026-10-25", 1)).toBe("2026-11-01");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(addWeeksToDate("nope", 1)).toBe("nope");
  });
});

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-09-14", 3)).toBe("2026-09-17");
  });

  it("rolls over a month boundary", () => {
    expect(addDays("2026-09-29", 3)).toBe("2026-10-02");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(addDays("nope", 1)).toBe("nope");
  });
});

describe("isSameDay", () => {
  it("is true for the same calendar day", () => {
    expect(isSameDay("2026-09-14", "2026-09-14")).toBe(true);
  });

  it("is false for different days", () => {
    expect(isSameDay("2026-09-14", "2026-09-15")).toBe(false);
  });

  it("falls back to string equality when a value cannot be parsed", () => {
    expect(isSameDay("nonsense", "nonsense")).toBe(true);
    expect(isSameDay("nonsense", "2026-09-14")).toBe(false);
  });
});

describe("weekRangeLabel", () => {
  it("reads as one month when the week does not cross one", () => {
    expect(weekRangeLabel("2026-09-14", "en-US")).toBe("14 – 20 September 2026");
  });

  it("names both months when the week crosses one", () => {
    // 2026-09-28 is a Monday; its week runs into October.
    expect(weekRangeLabel("2026-09-28", "en-US")).toBe("28 September – 4 October 2026");
  });

  it("does not throw on a bad locale and falls back to the raw value", () => {
    expect(weekRangeLabel("2026-09-14", "123")).toBe("2026-09-14");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(weekRangeLabel("nope")).toBe("nope");
  });
});

describe("dayLabel", () => {
  it("reads the weekday and the date", () => {
    expect(dayLabel("2026-09-14", "en-US")).toBe("Monday 14 September");
  });

  it("does not throw on a bad locale and falls back to the raw value", () => {
    expect(dayLabel("2026-09-14", "123")).toBe("2026-09-14");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(dayLabel("nope")).toBe("nope");
  });
});

describe("shortDayLabel", () => {
  it("abbreviates the weekday", () => {
    expect(shortDayLabel("2026-09-14", "en-US")).toBe("Mon");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(shortDayLabel("nope")).toBe("nope");
  });
});

describe("dayNumberLabel", () => {
  it("is the bare day number", () => {
    expect(dayNumberLabel("2026-09-14", "en-US")).toBe("14");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(dayNumberLabel("nope")).toBe("nope");
  });
});
