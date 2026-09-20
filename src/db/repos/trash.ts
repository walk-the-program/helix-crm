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
import { ValidationError } from "@/db/errors";
import * as deals from "@/db/repos/deals";

export type TrashEntityType =
  | "contact"
  | "company"
  | "deal"
  | "activity"
  | "task"
  | "tag"
  | "saved_view"
  | "attachment"
  | "recurring_rule"
  | "template"
  | "product"
  | "custom_field"
  | "document";

const TABLES: Record<TrashEntityType, string> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
  activity: "activities",
  task: "tasks",
  tag: "tags",
  saved_view: "saved_views",
  attachment: "attachments",
  recurring_rule: "recurring_rules",
  template: "templates",
  product: "products",
  custom_field: "custom_fields",
  document: "documents",
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
  recurring_rule: "title",
  template: "name",
  product: "'Service ' || name",
  custom_field: "'Field ' || name",
  // "Invoice INV-2026-0004" or "Quote QUO-2026-0007", per documents.ts's `kind`.
  document: "CASE WHEN kind = 'invoice' THEN 'Invoice ' || number ELSE 'Quote ' || number END",
};

export type TrashItem = {
  entityType: TrashEntityType;
  entityId: string;
  label: string;
  deletedAt: string;
  /**
   * Set only on a "deal" row that a real (SENT or later) quote or invoice
   * still refers to: the blocking document's number, so the screen can say
   * "Kept: INV-2026-0004 refers to it" (ruling R6b). Undefined for every
   * other type, and for a deal that is not blocked. Optional so an existing
   * caller that builds a TrashItem by hand keeps compiling.
   */
  blockedBy?: string | null;
  /**
   * Set on a contact or company row that is in the Trash because it LOST a
   * merge, rather than because the owner deleted it. The two need different
   * offers: restoring a merged loser rebuilds an empty duplicate of a person
   * who already exists on the survivor, with none of their work, because the
   * merge moved all of it (CPO audit, scenario 7). Undefined for every other
   * type and for an ordinary deletion.
   */
  mergedInto?: MergedInto | null;
};

/** The survivor a merged-away record was folded into. */
export type MergedInto = { survivorId: string; survivorName: string };

/**
 * Whether this contact or company is in the Trash because it lost a merge,
 * and who it was folded into.
 *
 * `merges` is written by src/db/repos/merge.ts and read here rather than
 * there, because "why is this record deleted" is a Trash question and
 * merge.ts belongs to another lead. A REVERSED merge does not count: the
 * reversal already restored the loser, so the row is live again or was
 * deleted for some other reason since. The newest unreversed merge wins,
 * which is also the one whose survivor still holds the work.
 */
export async function mergedInto(
  entityType: "contact" | "company",
  entityId: string,
): Promise<MergedInto | null> {
  const name =
    entityType === "contact"
      ? `CASE WHEN trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) = ''
              THEN '(no name)'
              ELSE trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) END`
      : "s.name";
  const table = entityType === "contact" ? "contacts" : "companies";
  const rows = await raw.query(
    `SELECT m.survivor_id AS m_survivor_id, ${name} AS m_survivor_name
     FROM merges m JOIN ${table} s ON s.id = m.survivor_id
     WHERE m.entity_type = ? AND m.loser_id = ? AND m.reversed_at IS NULL
     ORDER BY m.at DESC, m.id DESC LIMIT 1`,
    [entityType, entityId],
  );
  if (rows.length === 0) return null;
  return { survivorId: String(rows[0][0]), survivorName: String(rows[0][1]) };
}

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
  const items: TrashItem[] = rows.map((r) => ({
    entityType,
    entityId: String(r[0]),
    label: String(r[1] ?? "").trim() || "(untitled)",
    deletedAt: String(r[2]),
  }));
  if (entityType === "deal") {
    for (const item of items) {
      item.blockedBy = await deals.purgeBlockedBy(item.entityId);
    }
  }
  if (entityType === "contact" || entityType === "company") {
    for (const item of items) {
      item.mergedInto = await mergedInto(entityType, item.entityId);
    }
  }
  return items;
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
 * A quote or invoice's generated PDF, if it has one and it is still on disk
 * (SEC audit, launch round 2026-09-20). `documents.pdf_path` names wherever
 * the owner last saved that PDF through the save dialog in
 * `src/features/invoices/lib/pdfFile.ts` - by default the workspace's own
 * `documents/` folder, but the dialog lets the owner steer it anywhere else on
 * the machine.
 *
 * Read here rather than in the invoices feature so the purge sweep (which
 * this repository does not own the UI for) can ask a plain question without
 * crossing into `src/features/invoices`. Returns null for a document with no
 * saved PDF yet, and for anything that is not a "document" purge - the caller
 * decides whether the path is safe to remove; this function only reports what
 * the row says.
 */
