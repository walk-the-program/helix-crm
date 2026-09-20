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

const MAX_DISPLAY_NAME_LEN = 255;

/**
 * True for a NUL byte or a bidi override/embedding character (the code
 * points U+200E, U+200F, U+202A-U+202E and U+2066-U+2069): none has a
 * legitimate reason to be in a file name, and a right-to-left override is
 * exactly the trick that disguises "evil.exe" as something safer-looking in
 * a rendered list. Written as numeric code-point comparisons, never as a
 * regex literal holding the characters themselves, so no invisible
 * character has to sit in this source file.
 */
function isDisguiseCodePoint(codePoint: number): boolean {
  if (codePoint === 0x0000) return true;
  if (codePoint === 0x200e || codePoint === 0x200f) return true;
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  return false;
}

/**
 * Sanitises the attachment's DISPLAY name only (LR-SEC-W1 item 8).
 * `storedName` is what ever touches disk or the OS opener - chosen in Rust
 * from a fresh UUID with a sanitised extension (docs/CONTRACTS.md, `copy_in`)
 * - so this is purely about what the file list and the "Removed <name>"
 * toast show. Nothing upstream of `create` sanitised whatever the OS file
 * dialog (or, in future, an import or a rename) handed back:
 *
 *   - a NUL byte and a bidi override/embedding character are stripped, one
 *     code point at a time via `isDisguiseCodePoint` (`Array.from` splits by
 *     code point, not UTF-16 code unit, so a 4-byte emoji elsewhere in the
 *     name is never split in half);
 *   - a path separator is replaced, so the display string can never look
 *     like a path (defence in depth: no real filesystem lets a single path
 *     component contain one, so this only matters if some future caller
 *     other than the file picker feeds this a name it did not validate
 *     itself);
 *   - length is capped so one absurd name cannot bloat the database or the
 *     list's layout.
 *
 * A Windows-reserved device name (`CON`, `PRN.txt`, ...) is left alone on
 * purpose: `fileName` is never used as a real path component - only
 * `storedName` is - so displaying one is cosmetically odd at worst, and
 * "fixing" it would just be showing the owner a different string than what
 * their file is actually named.
 */
export function sanitizeDisplayName(name: string): string {
  const cleaned = Array.from(name)
    .filter((ch) => !isDisguiseCodePoint(ch.codePointAt(0) ?? 0))
    .join("")
    .replace(/[/\\]/g, "_")
    .trim();
  const safe = cleaned.length > 0 ? cleaned : "file";
  const chars = Array.from(safe);
  return chars.length > MAX_DISPLAY_NAME_LEN
    ? chars.slice(0, MAX_DISPLAY_NAME_LEN).join("")
    : safe;
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
      fileName: sanitizeDisplayName(trimmed(parsed.fileName)),
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
