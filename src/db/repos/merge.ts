/**
 * Duplicate merge, for contacts and companies.
 *
 *   survivor <--- everything the loser owned (activities, tasks, deals, tags,
 *                 custom values, attachments, and a contact's phones/emails)
 *   loser    ---> soft-deleted, kept for 30 days
 *
 * Every row the merge moves is recorded in change_log under one batch_id, so
 * a reversal can put each one back exactly where it came from. The survivor's
 * own field values are NOT restored on reversal: they are whatever they are
 * now, which is what docs/PLAN.md item 15 asks for.
 *
 * Reversal is refused, with a reason, when the survivor has been merged again
 * since, when the merge has already been reversed, or when it is older than
 * the 30-day window.
 */
import { raw } from "@/db/client";
import { withTransaction } from "@/db/writeLock";
import { logChange } from "@/db/changeLog";
import { MergeReversalRefusedError, NotFoundError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
import { newBatchId, newId } from "@/lib/ids";
import { insertStatement, mapRows, selectList, type Col } from "@/db/repos/_base";
import { systemStatement } from "@/db/repos/activities";

export type MergeableType = "contact" | "company";

export const MERGE_REVERSAL_DAYS = 30;

export type MergeRecord = {
  id: string;
  entityType: MergeableType;
  survivorId: string;
  loserId: string;
  batchId: string;
  at: string;
  reversedAt: string | null;
};

const MERGE_COLS: readonly Col<MergeRecord>[] = [
  ["id", "m.id", "text"],
  ["entityType", "m.entity_type", "text"],
  ["survivorId", "m.survivor_id", "text"],
  ["loserId", "m.loser_id", "text"],
  ["batchId", "m.batch_id", "text"],
  ["at", "m.at", "text"],
  ["reversedAt", "m.reversed_at", "textNull"],
] as const;

/** Tables whose rows point at the merged entity, and the column that does. */
type Move = { table: string; column: string; typed: boolean };

function movesFor(entityType: MergeableType): Move[] {
  const common: Move[] = [
    { table: "tag_links", column: "entity_id", typed: true },
    { table: "custom_values", column: "entity_id", typed: false },
    { table: "attachments", column: "entity_id", typed: true },
  ];
  if (entityType === "contact") {
    return [
      { table: "contact_phones", column: "contact_id", typed: false },
      { table: "contact_emails", column: "contact_id", typed: false },
      { table: "activities", column: "contact_id", typed: false },
      { table: "tasks", column: "contact_id", typed: false },
      { table: "deals", column: "contact_id", typed: false },
      ...common,
    ];
  }
  return [
    { table: "contacts", column: "company_id", typed: false },
    { table: "activities", column: "company_id", typed: false },
    { table: "tasks", column: "company_id", typed: false },
    { table: "deals", column: "company_id", typed: false },
    ...common,
  ];
}

const TABLE_FOR: Record<MergeableType, string> = {
  contact: "contacts",
  company: "companies",
};

async function idsPointingAt(
  move: Move,
  entityType: MergeableType,
  entityId: string,
): Promise<string[]> {
  const rows = await raw.query(
    `SELECT x.id AS x_id FROM ${move.table} x WHERE x.${move.column} = ?${
      move.typed ? " AND x.entity_type = ?" : ""
    }`,
    move.typed ? [entityId, entityType] : [entityId],
  );
  return rows.map((r) => String(r[0]));
}

async function label(
  entityType: MergeableType,
  entityId: string,
): Promise<string> {
  const rows =
    entityType === "contact"
      ? await raw.query(
          `SELECT trim(c.first_name || ' ' || c.last_name) AS c_label FROM contacts c WHERE c.id = ?`,
          [entityId],
        )
      : await raw.query(
          `SELECT co.name AS co_label FROM companies co WHERE co.id = ?`,
          [entityId],
        );
  if (rows.length === 0) throw new NotFoundError(entityType, entityId);
  const text = String(rows[0][0] ?? "").trim();
  return text.length > 0 ? text : "(no name)";
}

export type MergeResult = {
  mergeId: string;
  batchId: string;
  movedCounts: Record<string, number>;
};

/**
 * Merge `loserId` into `survivorId`.
 *
 * `fieldPicks` is whatever the merge screen chose to keep on the survivor,
 * as column-name/value pairs on the survivor's own table; anything omitted
 * keeps the survivor's current value.
 */
export async function merge(
  entityType: MergeableType,
  survivorId: string,
  loserId: string,
  fieldPicks: Record<string, string | number | null> = {},
): Promise<MergeResult> {
  if (survivorId === loserId) {
    throw new MergeReversalRefusedError(
      survivorId,
      "A record cannot be merged into itself.",
    );
  }

  const table = TABLE_FOR[entityType];
  const survivorLabel = await label(entityType, survivorId);
  const loserLabel = await label(entityType, loserId);

  return withTransaction(async () => {
    const at = nowIso();
    const batchId = newBatchId();
    const mergeId = newId();
    const movedCounts: Record<string, number> = {};
    const statements: { sql: string; params: unknown[] }[] = [];
    const moves = movesFor(entityType);

    // Capture the ids BEFORE anything moves: rows that already belonged to the
    // survivor must never be handed to the loser by a later reversal.
    const movedIds = new Map<string, string[]>();
    for (const move of moves) {
      const ids = await idsPointingAt(move, entityType, loserId);
      movedIds.set(move.table, ids);
      movedCounts[move.table] = ids.length;
      if (ids.length === 0) continue;
      statements.push({
        sql: `UPDATE ${move.table} SET ${move.column} = ?, updated_at = ?
              WHERE id IN (${ids.map(() => "?").join(", ")})`,
        params: [survivorId, at, ...ids],
      });
    }

    const pickKeys = Object.keys(fieldPicks);
    if (pickKeys.length > 0) {
      statements.push({
        sql: `UPDATE ${table} SET ${pickKeys
          .map((k) => `${k} = ?`)
          .join(", ")}, updated_at = ? WHERE id = ?`,
        params: [...pickKeys.map((k) => fieldPicks[k]), at, survivorId],
      });
    }

    statements.push({
      sql: `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      params: [at, at, loserId],
    });

    const sys = systemStatement({
      body: `Merged "${loserLabel}" into "${survivorLabel}".`,
      contactId: entityType === "contact" ? survivorId : null,
      companyId: entityType === "company" ? survivorId : null,
      occurredAt: at,
    });
    statements.push({ sql: sys.sql, params: sys.params });

    statements.push(
      insertStatement("merges", {
        id: mergeId,
        createdAt: at,
        updatedAt: at,
        entityType,
        survivorId,
        loserId,
        batchId,
        at,
        reversedAt: null,
        deletedAt: null,
      }),
    );

    await raw.batch(statements);

    // One change_log row per table, carrying the ids that moved, so the
    // reversal can re-point exactly those rows and nothing else.
    for (const move of moves) {
      const ids = movedIds.get(move.table) ?? [];
      if (ids.length === 0) continue;
      await logChange({
        entityType,
        entityId: survivorId,
        op: "merge",
        before: { table: move.table, column: move.column, owner: loserId },
        after: {
          table: move.table,
          column: move.column,
          owner: survivorId,
          ids,
        },
        batchId,
      });
    }

    await logChange({
      entityType,
      entityId: loserId,
      op: "merge",
      before: { deletedAt: null },
      after: { deletedAt: at, mergedInto: survivorId, mergeId },
      batchId,
    });

    return { mergeId, batchId, movedCounts };
  }, "Merging records");
}

export async function get(mergeId: string): Promise<MergeRecord | null> {
  const rows = await raw.query(
    `SELECT ${selectList(MERGE_COLS, "m")} FROM merges m WHERE m.id = ?`,
    [mergeId],
  );
  return rows.length > 0 ? mapRows(MERGE_COLS, rows)[0] : null;
}

export async function list(limit = 100): Promise<MergeRecord[]> {
  const rows = await raw.query(
    `SELECT ${selectList(MERGE_COLS, "m")} FROM merges m ORDER BY m.at DESC LIMIT ?`,
    [limit],
  );
  return mapRows(MERGE_COLS, rows);
}

/** Why a reversal would be refused, or null when it is allowed. */
export async function reversalRefusal(
  mergeId: string,
  now: string = nowIso(),
): Promise<string | null> {
  const record = await get(mergeId);
  if (!record) return "That merge is no longer in the history.";
  if (record.reversedAt) return "That merge has already been reversed.";

  const ageDays =
    (new Date(now).getTime() - new Date(record.at).getTime()) / 86_400_000;
  if (ageDays > MERGE_REVERSAL_DAYS) {
    return `Merges can only be reversed for ${MERGE_REVERSAL_DAYS} days.`;
  }

  // Two merges a millisecond apart share an `at`, so ties break on the id:
  // merge ids are UUID v7, which sort in creation order.
  const later = await raw.query(
    `SELECT m.id AS m_id FROM merges m
     WHERE m.reversed_at IS NULL
       AND (m.at > ? OR (m.at = ? AND m.id > ?))
       AND (m.survivor_id = ? OR m.loser_id = ?)`,
    [record.at, record.at, mergeId, record.survivorId, record.survivorId],
  );
  if (later.length > 0) {
    return "This one cannot be undone: the surviving record has been merged again since.";
  }
  return null;
}

/**
 * Put a merge back: restore the loser and re-point every row this merge
 * moved. The survivor keeps its current field values.
 */
export async function reverse(
  mergeId: string,
  options: { now?: string } = {},
): Promise<void> {
  const now = options.now ?? nowIso();
  const refusal = await reversalRefusal(mergeId, now);
  if (refusal) throw new MergeReversalRefusedError(mergeId, refusal);

  const record = await get(mergeId);
  if (!record) throw new NotFoundError("merge", mergeId);

  const moved = await raw.query(
    `SELECT cl.after_json AS cl_after_json FROM change_log cl
     WHERE cl.batch_id = ? AND cl.op = 'merge' AND cl.after_json IS NOT NULL`,
    [record.batchId],
  );

  await withTransaction(async () => {
    const at = nowIso();
    const statements: { sql: string; params: unknown[] }[] = [];

    for (const row of moved) {
      const parsed: unknown = JSON.parse(String(row[0]));
      if (typeof parsed !== "object" || parsed === null) continue;
      const payload = parsed as {
        table?: string;
        column?: string;
        ids?: unknown;
      };
      if (!payload.table || !payload.column || !Array.isArray(payload.ids)) {
        continue;
      }
      const ids = payload.ids.filter(
        (value): value is string => typeof value === "string",
      );
      if (ids.length === 0) continue;
      statements.push({
        sql: `UPDATE ${payload.table} SET ${payload.column} = ?, updated_at = ?
              WHERE id IN (${ids.map(() => "?").join(", ")})`,
        params: [record.loserId, at, ...ids],
      });
    }

    statements.push({
      sql: `UPDATE ${TABLE_FOR[record.entityType]} SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
      params: [at, record.loserId],
    });
    statements.push({
      sql: `UPDATE merges SET reversed_at = ?, updated_at = ? WHERE id = ?`,
      params: [at, at, mergeId],
    });

    const survivorLabel = await label(record.entityType, record.survivorId);
    const sys = systemStatement({
      body: `Reversed the merge with "${survivorLabel}".`,
      contactId: record.entityType === "contact" ? record.loserId : null,
      companyId: record.entityType === "company" ? record.loserId : null,
      occurredAt: at,
    });
    statements.push({ sql: sys.sql, params: sys.params });

    await raw.batch(statements);

    await logChange({
      entityType: record.entityType,
      entityId: record.loserId,
      op: "restore",
      after: { reversedMergeId: mergeId },
      batchId: record.batchId,
    });
  }, "Reversing a merge");
}