export async function documentPdfPathFor(entityId: string): Promise<string | null> {
  const rows = await raw.query(
    `SELECT d.pdf_path AS d_pdf_path FROM documents d WHERE d.id = ?`,
    [entityId],
  );
  if (rows.length === 0) return null;
  const path = rows[0][0];
  return typeof path === "string" && path.length > 0 ? path : null;
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
  // A quote or invoice that left draft is a real piece of paper the owner
  // sent someone; purging its deal would silently cut it loose (ruling R6b).
  // `deals.purgeBlockedBy` is the one place that check lives - reused here,
  // not reimplemented. The 30-day sweep never reaches this: `expired()`
  // already leaves a blocked deal out of what it hands the sweep.
  if (entityType === "deal") {
    const blocker = await deals.purgeBlockedBy(entityId);
    if (blocker) {
      throw new ValidationError(
        `${blocker} refers to this one, so it stays until that document is void or deleted.`,
        [{ path: "id", message: `${blocker} refers to it.` }],
      );
    }
  }
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

/**
 * The instant a row must have been soft-deleted before to be past the
 * retention window, as an ISO string - pulled out of `expired()` (SEC audit,
 * launch round 2026-09-20) so the exact boundary (a row deleted 29 days ago
 * survives, one deleted 31 days ago does not, and the arithmetic around
 * exactly `olderThanDays` is not off by a day in either direction) is provable
 * in a plain unit test with no database at all.
 */
export function purgeCutoffIso(
  olderThanDays: number = PURGE_AFTER_DAYS,
  today: string = todayLocal(),
): string {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - olderThanDays);
  return cutoff.toISOString();
}

/**
 * Everything soft-deleted longer ago than the retention window - what the
 * nightly sweep is free to purge.
 *
 * A deal a real (SENT or later) document still refers to is genuinely
 * expired, but is left out here rather than handed to a sweep that would
 * call `purge()` on it and throw (ruling R6b): the sweep purges every other
 * expired row and never has to know this one exists. It still shows up in
 * `trash.list("deal")`, with `blockedBy` set, so the owner can see it.
 */
export async function expired(
  olderThanDays = PURGE_AFTER_DAYS,
  today: string = todayLocal(),
): Promise<TrashItem[]> {
  const cutoffIso = purgeCutoffIso(olderThanDays, today);
  const types = Object.keys(TABLES) as TrashEntityType[];
  const out: TrashItem[] = [];
  for (const type of types) {
    const rows = await raw.query(
      `SELECT x.id AS x_id, ${LABELS[type]} AS x_label, x.deleted_at AS x_deleted_at
       FROM ${TABLES[type]} x WHERE x.deleted_at IS NOT NULL AND x.deleted_at < ?`,
      [cutoffIso],
    );
    for (const r of rows) {
      const entityId = String(r[0]);
      if (type === "deal" && (await deals.purgeBlockedBy(entityId)) !== null) {
        continue;
      }
      out.push({
        entityType: type,
        entityId,
        label: String(r[1] ?? "").trim() || "(untitled)",
        deletedAt: String(r[2]),
      });
    }
  }
  return out;
}
