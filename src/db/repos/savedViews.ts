/**
 * Saved views: a named, ordered, optionally-pinned filter/sort recipe per
 * entity type. `queryJson` is opaque storage for whatever shape the screen
 * that owns `entityType` wants; this repository only serialises and
 * deserialises it, and `parseQuery` never throws on a corrupted row.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
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
  updateStatement,
  parseOrThrow,
  type Col,
} from "@/db/repos/_base";

export type SavedView = {
  id: string;
  entityType: string;
  name: string;
  queryJson: string;
  position: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newSavedViewSchema = z.object({
  entityType: z.string().min(1, "A saved view needs an entity type."),
  name: z.string().min(1, "A saved view needs a name."),
  query: z.unknown().optional(),
  position: z.number().optional(),
  pinned: z.boolean().optional(),
});

export type NewSavedView = z.input<typeof newSavedViewSchema>;

const SAVED_VIEW_COLS: readonly Col<SavedView>[] = [
  ["id", "sv.id", "text"],
  ["entityType", "sv.entity_type", "text"],
  ["name", "sv.name", "text"],
  ["queryJson", "sv.query_json", "text"],
  ["position", "sv.position", "int"],
  ["pinned", "sv.pinned", "bool"],
  ["createdAt", "sv.created_at", "text"],
  ["updatedAt", "sv.updated_at", "text"],
  ["deletedAt", "sv.deleted_at", "textNull"],
] as const;

export async function get(id: string): Promise<SavedView | null> {
  const rows = await raw.query(
    `SELECT ${selectList(SAVED_VIEW_COLS, "sv")} FROM saved_views sv WHERE sv.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(SAVED_VIEW_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<SavedView> {
  const found = await get(id);
  if (!found) throw new NotFoundError("saved_view", id);
  return found;
}

/** Live views, optionally scoped to one entity type, ordered by position then name. */
export async function list(entityType?: string): Promise<SavedView[]> {
  const clauses = ["sv.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (entityType) {
    clauses.push("sv.entity_type = ?");
    params.push(entityType);
  }
  const rows = await raw.query(
    `SELECT ${selectList(SAVED_VIEW_COLS, "sv")} FROM saved_views sv
     WHERE ${clauses.join(" AND ")}
     ORDER BY sv.position ASC, sv.name COLLATE NOCASE ASC`,
    params,
  );
  return mapRows(SAVED_VIEW_COLS, rows);
}

/** Every live pinned view, across all entity types, ordered by position then name. */
export async function listPinned(): Promise<SavedView[]> {
  const rows = await raw.query(
    `SELECT ${selectList(SAVED_VIEW_COLS, "sv")} FROM saved_views sv
     WHERE sv.deleted_at IS NULL AND sv.pinned = 1
     ORDER BY sv.position ASC, sv.name COLLATE NOCASE ASC`,
  );
  return mapRows(SAVED_VIEW_COLS, rows);
}

export async function create(
  input: NewSavedView,
  options: { batchId?: string } = {},
): Promise<SavedView> {
  const parsed = parseOrThrow(newSavedViewSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      entityType: trimmed(parsed.entityType),
      name: trimmed(parsed.name),
      queryJson: JSON.stringify(parsed.query ?? {}),
      position: parsed.position ?? 0,
      pinned: parsed.pinned ?? false,
      deletedAt: null,
    };
    const stmt = insertStatement("saved_views", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("saved_view", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a view");
}

export type SavedViewPatch = {
  name?: string;
  query?: unknown;
  position?: number;
  pinned?: boolean;
};

export async function update(
  id: string,
  patch: SavedViewPatch,
  options: { batchId?: string } = {},
): Promise<SavedView> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.query !== undefined) values.queryJson = JSON.stringify(patch.query ?? {});
    if (patch.position !== undefined) values.position = patch.position;
    if (patch.pinned !== undefined) values.pinned = patch.pinned;

    const stmt = updateStatement("saved_views", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("saved_view", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a view");
}

export async function setPinned(
  id: string,
  pinned: boolean,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const before = await getOrThrow(id);
    const values = { pinned, updatedAt: nowIso() };
    const stmt = updateStatement("saved_views", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("saved_view", id, "update", before, values, options.batchId);
  }, pinned ? "Pinning a view" : "Unpinning a view");
}

/** Rewrite positions 0,1,2... in the given order, in one batch. */
export async function reorder(
  orderedIds: string[],
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const at = nowIso();
    const statements = orderedIds.map((id, index) =>
      updateStatement("saved_views", id, { position: index, updatedAt: at }),
    );
    if (statements.length > 0) await raw.batch(statements);
    for (const [index, id] of orderedIds.entries()) {
      await logWrite("saved_view", id, "update", null, { position: index }, options.batchId);
    }
  }, "Reordering views");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("saved_views", "saved_view", id, options.batchId),
    "Deleting a view",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("saved_views", "saved_view", id, options.batchId),
    "Restoring a view",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("saved_views", "saved_view", id, options.batchId),
    "Purging a view",
  );
}

/** Parse a view's stored query; never throws, returns {} on bad JSON. */
export function parseQuery(view: SavedView): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(view.queryJson);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
