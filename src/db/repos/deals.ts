/**
 * Deals.
 *
 *   [open in stage S] --move--> [open in stage S'] --stage.is_won--> [won]
 *        |                                              |
 *        +--stage.is_lost--> [lost, reason required]    +--reopen--> [open]
 *
 * Every move writes a deal_stage_events row and stamps stage_entered_at, so
 * reports (days in stage, conversion) and the gone-quiet rule never mine the
 * change log. Won and lost are properties of the stage, not of the deal: a
 * deal is closed because it sits in a stage with is_won or is_lost set.
 *
 * Position is the order within a stage. It is stored as a number and rewritten
 * to 0..n-1 whenever a deal is dropped, which keeps drag-and-drop honest
 * without fractional-index drift.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withTransaction, withWrite } from "@/db/writeLock";
import { NotFoundError, ValidationError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import {
  countRows,
  insertStatement,
  logWrite,
  mapRows,
  pageClause,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  trimmedOrNull,
  updateStatement,
  parseOrThrow,
  type Col,
  type Page,
} from "@/db/repos/_base";

export type Deal = {
  id: string;
  title: string;
  valueCents: number;
  currency: string;
  stageId: string;
  stageName: string;
  stageIsWon: boolean;
  stageIsLost: boolean;
  stageEnteredAt: string;
  position: number;
  contactId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  companyId: string | null;
  companyName: string | null;
  sourceId: string | null;
  externalId: string | null;
  expectedOn: string | null;
  closedAt: string | null;
  outcomeReason: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type DealStageEvent = {
  id: string;
  dealId: string;
  fromStageId: string | null;
  toStageId: string;
  at: string;
};

export const newDealSchema = z.object({
  title: z.string().min(1, "A deal needs a title."),
  stageId: z.string().min(1, "A deal needs a stage."),
  valueCents: z.number().int().default(0),
  currency: z.string().default("USD"),
  contactId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  expectedOn: z.string().nullable().optional(),
  position: z.number().optional(),
});

export type NewDeal = z.input<typeof newDealSchema>;

export type DealFilter = {
  stageId?: string;
  pipelineId?: string;
  contactId?: string;
  companyId?: string;
  sourceId?: string;
  search?: string;
  openOnly?: boolean;
  closedOnly?: boolean;
  minValueCents?: number;
  maxValueCents?: number;
  expectedFrom?: string;
  expectedTo?: string;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
};

const DEAL_COLS: readonly Col<Deal>[] = [
  ["id", "d.id", "text"],
  ["title", "d.title", "text"],
  ["valueCents", "d.value_cents", "int"],
  ["currency", "d.currency", "text"],
  ["stageId", "d.stage_id", "text"],
  ["stageName", "s.name", "text"],
  ["stageIsWon", "s.is_won", "bool"],
  ["stageIsLost", "s.is_lost", "bool"],
  ["stageEnteredAt", "d.stage_entered_at", "text"],
  ["position", "d.position", "int"],
  ["contactId", "d.contact_id", "textNull"],
  ["contactFirstName", "c.first_name", "textNull"],
  ["contactLastName", "c.last_name", "textNull"],
  ["companyId", "d.company_id", "textNull"],
  ["companyName", "co.name", "textNull"],
  ["sourceId", "d.source_id", "textNull"],
  ["externalId", "d.external_id", "textNull"],
  ["expectedOn", "d.expected_on", "textNull"],
  ["closedAt", "d.closed_at", "textNull"],
  ["outcomeReason", "d.outcome_reason", "textNull"],
  ["createdAt", "d.created_at", "text"],
  ["updatedAt", "d.updated_at", "text"],
  ["deletedAt", "d.deleted_at", "textNull"],
] as const;

const EVENT_COLS: readonly Col<DealStageEvent>[] = [
  ["id", "ev.id", "text"],
  ["dealId", "ev.deal_id", "text"],
  ["fromStageId", "ev.from_stage_id", "textNull"],
  ["toStageId", "ev.to_stage_id", "text"],
  ["at", "ev.at", "text"],
] as const;

const DEAL_FROM = `FROM deals d
  JOIN stages s ON s.id = d.stage_id
  LEFT JOIN contacts c ON c.id = d.contact_id
  LEFT JOIN companies co ON co.id = d.company_id`;

export async function get(id: string): Promise<Deal | null> {
  const rows = await raw.query(
    `SELECT ${selectList(DEAL_COLS, "d")} ${DEAL_FROM} WHERE d.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(DEAL_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Deal> {
  const found = await get(id);
  if (!found) throw new NotFoundError("deal", id);
  return found;
}

function whereFor(filter: DealFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.onlyDeleted) clauses.push("d.deleted_at IS NOT NULL");
  else if (!filter.includeDeleted) clauses.push("d.deleted_at IS NULL");

  if (filter.stageId) {
    clauses.push("d.stage_id = ?");
    params.push(filter.stageId);
  }
  if (filter.pipelineId) {
    clauses.push("s.pipeline_id = ?");
    params.push(filter.pipelineId);
  }
  if (filter.contactId) {
    clauses.push("d.contact_id = ?");
    params.push(filter.contactId);
  }
  if (filter.companyId) {
    clauses.push("d.company_id = ?");
    params.push(filter.companyId);
  }
  if (filter.sourceId) {
    clauses.push("d.source_id = ?");
    params.push(filter.sourceId);
  }
  if (filter.openOnly) clauses.push("s.is_won = 0 AND s.is_lost = 0");
  if (filter.closedOnly) clauses.push("(s.is_won = 1 OR s.is_lost = 1)");
  if (filter.minValueCents !== undefined) {
    clauses.push("d.value_cents >= ?");
    params.push(filter.minValueCents);
  }
  if (filter.maxValueCents !== undefined) {
    clauses.push("d.value_cents <= ?");
    params.push(filter.maxValueCents);
  }
  if (filter.expectedFrom) {
    clauses.push("d.expected_on >= ?");
    params.push(filter.expectedFrom);
  }
  if (filter.expectedTo) {
    clauses.push("d.expected_on <= ?");
    params.push(filter.expectedTo);
  }
  if (filter.search && filter.search.trim().length > 0) {
    clauses.push("(d.title LIKE ? OR co.name LIKE ? OR c.last_name LIKE ?)");
    const like = `%${filter.search.trim()}%`;
    params.push(like, like, like);
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function list(
  filter: DealFilter = {},
  page?: Page,
): Promise<{ rows: Deal[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(DEAL_COLS, "d")} ${DEAL_FROM}${where.sql}
     ORDER BY s.position ASC, d.position ASC, d.created_at ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total ${DEAL_FROM}${where.sql}`,
    where.params,
  );
  return { rows: mapRows(DEAL_COLS, rows), total };
}

/** Every open deal grouped by stage, in board order. */
export async function board(
  pipelineId: string,
): Promise<{ stageId: string; deals: Deal[] }[]> {
  const { rows } = await list({ pipelineId }, { limit: 5000 });
  const byStage = new Map<string, Deal[]>();
  for (const deal of rows) {
    const bucket = byStage.get(deal.stageId);
    if (bucket) bucket.push(deal);
    else byStage.set(deal.stageId, [deal]);
  }
  return [...byStage.entries()].map(([stageId, deals]) => ({ stageId, deals }));
}

