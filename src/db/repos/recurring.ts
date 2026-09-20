/**
 * Recurring service reminders.
 *
 *   [active, next_due_on] --done--> [next_due_on + interval, last_completed_on]
 *                         --skip--> [next_due_on + interval]
 *                         --pause--> [inactive]
 *
 * There is no timer and no scheduler. A rule is a row with a date on it, and
 * "what is coming up" is a query against today. That is the whole design: an
 * owner who does not open Helix for three weeks still sees the right thing
 * when he does, and a background job that has to be running for the product to
 * be correct is one more thing that can be broken on a laptop that sleeps.
 *
 * Dates here are local calendar days ("YYYY-MM-DD"), the same convention
 * `tasks.due_on` uses, because "spring cleanup on 12 April" is a day and not
 * an instant.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso, parseDateOnly, todayLocal, toLocalDateString } from "@/lib/dates";
import {
  countRows,
  insertStatement,
  logWrite,
  mapRows,
  pageClause,
  parseOrThrow,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  updateStatement,
  type Col,
  type Page,
} from "@/db/repos/_base";

export const RECURRING_UNITS = ["week", "month", "year"] as const;
export type RecurringUnit = (typeof RECURRING_UNITS)[number];

export type RecurringRule = {
  id: string;
  contactId: string | null;
  companyId: string | null;
  title: string;
  everyN: number;
  unit: RecurringUnit;
  nextDueOn: string;
  lastCompletedOn: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const newRecurringRuleSchema = z.object({
  // `.trim()` before `.min(1)`: a title of two spaces is not a title, and
  // without the trim it would pass validation and store as an empty string.
  title: z.string().trim().min(1, "A reminder needs a name."),
  everyN: z
    .number()
    .int("Use a whole number of weeks, months or years.")
    .min(1, "The smallest interval is 1.")
    .max(120, "That interval is longer than Helix can plan for."),
  unit: z.enum(RECURRING_UNITS),
  nextDueOn: z
    .string()
    .regex(DATE_ONLY, "Pick the first date this is due.")
    .refine((value) => parseDateOnly(value) !== null, "That is not a real date."),
  contactId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export type NewRecurringRule = z.input<typeof newRecurringRuleSchema>;

export type RecurringFilter = {
  contactId?: string;
  companyId?: string;
  activeOnly?: boolean;
  /** Rules whose next date is on or before this day. */
  dueOnOrBefore?: string;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
};

const RULE_COLS: readonly Col<RecurringRule>[] = [
  ["id", "r.id", "text"],
  ["contactId", "r.contact_id", "textNull"],
  ["companyId", "r.company_id", "textNull"],
  ["title", "r.title", "text"],
  ["everyN", "r.every_n", "int"],
  ["unit", "r.unit", "text"],
  ["nextDueOn", "r.next_due_on", "text"],
  ["lastCompletedOn", "r.last_completed_on", "textNull"],
  ["active", "r.active", "bool"],
  ["createdAt", "r.created_at", "text"],
  ["updatedAt", "r.updated_at", "text"],
  ["deletedAt", "r.deleted_at", "textNull"],
] as const;

/* -------------------------------------------------------------------------- */
/* the interval, as pure arithmetic (unit tested)                             */
/* -------------------------------------------------------------------------- */

/**
 * The next occurrence after `from`, `everyN` units later.
 *
 * Month and year arithmetic clamps to the end of the target month rather than
 * rolling forward into the next one: "every month" from 31 January is 28
 * February (29 in a leap year), not 3 March. A rolling month is what a
 * calendar application does and it is wrong here - a reminder that drifts a
 * few days later every time it fires ends up in the wrong season, which is
 * exactly what an annual spring cleanup cannot do.
 *
 * Returns the input unchanged when it is not a real date, so a corrupt row
 * cannot throw inside a list render.
 */
