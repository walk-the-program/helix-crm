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
import { nowIso, formatDateDisplay } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { systemStatement } from "@/db/repos/activities";
import * as settingsRepo from "@/db/repos/settings";
import { vocabularyFor } from "@/lib/vocabulary";
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
  type Statement,
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
  /**
   * Set when the linked contact or company is in the Trash. The joins below
   * deliberately do NOT filter on it: dropping the name would leave "No
   * company" on a deal that plainly has one, which is worse than saying so.
   * A screen renders the name with "(in Trash)" beside it instead, so the
   * owner can tell a live customer from a deleted one at a glance
   * (CPO audit, F-LA-9).
   */
  contactDeletedAt: string | null;
  companyId: string | null;
  companyName: string | null;
  companyDeletedAt: string | null;
  sourceId: string | null;
  externalId: string | null;
  expectedOn: string | null;
  closedAt: string | null;
  outcomeReason: string | null;
  /**
   * The revenue breakdown (D20). `valueCents` above is the annual value -
   * upfront plus twelve months of recurring - and these four say which half is
   * which. They are derived columns: `dealItems.recompute` is the only thing
   * that writes them, in the same transaction as the line change that caused
   * them, so a deal whose lines and whose value disagree cannot exist.
   */
  oneTimeCents: number;
  recurringMonthlyCents: number;
  recurringStartedOn: string | null;
  recurringEndedOn: string | null;
  suggestedTotalCents: number;
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
  ["contactDeletedAt", "c.deleted_at", "textNull"],
  ["companyId", "d.company_id", "textNull"],
  ["companyName", "co.name", "textNull"],
  ["companyDeletedAt", "co.deleted_at", "textNull"],
  ["sourceId", "d.source_id", "textNull"],
  ["externalId", "d.external_id", "textNull"],
  ["expectedOn", "d.expected_on", "textNull"],
  ["closedAt", "d.closed_at", "textNull"],
  ["outcomeReason", "d.outcome_reason", "textNull"],
  // coalesce because the columns arrived on a table that already held rows:
  // a deal written before 0004_revenue has NULL where a 0 belongs.
  ["oneTimeCents", "coalesce(d.one_time_cents, 0)", "int"],
  ["recurringMonthlyCents", "coalesce(d.recurring_monthly_cents, 0)", "int"],
  ["recurringStartedOn", "d.recurring_started_on", "textNull"],
  ["recurringEndedOn", "d.recurring_ended_on", "textNull"],
  ["suggestedTotalCents", "coalesce(d.suggested_total_cents, 0)", "int"],
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

/**
 * Every open deal grouped by stage: one entry per live stage of the pipeline,
 * in stage position order, including the stages that hold nothing.
 *
 * Both of those are load-bearing. A board with an empty column still has to
 * draw the column - it is the drop target for the first deal that gets there -
 * and the column order is the pipeline, not whichever stage happened to hold
 * the first row. Before wave 3 this grouped `list()` into a Map, so callers
 * had to drive the columns from `stages.list()` themselves and look each group
 * up; they no longer have to.
 */
