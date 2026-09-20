/**
 * The recurring invoice schedule: "bill this deal every month" (D22).
 *
 *   [won deal with recurring lines] --> [schedule, next_issue_on]
 *                                            |
 *                                   issueDue(today) --> a draft invoice
 *                                            |          next_issue_on += interval
 *                                            +--------> last_issued_on = today
 *
 * Like `recurring_rules`, `next_issue_on` is the only state and nothing runs
 * in the background to keep it honest. A workspace that was closed for a year
 * is correct the moment it opens, because the question is always "which
 * schedules are due on or before today" and never "did the timer fire".
 *
 * `issueDue` is called once after the first paint and then daily while the app
 * is open. It catches up: a schedule three months behind produces three
 * invoices, one per missed month, each dated to the month it belonged to, so
 * the owner has something to send for each of them rather than one invoice for
 * a quarter he cannot explain.
 *
 * Every invoice it raises is a DRAFT. Nothing is sent to a customer by a timer.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso, todayLocal, parseDateOnly, toLocalDateString } from "@/lib/dates";
import {
  insertStatement,
  logWrite,
  mapRows,
  parseOrThrow,
  selectList,
  stampNew,
  type Col,
} from "@/db/repos/_base";
import * as documents from "@/db/repos/documents";

export const SCHEDULE_INTERVALS = ["month", "year"] as const;
export type ScheduleInterval = (typeof SCHEDULE_INTERVALS)[number];

export type InvoiceSchedule = {
  id: string;
  dealId: string;
  dealTitle: string;
  interval: string;
  nextIssueOn: string;
  lastIssuedOn: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const SCHEDULE_COLS: readonly Col<InvoiceSchedule>[] = [
  ["id", "s.id", "text"],
  ["dealId", "s.deal_id", "text"],
  ["dealTitle", "d.title", "text"],
  ["interval", "s.interval", "text"],
  ["nextIssueOn", "s.next_issue_on", "text"],
  ["lastIssuedOn", "s.last_issued_on", "textNull"],
  ["active", "s.active", "bool"],
  ["createdAt", "s.created_at", "text"],
  ["updatedAt", "s.updated_at", "text"],
  ["deletedAt", "s.deleted_at", "textNull"],
];

const SCHEDULE_FROM = `FROM invoice_schedules s JOIN deals d ON d.id = s.deal_id`;

/* -------------------------------------------------------------------------- */
/* dates                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One interval on, clamped to the end of the target month.
 *
 * Billing on the 31st means the 28th of February and then the 31st of March
 * again, not the 3rd of March and then the 3rd of April: a bill date that
 * drifts a few days every month walks out of the month it belongs to. This is
 * the same rule `recurring.advanceDate` uses, deliberately - if one changes,
 * both should.
 */
export function advanceIssueDate(from: string, interval: string): string {
  const start = parseDateOnly(from);
  if (!start) return from;
  const months = interval === "year" ? 12 : 1;
  const targetMonthIndex = start.getMonth() + months;
  const targetYear = start.getFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Day 0 of the following month is the last day of the target month.
  const lastDayOfTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(start.getDate(), lastDayOfTarget);
  return toLocalDateString(new Date(targetYear, targetMonth, day));
}

