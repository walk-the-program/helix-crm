/**
 * The service catalog: the price list a deal's line items are built from.
 *
 * A product is either `one_time` (a job) or `recurring` (a plan billed every
 * month or year). The two kinds are the same row shape rather than two tables
 * because a business's list mixes them freely - "gutter cleaning" next to
 * "monthly maintenance plan" - and a deal line item copies whichever kind it
 * was at the time, the same way it copies the price (see `deal_items` in
 * schema.ts). That copy is also why `deal_items.product_id` is ON DELETE SET
 * NULL: losing the catalog row must never lose the line that already quoted
 * it.
 *
 * The cross-field rule that matters most here is that a recurring product
 * always has an interval. `newProductSchema` defaults a missing interval to
 * "month" rather than rejecting the input, and forces a one-time product's
 * interval to null either way. Reports sum recurring rows into MRR by reading
 * `interval` directly, so a recurring row with a null interval is not a
 * validation gap, it is a silent hole in that number - `update` re-applies
 * the same normalisation for exactly that reason.
 *
 * Deleting a product is soft delete like everything else, guarded by usage:
 * a product already quoted on a deal cannot be deleted out from under that
 * deal's price history, so `softDelete` refuses when `usageCount` is above
 * zero and the Services screen's Delete button calls `removeOrDeactivate`
 * instead, which deletes the ones nothing points at and deactivates the rest.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError, ValidationError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
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
  trimmedOrNull,
  updateStatement,
  parseOrThrow,
  type Col,
  type Page,
  type Statement,
} from "@/db/repos/_base";
import {
  PICKER_LIMIT,
  bestRank,
  contains,
  normalizeQuery,
  nullableTextOf,
  sortRanked,
  textOf,
  widen,
} from "@/db/repos/_pickers";

export const PRODUCT_KINDS = ["one_time", "recurring"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const PRODUCT_INTERVALS = ["month", "year"] as const;
export type ProductInterval = (typeof PRODUCT_INTERVALS)[number];

export type Product = {
  id: string;
  name: string;
  description: string | null;
  kind: ProductKind;
  interval: ProductInterval | null;
  unitPriceCents: number;
  taxable: boolean;
  active: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/**
 * A recurring product always carries an interval - default it to "month"
 * rather than error, since the form has to keep working when the owner
 * switches the kind toggle before touching the interval field. A one-time
 * product's interval is forced to null either way: it never bills again, so
 * an interval on it would be a fact with nothing to describe.
 */
export const newProductSchema = z
  .object({
    name: z.string().trim().min(1, "A service needs a name."),
    description: z.string().nullable().optional(),
    kind: z.enum(PRODUCT_KINDS).default("one_time"),
    interval: z.enum(PRODUCT_INTERVALS).nullable().optional(),
    unitPriceCents: z.number().int().min(0),
    taxable: z.boolean().default(false),
    active: z.boolean().default(true),
    position: z.number().optional(),
  })
  .transform((value) => ({
    ...value,
    interval: value.kind === "recurring" ? (value.interval ?? "month") : null,
  }));

export type NewProduct = z.input<typeof newProductSchema>;

export type ProductPatch = Partial<
  Pick<NewProduct, "name" | "description" | "kind" | "interval" | "unitPriceCents" | "taxable" | "active">
>;

export type ProductFilter = {
  activeOnly?: boolean;
  kind?: ProductKind;
  search?: string;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
};

