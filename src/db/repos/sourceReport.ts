/**
 * Leads by source, with what each source is worth (LR-PX-C, PART 1).
 *
 * "See which lead source actually pays" needs more than the deal count the
 * existing `leadsBySource` in reports.ts already gives Deals report's
 * "Leads by source" card: it needs a win rate and a won value per source, so
 * the owner can tell a source that brings a lot of cheap leads apart from one
 * that brings fewer, better ones.
 *
 * This is a separate file from `src/db/repos/reports.ts` on purpose (another
 * lead is editing that file's revenue/receivables functions this round) even
 * though it reads the same view, `v_report_deal_sources`
 * (drizzle/0002_report_views.sql). That view already resolves the source
 * (including the "" / "Unknown" bucket for a deal with no source) and already
 * carries `is_won` and `value_cents`, but it does not carry `closed_at` -
 * every other column on it is a property of the deal at read time, and
 * `closed_at` needs the `deals` table itself, joined by the view's own
 * `deal_id`. The view is part of an already-shipped migration and is not
 * this task's to change, so the join happens here instead.
 */
import { raw } from "@/db/client";
import type { Period } from "@/lib/periods";
import { median } from "@/db/repos/reports";

export type SourcePerformanceRow = {
  /** "" for the Unknown bucket - a deal with no source. */
  sourceId: string;
  /** "Unknown" for deals with no source. */
  sourceName: string;
  /** Deals created in the period. */
  leads: number;
  /** Of those, the ones now in a won stage. */
  won: number;
  /** Sum of value_cents of those won deals. */
  wonValueCents: number;
  /** won / leads, a ratio 0..1, not a percentage. 0 when leads is 0. */
  winRate: number;
  /** Median, over the won deals, of (closed_at - created_at) in whole days. Null when none. */
  medianDaysToWin: number | null;
};

/**
 * Whole days between two ISO instants, floored, never negative.
 *
 * A deal created and won the same day took zero days, not a fraction of one:
 * "whole days" is the contract, and flooring rather than rounding means a
 * deal won 23 hours after it arrived reads as the same "0 days" a deal won 10
 * minutes after it arrived does, which is the honest answer to "how many
 * whole days did this take." `Math.max(0, ...)` guards the same clock-skew
 * case `dealsSummary` in reports.ts guards: an imported row whose closed_at
 * predates its created_at must not pull the median negative.
 */
export function daysBetween(createdAtIso: string, closedAtIso: string): number {
  const created = Date.parse(createdAtIso);
  const closed = Date.parse(closedAtIso);
  if (Number.isNaN(created) || Number.isNaN(closed)) return 0;
  return Math.max(0, Math.floor((closed - created) / 86_400_000));
}

/** Sorted by wonValueCents descending, then sourceName ascending. */
export async function sourcePerformance(period: Period): Promise<SourcePerformanceRow[]> {
  const totalsRows = await raw.query(
    `SELECT v.source_id, v.source_name,
            count(*)                                                    AS leads,
            coalesce(sum(v.is_won), 0)                                  AS won,
            coalesce(sum(CASE WHEN v.is_won = 1 THEN v.value_cents ELSE 0 END), 0)
                                                                         AS won_value_cents
     FROM v_report_deal_sources v
     WHERE v.created_at >= ? AND v.created_at < ?
     GROUP BY v.source_id, v.source_name`,
    [period.from, period.to],
  );

  // A second pass, joined to deals for closed_at, restricted to the deals
  // that are both won and created in this period - the same population the
  // totals above already counted into `won`.
  const wonRows = await raw.query(
    `SELECT v.source_id, v.created_at, d.closed_at
     FROM v_report_deal_sources v
     JOIN deals d ON d.id = v.deal_id
     WHERE v.is_won = 1 AND d.closed_at IS NOT NULL
       AND v.created_at >= ? AND v.created_at < ?`,
    [period.from, period.to],
  );

  const daysBySource = new Map<string, number[]>();
  for (const row of wonRows) {
    const sourceId = String(row[0]);
    const days = daysBetween(String(row[1]), String(row[2]));
    const list = daysBySource.get(sourceId);
    if (list) {
      list.push(days);
    } else {
      daysBySource.set(sourceId, [days]);
    }
  }

  const rows: SourcePerformanceRow[] = totalsRows.map((row) => {
    const sourceId = String(row[0]);
    const leads = Number(row[2]);
    const won = Number(row[3]);
    return {
      sourceId,
      sourceName: String(row[1]),
      leads,
      won,
      wonValueCents: Number(row[4]),
      winRate: leads === 0 ? 0 : won / leads,
      medianDaysToWin: median(daysBySource.get(sourceId) ?? []),
    };
  });

  return rows.sort(
    (a, b) => b.wonValueCents - a.wonValueCents || a.sourceName.localeCompare(b.sourceName),
  );
}
