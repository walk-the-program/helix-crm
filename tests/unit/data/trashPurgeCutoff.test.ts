/**
 * The trash purge cutoff, in isolation (SEC audit, launch round 2026-09-20).
 *
 * `trash.expired()` needs a real database, but the date arithmetic that
 * decides the boundary does not, and the boundary is exactly what a security
 * review has to prove: a record deleted 29 days ago is not offered to the
 * sweep yet, one deleted exactly 30 days ago still is not (the window is
 * "longer ago than", not "at least"), and one deleted 31 days ago is.
 *
 * `purgeCutoffIso` is pulled out of `trash.expired()` for exactly this: it
 * takes no database and no clock read (`today` is always passed in), so the
 * boundary is provable here without the repo harness.
 */
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { PURGE_AFTER_DAYS, purgeCutoffIso } from "@/db/repos/trash";

const TODAY = "2026-09-20";

function daysBeforeToday(days: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

describe("purgeCutoffIso", () => {
  it("defaults to the 30-day policy", () => {
    expect(PURGE_AFTER_DAYS).toBe(30);
  });

  it("is midnight UTC, 30 days before the given day", () => {
    expect(purgeCutoffIso(PURGE_AFTER_DAYS, TODAY)).toBe("2026-08-21T00:00:00.000Z");
  });

  it("draws the exact line a 29/30/31-day-old row sits on", () => {
    const cutoff = purgeCutoffIso(PURGE_AFTER_DAYS, TODAY);

    // 29 days ago: strictly after the cutoff, so `deleted_at < cutoff` is
    // false - the sweep must not touch it yet.
    const twentyNine = daysBeforeToday(29);
    expect(twentyNine > cutoff).toBe(true);

    // Exactly 30 days ago lands ON the cutoff instant itself. `expired()`
    // queries `deleted_at < cutoffIso`, so a row deleted at exactly this
    // instant is NOT past the window yet - it turns 30 days old today, not
    // "longer ago than" 30 days.
    const thirty = daysBeforeToday(30);
    expect(thirty === cutoff).toBe(true);
    expect(thirty < cutoff).toBe(false);

    // 31 days ago: before the cutoff, so it is offered to the sweep.
    const thirtyOne = daysBeforeToday(31);
    expect(thirtyOne < cutoff).toBe(true);
  });

  it("is not off by a day for a custom window", () => {
    expect(purgeCutoffIso(7, "2026-01-08")).toBe("2026-01-01T00:00:00.000Z");
  });
});
