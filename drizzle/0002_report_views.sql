-- Report views (docs/PLAN.md, Core item 14).
--
-- The five reports are read through SQL views so that days-in-stage and
-- conversion never have to mine the change log: `deal_stage_events` already
-- holds one row per stage move. The views do the joins and the derivations;
-- the period filter and the final aggregation belong to the caller
-- (src/features/leads/lib/reportQueries.ts), because a period picker cannot
-- be baked into a view.
--
-- Conventions in every view below:
--   * soft-deleted rows are invisible (`deleted_at IS NULL` on every table);
--   * money stays integer cents;
--   * "open" means the deal has no `closed_at` and sits in a stage that is
--     neither `is_won` nor `is_lost`.
--
-- Views are dropped first so this migration is safe to re-read during
-- development; migrations are forward-only in production, so the DROPs are
-- no-ops on a real upgrade.

DROP VIEW IF EXISTS v_report_pipeline_stage;--> statement-breakpoint
DROP VIEW IF EXISTS v_report_closed_deals;--> statement-breakpoint
DROP VIEW IF EXISTS v_report_deal_sources;--> statement-breakpoint
DROP VIEW IF EXISTS v_report_stage_transitions;--> statement-breakpoint
DROP VIEW IF EXISTS v_report_stage_dwell;--> statement-breakpoint

-- 1. Pipeline value by stage, open deals only.
--
-- A LEFT JOIN from `stages` so a stage with nothing in it still appears: an
-- empty column is information, and the chart needs the slot.
CREATE VIEW v_report_pipeline_stage AS
SELECT
  s.id                            AS stage_id,
  s.name                          AS stage_name,
  s.position                      AS stage_position,
  s.color                         AS stage_color,
  s.pipeline_id                   AS pipeline_id,
  count(d.id)                     AS open_deals,
  coalesce(sum(d.value_cents), 0) AS open_value_cents
FROM stages s
LEFT JOIN deals d
  ON d.stage_id = s.id
 AND d.deleted_at IS NULL
 AND d.closed_at IS NULL
WHERE s.deleted_at IS NULL
  AND s.is_won = 0
  AND s.is_lost = 0
GROUP BY s.id, s.name, s.position, s.color, s.pipeline_id;--> statement-breakpoint

-- 2. Won and lost, one row per closed deal with its month, quarter and year.
--
-- The outcome comes from the stage flags, not from a column on the deal, so
-- renaming or recolouring a stage never rewrites history. The period columns
-- are plain string prefixes of `closed_at` (a UTC ISO timestamp), which is
-- what makes `GROUP BY period_month` an index-free but exact bucket.
CREATE VIEW v_report_closed_deals AS
SELECT
  d.id                            AS deal_id,
  d.title                         AS deal_title,
  d.value_cents                   AS value_cents,
  d.currency                      AS currency,
  d.closed_at                     AS closed_at,
  CASE WHEN s.is_won = 1 THEN 'won' ELSE 'lost' END AS outcome,
  s.id                            AS stage_id,
  s.name                          AS stage_name,
  substr(d.closed_at, 1, 7)       AS period_month,
  substr(d.closed_at, 1, 4) || '-Q'
    || CAST((CAST(substr(d.closed_at, 6, 2) AS INTEGER) + 2) / 3 AS TEXT)
                                  AS period_quarter,
  substr(d.closed_at, 1, 4)       AS period_year
FROM deals d
JOIN stages s ON s.id = d.stage_id
WHERE d.deleted_at IS NULL
  AND d.closed_at IS NOT NULL
  AND (s.is_won = 1 OR s.is_lost = 1);--> statement-breakpoint

-- 3. Leads by source: one row per live deal, with its source resolved.
--
-- A deal whose source was deleted, or that never had one, lands in a single
-- "Unknown" bucket rather than disappearing from the total.
CREATE VIEW v_report_deal_sources AS
SELECT
  d.id                                  AS deal_id,
  d.created_at                          AS created_at,
  d.value_cents                         AS value_cents,
  coalesce(src.id, '')                  AS source_id,
  coalesce(src.name, 'Unknown')         AS source_name,
  CASE WHEN s.is_won = 1 THEN 1 ELSE 0 END AS is_won,
  CASE WHEN s.is_lost = 1 THEN 1 ELSE 0 END AS is_lost,
  CASE WHEN d.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0
       THEN 1 ELSE 0 END                AS is_open
FROM deals d
JOIN stages s ON s.id = d.stage_id
LEFT JOIN sources src ON src.id = d.source_id AND src.deleted_at IS NULL
WHERE d.deleted_at IS NULL;--> statement-breakpoint

