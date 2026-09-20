/**
 * Stages: editable, reorderable, colour-coded, with per-stage quiet_days.
 *
 * Deleting a stage that still holds deals is refused with StageInUseError;
 * the caller must pass a target stage, and then the move is one transaction:
 * every deal moves, every move writes a deal_stage_event, and only then is the
 * stage soft-deleted.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite, withTransaction } from "@/db/writeLock";
import { NotFoundError, StageInUseError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import {
  insertStatement,
  logWrite,
  mapRows,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  updateStatement,
  parseOrThrow,
  type Col,
} from "@/db/repos/_base";

export type Stage = {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  color: string;
  quietDays: number;
  isWon: boolean;
  isLost: boolean;
  /** The per-stage follow-up rule (LR-PX-C). Null means no rule. */
  followUpDays: number | null;
  followUpTitle: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newStageSchema = z.object({
  pipelineId: z.string().min(1),
  name: z.string().min(1, "A stage needs a name."),
  position: z.number().optional(),
  color: z.string().default("var(--stage-1)"),
  quietDays: z.number().int().min(0).default(14),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  followUpDays: z.number().int().min(1).max(365).nullable().optional(),
  followUpTitle: z.string().nullable().optional(),
});

export type NewStage = z.input<typeof newStageSchema>;

const STAGE_COLS: readonly Col<Stage>[] = [
  ["id", "s.id", "text"],
  ["pipelineId", "s.pipeline_id", "text"],
  ["name", "s.name", "text"],
  ["position", "s.position", "int"],
  ["color", "s.color", "text"],
  ["quietDays", "s.quiet_days", "int"],
  ["isWon", "s.is_won", "bool"],
  ["isLost", "s.is_lost", "bool"],
  ["followUpDays", "s.follow_up_days", "intNull"],
  ["followUpTitle", "s.follow_up_title", "textNull"],
  ["createdAt", "s.created_at", "text"],
  ["updatedAt", "s.updated_at", "text"],
  ["deletedAt", "s.deleted_at", "textNull"],
] as const;

export async function get(id: string): Promise<Stage | null> {
  const rows = await raw.query(
    `SELECT ${selectList(STAGE_COLS, "s")} FROM stages s WHERE s.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(STAGE_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Stage> {
  const found = await get(id);
  if (!found) throw new NotFoundError("stage", id);
  return found;
}

export async function list(pipelineId?: string): Promise<Stage[]> {
  const rows = await raw.query(
    `SELECT ${selectList(STAGE_COLS, "s")} FROM stages s
     WHERE s.deleted_at IS NULL ${pipelineId ? "AND s.pipeline_id = ?" : ""}
     ORDER BY s.position ASC, s.created_at ASC`,
    pipelineId ? [pipelineId] : [],
  );
  return mapRows(STAGE_COLS, rows);
}

/** The stage a new deal lands in when nothing else is chosen. */
export async function firstStage(pipelineId: string): Promise<Stage | null> {
  const all = await list(pipelineId);
  return all[0] ?? null;
}

/** Open deals and their total value per stage, for the board header. */
export async function summary(pipelineId: string): Promise<
  { stageId: string; dealCount: number; valueCents: number }[]
> {
  const rows = await raw.query(
    `SELECT s.id AS s_id,
            count(d.id) AS deal_count,
            coalesce(sum(d.value_cents), 0) AS value_cents
     FROM stages s
     LEFT JOIN deals d ON d.stage_id = s.id AND d.deleted_at IS NULL
     WHERE s.deleted_at IS NULL AND s.pipeline_id = ?
     GROUP BY s.id
     ORDER BY s.position ASC`,
    [pipelineId],
  );
  return rows.map((r) => ({
    stageId: String(r[0]),
    dealCount: Number(r[1]),
    valueCents: Number(r[2]),
  }));
}

export async function dealCount(stageId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT count(*) AS deal_count FROM deals d WHERE d.stage_id = ? AND d.deleted_at IS NULL`,
    [stageId],
  );
  return rows.length > 0 ? Number(rows[0][0]) : 0;
}