export function advanceDate(
  from: string,
  everyN: number,
  unit: RecurringUnit,
): string {
  const start = parseDateOnly(from);
  if (!start) return from;
  const step = Math.max(1, Math.trunc(everyN));

  if (unit === "week") {
    const next = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    next.setDate(next.getDate() + step * 7);
    return toLocalDateString(next);
  }

  const months = unit === "month" ? step : step * 12;
  const targetMonthIndex = start.getMonth() + months;
  const targetYear = start.getFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Day 0 of the following month is the last day of the target month.
  const lastDayOfTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(start.getDate(), lastDayOfTarget);
  return toLocalDateString(new Date(targetYear, targetMonth, day));
}

/**
 * Advance past today, not by one step.
 *
 * A weekly rule that was missed for two months would otherwise come back due
 * yesterday, and then the day before that, one "Done" at a time. Marking it
 * done means the work happened today, so the next date is the first
 * occurrence that is still in the future.
 */
export function advancePastToday(
  from: string,
  everyN: number,
  unit: RecurringUnit,
  reference: string = todayLocal(),
): string {
  let next = advanceDate(from, everyN, unit);
  if (next === from) return next;
  // Bounded: a week interval over a ten-year gap is ~520 steps.
  for (let i = 0; i < 1000 && next <= reference; i += 1) {
    const stepped = advanceDate(next, everyN, unit);
    if (stepped === next) break;
    next = stepped;
  }
  return next;
}

