/**
 * Attachment rows only.
 *
 * The Rust command `copy_in(src)` copies the file into the workspace's
 * attachments directory and returns `{ storedName, bytes, mime }`; this
 * repository never touches the filesystem and never accepts a write path -
 * callers pass the already-copied file's metadata to `create`.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite, withTransaction } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { systemStatement } from "@/db/repos/activities";
import {
  insertStatement,
  logWrite,
  mapRows,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  parseOrThrow,
  type Col,
} from "@/db/repos/_base";

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export class AttachmentTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(
      `Attachments are limited to ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB; this file is ${bytes} bytes.`,
    );
    this.name = "AttachmentTooLargeError";
    this.bytes = bytes;
  }
}

export type Attachment = {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  storedName: string;
  bytes: number;
  mime: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newAttachmentSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  fileName: z.string().min(1),
  storedName: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
});

export type NewAttachment = z.input<typeof newAttachmentSchema>;

const ATTACHMENT_COLS: readonly Col<Attachment>[] = [
  ["id", "a.id", "text"],
  ["entityType", "a.entity_type", "text"],
  ["entityId", "a.entity_id", "text"],
  ["fileName", "a.file_name", "text"],
  ["storedName", "a.stored_name", "text"],
  ["bytes", "a.bytes", "int"],
  ["mime", "a.mime", "text"],
  ["createdAt", "a.created_at", "text"],
  ["updatedAt", "a.updated_at", "text"],
  ["deletedAt", "a.deleted_at", "textNull"],
] as const;

export async function get(id: string): Promise<Attachment | null> {
  const rows = await raw.query(
    `SELECT ${selectList(ATTACHMENT_COLS, "a")} FROM attachments a WHERE a.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(ATTACHMENT_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Attachment> {
  const found = await get(id);
  if (!found) throw new NotFoundError("attachment", id);
  return found;
}

/** Live attachments on one entity, newest first. */
export async function list(entityType: string, entityId: string): Promise<Attachment[]> {
  const rows = await raw.query(
    `SELECT ${selectList(ATTACHMENT_COLS, "a")} FROM attachments a
     WHERE a.entity_type = ? AND a.entity_id = ? AND a.deleted_at IS NULL
     ORDER BY a.created_at DESC`,
    [entityType, entityId],
  );
  return mapRows(ATTACHMENT_COLS, rows);
}

/**
 * Which record's timeline an attachment belongs on, or null when it hangs off
 * something with no timeline (a document, say).
 */
function timelineLinkFor(
  entityType: string,
  entityId: string,
): { contactId?: string; companyId?: string; dealId?: string } | null {
  if (entityType === "contact") return { contactId: entityId };
  if (entityType === "company") return { companyId: entityId };
  if (entityType === "deal") return { dealId: entityId };
  return null;
}

export async function create(
  input: NewAttachment,
  options: { batchId?: string } = {},
): Promise<Attachment> {
  const parsed = parseOrThrow(newAttachmentSchema, input);
  if (parsed.bytes > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError(parsed.bytes);
  }
  return withTransaction(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      entityType: trimmed(parsed.entityType),
      entityId: trimmed(parsed.entityId),
      fileName: trimmed(parsed.fileName),
      storedName: trimmed(parsed.storedName),
      bytes: parsed.bytes,
      mime: trimmed(parsed.mime),
      deletedAt: null,
    };
    const stmt = insertStatement("attachments", row);
    await raw.execute(stmt.sql, stmt.params);
    // Round 3, criterion 26: a file landing on a record is part of that
    // record's history, written in the same transaction as the file row.
    // Attachments hang off a polymorphic (entity_type, entity_id) pair, so
    // only the three types the timeline actually renders get an entry.
    const link = timelineLinkFor(row.entityType, row.entityId);
    if (link) {
      const entry = systemStatement({ body: `File added: ${row.fileName}`, ...link });
      await raw.execute(entry.sql, entry.params);
    }
    await logWrite("attachment", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving an attachment");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("attachments", "attachment", id, options.batchId),
    "Deleting an attachment",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("attachments", "attachment", id, options.batchId),
    "Restoring an attachment",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("attachments", "attachment", id, options.batchId),
    "Purging an attachment",
  );
}
