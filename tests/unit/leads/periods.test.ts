import { describe, it, expect } from "vitest";
import {
  periodFor,
  customPeriod,
  formatBucket,
  defaultGranularity,
  toDateInputValue,
} from "@/features/leads/lib/periods";

describe("periods", () => {
  describe("periodFor", () => {
    // A fixed local "now" partway through July 2026 (Q3), afternoon local time.
    const now = new Date(2026, 6, 15, 13, 30);

    it("'month' returns the owner's local calendar month, `to` exclusive", () => {
      const period = periodFor("month", now);
      expect(period.from).toBe(new Date(2026, 6, 1).toISOString());
      expect(period.to).toBe(new Date(2026, 7, 1).toISOString());
    });

    it("'quarter' returns the owner's local calendar quarter, `to` exclusive", () => {
      const period = periodFor("quarter", now);
      expect(period.from).toBe(new Date(2026, 6, 1).toISOString());
      expect(period.to).toBe(new Date(2026, 9, 1).toISOString());
    });

    it("'year' returns the owner's local calendar year, `to` exclusive", () => {
      const period = periodFor("year", now);
      expect(period.from).toBe(new Date(2026, 0, 1).toISOString());
      expect(period.to).toBe(new Date(2027, 0, 1).toISOString());
    });

    it("finds the right quarter for a date in Q1 (Jan-Mar)", () => {
      const period = periodFor("quarter", new Date(2026, 1, 10));
      expect(period.from).toBe(new Date(2026, 0, 1).toISOString());
      expect(period.to).toBe(new Date(2026, 3, 1).toISOString());
    });

    it("finds the right quarter for a date in Q2 (Apr-Jun)", () => {
      const period = periodFor("quarter", new Date(2026, 4, 10));
      expect(period.from).toBe(new Date(2026, 3, 1).toISOString());
      expect(period.to).toBe(new Date(2026, 6, 1).toISOString());
    });

    it("finds the right quarter for a date in Q3 (Jul-Sep)", () => {
      const period = periodFor("quarter", new Date(2026, 7, 10));
      expect(period.from).toBe(new Date(2026, 6, 1).toISOString());
      expect(period.to).toBe(new Date(2026, 9, 1).toISOString());
    });

    it("finds the right quarter for a date in Q4 (Oct-Dec)", () => {
      const period = periodFor("quarter", new Date(2026, 10, 10));
      expect(period.from).toBe(new Date(2026, 9, 1).toISOString());
      expect(period.to).toBe(new Date(2027, 0, 1).toISOString());
    });
  });

  describe("customPeriod", () => {
    it("is inclusive of the whole end day: 1 March to 31 March ends at 1 April local", () => {
      const period = customPeriod("2026-03-01", "2026-03-31");
      expect(period).not.toBeNull();
      expect(period?.from).toBe(new Date(2026, 2, 1).toISOString());
      expect(period?.to).toBe(new Date(2026, 3, 1).toISOString());
    });

    it("returns null for a backwards range", () => {
      expect(customPeriod("2026-03-10", "2026-03-01")).toBeNull();
    });

    it("returns null for junk input on either side", () => {
      expect(customPeriod("not-a-date", "2026-03-01")).toBeNull();
      expect(customPeriod("2026-03-01", "not-a-date")).toBeNull();
      expect(customPeriod("", "")).toBeNull();
    });
  });

  describe("formatBucket", () => {
    it("formats a YYYY-MM bucket as a short month and year", () => {
      expect(formatBucket("2026-03", "en-US")).toBe("Mar 2026");
    });

    it("formats a YYYY-Qn bucket as 'Qn YYYY'", () => {
      expect(formatBucket("2026-Q1", "en-US")).toBe("Q1 2026");
    });

    it("returns a bare year bucket unchanged", () => {
      expect(formatBucket("2026", "en-US")).toBe("2026");
    });
  });

  describe("defaultGranularity", () => {
    it("picks 'month' for a one-month period", () => {
      const period = periodFor("month", new Date(2026, 6, 15));
      expect(defaultGranularity(period)).toBe("month");
    });

    it("picks 'quarter' for a one-year period", () => {
      const period = periodFor("year", new Date(2026, 6, 15));
      expect(defaultGranularity(period)).toBe("quarter");
    });

    it("picks 'year' for a five-year period", () => {
      const period = {
        id: "custom" as const,
        label: "five years",
        from: new Date(2026, 0, 1).toISOString(),
        to: new Date(2031, 0, 1).toISOString(),
      };
      expect(defaultGranularity(period)).toBe("year");
    });
  });

  describe("toDateInputValue", () => {
    it("round-trips with customPeriod for a local date", () => {
      const period = customPeriod("2026-03-01", "2026-03-01");
      expect(period).not.toBeNull();
      expect(toDateInputValue(period!.from)).toBe("2026-03-01");
    });
  });
});
