/**
 * Sources: where a contact, company or deal originated (Website, Referral,
 * Import, Manual, or anything the user adds). First-boot seeding
 * (src/db/repos/seed.ts) inserts the four defaults directly with SQL, so
 * `ensure` below must be idempotent against rows it did not create itself.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
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
  updateStatement,
  parseOrThrow,
  type Col,
  type Page,
} from "@/db/repos/_base";

export type Source = {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newSourceSchema = z.object({
  name: z.string().min(1, "A source needs a name."),
  kind: z.string().default("manual"),
});

export type NewSource = z.input<typeof newSourceSchema>;

export type SourceFilter = {
  includeDeleted?: boolean;
};

const SOURCE_COLS: readonly Col<Source>[] = [
  ["id", "s.id", "text"],
  ["name", "s.name", "text"],
  ["kind", "s.kind", "text"],
  ["createdAt", "s.created_at", "text"],
  ["updatedAt", "s.updated_at", "text"],
  ["deletedAt", "s.deleted_at", "textNull"],
] as const;

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<Source | null> {
  const rows = await raw.query(
    `SELECT ${selectList(SOURCE_COLS, "s")} FROM sources s WHERE s.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(SOURCE_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Source> {
  const found = await get(id);
  if (!found) throw new NotFoundError("source", id);
  return found;
}

function whereFor(filter: SourceFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  if (!filter.includeDeleted) clauses.push("s.deleted_at IS NULL");
  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params: [],
  };
}

export async function list(
  filter: SourceFilter = {},
  page?: Page,
): Promise<{ rows: Source[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(SOURCE_COLS, "s")} FROM sources s${where.sql}
     ORDER BY s.name COLLATE NOCASE ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total FROM sources s${where.sql}`,
    where.params,
  );
  return { rows: mapRows(SOURCE_COLS, rows), total };
}

/** Exact-name lookup, live rows only. */
export async function findByName(name: string): Promise<Source | null> {
  const trimmedName = trimmed(name);
  if (trimmedName.length === 0) return null;
  const rows = await raw.query(
    `SELECT ${selectList(SOURCE_COLS, "s")} FROM sources s
     WHERE s.name = ? AND s.deleted_at IS NULL
     ORDER BY s.created_at ASC LIMIT 1`,
    [trimmedName],
  );
  return rows.length > 0 ? mapRows(SOURCE_COLS, rows)[0] : null;
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function create(
  input: NewSource,
  options: { batchId?: string } = {},
): Promise<Source> {
  const parsed = parseOrThrow(newSourceSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      name: trimmed(parsed.name),
      kind: trimmed(parsed.kind) || "manual",
      deletedAt: null,
    };
    const stmt = insertStatement("sources", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("source", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a source");
}

export type SourcePatch = Partial<NewSource>;

export async function update(
  id: string,
  patch: SourcePatch,
  options: { batchId?: string } = {},
): Promise<Source> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.kind !== undefined) values.kind = trimmed(patch.kind) || "manual";

    const stmt = updateStatement("sources", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("source", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a source");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("sources", "source", id, options.batchId),
    "Deleting a source",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("sources", "source", id, options.batchId),
    "Restoring a source",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("sources", "source", id, options.batchId),
    "Purging a source",
  );
}

/**
 * Return the existing live source or create it. Used by the lead poller
 * (`ensure("Website")`) and the CSV import (`ensure("Import")`). Idempotent
 * against the first-boot seed, which inserts rows with the same names.
 */
export async function ensure(name: string, kind?: string): Promise<Source> {
  const existing = await findByName(name);
  if (existing) return existing;
  return create({ name, kind: kind ?? "manual" });
}
