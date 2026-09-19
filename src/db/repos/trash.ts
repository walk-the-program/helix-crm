/**
 * Trash: everything soft-deleted, per type, with restore and purge.
 *
 * Purge order (docs/PLAN.md item 18): attachment FILES first - the caller
 * deletes those on disk, because JS never touches the filesystem here - then
 * custom_values, tag_links, attachment rows, and finally the row itself.
 * Foreign keys carry the rest: contact_phones, contact_emails and
 * deal_stage_events cascade; optional references null out. change_log rows
 * are kept.
 */
import { raw } from "@/db/client";
import { withTransaction, withWrite } from "@/db/writeLock";
import { logChange } from "@/db/changeLog";
import { nowIso, todayLocal } from "@/lib/dates";

export type TrashEntityType =
  | "contact"
  | "company"
  | "deal"
  | "activity"
  | "task"
  | "tag"
  | "saved_view"
  | "attachment";

const TABLES: Record<TrashEntityType, string> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
  activity: "activities",
  task: "tasks",
  tag: "tags",
  saved_view: "saved_views",
  attachment: "attachments",
};

/** How the row is labelled in the trash list, per type. */
const LABELS: Record<TrashEntityType, string> = {
  contact: "trim(first_name || ' ' || last_name)",
  company: "name",
  deal: "title",
  activity: "substr(body, 1, 80)",
  task: "title",
  tag: "name",
  saved_view: "name",
  attachment: "file_name",
};

export type TrashItem = {
  entityType: TrashEntityType;
  entityId: string;
  label: string;
  deletedAt: string;
};

export const PURGE_AFTER_DAYS = 30;

export async function list(
  entityType: TrashEntityType,
  limit = 200,
): Promise<TrashItem[]> {
  const table = TABLES[entityType];
  const rows = await raw.query(
    `SELECT x.id AS x_id, ${LABELS[entityType]} AS x_label, x.deleted_at AS x_deleted_at
     FROM ${table} x WHERE x.deleted_at IS NOT NULL
     ORDER BY x.deleted_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    entityType,
    entityId: String(r[0]),
    label: String(r[1] ?? "").trim() || "(untitled)",
    deletedAt: String(r[2]),
  }));
}

export async function listAll(limitPerType = 50): Promise<TrashItem[]> {
  const types = Object.keys(TABLES) as TrashEntityType[];
  const all = await Promise.all(types.map((t) => list(t, limitPerType)));
  return all.flat().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function counts(): Promise<Record<TrashEntityType, number>> {
  const types = Object.keys(TABLES) as TrashEntityType[];
  const out = {} as Record<TrashEntityType, number>;
  for (const type of types) {
    const rows = await raw.query(
      `SELECT count(*) AS row_count FROM ${TABLES[type]} WHERE deleted_at IS NOT NULL`,
    );
    out[type] = rows.length > 0 ? Number(rows[0][0]) : 0;
  }
  return out;
}

export async function restore(
  entityType: TrashEntityType,
  entityId: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const at = nowIso();
    await raw.execute(
      `UPDATE ${TABLES[entityType]} SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
      [at, entityId],
    );
    await logChange({
      entityType,
      entityId,
      op: "restore",
      batchId: options.batchId,
    });
  }, "Restoring from the trash");
}

/**
 * The stored file names an attachment purge must remove from disk first. The
 * caller (the data feature, through a Rust command) deletes them, then calls
 * purge().
 */
export async function attachmentFilesFor(
  entityType: TrashEntityType,
  entityId: string,
): Promise<{ id: string; storedName: string }[]> {
  const rows = await raw.query(
    `SELECT a.id AS a_id, a.stored_name AS a_stored_name FROM attachments a
     WHERE a.entity_type = ? AND a.entity_id = ?`,
    [entityType, entityId],
  );
  return rows.map((r) => ({ id: String(r[0]), storedName: String(r[1]) }));
}

/**
 * Hard delete, in the documented order, as one transaction.
 * Attachment files on disk are the caller's job and must be gone first.
 */
export async function purge(
  entityType: TrashEntityType,
  entityId: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withTransaction(async () => {
    await raw.batch([
      { sql: `DELETE FROM custom_values WHERE entity_id = ?`, params: [entityId] },
      {
        sql: `DELETE FROM tag_links WHERE entity_type = ? AND entity_id = ?`,
        params: [entityType, entityId],
      },
      {
        sql: `DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?`,
        params: [entityType, entityId],
      },
      { sql: `DELETE FROM ${TABLES[entityType]} WHERE id = ?`, params: [entityId] },
    ]);
    await logChange({
      entityType,
      entityId,
      op: "delete",
      after: { purged: true },
      batchId: options.batchId,
    });
  }, "Emptying the trash");
}

/** Everything soft-deleted longer ago than the retention window. */
export async function expired(
  olderThanDays = PURGE_AFTER_DAYS,
  today: string = todayLocal(),
): Promise<TrashItem[]> {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - olderThanDays);
  const cutoffIso = cutoff.toISOString();
  const types = Object.keys(TABLES) as TrashEntityType[];
  const out: TrashItem[] = [];
  for (const type of types) {
    const rows = await raw.query(
      `SELECT x.id AS x_id, ${LABELS[type]} AS x_label, x.deleted_at AS x_deleted_at
       FROM ${TABLES[type]} x WHERE x.deleted_at IS NOT NULL AND x.deleted_at < ?`,
      [cutoffIso],
    );
    for (const r of rows) {
      out.push({
        entityType: type,
        entityId: String(r[0]),
        label: String(r[1] ?? "").trim() || "(untitled)",
        deletedAt: String(r[2]),
      });
    }
  }
  return out;
}