export async function create(
  input: NewStage,
  options: { batchId?: string } = {},
): Promise<Stage> {
  const parsed = parseOrThrow(newStageSchema, input);
  return withWrite(async () => {
    const siblings = await list(parsed.pipelineId);
    const stamps = stampNew();
    const row = {
      ...stamps,
      pipelineId: parsed.pipelineId,
      name: trimmed(parsed.name),
      position: parsed.position ?? siblings.length,
      color: parsed.color,
      quietDays: parsed.quietDays,
      isWon: parsed.isWon,
      isLost: parsed.isLost,
      followUpDays: parsed.followUpDays ?? null,
      followUpTitle: parsed.followUpTitle ?? null,
      deletedAt: null,
    };
    const stmt = insertStatement("stages", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("stage", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a stage");
}

export type StagePatch = Partial<
  Pick<
    NewStage,
    | "name"
    | "color"
    | "quietDays"
    | "isWon"
    | "isLost"
    | "position"
    | "followUpDays"
    | "followUpTitle"
  >
>;

export async function update(
  id: string,
  patch: StagePatch,
  options: { batchId?: string } = {},
): Promise<Stage> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.color !== undefined) values.color = patch.color;
    if (patch.quietDays !== undefined) values.quietDays = patch.quietDays;
    if (patch.isWon !== undefined) values.isWon = patch.isWon;
    if (patch.isLost !== undefined) values.isLost = patch.isLost;
    if (patch.position !== undefined) values.position = patch.position;
    if (patch.followUpDays !== undefined) values.followUpDays = patch.followUpDays;
    if (patch.followUpTitle !== undefined) values.followUpTitle = patch.followUpTitle;
    const stmt = updateStatement("stages", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("stage", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a stage");
}

/** Rewrite positions to 0..n-1 in the given order, in one batch. */
export async function reorder(
  orderedIds: string[],
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const at = nowIso();
    await raw.batch(
      orderedIds.map((id, index) => ({
        sql: `UPDATE stages SET position = ?, updated_at = ? WHERE id = ?`,
        params: [index, at, id],
      })),
    );
    await logWrite(
      "stage",
      orderedIds[0] ?? "",
      "update",
      null,
      { order: orderedIds },
      options.batchId,
    );
  }, "Reordering stages");
}

/**
 * Delete a stage. When deals are still in it, `moveToStageId` is required:
 * without it this throws StageInUseError and nothing changes.
 */
export async function remove(
  id: string,
  moveToStageId?: string,
  options: { batchId?: string } = {},
): Promise<void> {
  const count = await dealCount(id);
  if (count > 0 && !moveToStageId) {
    throw new StageInUseError(id, count);
  }
  if (count > 0 && moveToStageId === id) {
    throw new StageInUseError(id, count);
  }

  await withTransaction(async () => {
    if (count > 0 && moveToStageId) {
      const target = await getOrThrow(moveToStageId);
      const source = await getOrThrow(id);
      if (target.pipelineId !== source.pipelineId) {
        throw new StageInUseError(id, count);
      }
      const at = nowIso();
      const rows = await raw.query(
        `SELECT d.id AS d_id FROM deals d WHERE d.stage_id = ? AND d.deleted_at IS NULL`,
        [id],
      );
      const statements = rows.flatMap((r) => {
        const dealId = String(r[0]);
        return [
          {
            sql: `UPDATE deals SET stage_id = ?, stage_entered_at = ?, updated_at = ? WHERE id = ?`,
            params: [moveToStageId, at, at, dealId],
          },
          insertStatement("deal_stage_events", {
            id: newId(),
            createdAt: at,
            updatedAt: at,
            dealId,
            fromStageId: id,
            toStageId: moveToStageId,
            at,
          }),
        ];
      });
      if (statements.length > 0) await raw.batch(statements);
    }
    await softDeleteRow("stages", "stage", id, options.batchId);
  }, "Deleting a stage");
}

/**
 * Empty stages the "Remove empty stages" sweep is allowed to touch: no deals,
 * and not won or not lost. A won/lost stage is a property the money model and
 * `reopen` depend on existing, so an empty one is never a cleanup candidate -
 * only a person deleting it by hand (with a target for the deals, if any)
 * gets to make that call.
 *
 * If literally every stage in the pipeline qualifies (no won/lost stage
 * exists and nothing holds a deal), the first one in position order is kept
 * so the sweep can never leave the pipeline with zero stages.
 */
export async function emptyRemovableCandidates(pipelineId: string): Promise<Stage[]> {
  const all = await list(pipelineId);
  const counts = await summary(pipelineId);
  const dealCountById = new Map(counts.map((c) => [c.stageId, c.dealCount]));
  const candidates = all.filter(
    (stage) =>
      !stage.isWon && !stage.isLost && (dealCountById.get(stage.id) ?? 0) === 0,
  );
  if (candidates.length > 0 && candidates.length === all.length) {
    return candidates.slice(1);
  }
  return candidates;
}

/**
 * Delete every stage `emptyRemovableCandidates` names. Each is already empty,
 * so `remove` needs no target stage for any of them. Returns what it removed,
 * for the confirm dialog to name.
 */
export async function removeEmpty(
  pipelineId: string,
  options: { batchId?: string } = {},
): Promise<Stage[]> {
  const candidates = await emptyRemovableCandidates(pipelineId);
  for (const stage of candidates) {
    await remove(stage.id, undefined, options);
  }
  return candidates;
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const at = nowIso();
    await raw.execute(
      `UPDATE stages SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
      [at, id],
    );
    await logWrite("stage", id, "restore", null, null, options.batchId);
  }, "Restoring a stage");
}
