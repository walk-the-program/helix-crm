/**
 * Bulk actions on a run of selected records: contacts and deals ticked on a
 * list, acted on together. Every operation here is ONE `withTransaction`, ONE
 * shared `batchId`, and writes its `change_log` rows through
 * `changeLogStatement` folded into the same `raw.batch` as the row it
 * describes — so `undoBatch(batchId)` reverses the whole run in one step, the
 * same way a single-record write's undo does.
 *
 * The write lock is NOT reentrant (`src/db/writeLock.ts`), so nothing here
 * calls another repository's `create`/`update`/`softDelete` — every write is
 * a hand-built statement against `raw`, exactly like `moveManyToStage` in
 * `deals.ts` does for the stage-move case this file deliberately does not
 * duplicate.
 *
 * Every id is checked against the live table before anything is written for
 * it. If one id in the run does not exist, the whole transaction throws and
 * rolls back — nothing already written for an earlier id in the same call
 * survives, because the throw propagates out of `withTransaction`'s callback
 * and its `catch` rolls back the real database transaction, not just the ids
 * that came after the bad one.
 */
import { raw } from "@/db/client";
import { withTransaction } from "@/db/writeLock";
import { changeLogStatement } from "@/db/changeLog";
import { NotFoundError } from "@/db/errors";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { insertStatement, updateStatement, stampNew, type Statement } from "@/db/repos/_base";

export type BulkResult = { batchId: string; count: number };