export async function board(
  pipelineId: string,
): Promise<{ stageId: string; deals: Deal[] }[]> {
  const stageRows = await raw.query(
    `SELECT s.id AS s_id FROM stages s
     WHERE s.pipeline_id = ? AND s.deleted_at IS NULL
     ORDER BY s.position ASC, s.created_at ASC`,
    [pipelineId],
  );

  const byStage = new Map<string, Deal[]>();
  for (const row of stageRows) byStage.set(String(row[0]), []);

  const { rows } = await list({ pipelineId }, { limit: 5000 });
  for (const deal of rows) {
    const bucket = byStage.get(deal.stageId);
    // A deal whose stage was deleted underneath it keeps its column rather
    // than vanishing from the board.
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

/**
 * The same write as `create`, as statements instead of a write.
 *
 * `contacts.createStatements` is the pattern and the reason: the write lock is
 * not reentrant, so anything that runs inside a `withTransaction` - the lead
 * poller applying a page, a CSV import - cannot call a repository write. It
 * needs the statements so it can fold them into its own batch. The caller owns
 * the change-log entry (`changeLogStatement`), which is why `row` comes back:
 * it is exactly what belongs in the entry's `after`.
 *
 * `position` is required here. `create()` can look the next one up because it
 * holds the lock; a caller inside a transaction already knows it, and a query
 * from in here would read through the same connection mid-batch.
 */
export function createStatements(input: {
  title: string;
  valueCents?: number;
  currency: string;
  stageId: string;
  position: number;
  contactId?: string | null;
  companyId?: string | null;
  sourceId?: string | null;
  externalId?: string | null;
  expectedOn?: string | null;
  /** Defaults to now; the stage-event row uses the same instant. */
  at?: string;
}): { id: string; row: Record<string, unknown>; statements: Statement[] } {
  const at = input.at ?? nowIso();
  const stamps = { id: newId(), createdAt: at, updatedAt: at };
  const row = {
    ...stamps,
    title: trimmed(input.title),
    valueCents: input.valueCents ?? 0,
    currency: input.currency,
    stageId: input.stageId,
    stageEnteredAt: at,
    position: input.position,
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    sourceId: input.sourceId ?? null,
    externalId: input.externalId ?? null,
    expectedOn: input.expectedOn ?? null,
    closedAt: null,
    outcomeReason: null,
    deletedAt: null,
  };
  return {
    id: stamps.id,
    row,
    statements: [
      insertStatement("deals", row),
      insertStatement("deal_stage_events", {
        id: newId(),
        createdAt: at,
        updatedAt: at,
        dealId: stamps.id,
        fromStageId: null,
        toStageId: input.stageId,
        at,
        deletedAt: null,
      }),
    ],
  };
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

/**
 * Edit a deal.
 *
 * When the customer changes, the deal's quotes and invoices follow it: a
 * document never stores a different customer from its deal (round 3, "Money
 * model"). That sync runs AFTER this write has committed, not inside it -
 * `documents.syncCustomerFromDeal` opens its own transaction and the write
 * lock is not reentrant - and it is imported lazily because documents.ts
 * already imports this module.
 */
export async function update(
  id: string,
  patch: DealPatch,
  options: { batchId?: string } = {},
): Promise<Deal> {
  const updated = await withWrite(async () => {
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
    const customerMoved =
      (patch.contactId !== undefined && (patch.contactId ?? null) !== before.contactId) ||
      (patch.companyId !== undefined && (patch.companyId ?? null) !== before.companyId);
    return { deal: await getOrThrow(id), customerMoved };
  }, "Saving a deal");

  if (updated.customerMoved) {
    const documents = await import("@/db/repos/documents");
    await documents.syncCustomerFromDeal(id);
  }
  return updated.deal;
}

type StageFlags = { pipelineId: string; name: string; isWon: boolean; isLost: boolean };

async function stageFlags(stageId: string): Promise<StageFlags> {
  const rows = await raw.query(
    `SELECT s.pipeline_id AS s_pipeline_id, s.name AS s_name,
            s.is_won AS s_is_won, s.is_lost AS s_is_lost
     FROM stages s WHERE s.id = ? AND s.deleted_at IS NULL`,
    [stageId],
  );
  if (rows.length === 0) throw new NotFoundError("stage", stageId);
  return {
    pipelineId: String(rows[0][0]),
    name: String(rows[0][1]),
    isWon: Number(rows[0][2]) !== 0,
    isLost: Number(rows[0][3]) !== 0,
  };
}

/**
 * Move a deal to a stage, optionally to a position inside it.
 *
 * Refuses a stage in another pipeline. Lost stages require a reason. Entering
 * a won or lost stage stamps closed_at; leaving one clears it (that is the
 * reopen path).
 *
 * `at` is the date the move is BACKDATED to (a confirm dialog's DatePicker,
 * defaulting to today): it lands on `deal_stage_events.at`, `stage_entered_at`
 * and, for a won/lost target, `closed_at` - the money model and gone-quiet
 * both read those columns, so a dated move has to mean it. Omitting it keeps
 * the old behaviour exactly (`nowIso()`), so every existing caller is
 * unaffected. `updated_at` always stays the real write time: it is
 * bookkeeping, not the business date.
 */
export async function moveToStage(
  id: string,
  toStageId: string,
  options: {
    toIndex?: number;
    outcomeReason?: string | null;
    at?: string;
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
      // The owner's own word for these. A workspace that calls them jobs
      // should not be told a "deal" needs anything (phase two, copy: the
      // vocabulary reaches every string the owner reads, including the ones a
      // repository writes).
      const word = vocabularyFor(await settingsRepo.get("vocabulary")).lower;
      throw new ValidationError(`Losing a ${word} needs a reason.`, [
        { path: "outcomeReason", message: "Say why it was lost." },
      ]);
    }

    const now = nowIso();
    const at = options.at ?? now;
    const changedStage = before.stageId !== toStageId;
    const closing = target.isWon || target.isLost;
    /**
     * Re-picking the stage a closed deal already sits in, with a date, is how
     * a wrong won or lost date is corrected.
     *
     * Before this, `closed_at` was `before.closedAt ?? at`, so the first close
     * won forever and the only way to fix a mistyped date was to reopen and
     * re-win - two stage events and two timeline lines for one correction
     * (CPO audit, F-LA-10; ruling R2). An explicitly passed `at` now wins.
     * Nothing else changes: no `deal_stage_events` row, because the deal did
     * not move, and the timeline says what actually happened.
     */
    const redatingClose =
      !changedStage && closing && options.at !== undefined && options.at !== before.closedAt;

    const values: Record<string, unknown> = {
      stageId: toStageId,
      updatedAt: now,
      closedAt: closing ? (redatingClose ? at : (before.closedAt ?? at)) : null,
    };
    if (changedStage || redatingClose) values.stageEnteredAt = at;
    // An open stage has no outcome, so leaving won or lost clears the reason:
    // that is the reopen path.
    values.outcomeReason = closing ? trimmedOrNull(effectiveReason) : null;

    const stmt = updateStatement("deals", id, values);
    await raw.execute(stmt.sql, stmt.params);

    if (changedStage) {
      const ev = insertStatement("deal_stage_events", {
        id: newId(),
        createdAt: now,
        updatedAt: now,
        dealId: id,
        fromStageId: before.stageId,
        toStageId,
        at,
      });
      await raw.execute(ev.sql, ev.params);

      // The dated, confirmed timeline entry (D24): "Moved to Won on Sep 19",
      // in the same transaction as the move it describes.
      const sys = systemStatement({
        dealId: id,
        body: `Moved to ${target.name} on ${formatDateDisplay(at)}`,
        occurredAt: at,
      });
      await raw.execute(sys.sql, sys.params);
    } else if (redatingClose) {
      const sys = systemStatement({
        dealId: id,
        body: `${target.isWon ? "Won" : "Lost"} date changed to ${formatDateDisplay(at)}`,
        occurredAt: at,
      });
      await raw.execute(sys.sql, sys.params);
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
  options: { outcomeReason?: string | null; at?: string; batchId?: string } = {},
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

/**
 * The document that stops this deal being purged, if there is one.
 *
 * A quote or an invoice that has left draft is a real piece of paper the owner
 * sent someone. `documents.deal_id` is ON DELETE SET NULL, so purging the deal
 * would silently cut the invoice loose from the job it was raised for and the
 * revenue report would never find its way back (Lead B's F-LB-3, ruling R6b).
 * Drafts and voids are not refused: nothing left the building.
 *
 * Returns the document's number, so the Trash row can say which one.
 */
export async function purgeBlockedBy(id: string): Promise<string | null> {
  const rows = await raw.query(
    `SELECT dc.number AS dc_number FROM documents dc
     WHERE dc.deal_id = ? AND dc.deleted_at IS NULL
       AND dc.status NOT IN ('draft', 'void')
     ORDER BY dc.number ASC LIMIT 1`,
    [id],
  );
  return rows.length > 0 ? String(rows[0][0]) : null;
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  const blocker = await purgeBlockedBy(id);
  if (blocker) {
    throw new ValidationError(
      `${blocker} refers to this one, so it stays until that document is void or deleted.`,
      [{ path: "id", message: `${blocker} refers to it.` }],
    );
  }
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

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/today/lib/todayData.ts.             */
/* -------------------------------------------------------------------------- */

/**
 * A deal created in the last N days that nobody has worked yet.
 *
 * "No activity yet" means no activity the *owner* created. System entries are
 * excluded deliberately: the website lead poller writes one ("Lead received",
 * carrying the original message) the instant a lead arrives, so counting
 * system rows would empty this section before the owner ever saw it. The point
 * of the section is "nobody has called these people".
 */
export type NewLead = {
  dealId: string;
  title: string;
  valueCents: number;
  currency: string;
  createdAt: string;
  stageId: string;
  stageName: string;
  sourceName: string | null;
  contactId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  companyId: string | null;
  companyName: string | null;
};

export async function newLeads(
  options: { sinceIso: string; limit?: number } = { sinceIso: "" },
): Promise<NewLead[]> {
  const limit = options.limit ?? 25;
  const rows = await raw.query(
    `SELECT d.id            AS d_id,
            d.title         AS d_title,
            d.value_cents   AS d_value_cents,
            d.currency      AS d_currency,
            d.created_at    AS d_created_at,
            d.stage_id      AS d_stage_id,
            s.name          AS s_name,
            src.name        AS src_name,
            d.contact_id    AS d_contact_id,
            c.first_name    AS c_first_name,
            c.last_name     AS c_last_name,
            (SELECT p.raw FROM contact_phones p
              WHERE p.contact_id = c.id
              ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1) AS c_phone,
            (SELECT e.email_lower FROM contact_emails e
              WHERE e.contact_id = c.id
              ORDER BY e.is_primary DESC, e.created_at ASC LIMIT 1) AS c_email,
            d.company_id    AS d_company_id,
            co.name         AS co_name
     FROM deals d
     JOIN stages s ON s.id = d.stage_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN sources src ON src.id = d.source_id
     WHERE d.deleted_at IS NULL
       AND s.is_won = 0 AND s.is_lost = 0
       AND d.created_at >= ?
       AND NOT EXISTS (
             SELECT 1 FROM activities a
             WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.is_system = 0)
     ORDER BY d.created_at DESC
     LIMIT ?`,
    [options.sinceIso, limit],
  );

  return rows.map((r) => ({
    dealId: String(r[0]),
    title: String(r[1]),
    valueCents: Number(r[2] ?? 0),
    currency: String(r[3] ?? "USD"),
    createdAt: String(r[4]),
    stageId: String(r[5]),
    stageName: String(r[6]),
    sourceName: r[7] === null || r[7] === undefined ? null : String(r[7]),
    contactId: r[8] === null || r[8] === undefined ? null : String(r[8]),
    contactFirstName: r[9] === null || r[9] === undefined ? null : String(r[9]),
    contactLastName: r[10] === null || r[10] === undefined ? null : String(r[10]),
    contactPhone: r[11] === null || r[11] === undefined ? null : String(r[11]),
    contactEmail: r[12] === null || r[12] === undefined ? null : String(r[12]),
    companyId: r[13] === null || r[13] === undefined ? null : String(r[13]),
    companyName: r[14] === null || r[14] === undefined ? null : String(r[14]),
  }));
}
