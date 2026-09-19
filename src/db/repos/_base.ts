/**
 * Repository plumbing.
 *
 * Rows arrive from the pipe as arrays in select order, so every repository
 * declares its columns once as a Col[] and gets both the aliased select list
 * and the row mapper from that one declaration. Aliasing is not optional: two
 * joined tables both have `id`, and an unaliased join silently shifts every
 * column after it (there is a regression test for this).
 */
import { raw } from "@/db/client";
import { logChange, type ChangeOp } from "@/db/changeLog";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ValidationError } from "@/db/errors";
import type { z } from "zod";

export type ColKind = "text" | "textNull" | "int" | "intNull" | "bool";

/** [field name on the TS object, SQL expression, how to read the value] */
export type Col<T> = readonly [keyof T & string, string, ColKind];

function aliasFor(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** `expr AS prefix_field, ...` - every column aliased, never SELECT *. */
export function selectList<T>(cols: readonly Col<T>[], prefix: string): string {
  return cols.map(([key, expr]) => `${expr} AS ${prefix}_${aliasFor(key)}`).join(", ");
}

function readValue(value: unknown, kind: ColKind): unknown {
  if (value === null || value === undefined) {
    return kind === "text" ? "" : null;
  }
  switch (kind) {
    case "bool":
      return Number(value) !== 0;
    case "int":
    case "intNull":
      return Number(value);
    default:
      return String(value);
  }
}

/** Map one row array onto the declared shape, starting at `offset`. */
export function mapRow<T>(
  cols: readonly Col<T>[],
  row: unknown[],
  offset = 0,
): T {
  const out: Record<string, unknown> = {};
  cols.forEach(([key, , kind], i) => {
    out[key] = readValue(row[offset + i], kind);
  });
  return out as T;
}

export function mapRows<T>(cols: readonly Col<T>[], rows: unknown[][]): T[] {
  return rows.map((r) => mapRow(cols, r));
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export type Bindable = string | number | null;

export function bindValue(value: unknown): Bindable {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Column name for a TS field (camelCase -> snake_case). */
export function column(key: string): string {
  return aliasFor(key);
}

export function insertStatement(
  table: string,
  values: Record<string, unknown>,
): { sql: string; params: Bindable[] } {
  const keys = Object.keys(values);
  return {
    sql: `INSERT INTO ${table} (${keys.map(column).join(", ")}) VALUES (${keys
      .map(() => "?")
      .join(", ")})`,
    params: keys.map((k) => bindValue(values[k])),
  };
}

export function updateStatement(
  table: string,
  id: string,
  values: Record<string, unknown>,
): { sql: string; params: Bindable[] } {
  const keys = Object.keys(values);
  return {
    sql: `UPDATE ${table} SET ${keys
      .map((k) => `${column(k)} = ?`)
      .join(", ")} WHERE id = ?`,
    params: [...keys.map((k) => bindValue(values[k])), id],
  };
}

/** id + created_at + updated_at for a new row. */
export function stampNew(): { id: string; createdAt: string; updatedAt: string } {
  const at = nowIso();
  return { id: newId(), createdAt: at, updatedAt: at };
}

/* -------------------------------------------------------------------------- */
/* soft delete, restore, purge                                                */
/* -------------------------------------------------------------------------- */

export async function softDeleteRow(
  table: string,
  entityType: string,
  id: string,
  batchId?: string,
): Promise<void> {
  const at = nowIso();
  await raw.execute(
    `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    [at, at, id],
  );
  await logChange({
    entityType,
    entityId: id,
    op: "delete",
    after: { deletedAt: at },
    batchId,
  });
}

export async function restoreRow(
  table: string,
  entityType: string,
  id: string,
  batchId?: string,
): Promise<void> {
  const at = nowIso();
  await raw.execute(
    `UPDATE ${table} SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
    [at, id],
  );
  await logChange({
    entityType,
    entityId: id,
    op: "restore",
    after: { deletedAt: null },
    batchId,
  });
}

/**
 * Hard delete, in docs/PLAN.md's order: custom_values, tag_links, attachment
 * rows, then the row itself. Foreign keys carry the rest (contact_phones,
 * contact_emails and deal_stage_events cascade; optional references null out).
 * change_log rows are kept on purpose.
 */
export async function purgeRow(
  table: string,
  entityType: string,
  id: string,
  batchId?: string,
): Promise<void> {
  await raw.batch([
    {
      sql: `DELETE FROM custom_values WHERE entity_id = ?`,
      params: [id],
    },
    {
      sql: `DELETE FROM tag_links WHERE entity_type = ? AND entity_id = ?`,
      params: [entityType, id],
    },
    {
      sql: `DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?`,
      params: [entityType, id],
    },
    { sql: `DELETE FROM ${table} WHERE id = ?`, params: [id] },
  ]);
  await logChange({ entityType, entityId: id, op: "delete", batchId });
}

/* -------------------------------------------------------------------------- */
/* validation and paging                                                      */
/* -------------------------------------------------------------------------- */

/** zod validation that raises the app's ValidationError. */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      "Some of those details need fixing.",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export type Page = { limit?: number; offset?: number };

export function pageClause(page?: Page): { sql: string; params: number[] } {
  const limit = page?.limit ?? 100;
  const offset = page?.offset ?? 0;
  return { sql: " LIMIT ? OFFSET ?", params: [limit, offset] };
}

export async function countRows(
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const rows = await raw.query(sql, params);
  return rows.length > 0 ? Number(rows[0][0]) : 0;
}

/** A small helper so repositories log a create/update with one call. */
export async function logWrite(
  entityType: string,
  entityId: string,
  op: ChangeOp,
  before: unknown,
  after: unknown,
  batchId?: string,
): Promise<void> {
  await logChange({ entityType, entityId, op, before, after, batchId });
}

/** Trim a string field, treating whitespace-only as empty. */
export function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Trim to null: empty strings become NULL so indexes stay small. */
export function trimmedOrNull(value: string | null | undefined): string | null {
  const t = trimmed(value);
  return t.length > 0 ? t : null;
}