async function requireLive(table: string, entityType: string, id: string): Promise<void> {
  const rows = await raw.query(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (rows.length === 0) throw new NotFoundError(entityType, id);
}

function uniqueOf(ids: string[]): string[] {
  return [...new Set(ids)];
}

/* -------------------------------------------------------------------------- */
/* contacts                                                                   */
/* -------------------------------------------------------------------------- */

/** Adding a tag a contact already has is a no-op for that contact, not an error. */
export async function addTagToContacts(contactIds: string[], tagId: string): Promise<BulkResult> {
  const unique = uniqueOf(contactIds);
  const batchId = newId();
  if (unique.length === 0) return { batchId, count: 0 };

  return withTransaction(async () => {
    for (const contactId of unique) {
      await requireLive("contacts", "contact", contactId);

      const existing = await raw.query(
        `SELECT tl.id AS tl_id FROM tag_links tl
         WHERE tl.tag_id = ? AND tl.entity_type = 'contact' AND tl.entity_id = ? AND tl.deleted_at IS NULL
         LIMIT 1`,
        [tagId, contactId],
      );
      if (existing.length > 0) continue;

      const stamps = stampNew();
      const row = { ...stamps, tagId, entityType: "contact", entityId: contactId, deletedAt: null };
      await raw.batch([
        insertStatement("tag_links", row),
        changeLogStatement({ entityType: "tag_link", entityId: stamps.id, op: "create", after: row, batchId }),
      ]);
    }
    return { batchId, count: unique.length };
  }, "Tagging contacts");
}

/** Removing a tag a contact does not have is a no-op for that contact, not an error. */
export async function removeTagFromContacts(contactIds: string[], tagId: string): Promise<BulkResult> {
  const unique = uniqueOf(contactIds);
  const batchId = newId();
  if (unique.length === 0) return { batchId, count: 0 };

  return withTransaction(async () => {
    for (const contactId of unique) {
      await requireLive("contacts", "contact", contactId);

      /**
       * The WHOLE row, `id` included, because this is a hard delete.
       *
       * `changeLog.undoBatch` tells the two kinds of delete apart by whether
       * `before` carries an `id`: without one it treats the entry as a soft
       * delete and undoes it with an `UPDATE ... WHERE id = ?`, which matches
       * nothing once the row is actually gone - the undo then reports success
       * and silently restores no tag. With the full row it takes the
       * re-insert branch instead, which is the correct reversal here.
       *
       * `tags.setTags` logs the short form for the same hard delete and has
       * the same silent-undo hole; it is outside this round's ownership and
       * is reported rather than changed here.
       */
      const rows = await raw.query(
        `SELECT tl.id AS tl_id, tl.created_at AS tl_created_at, tl.updated_at AS tl_updated_at
         FROM tag_links tl
         WHERE tl.tag_id = ? AND tl.entity_type = 'contact' AND tl.entity_id = ?`,
        [tagId, contactId],
      );
      if (rows.length === 0) continue;

      const statements: Statement[] = [];
      for (const r of rows) {
        const linkId = String(r[0]);
        statements.push({ sql: `DELETE FROM tag_links WHERE id = ?`, params: [linkId] });
        statements.push(
          changeLogStatement({
            entityType: "tag_link",
            entityId: linkId,
            op: "delete",
            before: {
              id: linkId,
              tagId,
              entityType: "contact",
              entityId: contactId,
              createdAt: String(r[1]),
              updatedAt: String(r[2]),
              deletedAt: null,
            },
            batchId,
          }),
        );
      }
      await raw.batch(statements);
    }
    return { batchId, count: unique.length };
  }, "Untagging contacts");
}

export async function setContactsCompany(
  contactIds: string[],
  companyId: string | null,
): Promise<BulkResult> {
  const unique = uniqueOf(contactIds);
  const batchId = newId();
  if (unique.length === 0) return { batchId, count: 0 };

  return withTransaction(async () => {
    for (const contactId of unique) {
      await requireLive("contacts", "contact", contactId);

      const beforeRows = await raw.query(`SELECT company_id FROM contacts WHERE id = ?`, [contactId]);
      const beforeCompanyId =
        beforeRows.length > 0 && beforeRows[0][0] !== null ? String(beforeRows[0][0]) : null;

      const at = nowIso();
      await raw.batch([
        updateStatement("contacts", contactId, { companyId, updatedAt: at }),
        changeLogStatement({
          entityType: "contact",
          entityId: contactId,
          op: "update",
          before: { companyId: beforeCompanyId },
          after: { companyId },
          batchId,
        }),
      ]);
    }
    return { batchId, count: unique.length };
  }, "Setting company");
}

export async function trashContacts(contactIds: string[]): Promise<BulkResult> {
  const unique = uniqueOf(contactIds);
  const batchId = newId();
  if (unique.length === 0) return { batchId, count: 0 };

  return withTransaction(async () => {
    for (const contactId of unique) {
      await requireLive("contacts", "contact", contactId);

      const at = nowIso();
      await raw.batch([
        {
          sql: `UPDATE contacts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
          params: [at, at, contactId],
        },
        // A soft delete logs only the column it changed and no `id`, which is
        // what tells `undoBatch` to write it back rather than re-insert a row
        // that never left (docs/CONTRACTS.md, "Undo and soft delete").
        changeLogStatement({
          entityType: "contact",
          entityId: contactId,
          op: "delete",
          before: { deletedAt: null },
          after: { deletedAt: at },
          batchId,
        }),
      ]);
    }
    return { batchId, count: unique.length };
  }, "Moving contacts to trash");
}

/* -------------------------------------------------------------------------- */
/* deals                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * "Move to stage" is deliberately NOT here: it goes through
 * `deals.moveManyToStage`, so each stage's follow-up rule fires once per deal.
 */
export async function setDealsSource(
  dealIds: string[],
  sourceId: string | null,
): Promise<BulkResult> {
  const unique = uniqueOf(dealIds);
  const batchId = newId();
  if (unique.length === 0) return { batchId, count: 0 };

  return withTransaction(async () => {
    for (const dealId of unique) {
      await requireLive("deals", "deal", dealId);

      const beforeRows = await raw.query(`SELECT source_id FROM deals WHERE id = ?`, [dealId]);
      const beforeSourceId =
        beforeRows.length > 0 && beforeRows[0][0] !== null ? String(beforeRows[0][0]) : null;

      const at = nowIso();
      await raw.batch([
        updateStatement("deals", dealId, { sourceId, updatedAt: at }),
        changeLogStatement({
          entityType: "deal",
          entityId: dealId,
          op: "update",
          before: { sourceId: beforeSourceId },
          after: { sourceId },
          batchId,
        }),
      ]);
    }
    return { batchId, count: unique.length };
  }, "Setting source");
}

export async function trashDeals(dealIds: string[]): Promise<BulkResult> {
  const unique = uniqueOf(dealIds);
  const batchId = newId();
  if (unique.length === 0) return { batchId, count: 0 };

  return withTransaction(async () => {
    for (const dealId of unique) {
      await requireLive("deals", "deal", dealId);

      const at = nowIso();
      await raw.batch([
        {
          sql: `UPDATE deals SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
          params: [at, at, dealId],
        },
        changeLogStatement({
          entityType: "deal",
          entityId: dealId,
          op: "delete",
          before: { deletedAt: null },
          after: { deletedAt: at },
          batchId,
        }),
      ]);
    }
    return { batchId, count: unique.length };
  }, "Moving jobs to trash");
}