/** How many issues a schedule owes as of `reference`, bounded. */
export function dueCount(
  nextIssueOn: string,
  interval: string,
  reference: string = todayLocal(),
  max = 36,
): number {
  let cursor = nextIssueOn;
  let count = 0;
  while (count < max && cursor <= reference) {
    const stepped = advanceIssueDate(cursor, interval);
    if (stepped === cursor) break;
    cursor = stepped;
    count += 1;
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<InvoiceSchedule | null> {
  const rows = await raw.query(
    `SELECT ${selectList(SCHEDULE_COLS, "s")} ${SCHEDULE_FROM} WHERE s.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(SCHEDULE_COLS, rows)[0] : null;
}

/** The live schedule on one deal, if it has one. The deal panel asks this. */
export async function forDeal(dealId: string): Promise<InvoiceSchedule | null> {
  const rows = await raw.query(
    `SELECT ${selectList(SCHEDULE_COLS, "s")} ${SCHEDULE_FROM}
     WHERE s.deal_id = ? AND s.deleted_at IS NULL
     ORDER BY s.created_at DESC LIMIT 1`,
    [dealId],
  );
  return rows.length > 0 ? mapRows(SCHEDULE_COLS, rows)[0] : null;
}

export async function list(
  options: { activeOnly?: boolean } = {},
): Promise<InvoiceSchedule[]> {
  const clauses = ["s.deleted_at IS NULL"];
  if (options.activeOnly) clauses.push("s.active = 1");
  const rows = await raw.query(
    `SELECT ${selectList(SCHEDULE_COLS, "s")} ${SCHEDULE_FROM}
     WHERE ${clauses.join(" AND ")}
     ORDER BY s.next_issue_on ASC, d.title ASC`,
    [],
  );
  return mapRows(SCHEDULE_COLS, rows);
}

/**
 * Schedules whose next issue date has arrived, on a deal that is still won.
 *
 * The stage test is not decoration. `ensureForWonDeals` only ever creates a
 * schedule; nothing used to take one away. So a deal moved from Won to Lost -
 * the customer cancelled, which is exactly when an owner moves it - kept its
 * active schedule and kept drafting an invoice for that customer every month,
 * for ever. Billing follows the deal's stage, and the deal page's panel says
 * so ("Billing is paused while this job is not won").
 *
 * Reopening it resumes billing, and `next_issue_on` has moved on in the
 * meantime, so it resumes from now rather than back-billing the gap.
 */
export async function due(
  reference: string = todayLocal(),
): Promise<InvoiceSchedule[]> {
  const rows = await raw.query(
    `SELECT ${selectList(SCHEDULE_COLS, "s")} ${SCHEDULE_FROM}
     JOIN stages st ON st.id = d.stage_id
     WHERE s.deleted_at IS NULL AND s.active = 1 AND s.next_issue_on <= ?
       AND d.deleted_at IS NULL AND st.is_won = 1
     ORDER BY s.next_issue_on ASC`,
    [reference],
  );
  return mapRows(SCHEDULE_COLS, rows);
}

/**
 * Whether the deal behind a schedule is still in a won stage, for the deal
 * page's panel: the schedule row is still there and still `active`, but
 * nothing will be billed against it until the deal is won again, and the owner
 * should be told that rather than left reading "Billing every month" under a
 * lost job.
 */
export async function isBillable(dealId: string): Promise<boolean> {
  const rows = await raw.query(
    `SELECT s.is_won AS s_is_won
     FROM deals d JOIN stages s ON s.id = d.stage_id
     WHERE d.id = ? AND d.deleted_at IS NULL`,
    [dealId],
  );
  return rows.length > 0 && Number(rows[0][0]) !== 0;
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export const newScheduleSchema = z.object({
  dealId: z.string().min(1, "A schedule needs a deal."),
  interval: z.enum(SCHEDULE_INTERVALS).default("month"),
  nextIssueOn: z.string().min(1, "A schedule needs a first billing date."),
  active: z.boolean().default(true),
});

export type NewInvoiceSchedule = z.input<typeof newScheduleSchema>;

export async function create(
  input: NewInvoiceSchedule,
): Promise<InvoiceSchedule> {
  const parsed = parseOrThrow(newScheduleSchema, input);
  return withWrite(async () => {
    const stamp = stampNew();
    const row = {
      ...stamp,
      dealId: parsed.dealId,
      interval: parsed.interval,
      nextIssueOn: parsed.nextIssueOn,
      lastIssuedOn: null,
      active: parsed.active,
      deletedAt: null,
    };
    const statement = insertStatement("invoice_schedules", row);
    await raw.execute(statement.sql, statement.params);
    await logWrite("invoiceSchedule", stamp.id, "create", null, row);
    const created = await get(stamp.id);
    if (!created) throw new NotFoundError("invoiceSchedule", stamp.id);
    return created;
  }, "Setting up the billing schedule");
}

/**
 * What a deal's recurring lines say the schedule should be.
 *
 * A deal with a yearly line and no monthly one bills yearly; anything with a
 * monthly line bills monthly, because a monthly obligation cannot wait a year.
 * Returns null when the deal has no recurring lines at all, which is most
 * deals and is why this answers rather than throwing.
 */
export async function intervalForDeal(
  dealId: string,
): Promise<ScheduleInterval | null> {
  const rows = await raw.query(
    `SELECT di.interval AS di_interval FROM deal_items di
     WHERE di.deal_id = ? AND di.deleted_at IS NULL AND di.kind = 'recurring'`,
    [dealId],
  );
  if (rows.length === 0) return null;
  const intervals = rows.map((row) => String(row[0] ?? "month"));
  return intervals.some((i) => i !== "year") ? "month" : "year";
}

/**
 * Start billing a deal that has just been won, if it has recurring lines and
 * does not already have a schedule. Idempotent, so the deal page can call it
 * on every win without checking first.
 *
 * The first billing date is the deal's `recurring_started_on` when it has one
 * and today otherwise: the owner may have agreed the service starts next
 * month, and the schedule has to respect that rather than bill on the day the
 * deal closed.
 */
export async function ensureForWonDeal(
  dealId: string,
  reference: string = todayLocal(),
): Promise<InvoiceSchedule | null> {
  const existing = await forDeal(dealId);
  if (existing) return existing;

  const interval = await intervalForDeal(dealId);
  if (!interval) return null;

  const rows = await raw.query(
    `SELECT d.recurring_started_on AS d_recurring_started_on FROM deals d WHERE d.id = ?`,
    [dealId],
  );
  if (rows.length === 0) throw new NotFoundError("deal", dealId);
  const startedOn =
    rows[0][0] === null || rows[0][0] === undefined ? null : String(rows[0][0]);

  return create({
    dealId,
    interval,
    nextIssueOn: startedOn && startedOn.length > 0 ? startedOn : reference,
  });
}

/**
 * Every won deal that has recurring lines and no schedule yet, given one.
 *
 * "A deal is won" is a property of the stage it sits in, not of the deal, so
 * the query joins through `stages.is_won` the same way `deals.board` does.
 *
 * This is called from the schedule runner on boot rather than from the deal
 * page's stage change, deliberately. The stage change belongs to the records
 * feature, and a deal can also be won by an import, by an undo, or by a drag
 * on the board - three more call sites that would each have to remember. One
 * query that asks "which won deals are missing a schedule" cannot forget.
 */
export async function ensureForWonDeals(
  reference: string = todayLocal(),
): Promise<InvoiceSchedule[]> {
  const rows = await raw.query(
    `SELECT DISTINCT d.id AS d_id
     FROM deals d
     JOIN stages st ON st.id = d.stage_id
     JOIN deal_items di ON di.deal_id = d.id
     LEFT JOIN invoice_schedules s ON s.deal_id = d.id AND s.deleted_at IS NULL
     WHERE st.is_won = 1
       AND d.deleted_at IS NULL
       AND di.deleted_at IS NULL
       AND di.kind = 'recurring'
       AND s.id IS NULL`,
    [],
  );

  const created: InvoiceSchedule[] = [];
  for (const row of rows) {
    const schedule = await ensureForWonDeal(String(row[0]), reference);
    if (schedule) created.push(schedule);
  }
  return created;
}

export async function setActive(id: string, active: boolean): Promise<void> {
  await withWrite(async () => {
    await raw.execute(
      `UPDATE invoice_schedules SET active = ?, updated_at = ? WHERE id = ?`,
      [active ? 1 : 0, nowIso(), id],
    );
    await logWrite("invoiceSchedule", id, "update", null, { active });
  }, active ? "Resuming the schedule" : "Pausing the schedule");
}

export async function softDelete(id: string): Promise<void> {
  await withWrite(async () => {
    const at = nowIso();
    await raw.execute(
      `UPDATE invoice_schedules SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [at, at, id],
    );
    await logWrite("invoiceSchedule", id, "delete", { deletedAt: null }, { deletedAt: at });
  }, "Stopping the schedule");
}

