import { describe, it, expect } from "vitest";
import {
  nowIso,
  toIso,
  parseIso,
  todayLocal,
  toLocalDateString,
  parseDateOnly,
  addDaysToDateString,
  isOverdue,
  isDueToday,
  daysBetween,
  formatDateDisplay,
  formatDateTimeDisplay,
  formatRelative,
} from "@/lib/dates";

describe("dates", () => {
  describe("nowIso / toIso / parseIso", () => {
    it("nowIso returns a parseable ISO string", () => {
      const iso = nowIso();
      expect(parseIso(iso)).not.toBeNull();
    });

    it("toIso round-trips through parseIso", () => {
      const d = new Date(2026, 0, 15, 10, 30, 0);
      const iso = toIso(d);
      const parsed = parseIso(iso);
      expect(parsed?.getTime()).toBe(d.getTime());
    });

    it("parseIso returns null for unparseable strings", () => {
      expect(parseIso("not a date")).toBeNull();
      expect(parseIso("")).toBeNull();
    });
  });

  describe("todayLocal / toLocalDateString", () => {
    it("uses LOCAL calendar fields, not UTC slicing", () => {
      // Construct a date at 23:30 local time. If the implementation used
      // `toISOString().slice(0, 10)` instead of local fields, a timezone
      // ahead of UTC would roll this into the next UTC day and fail.
      const localLateNight = new Date(2026, 5, 14, 23, 30, 0); // 2026-06-14 23:30 local
      expect(toLocalDateString(localLateNight)).toBe("2026-06-14");
    });

    it("uses LOCAL calendar fields near local midnight too", () => {
      const localEarlyMorning = new Date(2026, 5, 14, 0, 15, 0); // 2026-06-14 00:15 local
      expect(toLocalDateString(localEarlyMorning)).toBe("2026-06-14");
    });

    it("todayLocal matches toLocalDateString(new Date()) in shape", () => {
      expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("parseDateOnly", () => {
    it("parses a YYYY-MM-DD string to local midnight", () => {
      const d = parseDateOnly("2026-03-01");
      expect(d).not.toBeNull();
      expect(d?.getFullYear()).toBe(2026);
      expect(d?.getMonth()).toBe(2);
      expect(d?.getDate()).toBe(1);
      expect(d?.getHours()).toBe(0);
      expect(d?.getMinutes()).toBe(0);
    });

    it("returns null for malformed input", () => {
      expect(parseDateOnly("not-a-date")).toBeNull();
      expect(parseDateOnly("")).toBeNull();
      expect(parseDateOnly("2026/03/01")).toBeNull();
    });

    it("returns null for an out-of-range calendar date", () => {
      expect(parseDateOnly("2026-02-31")).toBeNull();
    });
  });

  describe("addDaysToDateString", () => {
    it("adds days within the same month", () => {
      expect(addDaysToDateString("2026-03-01", 5)).toBe("2026-03-06");
    });

    it("rolls over a month boundary", () => {
      expect(addDaysToDateString("2026-01-30", 5)).toBe("2026-02-04");
    });

    it("supports negative days", () => {
      expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
    });
  });

  describe("isOverdue", () => {
    const now = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15 noon local

    it("is overdue when dueAt is in the past", () => {
      const task = { dueOn: "2026-06-15", dueAt: "2026-06-15T00:00:00.000Z" };
      // Compare against a `now` well after that instant.
      const later = new Date(2026, 5, 16, 0, 0, 0);
      expect(isOverdue(task, later)).toBe(true);
    });

    it("is not overdue when dueAt is in the future", () => {
      const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const task = { dueOn: "2026-06-15", dueAt: future };
      expect(isOverdue(task, now)).toBe(false);
    });

    it("falls back to dueOn < today when dueAt is not set", () => {
      const task = { dueOn: "2026-06-14", dueAt: null };
      expect(isOverdue(task, now)).toBe(true);
    });

    it("is not overdue when dueOn is today and dueAt is not set", () => {
      const task = { dueOn: "2026-06-15", dueAt: null };
      expect(isOverdue(task, now)).toBe(false);
    });

    it("is not overdue when dueOn is in the future", () => {
      const task = { dueOn: "2026-06-20", dueAt: null };
      expect(isOverdue(task, now)).toBe(false);
    });

    it("a task with doneAt set is never overdue, even if dueOn/dueAt are in the past", () => {
      const task = { dueOn: "2026-01-01", dueAt: "2026-01-01T00:00:00.000Z", doneAt: "2026-01-02T00:00:00.000Z" };
      expect(isOverdue(task, now)).toBe(false);
    });

    it("a task with neither dueOn nor dueAt is never overdue", () => {
      const task = {};
      expect(isOverdue(task, now)).toBe(false);
    });
  });

  describe("isDueToday", () => {
    const now = new Date(2026, 5, 15, 9, 0, 0); // 2026-06-15 local

    it("is true when dueOn equals today, regardless of any time component", () => {
      expect(isDueToday({ dueOn: "2026-06-15" }, now)).toBe(true);
    });

    it("is false when dueOn is a different day", () => {
      expect(isDueToday({ dueOn: "2026-06-16" }, now)).toBe(false);
      expect(isDueToday({ dueOn: "2026-06-14" }, now)).toBe(false);
    });

    it("is false when dueOn is missing", () => {
      expect(isDueToday({}, now)).toBe(false);
    });

    it("a task with doneAt set is never due today", () => {
      expect(isDueToday({ dueOn: "2026-06-15", doneAt: "2026-06-15T08:00:00.000Z" }, now)).toBe(false);
    });
  });

  describe("daysBetween", () => {
    it("counts calendar days between two ISO timestamps", () => {
      const a = new Date(2026, 5, 1, 23, 0, 0).toISOString();
      const b = new Date(2026, 5, 4, 1, 0, 0).toISOString();
      expect(daysBetween(a, b)).toBe(3);
    });

    it("returns 0 for unparseable input", () => {
      expect(daysBetween("nope", "also nope")).toBe(0);
    });
  });

  describe("formatDateDisplay / formatDateTimeDisplay", () => {
    it("formats a date-only value", () => {
      const result = formatDateDisplay("2026-03-01", "en-US");
      expect(result).toContain("2026");
      expect(result).toContain("Mar");
    });

    it("formats a full ISO timestamp with time", () => {
      const result = formatDateTimeDisplay("2026-03-01T15:30:00.000Z", "en-US");
      expect(result).toContain("2026");
    });

    it("returns '' for null, undefined, and unparseable values", () => {
      expect(formatDateDisplay(null)).toBe("");
      expect(formatDateDisplay(undefined)).toBe("");
      expect(formatDateDisplay("garbage")).toBe("");
      expect(formatDateTimeDisplay(null)).toBe("");
      expect(formatDateTimeDisplay(undefined)).toBe("");
      expect(formatDateTimeDisplay("garbage")).toBe("");
    });
  });

  describe("formatRelative", () => {
    const now = new Date(2026, 5, 15, 12, 0, 0);

    it("returns 'today' for a same-day timestamp", () => {
      const ts = new Date(2026, 5, 15, 8, 0, 0).toISOString();
      expect(formatRelative(ts, now)).toBe("today");
    });

    it("returns 'X days ago' for a past date", () => {
      const ts = new Date(2026, 5, 13, 12, 0, 0).toISOString();
      expect(formatRelative(ts, now)).toBe("2 days ago");
    });

    it("returns 'in X days' for a future date", () => {
      const ts = new Date(2026, 5, 18, 12, 0, 0).toISOString();
      expect(formatRelative(ts, now)).toBe("in 3 days");
    });

    it("returns '' for null/undefined/unparseable", () => {
      expect(formatRelative(null, now)).toBe("");
      expect(formatRelative(undefined, now)).toBe("");
      expect(formatRelative("garbage", now)).toBe("");
    });
  });
});
