/**
 * The lines a deal is made of, and the one function that keeps the deal's
 * money honest (D20).
 *
 *   [catalog product] --copied--> [deal_item] --recompute--> [deal.value_cents]
 *
 * A line copies the product's name, kind, interval and price instead of
 * reading through the reference. A price list changes; a deal that was agreed
 * at last year's price is still that deal, and `product_id` is ON DELETE SET
 * NULL for the same reason. The copy is also what makes a discount visible:
 * `suggested_unit_cents` is what the catalog said and `actual_unit_cents` is
 * what the owner is charging, so the deal page can say "Suggested $2,100,
 * actual $1,650" rather than quietly showing one number.
 *
 * `recompute(dealId)` is the only way the four derived columns on `deals` are
 * ever written, and every write in this file runs it in the same transaction
 * as the change that caused it. That is deliberate: a deal whose lines say one
 * thing and whose value says another is the bug this design exists to make
 * impossible. The write lock is not reentrant, so the internal path builds
 * statements (`recomputeStatements`) and the caller batches them; the public
 * `recompute` is the same thing with the transaction wrapped around it.
 *
 * Yearly lines are normalised to monthly at the boundary - divided by 12 and
 * rounded, per line - so `recurring_monthly_cents` is a single number that MRR
 * can sum with no CASE in it. `value_cents` keeps its old meaning as the
 * deal's one stored number and is now defined as the ANNUAL value: upfront
 * plus twelve months of recurring. Everything that already sorts, filters,
 * sums or charts on it keeps working.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withTransaction } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso, todayLocal } from "@/lib/dates";
import {
  insertStatement,
  logWrite,
  mapRows,
  parseOrThrow,
  selectList,
  stampNew,
  trimmed,
  trimmedOrNull,
  updateStatement,
  type Col,
  type Statement,
} from "@/db/repos/_base";

/* -------------------------------------------------------------------------- */
/* the value math: pure, and unit tested on its own                           */
/* -------------------------------------------------------------------------- */

export type ItemKind = "one_time" | "recurring";
export type ItemInterval = "month" | "year";

/** The five fields the money is derived from, and nothing else. */
export type ValueLine = {
  kind: ItemKind;
  interval: ItemInterval | null;
  qty: number;
  suggestedUnitCents: number;
  actualUnitCents: number;
};

export type Totals = {
  /** Charged once, at the actual prices. */
  oneTimeCents: number;
  /** Charged every month, at the actual prices, yearly lines normalised. */
  recurringMonthlyCents: number;
  /** The stored deal value: oneTimeCents + 12 x recurringMonthlyCents. */
  valueCents: number;
  /** The same three at the catalog's prices. */
  suggestedOneTimeCents: number;
  suggestedRecurringMonthlyCents: number;
  suggestedTotalCents: number;
  /** suggestedTotalCents - valueCents, so a discount is positive. */
  discountCents: number;
};

export const EMPTY_TOTALS: Totals = {
  oneTimeCents: 0,
  recurringMonthlyCents: 0,
  valueCents: 0,
  suggestedOneTimeCents: 0,
  suggestedRecurringMonthlyCents: 0,
  suggestedTotalCents: 0,
  discountCents: 0,
};

/** Months in a year, written once so the twelves below are not magic. */
export const MONTHS_PER_YEAR = 12;

/**
 * One line's monthly contribution, in whole cents.
 *
 * A yearly line is divided by twelve and rounded half up, and it is rounded
 * per line rather than once over the sum. Per line is what the owner sees: a
 * $1,200/year plan reads as $100/mo on its own row, and a total that disagreed
 * with the rows adding up would be the thing he noticed. The cost is at most
 * half a cent of drift per yearly line against the annual figure, which is
 * why `valueCents` is built from the rounded monthly number rather than
 * alongside it - the breakdown and the total are always the same arithmetic.
 */