/* -------------------------------------------------------------------------- */
/* issuing                                                                    */
/* -------------------------------------------------------------------------- */

export type IssueOptions = {
  /** The invoice number prefix, from settings. */
  prefix: string;
  taxRateBp: number;
  dueDays: number;
  paymentInstructions?: string | null;
};

export type IssuedInvoice = {
  scheduleId: string;
  dealId: string;
  dealTitle: string;
  documentId: string;
  number: string;
  issuedOn: string;
};

/**
 * Raise a draft invoice for every schedule that is due, and move each one on.
 *
 * Deliberately NOT one transaction over the whole run: a schedule whose deal
 * has lost its recurring lines must not take the rest of the run down with it.
 * Each schedule is its own transaction, and a failure on one is collected and
 * reported rather than thrown.
 *
 * The write lock is not reentrant, so this calls `documents.createFromDeal`
 * (which takes the lock itself) from OUTSIDE any lock of its own, and then
 * takes the lock separately to advance the schedule row. Holding one write
 * while starting another is the one mistake this file must not make.
 */
export async function issueDue(
  reference: string = todayLocal(),
  options: IssueOptions,
): Promise<{ issued: IssuedInvoice[]; failed: { scheduleId: string; reason: string }[] }> {
  const schedules = await due(reference);
  const issued: IssuedInvoice[] = [];
  const failed: { scheduleId: string; reason: string }[] = [];

  for (const schedule of schedules) {
    // Catch up one missed period at a time, each dated to the period it
    // belonged to, bounded so a corrupt date cannot spin.
    let cursor = schedule.nextIssueOn;
    let guard = 0;
    while (cursor <= reference && guard < 36) {
      guard += 1;
      try {
        const invoice = await documents.createFromDeal(schedule.dealId, {
          kind: "invoice",
          lines: "recurring",
          prefix: options.prefix,
          taxRateBp: options.taxRateBp,
          dueDays: options.dueDays,
          paymentInstructions: options.paymentInstructions ?? null,
          issuedOn: cursor,
        });
        const next = advanceIssueDate(cursor, schedule.interval);
        if (next === cursor) break;
        await withWrite(async () => {
          await raw.execute(
            `UPDATE invoice_schedules SET next_issue_on = ?, last_issued_on = ?, updated_at = ? WHERE id = ?`,
            [next, cursor, nowIso(), schedule.id],
          );
        }, "Advancing the billing schedule");
        issued.push({
          scheduleId: schedule.id,
          dealId: schedule.dealId,
          dealTitle: schedule.dealTitle,
          documentId: invoice.id,
          number: invoice.number,
          issuedOn: cursor,
        });
        cursor = next;
      } catch (err) {
        failed.push({
          scheduleId: schedule.id,
          reason: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }
  }

  return { issued, failed };
}

/**
 * "Create this month's invoice" on the deal panel: one invoice now, for the
 * period the schedule is currently sitting on, and the schedule moves on.
 */
export async function issueOne(
  scheduleId: string,
  options: IssueOptions,
): Promise<documents.Document> {
  const schedule = await get(scheduleId);
  if (!schedule) throw new NotFoundError("invoiceSchedule", scheduleId);

  const invoice = await documents.createFromDeal(schedule.dealId, {
    kind: "invoice",
    lines: "recurring",
    prefix: options.prefix,
    taxRateBp: options.taxRateBp,
    dueDays: options.dueDays,
    paymentInstructions: options.paymentInstructions ?? null,
    issuedOn: schedule.nextIssueOn,
  });

  const next = advanceIssueDate(schedule.nextIssueOn, schedule.interval);
  await withWrite(async () => {
    await raw.execute(
      `UPDATE invoice_schedules SET next_issue_on = ?, last_issued_on = ?, updated_at = ? WHERE id = ?`,
      [next, schedule.nextIssueOn, nowIso(), scheduleId],
    );
  }, "Advancing the billing schedule");

  return invoice;
}
