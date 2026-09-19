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
    // A soft delete logs the one column it changed, so `undoBatch` can put it
    // back. The absence of an `id` in `before` is what tells undoBatch this
    // was a soft delete and not a purge (docs/CONTRACTS.md, "Undo").
    before: { deletedAt: null },
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

/* -------------------------------------------------------------------------- */
/* Batch planning (promoted in wave 3 from the data feature's importWrite.ts). */
/* -------------------------------------------------------------------------- */

/**
 * One statement in a `raw.batch`. `insertStatement` and `updateStatement`
 * above both produce this shape.
 */
export type Statement = { sql: string; params: unknown[] };

const SINGLE_INSERT = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]*)\)$/;

/**
 * Fold consecutive one-row inserts into the same table into one multi-row
 * insert, which is what docs/PLAN.md item 9 asks for: 500 rows arrive as a
 * handful of statements rather than several thousand.
 *
 * SQLite's default limit is 32766 bound parameters per statement, so a group
 * is split before it gets there.
 */
export const MAX_BOUND_PARAMS = 30_000;

export function coalesceInserts(statements: Statement[]): Statement[] {
  const out: Statement[] = [];

  type Group = { table: string; columns: string; tuple: string; rows: number; params: unknown[] };
  let group: Group | null = null;

  const flush = () => {
    if (!group) return;
    const values = Array.from({ length: group.rows }, () => `(${group!.tuple})`).join(", ");
    out.push({
      sql: `INSERT INTO ${group.table} (${group.columns}) VALUES ${values}`,
      params: group.params,
    });
    group = null;
  };

  for (const statement of statements) {
    const match = SINGLE_INSERT.exec(statement.sql);
    if (!match) {
      flush();
      out.push(statement);
      continue;
    }
    const [, table, columns, tuple] = match;
    const params = statement.params ?? [];
    if (
      group &&
      (group.table !== table ||
        group.columns !== columns ||
        group.params.length + params.length > MAX_BOUND_PARAMS)
    ) {
      flush();
    }
    if (!group) {
      group = { table, columns, tuple, rows: 0, params: [] };
    }
    group.rows += 1;
    group.params.push(...params);
  }
  flush();

  return out;
}

/**
 * Insert order between tables, so a batch can be regrouped without tripping a
 * foreign key: a company exists before the contact that points at it, a
 * contact before its phones, a tag before its link. Anything not listed
 * (and every statement that is not a plain insert, such as the update half of
 * the dedupe policy) goes last, in the order it was built.
 */
const TABLE_ORDER = [
  "sources",
  "companies",
  "tags",
  "custom_fields",
  "contacts",
  "contact_phones",
  "contact_emails",
  "tag_links",
  "custom_values",
];

/**
 * Regroup a batch so `coalesceInserts` can actually do its job.
 *
 * The import builds statements row by row - contact, phones, emails, tags -
 * so two inserts into the same table are almost never next to each other, and
 * a coalescer that only merges neighbours merges nothing: 100k rows went out
 * as ~400k statements and took 35 s. Bucketing by table first turns the same
 * work into a few multi-row inserts per batch.
 */
export function planBatch(statements: Statement[]): Statement[] {
  const buckets = new Map<string, { table: string; seen: number; rows: Statement[] }>();
  const others: Statement[] = [];

  statements.forEach((statement, index) => {
    const match = SINGLE_INSERT.exec(statement.sql);
    if (!match) {
      others.push(statement);
      return;
    }
    const [, table, columns] = match;
    const key = `${table}\u0000${columns}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(statement);
    else buckets.set(key, { table, seen: index, rows: [statement] });
  });

  const ordered = [...buckets.values()].sort((a, b) => {
    const ai = TABLE_ORDER.indexOf(a.table);
    const bi = TABLE_ORDER.indexOf(b.table);
    const aRank = ai === -1 ? TABLE_ORDER.length : ai;
    const bRank = bi === -1 ? TABLE_ORDER.length : bi;
    return aRank - bRank || a.seen - b.seen;
  });

  const out: Statement[] = [];
  for (const bucket of ordered) out.push(...coalesceInserts(bucket.rows));
  out.push(...others);
  return out;
}

/* -------------------------------------------------------------------------- */
/* The whole-workspace duplicate pair scan (promoted in wave 3). */
/* -------------------------------------------------------------------------- */
/*
 * The pair queries themselves live in contacts.ts and companies.ts; the shapes
 * both of them return live here. `contacts.findDuplicates` stays what it
 * always was - "does this one record clash with anything", for the create
 * form - which is a different question from "list every candidate pair".
 */

export type DuplicateEntity = "contact" | "company";
export type MatchedOn = "email" | "phone" | "name";

export type DuplicateSide = {
  id: string;
  label: string;
  /** What the merge screen shows beside the name: company, city, created. */
  detail: string;
  createdAt: string;
};

export type DuplicatePair = {
  entityType: DuplicateEntity;
  matchedOn: MatchedOn;
  /** The shared value, highlighted in the list. */
  value: string;
  a: DuplicateSide;
  b: DuplicateSide;
  /** Stable key for React and for "I already dismissed this one". */
  key: string;
};

/** Stable, order-independent key for a candidate pair. */
export function pairKey(
  entityType: DuplicateEntity,
  matchedOn: MatchedOn,
  aId: string,
  bId: string,
): string {
  const [first, second] = aId < bId ? [aId, bId] : [bId, aId];
  return `${entityType}:${matchedOn}:${first}:${second}`;
}