export function monthlyCentsFor(line: ValueLine, unitCents: number): number {
  if (line.kind !== "recurring") return 0;
  const total = unitCents * line.qty;
  if (line.interval === "year") return Math.round(total / MONTHS_PER_YEAR);
  return total;
}

/** Charged once: a one-time line's quantity times its unit price. */
export function oneTimeCentsFor(line: ValueLine, unitCents: number): number {
  if (line.kind === "recurring") return 0;
  return unitCents * line.qty;
}

/**
 * The upfront half of a deal's value, for a list that has to total a mix.
 *
 * A deal priced from the catalog has `one_time_cents` filled in. A deal typed
 * in by hand, or created before D20, has a `value_cents` and nothing else, and
 * reading its upfront as 0 would quietly wipe it out of a column total. So a
 * deal with no recurring revenue contributes its whole value as upfront, which
 * is exactly what it is.
 */
export function upfrontCents(deal: {
  valueCents: number;
  oneTimeCents: number;
  recurringMonthlyCents: number;
}): number {
  return deal.recurringMonthlyCents > 0 ? deal.oneTimeCents : deal.valueCents;
}

/** The annual value the deal stores: upfront plus twelve months of recurring. */
export function annualValueCents(
  oneTimeCents: number,
  recurringMonthlyCents: number,
): number {
  return oneTimeCents + MONTHS_PER_YEAR * recurringMonthlyCents;
}

export function totalsFor(lines: ValueLine[]): Totals {
  let oneTimeCents = 0;
  let recurringMonthlyCents = 0;
  let suggestedOneTimeCents = 0;
  let suggestedRecurringMonthlyCents = 0;

  for (const line of lines) {
    oneTimeCents += oneTimeCentsFor(line, line.actualUnitCents);
    recurringMonthlyCents += monthlyCentsFor(line, line.actualUnitCents);
    suggestedOneTimeCents += oneTimeCentsFor(line, line.suggestedUnitCents);
    suggestedRecurringMonthlyCents += monthlyCentsFor(
      line,
      line.suggestedUnitCents,
    );
  }

  const valueCents = annualValueCents(oneTimeCents, recurringMonthlyCents);
  const suggestedTotalCents = annualValueCents(
    suggestedOneTimeCents,
    suggestedRecurringMonthlyCents,
  );

  return {
    oneTimeCents,
    recurringMonthlyCents,
    valueCents,
    suggestedOneTimeCents,
    suggestedRecurringMonthlyCents,
    suggestedTotalCents,
    discountCents: suggestedTotalCents - valueCents,
  };
}

/* -------------------------------------------------------------------------- */
/* the row                                                                    */
/* -------------------------------------------------------------------------- */