const PRODUCT_COLS: readonly Col<Product>[] = [
  ["id", "p.id", "text"],
  ["name", "p.name", "text"],
  ["description", "p.description", "textNull"],
  ["kind", "p.kind", "text"],
  ["interval", "p.interval", "textNull"],
  ["unitPriceCents", "p.unit_price_cents", "int"],
  ["taxable", "p.taxable", "bool"],
  ["active", "p.active", "bool"],
  ["position", "p.position", "int"],
  ["createdAt", "p.created_at", "text"],
  ["updatedAt", "p.updated_at", "text"],
  ["deletedAt", "p.deleted_at", "textNull"],
] as const;

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<Product | null> {
  const rows = await raw.query(
    `SELECT ${selectList(PRODUCT_COLS, "p")} FROM products p WHERE p.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(PRODUCT_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Product> {
  const found = await get(id);
  if (!found) throw new NotFoundError("product", id);
  return found;
}

function whereFor(filter: ProductFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.onlyDeleted) clauses.push("p.deleted_at IS NOT NULL");
  else if (!filter.includeDeleted) clauses.push("p.deleted_at IS NULL");

  if (filter.activeOnly) clauses.push("p.active = 1");
  if (filter.kind) {
    clauses.push("p.kind = ?");
    params.push(filter.kind);
  }
  if (filter.search && filter.search.trim().length > 0) {
    clauses.push("p.name LIKE ?");
    params.push(`%${filter.search.trim()}%`);
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function list(
  filter: ProductFilter = {},
  page?: Page,
): Promise<{ rows: Product[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(PRODUCT_COLS, "p")} FROM products p${where.sql}
     ORDER BY p.position ASC, p.created_at ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total FROM products p${where.sql}`,
    where.params,
  );
  return { rows: mapRows(PRODUCT_COLS, rows), total };
}

