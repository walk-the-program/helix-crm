/**
 * change_log: the undo trail, and the seam a future sync layer plugs into.
 *
 * Every repository write appends one row here with actor_id "owner" (v1 has a
 * single actor; team mode is additive). Rows are never deleted, not even when
 * the entity is purged, so an undo can always describe what happened.
 */
import { raw } from "@/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";

export type ChangeOp = "create" | "update" | "delete" | "restore" | "merge";

export type ChangeEntry = {
  entityType: string;
  entityId: string;
  op: ChangeOp;
  before?: unknown;
  after?: unknown;
  batchId?: string;
  actorId?: string;
};

export const ACTOR_OWNER = "owner";

function json(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/** The INSERT for one change row, so callers can fold it into their batch. */
export function changeLogStatement(entry: ChangeEntry): {
  sql: string;
  params: unknown[];
} {
  return {
    sql: `INSERT INTO change_log (id, at, actor_id, entity_type, entity_id, op, before_json, after_json, batch_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      newId(),
      nowIso(),
      entry.actorId ?? ACTOR_OWNER,
      entry.entityType,
      entry.entityId,
      entry.op,
      json(entry.before),
      json(entry.after),
      entry.batchId ?? null,
    ],
  };
}

/** Append one change row. Callers are already inside withWrite. */
export async function logChange(entry: ChangeEntry): Promise<void> {
  const stmt = changeLogStatement(entry);
  await raw.execute(stmt.sql, stmt.params);
}

/** Append several change rows in one round trip. */
export async function logChanges(entries: ChangeEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await raw.batch(entries.map(changeLogStatement));
}

export type ChangeLogEntry = {
  id: string;
  at: string;
  actorId: string;
  entityType: string;
  entityId: string;
  op: ChangeOp;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  batchId: string | null;
};

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toEntry(row: unknown[]): ChangeLogEntry {
  return {
    id: String(row[0]),
    at: String(row[1]),
    actorId: String(row[2]),
    entityType: String(row[3]),
    entityId: String(row[4]),
    op: String(row[5]) as ChangeOp,
    before: parseJson(row[6]),
    after: parseJson(row[7]),
    batchId: row[8] === null ? null : String(row[8]),
  };
}

const SELECT_COLUMNS = `cl.id AS cl_id, cl.at AS cl_at, cl.actor_id AS cl_actor_id,
       cl.entity_type AS cl_entity_type, cl.entity_id AS cl_entity_id, cl.op AS cl_op,
       cl.before_json AS cl_before_json, cl.after_json AS cl_after_json,
       cl.batch_id AS cl_batch_id`;

/** Every change row in a batch, oldest first. */
export async function listBatch(batchId: string): Promise<ChangeLogEntry[]> {
  const rows = await raw.query(
    `SELECT ${SELECT_COLUMNS} FROM change_log cl WHERE cl.batch_id = ? ORDER BY cl.at ASC, cl.id ASC`,
    [batchId],
  );
  return rows.map(toEntry);
}

/** The change history for one entity, newest first. */
export async function listForEntity(
  entityType: string,
  entityId: string,
  limit = 100,
): Promise<ChangeLogEntry[]> {
  const rows = await raw.query(
    `SELECT ${SELECT_COLUMNS} FROM change_log cl
     WHERE cl.entity_type = ? AND cl.entity_id = ?
     ORDER BY cl.at DESC, cl.id DESC LIMIT ?`,
    [entityType, entityId, limit],
  );
  return rows.map(toEntry);
}

const TABLE_FOR_ENTITY: Record<string, string> = {
  contact: "contacts",
  contact_phone: "contact_phones",
  contact_email: "contact_emails",
  company: "companies",
  pipeline: "pipelines",
  stage: "stages",
  deal: "deals",
  deal_stage_event: "deal_stage_events",
  activity: "activities",
  task: "tasks",
  tag: "tags",
  tag_link: "tag_links",
  custom_field: "custom_fields",
  custom_value: "custom_values",
  attachment: "attachments",
  source: "sources",
  saved_view: "saved_views",
};

/** The physical table behind an entity type, or null when there is none. */
export function tableFor(entityType: string): string | null {
  return TABLE_FOR_ENTITY[entityType] ?? null;
}

function columnName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function bindable(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Reverse every row change in a batch, newest first.
 *
 *   create -> delete the row        update -> write `before` back
 *   delete -> re-insert `before`    restore -> soft-delete again
 *   merge  -> handled by the merge repository, which knows how to re-point rows
 *
 * The undo itself is not logged: a batch is undone once, and re-logging would
 * make the trail ambiguous.
 */
export async function undoBatch(batchId: string): Promise<void> {
  const entries = await listBatch(batchId);
  const statements: { sql: string; params: unknown[] }[] = [];

  for (const entry of [...entries].reverse()) {
    const table = tableFor(entry.entityType);
    if (!table) continue;

    if (entry.op === "create") {
      statements.push({
        sql: `DELETE FROM ${table} WHERE id = ?`,
        params: [entry.entityId],
      });
      continue;
    }

    if (entry.op === "restore") {
      statements.push({
        sql: `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
        params: [nowIso(), nowIso(), entry.entityId],
      });
      continue;
    }

    const before = entry.before;
    if (!before) continue;

    if (entry.op === "delete") {
      const keys = Object.keys(before);
      if (keys.length === 0) continue;
      const cols = keys.map(columnName);
      statements.push({
        sql: `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols
          .map(() => "?")
          .join(", ")})`,
        params: keys.map((k) => bindable(before[k])),
      });
      continue;
    }

    if (entry.op === "update") {
      const keys = Object.keys(before).filter((k) => k !== "id");
      if (keys.length === 0) continue;
      statements.push({
        sql: `UPDATE ${table} SET ${keys
          .map((k) => `${columnName(k)} = ?`)
          .join(", ")} WHERE id = ?`,
        params: [...keys.map((k) => bindable(before[k])), entry.entityId],
      });
    }
  }

  if (statements.length > 0) {
    await raw.batch(statements);
  }
}