export type DealItem = {
  id: string;
  dealId: string;
  productId: string | null;
  name: string;
  description: string | null;
  kind: ItemKind;
  interval: ItemInterval | null;
  qty: number;
  suggestedUnitCents: number;
  actualUnitCents: number;
  taxable: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const ITEM_COLS: readonly Col<DealItem>[] = [
  ["id", "di.id", "text"],
  ["dealId", "di.deal_id", "text"],
  ["productId", "di.product_id", "textNull"],
  ["name", "di.name", "text"],
  ["description", "di.description", "textNull"],
  ["kind", "di.kind", "text"],
  ["interval", "di.interval", "textNull"],
  ["qty", "di.qty", "int"],
  ["suggestedUnitCents", "di.suggested_unit_cents", "int"],
  ["actualUnitCents", "di.actual_unit_cents", "int"],
  ["taxable", "di.taxable", "bool"],
  ["position", "di.position", "int"],
  ["createdAt", "di.created_at", "text"],
  ["updatedAt", "di.updated_at", "text"],
  ["deletedAt", "di.deleted_at", "textNull"],
] as const;

export const newDealItemSchema = z
  .object({
    dealId: z.string().min(1, "A line needs a deal."),
    productId: z.string().nullable().optional(),
    name: z.string().min(1, "A line needs a name."),
    description: z.string().nullable().optional(),
    kind: z.enum(["one_time", "recurring"]).default("one_time"),
    interval: z.enum(["month", "year"]).nullable().optional(),
    qty: z.number().int().min(1, "A line needs at least one.").default(1),
    suggestedUnitCents: z.number().int().min(0).default(0),
    actualUnitCents: z.number().int().min(0).optional(),
    taxable: z.boolean().default(false),
  })
  .transform((value) => ({
    ...value,
    // A recurring line always has an interval and a one-time line never does.
    // The MRR sum in reports leans on that, so it is enforced here rather than
    // hoped for: an unstated interval on a recurring line means "per month",
    // which is what an owner adding one means.
    interval:
      value.kind === "recurring" ? (value.interval ?? "month") : null,
    // The actual price defaults to the suggested one: a line the owner has not
    // touched is not a discount.
    actualUnitCents: value.actualUnitCents ?? value.suggestedUnitCents,
  }));

export type NewDealItem = z.input<typeof newDealItemSchema>;

export type DealItemPatch = {
  name?: string;
  description?: string | null;
  qty?: number;
  actualUnitCents?: number;
  suggestedUnitCents?: number;
  kind?: ItemKind;
  interval?: ItemInterval | null;
  taxable?: boolean;
};

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function list(dealId: string): Promise<DealItem[]> {
  const rows = await raw.query(
    `SELECT ${selectList(ITEM_COLS, "di")} FROM deal_items di
     WHERE di.deal_id = ? AND di.deleted_at IS NULL
     ORDER BY di.position ASC, di.created_at ASC`,
    [dealId],
  );
  return mapRows(ITEM_COLS, rows);
}

export async function get(id: string): Promise<DealItem | null> {
  const rows = await raw.query(
    `SELECT ${selectList(ITEM_COLS, "di")} FROM deal_items di WHERE di.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(ITEM_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<DealItem> {
  const found = await get(id);
  if (!found) throw new NotFoundError("deal item", id);
  return found;
}

/** The totals a deal's live lines add up to, without writing anything. */
export async function totals(dealId: string): Promise<Totals> {
  return totalsFor(await list(dealId));
}

async function nextPosition(dealId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT coalesce(max(di.position), -1) AS max_position FROM deal_items di
     WHERE di.deal_id = ? AND di.deleted_at IS NULL`,
    [dealId],
  );
  return (rows.length > 0 ? Number(rows[0][0]) : -1) + 1;
}

/* -------------------------------------------------------------------------- */
/* recompute: the one writer of the derived columns                           */
/* -------------------------------------------------------------------------- */

type DealRecurringState = {
  isWon: boolean;
  recurringStartedOn: string | null;
  recurringEndedOn: string | null;
};

async function recurringState(dealId: string): Promise<DealRecurringState | null> {
  const rows = await raw.query(
    `SELECT s.is_won                 AS s_is_won,
            d.recurring_started_on   AS d_recurring_started_on,
            d.recurring_ended_on     AS d_recurring_ended_on
     FROM deals d JOIN stages s ON s.id = d.stage_id
     WHERE d.id = ?`,
    [dealId],
  );
  if (rows.length === 0) return null;
  return {
    isWon: Number(rows[0][0]) !== 0,
    recurringStartedOn: rows[0][1] === null ? null : String(rows[0][1]),
    recurringEndedOn: rows[0][2] === null ? null : String(rows[0][2]),
  };
}

export type RecomputePlan = { totals: Totals; statements: Statement[] };

/**
 * The recompute as statements, for a caller that already holds the write lock.
 *
 * `deals.createStatements` is the pattern and the reason: the lock is not
 * reentrant, so a repository write from inside a transaction that already
 * holds it would wait for itself. Every write below folds these statements
 * into the same batch as the line change, which is what makes the deal's money
 * and the deal's lines impossible to disagree.
 *
 * It also decides the recurring start date, because that is the same question:
 * a won deal that has recurring lines is earning from today unless it already
 * had a start date. Winning a deal with no recurring lines sets nothing.
 */
export async function recomputeStatements(
  dealId: string,
  options: { on?: string } = {},
): Promise<RecomputePlan> {
  const lines = await list(dealId);
  const computed = totalsFor(lines);
  const state = await recurringState(dealId);

  const values: Record<string, unknown> = {
    oneTimeCents: computed.oneTimeCents,
    recurringMonthlyCents: computed.recurringMonthlyCents,
    suggestedTotalCents: computed.suggestedTotalCents,
    valueCents: computed.valueCents,
    updatedAt: nowIso(),
  };

  if (
    state &&
    state.isWon &&
    state.recurringStartedOn === null &&
    computed.recurringMonthlyCents > 0
  ) {
    values.recurringStartedOn = options.on ?? todayLocal();
  }

  return {
    totals: computed,
    statements: [updateStatement("deals", dealId, values)],
  };
}

/**
 * Rewrite a deal's one_time_cents, recurring_monthly_cents,
 * suggested_total_cents and value_cents from its lines.
 *
 * Callable on its own - the deal page runs it after a stage change, which is
 * how winning a deal stamps `recurring_started_on` - and it is the same work
 * every write in this file already does inside its own transaction.
 */
export async function recompute(
  dealId: string,
  options: { on?: string } = {},
): Promise<Totals> {
  return withTransaction(async () => {
    const plan = await recomputeStatements(dealId, options);
    await raw.batch(plan.statements);
    return plan.totals;
  }, "Updating the deal total");
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function add(
  input: NewDealItem,
  options: { batchId?: string } = {},
): Promise<DealItem> {
  const parsed = parseOrThrow(newDealItemSchema, input);
  return withTransaction(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      dealId: parsed.dealId,
      productId: parsed.productId ?? null,
      name: trimmed(parsed.name),
      description: trimmedOrNull(parsed.description),
      kind: parsed.kind,
      interval: parsed.interval,
      qty: parsed.qty,
      suggestedUnitCents: parsed.suggestedUnitCents,
      actualUnitCents: parsed.actualUnitCents,
      taxable: parsed.taxable,
      position: await nextPosition(parsed.dealId),
      deletedAt: null,
    };
    await applyAndRecompute(parsed.dealId, [insertStatement("deal_items", row)]);
    await logWrite("dealItem", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Adding a service");
}

/**
 * Add a catalog service to a deal at its catalog price.
 *
 * The product is read here rather than in the caller so the copy is one round
 * trip and cannot be assembled wrong: the name, kind, interval, taxable flag
 * and price all come from the same row at the same moment.
 */
export async function addFromProduct(
  dealId: string,
  productId: string,
  options: { qty?: number; batchId?: string } = {},
): Promise<DealItem> {
  const rows = await raw.query(
    `SELECT p.name              AS p_name,
            p.description       AS p_description,
            p.kind              AS p_kind,
            p.interval          AS p_interval,
            p.unit_price_cents  AS p_unit_price_cents,
            p.taxable           AS p_taxable
     FROM products p WHERE p.id = ?`,
    [productId],
  );
  if (rows.length === 0) throw new NotFoundError("product", productId);
  const [name, description, kind, interval, unitPriceCents, taxable] = rows[0];

  return add(
    {
      dealId,
      productId,
      name: String(name),
      description: description === null ? null : String(description),
      kind: String(kind) as ItemKind,
      interval: interval === null ? null : (String(interval) as ItemInterval),
      qty: options.qty ?? 1,
      suggestedUnitCents: Number(unitPriceCents),
      taxable: Number(taxable) !== 0,
    },
    { batchId: options.batchId },
  );
}

export async function update(
  id: string,
  patch: DealItemPatch,
  options: { batchId?: string } = {},
): Promise<DealItem> {
  return withTransaction(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.description !== undefined)
      values.description = trimmedOrNull(patch.description);
    if (patch.qty !== undefined) values.qty = Math.max(1, Math.trunc(patch.qty));
    if (patch.actualUnitCents !== undefined)
      values.actualUnitCents = Math.max(0, Math.trunc(patch.actualUnitCents));
    if (patch.suggestedUnitCents !== undefined)
      values.suggestedUnitCents = Math.max(0, Math.trunc(patch.suggestedUnitCents));
    if (patch.taxable !== undefined) values.taxable = patch.taxable;
    if (patch.kind !== undefined) {
      values.kind = patch.kind;
      // The same invariant the insert schema enforces: a recurring line always
      // has an interval and a one-time line never does.
      const wanted = patch.interval ?? before.interval ?? "month";
      values.interval = patch.kind === "recurring" ? wanted : null;
    } else if (patch.interval !== undefined) {
      values.interval = before.kind === "recurring" ? patch.interval : null;
    }

    await applyAndRecompute(before.dealId, [
      updateStatement("deal_items", id, values),
    ]);
    await logWrite("dealItem", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a service");
}

export async function remove(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withTransaction(async () => {
    const before = await getOrThrow(id);
    const at = nowIso();
    await applyAndRecompute(before.dealId, [
      {
        sql: `UPDATE deal_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        params: [at, at, id],
      },
    ]);
    await logWrite(
      "dealItem",
      id,
      "delete",
      { deletedAt: null },
      { deletedAt: at },
      options.batchId,
    );
  }, "Removing a service");
}

/** Rewrite one deal's line positions to 0..n-1, in the order given. */
export async function reorder(dealId: string, ids: string[]): Promise<void> {
  await withTransaction(async () => {
    const at = nowIso();
    await raw.batch(
      ids.map((id, index) => ({
        sql: `UPDATE deal_items SET position = ?, updated_at = ? WHERE id = ? AND deal_id = ?`,
        params: [index, at, id, dealId],
      })),
    );
  }, "Reordering services");
}

/**
 * Stop the clock on a won deal's recurring revenue.
 *
 * The lines stay: what the deal was is history and history does not change.
 * MRR stops counting the deal from this date, which is the whole point - a
 * cancelled monthly plan has to leave the number, and deleting the lines to
 * make that happen would also delete what was sold.
 */
export async function endRecurring(
  dealId: string,
  options: { on?: string; batchId?: string } = {},
): Promise<void> {
  await withTransaction(async () => {
    const on = options.on ?? todayLocal();
    const stmt = updateStatement("deals", dealId, {
      recurringEndedOn: on,
      updatedAt: nowIso(),
    });
    await raw.batch([stmt]);
    await logWrite(
      "deal",
      dealId,
      "update",
      { recurringEndedOn: null },
      { recurringEndedOn: on },
      options.batchId,
    );
  }, "Ending the recurring service");
}

/** The reverse: put a deal that was ended by mistake back on the books. */
export async function resumeRecurring(
  dealId: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withTransaction(async () => {
    const stmt = updateStatement("deals", dealId, {
      recurringEndedOn: null,
      updatedAt: nowIso(),
    });
    await raw.batch([stmt]);
    await logWrite(
      "deal",
      dealId,
      "update",
      { recurringEndedOn: "set" },
      { recurringEndedOn: null },
      options.batchId,
    );
  }, "Resuming the recurring service");
}

/**
 * The line change and the recompute, inside the caller's transaction.
 *
 * Two batches rather than one, because the recompute has to read the lines as
 * they are AFTER the change - a total computed from the rows as they were
 * would be wrong by exactly the edit that caused it. Both batches are inside
 * one `withTransaction`, so the deal's money and the deal's lines still land
 * together or not at all.
 */
async function applyAndRecompute(
  dealId: string,
  statements: Statement[],
): Promise<Totals> {
  await raw.batch(statements);
  const plan = await recomputeStatements(dealId);
  await raw.batch(plan.statements);
  return plan.totals;
}
