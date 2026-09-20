/**
 * Read-only queries over the report views in `drizzle/0002_report_views.sql`.
 *
 * The views do the joins and the derivations; these functions add the period
 * filter and the final aggregation, because a period picker cannot be baked
 * into a view. Nothing here writes, so none of it goes near the write lock.
 *
 * Every column is aliased and there is no `SELECT *`, the same rule the rest
 * of this folder follows: rows come back from the pipe as arrays in select
 * order, so the order of the select list is the contract.
 *
 * Written by the leads agent as src/features/leads/lib/reportQueries.ts and
 * promoted here in wave 3.
 */
import { raw } from "@/db/client";
import { periodFor, type Granularity, type Period } from "@/lib/periods";
import { todayLocal } from "@/lib/dates";
import { perDealMoney, periodMoney, type MoneyTotals, type PerDealMoneyRow } from "@/db/repos/money";

/* -------------------------------------------------------------------------- */
/* 1. pipeline value by stage                                                 */
/* -------------------------------------------------------------------------- */

export type PipelineStageRow = {
  stageId: string;
  stageName: string;
  stagePosition: number;
  stageColor: string;
  openDeals: number;
  openValueCents: number;
};

/** Open deals only, and every open stage, including the empty ones. */
export async function pipelineByStage(): Promise<PipelineStageRow[]> {
  const rows = await raw.query(
    `SELECT v.stage_id, v.stage_name, v.stage_position, v.stage_color,
            v.open_deals, v.open_value_cents
     FROM v_report_pipeline_stage v
     ORDER BY v.stage_position ASC, v.stage_name ASC`,
  );
  return rows.map((r) => ({
    stageId: String(r[0]),
    stageName: String(r[1]),
    stagePosition: Number(r[2]),
    stageColor: String(r[3]),
    openDeals: Number(r[4]),
    openValueCents: Number(r[5]),
  }));
}

/* -------------------------------------------------------------------------- */
/* 2. won and lost by month, quarter or year                                  */
/* -------------------------------------------------------------------------- */

export type WonLostRow = {
  /** "2026-03", "2026-Q1" or "2026". */
  bucket: string;
  wonCount: number;
  wonValueCents: number;
  lostCount: number;
  lostValueCents: number;
};

const BUCKET_COLUMN: Record<Granularity, string> = {
  month: "period_month",
  quarter: "period_quarter",
  year: "period_year",
};

export async function wonLost(
  period: Period,
  granularity: Granularity,
): Promise<WonLostRow[]> {
  const column = BUCKET_COLUMN[granularity];
  const rows = await raw.query(
    `SELECT v.${column} AS bucket,
            sum(CASE WHEN v.outcome = 'won'  THEN 1 ELSE 0 END)             AS won_count,
            sum(CASE WHEN v.outcome = 'won'  THEN v.value_cents ELSE 0 END) AS won_value,
            sum(CASE WHEN v.outcome = 'lost' THEN 1 ELSE 0 END)             AS lost_count,
            sum(CASE WHEN v.outcome = 'lost' THEN v.value_cents ELSE 0 END) AS lost_value
     FROM v_report_closed_deals v
     WHERE v.closed_at >= ? AND v.closed_at < ?
     GROUP BY v.${column}
     ORDER BY v.${column} ASC`,
    [period.from, period.to],
  );
  return rows.map((r) => ({
    bucket: String(r[0]),
    wonCount: Number(r[1]),
    wonValueCents: Number(r[2]),
    lostCount: Number(r[3]),
    lostValueCents: Number(r[4]),
  }));
}

/* -------------------------------------------------------------------------- */
/* 3. leads by source                                                         */
/* -------------------------------------------------------------------------- */

export type SourceRow = {
  sourceId: string;
  sourceName: string;
  dealCount: number;
  valueCents: number;
  wonCount: number;
  openCount: number;
};

/** Counted on the deal's created_at, which is when the lead arrived. */
export async function leadsBySource(period: Period): Promise<SourceRow[]> {
  const rows = await raw.query(
    `SELECT v.source_id, v.source_name,
            count(*)                AS deal_count,
            sum(v.value_cents)      AS value_cents,
            sum(v.is_won)           AS won_count,
            sum(v.is_open)          AS open_count
     FROM v_report_deal_sources v
     WHERE v.created_at >= ? AND v.created_at < ?
     GROUP BY v.source_id, v.source_name
     ORDER BY deal_count DESC, v.source_name ASC`,
    [period.from, period.to],
  );
  return rows.map((r) => ({
    sourceId: String(r[0]),
    sourceName: String(r[1]),
    dealCount: Number(r[2]),
    valueCents: Number(r[3]),
    wonCount: Number(r[4]),
    openCount: Number(r[5]),
  }));
}

