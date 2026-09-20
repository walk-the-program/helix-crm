/**
 * The one line under the Today title: what this week has actually amounted to.
 *
 * "This week" is the owner's calendar week, Monday to now, worked out from his
 * local clock and then compared as ISO strings - the same trick
 * `src/lib/periods.ts` uses, and the reason a job closed at 6 pm on Sunday
 * counts in the week he closed it rather than in UTC's.
 *
 * Every number comes from a repository that already existed:
 *
 *   new leads  -> reports.leadsBySource, which counts deals by created_at
 *   jobs won   -> reports.wonLost, which counts and sums closed_at = won
 *   calls      -> activities.list, newest first, counted down to the boundary
 *
 * The activity count is read from the top of the newest-first list and stopped
 * at the week boundary, with a 1000-row ceiling. A workspace logging more than
 * a thousand calls in one week is not the one this product is for, and the
 * ceiling is cheaper than a new column in ActivityFilter.
 */
import { useQuery } from "@tanstack/react-query";
import { qk } from "@/app/queryClient";
import * as reportsRepo from "@/db/repos/reports";
import * as activitiesRepo from "@/db/repos/activities";
import * as settingsRepo from "@/db/repos/settings";
import type { Period } from "@/lib/periods";

/** The most calls this counts. Past it the number reads "1000+". */
export const CALL_SCAN_LIMIT = 1000;

export type WeekSummary = {
  newLeads: number;
  wonCount: number;
  wonValueCents: number;
  callsLogged: number;
  /** True when the workspace has done nothing this week: the line is hidden. */
  isEmpty: boolean;
  /** Set when the call count hit its ceiling, so the line can say "1000+". */
  callsCapped: boolean;
  /** The workspace's own currency and locale, for the money in the sentence. */
  currency: string;
  locale: string;
};

/** Monday 00:00 local, as an ISO instant. Sunday belongs to the week before. */
export function weekStart(now: Date = new Date()): Date {
  const day = now.getDay(); // 0 = Sunday
  const backToMonday = day === 0 ? 6 : day - 1;
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - backToMonday,
    0,
    0,
    0,
    0,
  );
}

/** The half-open range the three queries share. */
export function weekPeriod(now: Date = new Date()): Period {
  const start = weekStart(now);
  // Exclusive end: tomorrow's local midnight, so everything logged today counts
  // however late in the day it happened.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    id: "custom",
    label: "This week",
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

export async function loadWeekSummary(now: Date = new Date()): Promise<WeekSummary> {
  const period = weekPeriod(now);

  const [sources, wonLost, calls, currency, locale] = await Promise.all([
    reportsRepo.leadsBySource(period),
    // The range never spans more than eight days, so one granularity is enough;
    // a week that straddles two months comes back as two buckets and both are
    // summed.
    reportsRepo.wonLost(period, "month"),
    activitiesRepo.list(
      { kind: "call", includeSystem: false },
      { limit: CALL_SCAN_LIMIT },
    ),
    settingsRepo.get("currency"),
    settingsRepo.get("locale"),
  ]);

  const newLeads = sources.reduce((total, row) => total + row.dealCount, 0);
  const wonCount = wonLost.reduce((total, row) => total + row.wonCount, 0);
  const wonValueCents = wonLost.reduce((total, row) => total + row.wonValueCents, 0);
  const callsLogged = calls.rows.filter(
    (activity) => activity.occurredAt >= period.from && activity.occurredAt < period.to,
  ).length;

  return {
    newLeads,
    wonCount,
    wonValueCents,
    callsLogged,
    isEmpty: newLeads === 0 && wonCount === 0 && callsLogged === 0,
    currency,
    locale,
    callsCapped: calls.rows.length >= CALL_SCAN_LIMIT && callsLogged === calls.rows.length,
  };
}

export function useWeekSummary() {
  return useQuery({
    queryKey: [...qk.today(), "week-summary"] as const,
    queryFn: () => loadWeekSummary(),
  });
}
