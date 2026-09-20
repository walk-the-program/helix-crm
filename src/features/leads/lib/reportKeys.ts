/**
 * Query keys and data hook for the Reports screen, plus the CSV helpers every
 * report card's "Copy as CSV" button uses.
 *
 * The keys live here rather than in `src/app/queryClient.ts`'s `qk` (which
 * this feature does not own) so the lead poller's invalidation of the single
 * key `["reports"]` still catches every period/granularity combination this
 * screen has ever queried - TanStack Query invalidates by prefix match.
 */
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  loadDealsReport,
  loadOverview,
  loadPeopleReport,
  loadReports,
  revenue,
  revenueMoney,
  revenueParams,
} from "@/db/repos/reports";
import type {
  DealsReport,
  OverviewBundle,
  PeopleReport,
  ReportBundle,
  RevenueBundle,
  RevenueMoney,
  TrendGrain,
} from "@/db/repos/reports";
import type { Granularity, Period } from "@/lib/periods";

export const reportKeys = {
  /** The prefix the poller invalidates against. Not queried on its own. */
  all: ["reports"] as const,
  bundle: (period: Period, granularity: Granularity) =>
    ["reports", period.from, period.to, granularity] as const,
  /** Still under the "reports" prefix, so the poller's invalidation catches it too. */
  revenue: () => ["reports", "revenue"] as const,
};

export function useReports(period: Period, granularity: Granularity): UseQueryResult<ReportBundle> {
  return useQuery({
    queryKey: reportKeys.bundle(period, granularity),
    queryFn: () => loadReports(period, granularity),
  });
}

/**
 * The recurring-revenue report (/reports/revenue). `revenueParams` reads the
 * owner's own clock, so this hook takes no arguments - there is no period
 * picker on that screen, only "as of today."
 */
export function useRevenue(): UseQueryResult<RevenueBundle> {
  return useQuery({
    queryKey: reportKeys.revenue(),
    queryFn: () => revenue(revenueParams()),
  });
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A cell whose first character is one of these is prefixed with a single
 * quote before export. Otherwise a spreadsheet application that opens the
 * file may read the cell as a formula (`=cmd|...`, `+1+1`, `-1+1`, `@SUM(...)`)
 * and, in the worst case, execute it. This is the formula-injection guard
 * docs/PLAN.md requires on every export, and it runs before the normal
 * comma/quote/newline quoting below so a guarded cell that also needs quoting
 * still gets both.
 */
const FORMULA_PREFIX_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function guardFormulaInjection(value: string): string {
  return value.length > 0 && FORMULA_PREFIX_CHARS.has(value[0]) ? `'${value}` : value;
}

function quoteCsvCell(value: string): string {
  const guarded = guardFormulaInjection(value);
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Builds a CRLF-terminated CSV string, matching the row order and columns a
 * `DataTable` renders, so a card's `csv()` and its table are always the same
 * data by construction.
 */
export function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  return [header, ...rows]
    .map((row) => row.map((cell) => quoteCsvCell(String(cell))).join(","))
    .join("\r\n")
    .concat("\r\n");
}

/* -------------------------------------------------------------------------- */
/* the round-3 report pages                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every key below still starts with "reports", so the lead poller's single
 * `invalidateQueries(["reports"])` refreshes all five pages, whatever period
 * or bucket size each of them was last asked for.
 */
export const reportPageKeys = {
  overview: (period: Period) => ["reports", "overview", period.from, period.to] as const,
  deals: (period: Period, grain: TrendGrain, granularity: Granularity) =>
    ["reports", "deals", period.from, period.to, grain, granularity] as const,
  people: (period: Period) => ["reports", "people", period.from, period.to] as const,
  revenueMoney: (period: Period) =>
    ["reports", "revenue", "money", period.from, period.to] as const,
};

export function useOverview(period: Period): UseQueryResult<OverviewBundle> {
  return useQuery({
    queryKey: reportPageKeys.overview(period),
    queryFn: () => loadOverview(period),
  });
}

export function useDealsReport(
  period: Period,
  grain: TrendGrain,
  granularity: Granularity,
): UseQueryResult<DealsReport> {
  return useQuery({
    queryKey: reportPageKeys.deals(period, grain, granularity),
    queryFn: () => loadDealsReport(period, grain, granularity),
  });
}

export function usePeopleReport(period: Period): UseQueryResult<PeopleReport> {
  return useQuery({
    queryKey: reportPageKeys.people(period),
    queryFn: () => loadPeopleReport(period),
  });
}

/** The four money numbers for the revenue page's chosen period. */
export function useRevenueMoney(period: Period): UseQueryResult<RevenueMoney> {
  return useQuery({
    queryKey: reportPageKeys.revenueMoney(period),
    queryFn: () => revenueMoney(period),
  });
}