/** "Every year", "Every 3 months", "Every 2 weeks" - the owner's words. */
export function describeInterval(everyN: number, unit: RecurringUnit): string {
  const n = Math.max(1, Math.trunc(everyN));
  if (n === 1) return `Every ${unit}`;
  return `Every ${n} ${unit}s`;
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<RecurringRule | null> {
  const rows = await raw.query(
    `SELECT ${selectList(RULE_COLS, "r")} FROM recurring_rules r WHERE r.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(RULE_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<RecurringRule> {
  const found = await get(id);
  if (!found) throw new NotFoundError("recurring_rule", id);
  return found;
}

function whereFor(filter: RecurringFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.onlyDeleted) clauses.push("r.deleted_at IS NOT NULL");
  else if (!filter.includeDeleted) clauses.push("r.deleted_at IS NULL");

  if (filter.activeOnly) clauses.push("r.active = 1");
  if (filter.contactId) {
    clauses.push("r.contact_id = ?");
    params.push(filter.contactId);
  }
  if (filter.companyId) {
    clauses.push("r.company_id = ?");
    params.push(filter.companyId);
  }
  if (filter.dueOnOrBefore) {
    clauses.push("r.next_due_on <= ?");
    params.push(filter.dueOnOrBefore);
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/**
 * Every rule, soonest first. Paused rules sort after live ones so the screen
 * reads as "what is coming" and not as a settings table.
 */
export async function list(
  filter: RecurringFilter = {},
  page?: Page,
): Promise<{ rows: RecurringRule[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(RULE_COLS, "r")} FROM recurring_rules r${where.sql}
     ORDER BY r.active DESC, r.next_due_on ASC, r.title ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total FROM recurring_rules r${where.sql}`,
    where.params,
  );
  return { rows: mapRows(RULE_COLS, rows), total };
}

/**
 * A rule plus who it is about and how to reach them, which is what a Today row
 * needs: a reminder without the customer's name and a way to open the record
 * is a sticky note.
 */
export type RecurringDue = {
  rule: RecurringRule;
  /** "Nella Okonkwo" or "Mountain Shadows Assisted Living", when there is one. */
  label: string | null;
  href: string | null;
  phone: string | null;
  email: string | null;
  /**
   * True when the contact or company this rule is about is in the Trash. The
   * joins used to drop a deleted record, which left the screen saying "No
   * record attached" about a rule that is plainly attached to something - the
   * owner could not tell a rule he had orphaned from one whose customer he had
   * deleted (CPO audit, F-W1-4).
   */
  recordDeleted: boolean;
  /** Negative when the date has already passed. */
  daysUntil: number;
};

function dayGap(fromDateOnly: string, toDateOnly: string): number {
  const from = Date.parse(`${fromDateOnly}T00:00:00Z`);
  const to = Date.parse(`${toDateOnly}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * The rule columns plus who it is about and how to reach them. One join, used
 * by both the Today section and the Reminders screen, so the two can never
 * disagree about what a rule's customer is called.
 */
const WITH_WHO_SELECT = `SELECT ${selectList(RULE_COLS, "r")},
            c.first_name AS c_first_name,
            c.last_name  AS c_last_name,
            co.name      AS co_name,
            (SELECT p.raw FROM contact_phones p
              WHERE p.contact_id = r.contact_id AND p.deleted_at IS NULL
              ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1) AS r_phone,
            (SELECT e.email_lower FROM contact_emails e
              WHERE e.contact_id = r.contact_id AND e.deleted_at IS NULL
              ORDER BY e.is_primary DESC, e.created_at ASC LIMIT 1) AS r_email,
            c.deleted_at AS c_deleted_at,
            co.deleted_at AS co_deleted_at
     FROM recurring_rules r
     LEFT JOIN contacts c ON c.id = r.contact_id
     LEFT JOIN companies co ON co.id = r.company_id`;

/** Map one joined row onto the rule and the four columns after it. */
function toRecurringDue(row: unknown[], reference: string): RecurringDue {
  const offset = RULE_COLS.length;
  const rule = mapRows(RULE_COLS, [row])[0];
  const first = row[offset] === null || row[offset] === undefined ? "" : String(row[offset]);
  const last =
    row[offset + 1] === null || row[offset + 1] === undefined ? "" : String(row[offset + 1]);
  const companyName =
    row[offset + 2] === null || row[offset + 2] === undefined ? null : String(row[offset + 2]);
  const phone =
    row[offset + 3] === null || row[offset + 3] === undefined ? null : String(row[offset + 3]);
  const email =
    row[offset + 4] === null || row[offset + 4] === undefined ? null : String(row[offset + 4]);
  const contactDeleted = row[offset + 5] !== null && row[offset + 5] !== undefined;
  const companyDeleted = row[offset + 6] !== null && row[offset + 6] !== undefined;

  const contactName = `${first} ${last}`.trim();
  let label: string | null = null;
  let href: string | null = null;
  let recordDeleted = false;
  if (rule.contactId && contactName.length > 0) {
    label = contactName;
    href = `/contacts/${rule.contactId}`;
    recordDeleted = contactDeleted;
  } else if (rule.companyId && companyName) {
    label = companyName;
    href = `/companies/${rule.companyId}`;
    recordDeleted = companyDeleted;
  }

  return {
    rule,
    label,
    href,
    phone,
    email,
    recordDeleted,
    daysUntil: dayGap(reference, rule.nextDueOn),
  };
}

/**
 * Every rule with its customer's name, for the Reminders screen. Live rules
 * first, soonest first, paused ones after them.
 */
export async function listWithWho(
  filter: RecurringFilter = {},
  reference: string = todayLocal(),
): Promise<RecurringDue[]> {
  const where = whereFor(filter);
  const rows = await raw.query(
    `${WITH_WHO_SELECT}${where.sql}
     ORDER BY r.active DESC, r.next_due_on ASC, r.title ASC
     LIMIT 500`,
    where.params,
  );
  return rows.map((row) => toRecurringDue(row, reference));
}

/**
 * The rules Today shows: active, not deleted, next date on or before
 * `reference + days`. Overdue ones are included and sort first, because a
 * reminder nobody acted on last week is the one that matters most.
 */
export async function dueSoon(
  reference: string = todayLocal(),
  days = 7,
): Promise<RecurringDue[]> {
  const horizonDate = new Date(`${reference}T00:00:00Z`);
  horizonDate.setUTCDate(horizonDate.getUTCDate() + Math.max(0, Math.trunc(days)));
  const horizon = horizonDate.toISOString().slice(0, 10);

  const rows = await raw.query(
    `${WITH_WHO_SELECT}
     WHERE r.deleted_at IS NULL
       AND r.active = 1
       AND r.next_due_on <= ?
     ORDER BY r.next_due_on ASC, r.title ASC`,
    [horizon],
  );

  return rows.map((row) => toRecurringDue(row, reference));
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function create(
  input: NewRecurringRule,
  options: { batchId?: string } = {},
): Promise<RecurringRule> {
  const parsed = parseOrThrow(newRecurringRuleSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      contactId: parsed.contactId ?? null,
      companyId: parsed.companyId ?? null,
      title: trimmed(parsed.title),
      everyN: parsed.everyN,
      unit: parsed.unit,
      nextDueOn: parsed.nextDueOn,
      lastCompletedOn: null,
      active: parsed.active ?? true,
      deletedAt: null,
    };
    const stmt = insertStatement("recurring_rules", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("recurring_rule", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a reminder");
}

export type RecurringPatch = Partial<
  Pick<NewRecurringRule, "title" | "everyN" | "unit" | "nextDueOn" | "active">
>;

export async function update(
  id: string,
  patch: RecurringPatch,
  options: { batchId?: string } = {},
): Promise<RecurringRule> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.title !== undefined) values.title = trimmed(patch.title);
    if (patch.everyN !== undefined) values.everyN = Math.max(1, Math.trunc(patch.everyN));
    if (patch.unit !== undefined) values.unit = patch.unit;
    if (patch.nextDueOn !== undefined) values.nextDueOn = patch.nextDueOn;
    if (patch.active !== undefined) values.active = patch.active;

    const stmt = updateStatement("recurring_rules", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("recurring_rule", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a reminder");
}

/** Pause or resume. A paused rule keeps its date and leaves Today. */
export async function setActive(
  id: string,
  active: boolean,
  options: { batchId?: string } = {},
): Promise<RecurringRule> {
  return update(id, { active }, options);
}

/**
 * "Done" - the work happened. Advances past today and stamps the completion.
 *
 * The system timeline entry is the caller's job, not this repository's: a repo
 * that writes another table's rows behind the caller's back is how two
 * features end up logging the same thing twice. The recurring feature's
 * mutation writes it through `activities.createSystem`.
 */
export async function complete(
  id: string,
  options: { batchId?: string; reference?: string } = {},
): Promise<RecurringRule> {
  const reference = options.reference ?? todayLocal();
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const nextDueOn = advancePastToday(
      before.nextDueOn,
      before.everyN,
      before.unit,
      reference,
    );
    const values = {
      nextDueOn,
      lastCompletedOn: reference,
      updatedAt: nowIso(),
    };
    const stmt = updateStatement("recurring_rules", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("recurring_rule", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Completing a reminder");
}

/**
 * "Skip this one" - the date moves and nothing claims the work was done, so
 * `last_completed_on` is left exactly as it was.
 */
export async function skip(
  id: string,
  options: { batchId?: string; reference?: string } = {},
): Promise<RecurringRule> {
  const reference = options.reference ?? todayLocal();
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const nextDueOn = advancePastToday(
      before.nextDueOn,
      before.everyN,
      before.unit,
      reference,
    );
    const values = { nextDueOn, updatedAt: nowIso() };
    const stmt = updateStatement("recurring_rules", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("recurring_rule", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Skipping a reminder");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("recurring_rules", "recurring_rule", id, options.batchId),
    "Deleting a reminder",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("recurring_rules", "recurring_rule", id, options.batchId),
    "Restoring a reminder",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("recurring_rules", "recurring_rule", id, options.batchId),
    "Purging a reminder",
  );
}
