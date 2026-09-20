/**
 * The pure helper behind the sources report (LR-PX-C, PART 1): whole days
 * between two ISO instants. `sourcePerformance` itself is exercised against a
 * real database in tests/repo/reports/sourceReport.test.ts; the median it
 * uses is `reports.ts#median`, already covered in tests/repo/leads.
 */
import { describe, expect, it } from "vitest";
import { daysBetween } from "@/db/repos/sourceReport";

describe("daysBetween", () => {
  it("floors a fractional number of days rather than rounding", () => {
    // 23 hours: less than a whole day, so it reads as zero, not one.
    expect(daysBetween("2026-03-01T09:00:00.000Z", "2026-03-02T08:00:00.000Z")).toBe(0);
  });

  it("is zero for a deal created and won the same instant", () => {
    expect(daysBetween("2026-03-01T09:00:00.000Z", "2026-03-01T09:00:00.000Z")).toBe(0);
  });

  it("counts a clean multi-day gap exactly", () => {
    expect(daysBetween("2026-03-01T00:00:00.000Z", "2026-03-11T00:00:00.000Z")).toBe(10);
  });

  it("floors down even when the closing time of day is later than the creation time", () => {
    // 10 days and 23 hours: 10 whole days, not 11.
    expect(daysBetween("2026-03-01T01:00:00.000Z", "2026-03-11T23:00:00.000Z")).toBe(10);
  });

  it("never goes negative when a closed_at predates created_at (clock skew on an imported row)", () => {
    expect(daysBetween("2026-03-11T00:00:00.000Z", "2026-03-01T00:00:00.000Z")).toBe(0);
  });

  it("is zero for an unparsable instant rather than NaN", () => {
    expect(daysBetween("not-a-date", "2026-03-11T00:00:00.000Z")).toBe(0);
    expect(daysBetween("2026-03-01T00:00:00.000Z", "not-a-date")).toBe(0);
  });
});
