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
import { loadReports } from "@/features/leads/lib/reportQueries";
import type { ReportBundle } from "@/features/leads/lib/reportQueries";
import type { Granularity, Period } from "@/features/leads/lib/periods";

export const reportKeys = {
  /** The prefix the poller invalidates against. Not queried on its own. */
  all: ["reports"] as const,
  bundle: (period: Period, granularity: Granularity) =>
    ["reports", period.from, period.to, granularity] as const,
};

export function useReports(period: Period, granularity: Granularity): UseQueryResult<ReportBundle> {
  return useQuery({
    queryKey: reportKeys.bundle(period, granularity),
    queryFn: () => loadReports(period, granularity),
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