/* -------------------------------------------------------------------------- */
/* 4. conversion between consecutive stages                                   */
/* -------------------------------------------------------------------------- */

export type ConversionRow = {
  fromStageId: string;
  fromStageName: string;
  toStageId: string;
  toStageName: string;
  fromPosition: number;
  entered: number;
  advanced: number;
  /** 0..1, or null when nothing entered the earlier stage in this period. */
  rate: number | null;
};

/**
 * Filtered on the deal's own created_at, so "this quarter" means the deals
 * that came in this quarter, not the moves that happened in it. Moving a
 * two-year-old deal forward should not rewrite this quarter's conversion.
 */
export async function stageConversion(period: Period): Promise<ConversionRow[]> {
  const rows = await raw.query(
    `SELECT v.from_stage_id, v.from_stage_name, v.to_stage_id, v.to_stage_name,
            v.from_position,
            count(DISTINCT v.deal_id) AS entered,
            count(DISTINCT CASE WHEN v.advanced = 1 THEN v.deal_id END) AS advanced
     FROM v_report_stage_transitions v
     WHERE v.deal_created_at >= ? AND v.deal_created_at < ?
     GROUP BY v.from_stage_id, v.from_stage_name, v.to_stage_id, v.to_stage_name,
              v.from_position
     ORDER BY v.from_position ASC`,
    [period.from, period.to],
  );
  return rows.map((r) => {
    const entered = Number(r[5]);
    const advanced = Number(r[6]);
    return {
      fromStageId: String(r[0]),
      fromStageName: String(r[1]),
      toStageId: String(r[2]),
      toStageName: String(r[3]),
      fromPosition: Number(r[4]),
      entered,
      advanced,
      rate: entered > 0 ? advanced / entered : null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* 5. average days in stage                                                   */
/* -------------------------------------------------------------------------- */

export type DwellRow = {
  stageId: string;
  stageName: string;
  stagePosition: number;
  stageColor: string;
  /** Stage visits that finished inside the period. */
  completedCount: number;
  /** Average days for those visits, or null when there were none. */
  averageDays: number | null;
  /** Open deals sitting in the stage right now. */
  openCount: number;
  /** Average days those open deals have been waiting, or null. */
  currentAverageDays: number | null;
};

/**
 * Two numbers per stage: how long a visit used to take, and how long the deals
 * standing there have been standing there. Both come from
 * `v_report_stage_dwell`, which is one row per stage entry.
 *
 * The completed average is filtered on when the stage was entered, so it
 * belongs to the chosen period. The current dwell is not filtered: "how long
 * has this been sitting here" is a question about now.
 */
export async function daysInStage(period: Period): Promise<DwellRow[]> {
  const rows = await raw.query(
    `SELECT s.id, s.name, s.position, s.color,
            coalesce(done.visits, 0)   AS completed_count,
            done.avg_days              AS average_days,
            coalesce(live.visits, 0)   AS open_count,
            live.avg_days              AS current_average_days
     FROM stages s
     LEFT JOIN (
       SELECT d.stage_id AS stage_id, count(*) AS visits, avg(d.days_in_stage) AS avg_days
       FROM v_report_stage_dwell d
       WHERE d.is_current = 0 AND d.entered_at >= ? AND d.entered_at < ?
       GROUP BY d.stage_id
     ) done ON done.stage_id = s.id
     LEFT JOIN (
       SELECT d.stage_id AS stage_id, count(*) AS visits, avg(d.days_in_stage) AS avg_days
       FROM v_report_stage_dwell d
       WHERE d.is_current = 1 AND d.deal_is_open = 1
       GROUP BY d.stage_id
     ) live ON live.stage_id = s.id
     WHERE s.deleted_at IS NULL
     ORDER BY s.position ASC, s.name ASC`,
    [period.from, period.to],
  );
  return rows.map((r) => ({
    stageId: String(r[0]),
    stageName: String(r[1]),
    stagePosition: Number(r[2]),
    stageColor: String(r[3]),
    completedCount: Number(r[4]),
    averageDays: r[5] === null ? null : Number(r[5]),
    openCount: Number(r[6]),
    currentAverageDays: r[7] === null ? null : Number(r[7]),
  }));
}

/* -------------------------------------------------------------------------- */
/* the whole page in one round trip                                           */
/* -------------------------------------------------------------------------- */

export type ReportBundle = {
  pipeline: PipelineStageRow[];
  wonLost: WonLostRow[];
  sources: SourceRow[];
  conversion: ConversionRow[];
  dwell: DwellRow[];
};

export async function loadReports(
  period: Period,
  granularity: Granularity,
): Promise<ReportBundle> {
  const [pipeline, won, sources, conversion, dwell] = await Promise.all([
    pipelineByStage(),
    wonLost(period, granularity),
    leadsBySource(period),
    stageConversion(period),
    daysInStage(period),
  ]);
  return { pipeline, wonLost: won, sources, conversion, dwell };
}

/* -------------------------------------------------------------------------- */
/* 6. recurring revenue: MRR, ARR and what is behind them                      */
/* -------------------------------------------------------------------------- */

/*
 * D20 made a deal two numbers rather than one: what is charged once and what
 * is charged every month. `deals.recurring_monthly_cents` is already
 * normalised (a yearly line is divided by twelve when the line is saved), so
 * MRR is a plain sum with no CASE in it, and `recurring_started_on` /
 * `recurring_ended_on` are what put a deal inside or outside it.
 *
 * The twelve-month series is computed in TypeScript from one query rather than
 * twelve queries or a recursive CTE. The row set is small by construction -
 * one row per won deal that ever had a recurring line - and the two functions
 * that do the arithmetic are pure, which is what lets the boundary cases
 * (started today, ended today, ended before it started) be tested without a
 * database.
 */

/** A won deal that has, or once had, recurring revenue. */
export type RecurringDealRow = {
  dealId: string;
  title: string;
  monthlyCents: number;
  oneTimeCents: number;
  currency: string;
  startedOn: string;
  endedOn: string | null;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
};

export async function recurringDeals(): Promise<RecurringDealRow[]> {
  const rows = await raw.query(
    `SELECT d.id                            AS d_id,
            d.title                         AS d_title,
            coalesce(d.recurring_monthly_cents, 0) AS d_recurring_monthly_cents,
            coalesce(d.one_time_cents, 0)   AS d_one_time_cents,
            d.currency                      AS d_currency,
            d.recurring_started_on          AS d_recurring_started_on,
            d.recurring_ended_on            AS d_recurring_ended_on,
            d.contact_id                    AS d_contact_id,
            trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) AS c_name,
            d.company_id                    AS d_company_id,
            co.name                         AS co_name
     FROM deals d
     JOIN stages s ON s.id = d.stage_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     LEFT JOIN companies co ON co.id = d.company_id
     WHERE d.deleted_at IS NULL
       AND s.is_won = 1
       AND d.recurring_started_on IS NOT NULL
       AND coalesce(d.recurring_monthly_cents, 0) > 0
     ORDER BY d.recurring_monthly_cents DESC, d.title ASC`,
  );
  return rows.map((r) => {
    const contactName = r[8] === null || r[8] === undefined ? "" : String(r[8]);
    return {
      dealId: String(r[0]),
      title: String(r[1]),
      monthlyCents: Number(r[2]),
      oneTimeCents: Number(r[3]),
      currency: String(r[4] ?? "USD"),
      startedOn: String(r[5]),
      endedOn: r[6] === null || r[6] === undefined ? null : String(r[6]),
      contactId: r[7] === null || r[7] === undefined ? null : String(r[7]),
      contactName: contactName.length > 0 ? contactName : null,
      companyId: r[9] === null || r[9] === undefined ? null : String(r[9]),
      companyName: r[10] === null || r[10] === undefined ? null : String(r[10]),
    };
  });
}

/**
 * Is this deal earning on that date?
 *
 * Both boundaries are deliberate and both are the owner's reading of them. The
 * start date counts from the day itself: a plan that starts today is earning
 * today. The end date does not: "ended on the 30th" means the 30th was the
 * last day it was paid for, so the deal is still in the number on the 30th and
 * out of it on the 1st. Dates are 'YYYY-MM-DD', so a string comparison is a
 * date comparison.
 */
export function isEarningOn(
  row: { startedOn: string; endedOn: string | null },
  date: string,
): boolean {
  if (row.startedOn > date) return false;
  return row.endedOn === null || row.endedOn >= date;
}

/** Monthly recurring revenue on one date. */
export function mrrAsOf(rows: RecurringDealRow[], date: string): number {
  return rows.reduce(
    (sum, row) => (isEarningOn(row, date) ? sum + row.monthlyCents : sum),
    0,
  );
}

export type MrrPoint = {
  /** "2026-03". */
  bucket: string;
  /** The date the figure was taken on, which is today for the current month. */
  asOf: string;
  mrrCents: number;
};

/** The last day of a 'YYYY-MM' month, as 'YYYY-MM-DD'. */
export function lastDayOfMonth(bucket: string): string {
  const [year, month] = bucket.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${bucket}-${String(day).padStart(2, "0")}`;
}

/**
 * The twelve buckets the chart draws, oldest first and ending on the month
 * `today` falls in.
 *
 * The current month is read as of today rather than as of its last day,
 * because a chart whose final point is a month that has not happened yet
 * always looks like a collapse.
 */
export function lastTwelveMonths(today: string): { bucket: string; asOf: string }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const out: { bucket: string; asOf: string }[] = [];
  for (let back = 11; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    const bucket = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const end = lastDayOfMonth(bucket);
    out.push({ bucket, asOf: end > today ? today : end });
  }
  return out;
}

export function mrrSeries(rows: RecurringDealRow[], today: string): MrrPoint[] {
  return lastTwelveMonths(today).map(({ bucket, asOf }) => ({
    bucket,
    asOf,
    mrrCents: mrrAsOf(rows, asOf),
  }));
}

/** Recurring revenue that started, or stopped, inside one calendar month. */
export function mrrMovement(
  rows: RecurringDealRow[],
  monthBucket: string,
): { newCents: number; churnedCents: number } {
  const from = `${monthBucket}-01`;
  const to = lastDayOfMonth(monthBucket);
  let newCents = 0;
  let churnedCents = 0;
  for (const row of rows) {
    if (row.startedOn >= from && row.startedOn <= to) newCents += row.monthlyCents;
    if (row.endedOn !== null && row.endedOn >= from && row.endedOn <= to) {
      churnedCents += row.monthlyCents;
    }
  }
  return { newCents, churnedCents };
}

/**
 * Upfront money on deals won inside a period.
 *
 * Counted on `closed_at`, which is when the deal was won, and on
 * `one_time_cents` rather than `value_cents`, because the annual value of a
 * monthly plan is not money that arrived this month.
 */
export async function upfrontWon(period: Period): Promise<number> {
  const rows = await raw.query(
    `SELECT coalesce(sum(d.one_time_cents), 0) AS upfront_cents
     FROM deals d JOIN stages s ON s.id = d.stage_id
     WHERE d.deleted_at IS NULL AND s.is_won = 1
       AND d.closed_at IS NOT NULL AND d.closed_at >= ? AND d.closed_at < ?`,
    [period.from, period.to],
  );
  return rows.length > 0 ? Number(rows[0][0]) : 0;
}

export type RevenueParams = {
  /** Today in the owner's own calendar, 'YYYY-MM-DD'. */
  today: string;
  month: Period;
  quarter: Period;
  year: Period;
};

export type RevenueBundle = {
  mrrCents: number;
  arrCents: number;
  newMrrCents: number;
  churnedMrrCents: number;
  upfrontMonthCents: number;
  upfrontQuarterCents: number;
  upfrontYearCents: number;
  byMonth: MrrPoint[];
  /** Only the deals earning today, biggest first. */
  active: RecurringDealRow[];
};

/** The three periods the revenue report needs, from the owner's own clock. */
export function revenueParams(now: Date = new Date()): RevenueParams {
  return {
    today: todayLocal(),
    month: periodFor("month", now),
    quarter: periodFor("quarter", now),
    year: periodFor("year", now),
  };
}

export async function revenue(params: RevenueParams): Promise<RevenueBundle> {
  const [rows, upfrontMonthCents, upfrontQuarterCents, upfrontYearCents] =
    await Promise.all([
      recurringDeals(),
      upfrontWon(params.month),
      upfrontWon(params.quarter),
      upfrontWon(params.year),
    ]);

  const mrrCents = mrrAsOf(rows, params.today);
  const movement = mrrMovement(rows, params.today.slice(0, 7));

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    newMrrCents: movement.newCents,
    churnedMrrCents: movement.churnedCents,
    upfrontMonthCents,
    upfrontQuarterCents,
    upfrontYearCents,
    byMonth: mrrSeries(rows, params.today),
    active: rows.filter((row) => isEarningOn(row, params.today)),
  };
}

/* -------------------------------------------------------------------------- */
/* 7. the deals report                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Round 3 added two report pages beside the overview: one about the work and
 * one about the people it comes from. Both are plain SQL over the base tables
 * rather than new views, because neither needs the stage-event mining the
 * 0002 views exist for.
 *
 * Trend and period are two different questions and this file keeps them apart.
 * "How many deals came in" is a trend, so it runs over a trailing window of
 * twelve weeks or twelve months and ignores the period picker - a trend over
 * "this month" is one point, which is a number, not a line. Everything else on
 * the page (won rate, average value, time to win) is scoped by the period the
 * owner chose.
 */

/** One trend bucket: a Monday ('YYYY-MM-DD') for weeks, 'YYYY-MM' for months. */
export type DealBucketRow = {
  bucket: string;
  count: number;
  valueCents: number;
};

export type TrendGrain = "week" | "month";

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The Monday of the week a day falls in, UTC.
 *
 * It matches SQLite's `date(x, 'weekday 0', '-6 days')` exactly, which is what
 * the query buckets on: forward to the coming Sunday (staying put if it is
 * already Sunday), then back six days. So a week runs Monday to Sunday and
 * both halves of the report agree about which one a deal belongs to.
 */
export function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const sunday = date.getUTCDay();
  const toSunday = sunday === 0 ? 0 : 7 - sunday;
  date.setUTCDate(date.getUTCDate() + toSunday - 6);
  return utcDay(date);
}

/** The last `count` Mondays, oldest first, ending on the week `today` is in. */
export function lastWeeks(today: string, count = 12): string[] {
  const end = new Date(`${mondayOf(today)}T00:00:00.000Z`);
  const out: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const week = new Date(end);
    week.setUTCDate(week.getUTCDate() - back * 7);
    out.push(utcDay(week));
  }
  return out;
}

/** The last `count` months as 'YYYY-MM', oldest first, ending on today's. */
export function lastMonths(today: string, count = 12): string[] {
  return lastTwelveMonths(today)
    .slice(Math.max(0, 12 - count))
    .map((point) => point.bucket);
}

/**
 * Deals created per bucket over a trailing window, zero-filled.
 *
 * A week nobody sold anything in is a zero, not a gap: a line that skips the
 * quiet weeks makes a bad month look like a good one.
 */
export async function newDealsTrend(
  grain: TrendGrain,
  today: string,
  count = 12,
): Promise<DealBucketRow[]> {
  const buckets = grain === "week" ? lastWeeks(today, count) : lastMonths(today, count);
  const first = buckets[0];
  const fromIso = grain === "week" ? `${first}T00:00:00.000Z` : `${first}-01T00:00:00.000Z`;
  const bucketExpr =
    grain === "week"
      ? `date(d.created_at, 'weekday 0', '-6 days')`
      : `substr(d.created_at, 1, 7)`;

  const rows = await raw.query(
    `SELECT ${bucketExpr}                  AS bucket,
            count(*)                       AS deal_count,
            coalesce(sum(d.value_cents), 0) AS value_cents
     FROM deals d
     WHERE d.deleted_at IS NULL AND d.created_at >= ?
     GROUP BY bucket
     ORDER BY bucket ASC`,
    [fromIso],
  );

  const found = new Map<string, { count: number; valueCents: number }>();
  for (const row of rows) {
    found.set(String(row[0]), { count: Number(row[1]), valueCents: Number(row[2]) });
  }
  return buckets.map((bucket) => ({
    bucket,
    count: found.get(bucket)?.count ?? 0,
    valueCents: found.get(bucket)?.valueCents ?? 0,
  }));
}

/**
 * The middle value of a sorted list, or null when the list is empty.
 *
 * Median rather than mean for time to win, because one job that sat in the
 * pipeline for two years drags an average somewhere no real job has ever been.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type DealsSummary = {
  /** Deals created in the period. */
  newCount: number;
  newValueCents: number;
  wonCount: number;
  lostCount: number;
  /** Won plus lost: the deals that actually closed in the period. */
  closedCount: number;
  /** won / closed, or null when nothing closed - the screen shows "—". */
  wonRate: number | null;
  wonValueCents: number;
  /** Won value over won count, or null when nothing was won. */
  averageWonCents: number | null;
  /** Median days from a deal's creation to the day it was won, or null. */
  medianDaysToWin: number | null;
};

export async function dealsSummary(period: Period): Promise<DealsSummary> {
  const [closedRows, newRows, winRows] = await Promise.all([
    raw.query(
      `SELECT coalesce(sum(CASE WHEN s.is_won = 1 THEN 1 ELSE 0 END), 0)  AS won_count,
              coalesce(sum(CASE WHEN s.is_lost = 1 THEN 1 ELSE 0 END), 0) AS lost_count,
              coalesce(sum(CASE WHEN s.is_won = 1 THEN d.value_cents ELSE 0 END), 0) AS won_value_cents
       FROM deals d JOIN stages s ON s.id = d.stage_id
       WHERE d.deleted_at IS NULL AND d.closed_at IS NOT NULL
         AND (s.is_won = 1 OR s.is_lost = 1)
         AND d.closed_at >= ? AND d.closed_at < ?`,
      [period.from, period.to],
    ),
    raw.query(
      `SELECT count(*) AS deal_count, coalesce(sum(d.value_cents), 0) AS value_cents
       FROM deals d
       WHERE d.deleted_at IS NULL AND d.created_at >= ? AND d.created_at < ?`,
      [period.from, period.to],
    ),
    raw.query(
      `SELECT julianday(d.closed_at) - julianday(d.created_at) AS days
       FROM deals d JOIN stages s ON s.id = d.stage_id
       WHERE d.deleted_at IS NULL AND s.is_won = 1 AND d.closed_at IS NOT NULL
         AND d.closed_at >= ? AND d.closed_at < ?`,
      [period.from, period.to],
    ),
  ]);

  const wonCount = closedRows.length > 0 ? Number(closedRows[0][0]) : 0;
  const lostCount = closedRows.length > 0 ? Number(closedRows[0][1]) : 0;
  const wonValueCents = closedRows.length > 0 ? Number(closedRows[0][2]) : 0;
  const closedCount = wonCount + lostCount;
  const days = winRows
    .map((row) => (row[0] === null || row[0] === undefined ? null : Number(row[0])))
    .filter((value): value is number => value !== null && Number.isFinite(value))
    // A deal created and won on the same day took no days, not a negative
    // number; clock skew on an imported row must not pull the median under 0.
    .map((value) => Math.max(0, value));

  return {
    newCount: newRows.length > 0 ? Number(newRows[0][0]) : 0,
    newValueCents: newRows.length > 0 ? Number(newRows[0][1]) : 0,
    wonCount,
    lostCount,
    closedCount,
    // Nothing closed is not a zero per cent win rate. It is no answer, and the
    // screen prints "—" rather than a figure nobody can act on.
    wonRate: closedCount > 0 ? wonCount / closedCount : null,
    wonValueCents,
    averageWonCents: wonCount > 0 ? Math.round(wonValueCents / wonCount) : null,
    medianDaysToWin: median(days),
  };
}

/**
 * Everything the Deals page draws, in one round trip.
 *
 * It is a superset of the old `ReportBundle`: the five cards that used to be
 * the whole of /reports are all about deals, so they moved here whole rather
 * than being split across the new tabs, and the page's own summary and trend
 * are loaded beside them so every figure on the page is read at one instant.
 */
export type DealsReport = {
  summary: DealsSummary;
  trend: DealBucketRow[];
  grain: TrendGrain;
  /** Open deals by stage, right now. */
  openByStage: PipelineStageRow[];
  wonLost: WonLostRow[];
  sources: SourceRow[];
  conversion: ConversionRow[];
  dwell: DwellRow[];
};

export async function loadDealsReport(
  period: Period,
  grain: TrendGrain,
  granularity: Granularity,
  today: string = todayLocal(),
): Promise<DealsReport> {
  const [summary, trend, openByStage, won, sources, conversion, dwell] = await Promise.all([
    dealsSummary(period),
    newDealsTrend(grain, today),
    pipelineByStage(),
    wonLost(period, granularity),
    leadsBySource(period),
    stageConversion(period),
    daysInStage(period),
  ]);
  return { summary, trend, grain, openByStage, wonLost: won, sources, conversion, dwell };
}

/* -------------------------------------------------------------------------- */
/* 8. the contacts and companies report                                       */
/* -------------------------------------------------------------------------- */

export type PeopleTotals = {
  contacts: number;
  companies: number;
  /** Contacts with at least one live deal against them. */
  contactsWithDeal: number;
  companiesWithDeal: number;
  /** Created inside the period. */
  newContacts: number;
  newCompanies: number;
};

export async function peopleTotals(period: Period): Promise<PeopleTotals> {
  const rows = await raw.query(
    `SELECT
       (SELECT count(*) FROM contacts WHERE deleted_at IS NULL)  AS contacts,
       (SELECT count(*) FROM companies WHERE deleted_at IS NULL) AS companies,
       (SELECT count(DISTINCT c.id) FROM contacts c
          JOIN deals d ON d.contact_id = c.id AND d.deleted_at IS NULL
         WHERE c.deleted_at IS NULL)                             AS contacts_with_deal,
       (SELECT count(DISTINCT co.id) FROM companies co
          JOIN deals d ON d.company_id = co.id AND d.deleted_at IS NULL
         WHERE co.deleted_at IS NULL)                            AS companies_with_deal,
       (SELECT count(*) FROM contacts
         WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?)  AS new_contacts,
       (SELECT count(*) FROM companies
         WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?)  AS new_companies`,
    [period.from, period.to, period.from, period.to],
  );
  const row = rows[0] ?? [0, 0, 0, 0, 0, 0];
  return {
    contacts: Number(row[0]),
    companies: Number(row[1]),
    contactsWithDeal: Number(row[2]),
    companiesWithDeal: Number(row[3]),
    newContacts: Number(row[4]),
    newCompanies: Number(row[5]),
  };
}

export type PeopleBucketRow = { bucket: string; contacts: number; companies: number };

/** New contacts and new companies per month over a trailing window, zero-filled. */
export async function newPeopleByMonth(
  today: string = todayLocal(),
  count = 12,
): Promise<PeopleBucketRow[]> {
  const buckets = lastMonths(today, count);
  const fromIso = `${buckets[0]}-01T00:00:00.000Z`;
  const rows = await raw.query(
    `SELECT bucket, sum(is_contact) AS contacts, sum(is_company) AS companies
     FROM (
       SELECT substr(c.created_at, 1, 7) AS bucket, 1 AS is_contact, 0 AS is_company
       FROM contacts c WHERE c.deleted_at IS NULL AND c.created_at >= ?
       UNION ALL
       SELECT substr(co.created_at, 1, 7), 0, 1
       FROM companies co WHERE co.deleted_at IS NULL AND co.created_at >= ?
     )
     GROUP BY bucket
     ORDER BY bucket ASC`,
    [fromIso, fromIso],
  );
  const found = new Map<string, { contacts: number; companies: number }>();
  for (const row of rows) {
    found.set(String(row[0]), { contacts: Number(row[1]), companies: Number(row[2]) });
  }
  return buckets.map((bucket) => ({
    bucket,
    contacts: found.get(bucket)?.contacts ?? 0,
    companies: found.get(bucket)?.companies ?? 0,
  }));
}

export type PeopleSourceRow = {
  sourceId: string;
  sourceName: string;
  contacts: number;
  companies: number;
};

/**
 * Where the people added in this period came from.
 *
 * A record with no source, or whose source was deleted, lands in "Unknown"
 * rather than vanishing - the same rule `v_report_deal_sources` follows, so
 * the two source reports add up the same way.
 */
export async function peopleBySource(period: Period): Promise<PeopleSourceRow[]> {
  const rows = await raw.query(
    `SELECT source_id, source_name,
            sum(is_contact) AS contacts,
            sum(is_company) AS companies
     FROM (
       SELECT coalesce(s.id, '') AS source_id, coalesce(s.name, 'Unknown') AS source_name,
              1 AS is_contact, 0 AS is_company
       FROM contacts c
       LEFT JOIN sources s ON s.id = c.source_id AND s.deleted_at IS NULL
       WHERE c.deleted_at IS NULL AND c.created_at >= ? AND c.created_at < ?
       UNION ALL
       SELECT coalesce(s.id, ''), coalesce(s.name, 'Unknown'), 0, 1
       FROM companies co
       LEFT JOIN sources s ON s.id = co.source_id AND s.deleted_at IS NULL
       WHERE co.deleted_at IS NULL AND co.created_at >= ? AND co.created_at < ?
     )
     GROUP BY source_id, source_name
     ORDER BY (sum(is_contact) + sum(is_company)) DESC, source_name ASC`,
    [period.from, period.to, period.from, period.to],
  );
  return rows.map((r) => ({
    sourceId: String(r[0]),
    sourceName: String(r[1]),
    contacts: Number(r[2]),
    companies: Number(r[3]),
  }));
}

export type TopCompanyRow = {
  companyId: string;
  name: string;
  wonCount: number;
  wonValueCents: number;
  openCount: number;
  openValueCents: number;
};

/** The companies that won the most in the period, with what they still have open. */
export async function topCompanies(period: Period, limit = 10): Promise<TopCompanyRow[]> {
  const rows = await raw.query(
    `SELECT co.id AS co_id, co.name AS co_name,
            coalesce(sum(CASE WHEN s.is_won = 1 AND d.closed_at >= ? AND d.closed_at < ?
                              THEN 1 ELSE 0 END), 0) AS won_count,
            coalesce(sum(CASE WHEN s.is_won = 1 AND d.closed_at >= ? AND d.closed_at < ?
                              THEN d.value_cents ELSE 0 END), 0) AS won_value_cents,
            coalesce(sum(CASE WHEN d.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0
                              THEN 1 ELSE 0 END), 0) AS open_count,
            coalesce(sum(CASE WHEN d.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0
                              THEN d.value_cents ELSE 0 END), 0) AS open_value_cents
     FROM companies co
     JOIN deals d ON d.company_id = co.id AND d.deleted_at IS NULL
     JOIN stages s ON s.id = d.stage_id
     WHERE co.deleted_at IS NULL
     GROUP BY co.id, co.name
     HAVING won_value_cents > 0 OR open_value_cents > 0
     ORDER BY won_value_cents DESC, open_value_cents DESC, co.name ASC
     LIMIT ?`,
    [period.from, period.to, period.from, period.to, limit],
  );
  return rows.map((r) => ({
    companyId: String(r[0]),
    name: String(r[1]),
    wonCount: Number(r[2]),
    wonValueCents: Number(r[3]),
    openCount: Number(r[4]),
    openValueCents: Number(r[5]),
  }));
}

export type PeopleReport = {
  totals: PeopleTotals;
  byMonth: PeopleBucketRow[];
  bySource: PeopleSourceRow[];
  topCompanies: TopCompanyRow[];
};

export async function loadPeopleReport(
  period: Period,
  today: string = todayLocal(),
): Promise<PeopleReport> {
  const [totals, byMonth, bySource, top] = await Promise.all([
    peopleTotals(period),
    newPeopleByMonth(today),
    peopleBySource(period),
    topCompanies(period),
  ]);
  return { totals, byMonth, bySource, topCompanies: top };
}

/* -------------------------------------------------------------------------- */
/* 9. the overview                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The headline of every other tab, in one round trip, so /reports can answer
 * "how is the business" before the owner has decided which report he wants.
 * Nothing is computed here that a tab does not also show; the overview is a
 * table of contents with numbers on it, not a sixth report.
 */
export type OverviewBundle = {
  deals: DealsSummary;
  people: PeopleTotals;
  money: MoneyTotals;
  mrrCents: number;
  arrCents: number;
  openByStage: PipelineStageRow[];
};

export async function loadOverview(period: Period): Promise<OverviewBundle> {
  const [deals, people, money, revenueBundle, openByStage] = await Promise.all([
    dealsSummary(period),
    peopleTotals(period),
    periodMoney(period.from, period.to),
    revenue(revenueParams()),
    pipelineByStage(),
  ]);
  return {
    deals,
    people,
    money,
    mrrCents: revenueBundle.mrrCents,
    arrCents: revenueBundle.arrCents,
    openByStage,
  };
}

/* -------------------------------------------------------------------------- */
/* 10. the four money numbers, for the revenue report                         */
/* -------------------------------------------------------------------------- */

/**
 * What the period quoted, won, invoiced and collected, and the same four
 * numbers deal by deal.
 *
 * MRR and ARR answer "what repeats"; these answer "what happened". They are a
 * separate bundle from `revenue()` because they are the only part of that
 * screen a period picker moves - MRR is read as of today whatever range is
 * chosen, and pretending otherwise would put a figure under the picker that
 * the picker does not change.
 *
 * Both halves come from `src/db/repos/money.ts`, which is the one definition
 * of those four words in the product.
 */
export type RevenueMoney = {
  totals: MoneyTotals;
  perDeal: PerDealMoneyRow[];
};

export async function revenueMoney(period: Period): Promise<RevenueMoney> {
  const [totals, perDeal] = await Promise.all([
    periodMoney(period.from, period.to),
    perDealMoney(period.from, period.to),
  ]);
  return { totals, perDeal };
}