/** Live (deleted_at IS NULL) deal_items rows pointing at this product. */
export async function usageCount(id: string): Promise<number> {
  return countRows(
    `SELECT count(*) AS total FROM deal_items di
     WHERE di.product_id = ? AND di.deleted_at IS NULL`,
    [id],
  );
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

async function nextPosition(): Promise<number> {
  const rows = await raw.query(
    `SELECT coalesce(max(p.position), -1) AS max_position FROM products p WHERE p.deleted_at IS NULL`,
  );
  return rows.length > 0 ? Number(rows[0][0]) + 1 : 0;
}

export async function create(
  input: NewProduct,
  options: { batchId?: string } = {},
): Promise<Product> {
  const parsed = parseOrThrow(newProductSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      name: trimmed(parsed.name),
      description: trimmedOrNull(parsed.description),
      kind: parsed.kind,
      interval: parsed.interval,
      unitPriceCents: parsed.unitPriceCents,
      taxable: parsed.taxable,
      active: parsed.active,
      position: parsed.position ?? (await nextPosition()),
      deletedAt: null,
    };
    const stmt = insertStatement("products", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("product", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a service");
}

export async function update(
  id: string,
  patch: ProductPatch,
  options: { batchId?: string } = {},
): Promise<Product> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const kind = patch.kind ?? before.kind;
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.description !== undefined) values.description = trimmedOrNull(patch.description);
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.unitPriceCents !== undefined) values.unitPriceCents = patch.unitPriceCents;
    if (patch.taxable !== undefined) values.taxable = patch.taxable;
    if (patch.active !== undefined) values.active = patch.active;
    // Same cross-field rule as create(): a recurring product keeps (or gets)
    // an interval, a one-time one loses it - checked whenever either field
    // moves, not just when interval itself is touched, since switching kind
    // alone must still clear or fill it in.
    if (patch.interval !== undefined || patch.kind !== undefined) {
      const interval = patch.interval !== undefined ? patch.interval : before.interval;
      values.interval = kind === "recurring" ? (interval ?? "month") : null;
    }

    const stmt = updateStatement("products", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("product", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a service");
}

/** Rewrite positions 0,1,2... in the given order, in one batch. */
export async function reorder(ids: string[]): Promise<void> {
  await withWrite(async () => {
    const at = nowIso();
    const statements = ids.map((id, index) =>
      updateStatement("products", id, { position: index, updatedAt: at }),
    );
    if (statements.length > 0) await raw.batch(statements);
    for (const [index, id] of ids.entries()) {
      await logWrite("product", id, "update", null, { position: index }, undefined);
    }
  }, "Reordering services");
}

/**
 * Soft delete. Throws ValidationError when usageCount > 0: the price on a
 * deal that already used this product has to survive the product going away,
 * and a deleted row cannot be what that history points at.
 */
export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  const used = await usageCount(id);
  if (used > 0) {
    throw new ValidationError("That service is on a deal already.", [
      { path: "id", message: "Deactivate it instead so the deal keeps its price." },
    ]);
  }
  await withWrite(
    () => softDeleteRow("products", "product", id, options.batchId),
    "Deleting a service",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("products", "product", id, options.batchId),
    "Restoring a service",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("products", "product", id, options.batchId),
    "Purging a service",
  );
}

/**
 * What the Services screen's Delete button calls: a service nothing
 * references is deleted, and one a deal already uses is deactivated instead,
 * because the price history on that deal has to survive.
 *
 * This holds no lock of its own - it calls the two public functions above in
 * sequence, each taking and releasing the write lock on its own turn, which
 * is what the write lock's non-reentrancy requires. Calling `softDelete` or
 * `update` from inside another `withWrite` here would deadlock.
 */
export async function removeOrDeactivate(
  id: string,
  options: { batchId?: string } = {},
): Promise<{ outcome: "deleted" | "deactivated" }> {
  const used = await usageCount(id);
  if (used > 0) {
    await update(id, { active: false }, options);
    return { outcome: "deactivated" };
  }
  await softDelete(id, options);
  return { outcome: "deleted" };
}

/**
 * The insert as a statement, for a caller already inside a transaction
 * (onboarding's "Use this setup").
 */
export function productStatements(input: {
  name: string;
  description?: string | null;
  kind: ProductKind;
  interval?: ProductInterval | null;
  unitPriceCents: number;
  taxable?: boolean;
  position: number;
  at?: string;
}): { id: string; row: Record<string, unknown>; statements: Statement[] } {
  const at = input.at ?? nowIso();
  const id = newId();
  const kind = input.kind;
  const row = {
    id,
    createdAt: at,
    updatedAt: at,
    name: trimmed(input.name),
    description: trimmedOrNull(input.description),
    kind,
    interval: kind === "recurring" ? (input.interval ?? "month") : null,
    unitPriceCents: input.unitPriceCents,
    taxable: input.taxable ?? false,
    active: true,
    position: input.position,
    deletedAt: null,
  };
  return {
    id,
    row,
    statements: [insertStatement("products", row)],
  };
}

/* -------------------------------------------------------------------------- */
/* type-ahead search, for the services pickers                                */
/* -------------------------------------------------------------------------- */

/**
 * One row of a services picker. The price and the billing shape ride along
 * because every caller - an invoice line, a deal item - needs them the moment
 * the owner picks the row, and a second round trip per pick would be silly.
 */
export type ProductSearchResult = {
  id: string;
  label: string;
  detail?: string;
  description: string | null;
  kind: ProductKind;
  interval: ProductInterval | null;
  unitPriceCents: number;
  taxable: boolean;
};

const PRODUCT_SEARCH_SELECT = `
  SELECT p.id               AS p_id,
         p.name             AS p_name,
         p.description      AS p_description,
         p.kind             AS p_kind,
         p.interval         AS p_interval,
         p.unit_price_cents AS p_unit_price_cents,
         p.taxable          AS p_taxable
  FROM products p`;

function productResult(r: readonly unknown[]): ProductSearchResult {
  const description = nullableTextOf(r[2]);
  return {
    id: textOf(r[0]),
    label: textOf(r[1]),
    ...(description ? { detail: description } : {}),
    description,
    kind: textOf(r[3]) as ProductKind,
    interval: (nullableTextOf(r[4]) as ProductInterval | null) ?? null,
    unitPriceCents: Number(r[5]),
    taxable: Number(r[6]) === 1,
  };
}

/**
 * Active services matching what the owner has typed, best first. Matches the
 * name and the description; an empty query answers with the catalog in its
 * own order, which is the order the owner arranged it in.
 */
export async function search(
  query: string,
  limit = PICKER_LIMIT,
): Promise<ProductSearchResult[]> {
  const q = normalizeQuery(query);

  if (q.length === 0) {
    const rows = await raw.query(
      `${PRODUCT_SEARCH_SELECT}
       WHERE p.deleted_at IS NULL AND p.active = 1
       ORDER BY p.position ASC, p.created_at ASC
       LIMIT ?`,
      [limit],
    );
    return rows.map(productResult);
  }

  const like = contains(q);
  const rows = await raw.query(
    `${PRODUCT_SEARCH_SELECT}
     WHERE p.deleted_at IS NULL AND p.active = 1 AND (
       p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\'
     )
     LIMIT ?`,
    [like, like, widen(limit)],
  );

  const ranked = rows.map((r) => {
    const item = productResult(r);
    return { rank: bestRank([item.label, item.description], q), item };
  });

  return sortRanked(ranked).slice(0, limit);
}