-- 4. Conversion between consecutive stages.
--
-- One row per (deal, consecutive stage pair) for every deal that ever entered
-- the earlier stage, with `advanced` set when the same deal entered the next
-- stage *afterwards*. "Consecutive" is by `position` inside a pipeline, so
-- reordering the board reshapes the report and a deleted stage closes the gap.
--
-- `advanced` deliberately asks for a later event rather than comparing first
-- entries: a deal that bounced New -> Quoted -> New -> Quoted still counts as
-- having advanced.
--
-- A won or lost stage is never the `from` side of a pair: a closed deal has
-- nowhere left to convert to, and "Won -> Lost" is not a funnel step anybody
-- would want a percentage for. It can still be the `to` side, because
-- "Scheduled -> Won" is the most interesting number on the report.
CREATE VIEW v_report_stage_transitions AS
WITH pairs AS (
  SELECT
    a.pipeline_id AS pipeline_id,
    a.id          AS from_stage_id,
    a.name        AS from_stage_name,
    a.position    AS from_position,
    b.id          AS to_stage_id,
    b.name        AS to_stage_name,
    b.position    AS to_position
  FROM stages a
  JOIN stages b
    ON b.pipeline_id = a.pipeline_id
   AND b.deleted_at IS NULL
  WHERE a.deleted_at IS NULL
    AND a.is_won = 0
    AND a.is_lost = 0
    AND b.position = (
      SELECT min(c.position) FROM stages c
      WHERE c.pipeline_id = a.pipeline_id
        AND c.deleted_at IS NULL
        AND c.position > a.position
    )
),
entered AS (
  SELECT ev.deal_id AS deal_id, ev.to_stage_id AS stage_id, min(ev.at) AS first_at
  FROM deal_stage_events ev
  WHERE ev.deleted_at IS NULL
  GROUP BY ev.deal_id, ev.to_stage_id
)
SELECT
  p.pipeline_id                   AS pipeline_id,
  p.from_stage_id                 AS from_stage_id,
  p.from_stage_name               AS from_stage_name,
  p.from_position                 AS from_position,
  p.to_stage_id                   AS to_stage_id,
  p.to_stage_name                 AS to_stage_name,
  p.to_position                   AS to_position,
  e.deal_id                       AS deal_id,
  d.created_at                    AS deal_created_at,
  e.first_at                      AS entered_from_at,
  CASE WHEN EXISTS (
    SELECT 1 FROM deal_stage_events nx
    WHERE nx.deal_id = e.deal_id
      AND nx.to_stage_id = p.to_stage_id
      AND nx.deleted_at IS NULL
      AND nx.at > e.first_at
  ) THEN 1 ELSE 0 END             AS advanced
FROM pairs p
JOIN entered e ON e.stage_id = p.from_stage_id
JOIN deals d ON d.id = e.deal_id AND d.deleted_at IS NULL;--> statement-breakpoint

-- 5. Days in stage.
--
-- One row per stage entry. `left_at` is the next stage event for that deal
-- (ties on the same millisecond break on id, which is UUID v7 and therefore in
-- creation order). The last entry for a deal has no `left_at`: that is the
-- deal's current stage, and `days_in_stage` is measured against now, which is
-- the "current dwell" the report shows beside the historical average.
CREATE VIEW v_report_stage_dwell AS
WITH spans AS (
  SELECT
    e.deal_id      AS deal_id,
    e.to_stage_id  AS stage_id,
    e.at           AS entered_at,
    (
      SELECT min(n.at) FROM deal_stage_events n
      WHERE n.deal_id = e.deal_id
        AND n.deleted_at IS NULL
        AND (n.at > e.at OR (n.at = e.at AND n.id > e.id))
    )              AS left_at
  FROM deal_stage_events e
  WHERE e.deleted_at IS NULL
)
SELECT
  spans.deal_id                         AS deal_id,
  spans.stage_id                        AS stage_id,
  s.name                                AS stage_name,
  s.position                            AS stage_position,
  s.pipeline_id                         AS pipeline_id,
  spans.entered_at                      AS entered_at,
  spans.left_at                         AS left_at,
  CASE WHEN spans.left_at IS NULL THEN 1 ELSE 0 END AS is_current,
  CASE WHEN d.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0
       THEN 1 ELSE 0 END                AS deal_is_open,
  CASE WHEN spans.left_at IS NOT NULL
       THEN julianday(spans.left_at) - julianday(spans.entered_at)
       ELSE julianday('now') - julianday(spans.entered_at)
  END                                   AS days_in_stage
FROM spans
JOIN deals d ON d.id = spans.deal_id AND d.deleted_at IS NULL
JOIN stages s ON s.id = spans.stage_id AND s.deleted_at IS NULL;
