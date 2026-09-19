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
import type { Granularity, Period } from "@/lib/periods";

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