export async function listStageEvents(
  dealId: string,
): Promise<DealStageEvent[]> {
  const rows = await raw.query(
    `SELECT ${selectList(EVENT_COLS, "ev")} FROM deal_stage_events ev
     WHERE ev.deal_id = ? ORDER BY ev.at ASC, ev.id ASC`,
    [dealId],
  );
  return mapRows(EVENT_COLS, rows);
}

/** Idempotency for the lead poller: one deal per "<site>:<lead id>". */
export async function findByExternalId(
  externalId: string,
): Promise<Deal | null> {
  const rows = await raw.query(
    `SELECT ${selectList(DEAL_COLS, "d")} ${DEAL_FROM} WHERE d.external_id = ? LIMIT 1`,
    [externalId],
  );
  return rows.length > 0 ? mapRows(DEAL_COLS, rows)[0] : null;
}

async function nextPosition(stageId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT coalesce(max(d.position), -1) AS max_position FROM deals d
     WHERE d.stage_id = ? AND d.deleted_at IS NULL`,
    [stageId],
  );
  return (rows.length > 0 ? Number(rows[0][0]) : -1) + 1;
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function create(
  input: NewDeal,
  options: { batchId?: string } = {},
): Promise<Deal> {
  const parsed = parseOrThrow(newDealSchema, input);
  return withWrite(async () => {
    const at = nowIso();
    const stamps = stampNew();
    const row = {
      ...stamps,
      title: trimmed(parsed.title),
      valueCents: parsed.valueCents,
      currency: parsed.currency,
      stageId: parsed.stageId,
      stageEnteredAt: at,
      position: parsed.position ?? (await nextPosition(parsed.stageId)),
      contactId: parsed.contactId ?? null,
      companyId: parsed.companyId ?? null,
      sourceId: parsed.sourceId ?? null,
      externalId: parsed.externalId ?? null,
      expectedOn: parsed.expectedOn ?? null,
      closedAt: null,
      outcomeReason: null,
      deletedAt: null,
    };
    await raw.batch([
      insertStatement("deals", row),
      insertStatement("deal_stage_events", {
        id: newId(),
        createdAt: at,
        updatedAt: at,
        dealId: stamps.id,
        fromStageId: null,
        toStageId: parsed.stageId,
        at,
      }),
    ]);
    await logWrite("deal", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a deal");
}

export type DealPatch = Partial<
  Pick<
    NewDeal,
    | "title"
    | "valueCents"
    | "currency"
    | "contactId"
    | "companyId"
    | "sourceId"
    | "expectedOn"
    | "externalId"
  >
> & { outcomeReason?: string | null };

export async function update(
  id: string,
  patch: DealPatch,
  options: { batchId?: string } = {},
): Promise<Deal> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.title !== undefined) values.title = trimmed(patch.title);
    if (patch.valueCents !== undefined) values.valueCents = patch.valueCents;
    if (patch.currency !== undefined) values.currency = patch.currency;
    if (patch.contactId !== undefined) values.contactId = patch.contactId ?? null;
    if (patch.companyId !== undefined) values.companyId = patch.companyId ?? null;
    if (patch.sourceId !== undefined) values.sourceId = patch.sourceId ?? null;
    if (patch.expectedOn !== undefined) values.expectedOn = patch.expectedOn ?? null;
    if (patch.externalId !== undefined) values.externalId = patch.externalId ?? null;
    if (patch.outcomeReason !== undefined)
      values.outcomeReason = trimmedOrNull(patch.outcomeReason);

    const stmt = updateStatement("deals", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("deal", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a deal");
}

type StageFlags = { pipelineId: string; isWon: boolean; isLost: boolean };

async function stageFlags(stageId: string): Promise<StageFlags> {
  const rows = await raw.query(
    `SELECT s.pipeline_id AS s_pipeline_id, s.is_won AS s_is_won, s.is_lost AS s_is_lost
     FROM stages s WHERE s.id = ? AND s.deleted_at IS NULL`,
    [stageId],
  );
  if (rows.length === 0) throw new NotFoundError("stage", stageId);
  return {
    pipelineId: String(rows[0][0]),
    isWon: Number(rows[0][1]) !== 0,
    isLost: Number(rows[0][2]) !== 0,
  };
}

/**
 * Move a deal to a stage, optionally to a position inside it.
 *
 * Refuses a stage in another pipeline. Lost stages require a reason. Entering
 * a won or lost stage stamps closed_at; leaving one clears it (that is the
 * reopen path).
 */
export async function moveToStage(
  id: string,
  toStageId: string,
  options: {
    toIndex?: number;
    outcomeReason?: string | null;
    batchId?: string;
  } = {},
): Promise<Deal> {
  return withTransaction(async () => {
    const before = await getOrThrow(id);
    const target = await stageFlags(toStageId);
    const source = await stageFlags(before.stageId);

    if (target.pipelineId !== source.pipelineId) {
      throw new ValidationError("That stage belongs to another pipeline.", [
        { path: "stageId", message: "Stage is in a different pipeline." },
      ]);
    }
    // The reason this deal will end up with: an explicit value wins, even an
    // explicit null, so "clear the reason" cannot silently keep the old one.
    const effectiveReason =
      options.outcomeReason !== undefined
        ? options.outcomeReason
        : before.outcomeReason;
    if (target.isLost && trimmed(effectiveReason).length === 0) {
      throw new ValidationError("Losing a deal needs a reason.", [
        { path: "outcomeReason", message: "Say why it was lost." },
      ]);
    }

    const at = nowIso();
    const changedStage = before.stageId !== toStageId;
    const closing = target.isWon || target.isLost;

    const values: Record<string, unknown> = {
      stageId: toStageId,
      updatedAt: at,
      closedAt: closing ? (before.closedAt ?? at) : null,
    };
    if (changedStage) values.stageEnteredAt = at;
    // An open stage has no outcome, so leaving won or lost clears the reason:
    // that is the reopen path.
    values.outcomeReason = closing ? trimmedOrNull(effectiveReason) : null;

    const stmt = updateStatement("deals", id, values);
    await raw.execute(stmt.sql, stmt.params);

    if (changedStage) {
      const ev = insertStatement("deal_stage_events", {
        id: newId(),
        createdAt: at,
        updatedAt: at,
        dealId: id,
        fromStageId: before.stageId,
        toStageId,
        at,
      });
      await raw.execute(ev.sql, ev.params);
    }

    await reposition(id, toStageId, options.toIndex);
    // The stage it left must not keep a hole where it used to sit.
    if (changedStage) await compactStage(before.stageId);
    await logWrite("deal", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Moving a deal");
}

/** Rewrite one stage's positions to 0..n-1, closing any gaps. */
export async function compactStage(stageId: string): Promise<void> {
  const rows = await raw.query(
    `SELECT d.id AS d_id FROM deals d
     WHERE d.stage_id = ? AND d.deleted_at IS NULL
     ORDER BY d.position ASC, d.created_at ASC`,
    [stageId],
  );
  if (rows.length === 0) return;
  const at = nowIso();
  await raw.batch(
    rows.map((r, i) => ({
      sql: `UPDATE deals SET position = ?, updated_at = ? WHERE id = ?`,
      params: [i, at, String(r[0])],
    })),
  );
}

/**
 * Put the deal at `toIndex` inside its stage and rewrite every sibling's
 * position to 0..n-1. Called by drag-and-drop and by shift+arrow.
 */
export async function reposition(
  id: string,
  stageId: string,
  toIndex?: number,
): Promise<void> {
  const rows = await raw.query(
    `SELECT d.id AS d_id FROM deals d
     WHERE d.stage_id = ? AND d.deleted_at IS NULL
     ORDER BY d.position ASC, d.created_at ASC`,
    [stageId],
  );
  const ids = rows.map((r) => String(r[0])).filter((rowId) => rowId !== id);
  const index =
    toIndex === undefined
      ? ids.length
      : Math.max(0, Math.min(toIndex, ids.length));
  ids.splice(index, 0, id);

  const at = nowIso();
  await raw.batch(
    ids.map((rowId, i) => ({
      sql: `UPDATE deals SET position = ?, updated_at = ? WHERE id = ?`,
      params: [i, at, rowId],
    })),
  );
}

/** Drag within or between stages: one call from the board. */
export async function moveTo(
  id: string,
  toStageId: string,
  toIndex: number,
  options: { outcomeReason?: string | null; batchId?: string } = {},
): Promise<Deal> {
  const current = await getOrThrow(id);
  if (current.stageId === toStageId) {
    return withWrite(async () => {
      await reposition(id, toStageId, toIndex);
      await logWrite(
        "deal",
        id,
        "update",
        { position: current.position },
        { position: toIndex },
        options.batchId,
      );
      return getOrThrow(id);
    }, "Moving a deal");
  }
  return moveToStage(id, toStageId, { ...options, toIndex });
}

/** Reopen a won or lost deal into an open stage. */
export async function reopen(
  id: string,
  toStageId: string,
  options: { batchId?: string } = {},
): Promise<Deal> {
  const target = await stageFlags(toStageId);
  if (target.isWon || target.isLost) {
    throw new ValidationError("Reopen needs an open stage.", [
      { path: "stageId", message: "Pick a stage that is neither won nor lost." },
    ]);
  }
  return moveToStage(id, toStageId, { ...options, outcomeReason: null });
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("deals", "deal", id, options.batchId),
    "Deleting a deal",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("deals", "deal", id, options.batchId),
    "Restoring a deal",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("deals", "deal", id, options.batchId),
    "Purging a deal",
  );
}

/**
 * Gone quiet: an open deal whose last sign of life (stage entry or activity)
 * is older than its stage's quiet_days. quiet_days = 0 disables the rule.
 */
export async function goneQuiet(nowAt: string = nowIso()): Promise<Deal[]> {
  const rows = await raw.query(
    `SELECT ${selectList(DEAL_COLS, "d")} ${DEAL_FROM}
     WHERE d.deleted_at IS NULL AND s.is_won = 0 AND s.is_lost = 0 AND s.quiet_days > 0
       AND julianday(?) - julianday(
             max(d.stage_entered_at,
                 coalesce((SELECT max(a.occurred_at) FROM activities a
                           WHERE a.deal_id = d.id AND a.deleted_at IS NULL), d.stage_entered_at))
           ) >= s.quiet_days
     ORDER BY d.stage_entered_at ASC`,
    [nowAt],
  );
  return mapRows(DEAL_COLS, rows);
}
