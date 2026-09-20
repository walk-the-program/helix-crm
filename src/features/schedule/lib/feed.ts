/**
 * The Schedule's one read: everything due in a date range, out of five
 * tables the product already trusts.
 *
 * The owner's week is not one kind of record. It is a visit at nine, a job
 * he said he would start on Thursday, a reminder that came round again, an
 * invoice that falls due on Friday and the bill that goes out on the first.
 * Decision PX-6 is that none of that gets copied into a `schedule_items`
 * table of its own - a denormalised copy is a second answer to "when is
 * that", and the two would disagree the first time someone moved a date
 * outside this screen. `scheduleItems` reads the live rows instead, on every
 * call, and shapes each one into the `ScheduleItem` union `./types.ts`
 * defines.
 *
 * `ScheduleDeps` is the whole surface this file touches. `repoDeps` is the
 * only production implementation, and each of its five calls is exactly the
 * query the packet for this feature specifies - no more filtering happens in
 * there than the repository itself can already do. Whatever a repository's
 * own query cannot express (recurring's lower bound, the invoice status set,
 * both money-schedule date bounds) is filtered here instead, in plain reads
 * of the rows already in memory, which is also what keeps this file honest
 * to unit-test: a fixture `ScheduleDeps` stands in for the database and the
 * mapping is exercised without one.
 *
 * Every date compared here is a "YYYY-MM-DD" string compared lexically, never
 * parsed into a `Date` - that ordering is exactly calendar ordering for a
 * zero-padded ISO date, and a malformed value simply fails to fall in range
 * rather than throwing out of a screen render.
 */
import * as tasksRepo from "@/db/repos/tasks";
import type { Task, TaskLink } from "@/db/repos/tasks";
import * as dealsRepo from "@/db/repos/deals";
import type { Deal } from "@/db/repos/deals";
import * as recurringRepo from "@/db/repos/recurring";
import type { RecurringDue } from "@/db/repos/recurring";
import * as documentsRepo from "@/db/repos/documents";
import type { Document } from "@/db/repos/documents";
import * as invoiceSchedulesRepo from "@/db/repos/invoiceSchedules";
import type { InvoiceSchedule } from "@/db/repos/invoiceSchedules";
import {
  compareScheduleItems,
  kindForTask,
  type ScheduleItem,
  type ScheduleRange,
  type ScheduleWho,
} from "@/features/schedule/lib/types";

/** Every read the feed makes, injectable so tests use fixtures instead of a database. */
export type ScheduleDeps = {
  listTasks: (range: ScheduleRange) => Promise<Task[]>;
  taskLinks: (ids: string[]) => Promise<Map<string, TaskLink>>;
  listDeals: (range: ScheduleRange) => Promise<Deal[]>;
  listRules: (range: ScheduleRange) => Promise<RecurringDue[]>;
  listInvoices: () => Promise<Document[]>;
  listInvoiceSchedules: () => Promise<InvoiceSchedule[]>;
};

/** The production reads, through the existing repositories. */
export const repoDeps: ScheduleDeps = {
  listTasks: async (range) => {
    const { rows } = await tasksRepo.list(
      { openOnly: true, dueFrom: range.from, dueOnOrBefore: range.to },
      { limit: 500 },
    );
    return rows;
  },
  taskLinks: (ids) => tasksRepo.taskLinks(ids),
  listDeals: async (range) => {
    const { rows } = await dealsRepo.list(
      { openOnly: true, expectedFrom: range.from, expectedTo: range.to },
      { limit: 500 },
    );
    return rows;
  },
  // `listWithWho` only takes an upper bound; the lower bound (rule.nextDueOn
  // >= range.from) is applied below, in `recurringItems`.
  listRules: (range) => recurringRepo.listWithWho({ activeOnly: true, dueOnOrBefore: range.to }),
  listInvoices: async () => {
    const { rows } = await documentsRepo.list({ kind: "invoice" }, { limit: 500 });
    return rows;
  },
  listInvoiceSchedules: () => invoiceSchedulesRepo.list({ activeOnly: true }),
};

/* -------------------------------------------------------------------------- */
/* one mapper per source                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A task with a due date becomes a visit (a time is set) or a task (it is
 * not). A task with no due date at all has nothing to put on a calendar and
 * is skipped, the same way a task with no `dueOn` never reaches Today.
 */
async function taskItems(range: ScheduleRange, deps: ScheduleDeps): Promise<ScheduleItem[]> {
  const tasks = (await deps.listTasks(range)).filter((task) => task.dueOn !== null);
  const links = await deps.taskLinks(tasks.map((task) => task.id));

  return tasks.map((task) => {
    const link = links.get(task.id) ?? null;
    const kind = kindForTask(task);
    return {
      id: `${kind}:${task.id}`,
      kind,
      sourceId: task.id,
      date: task.dueOn as string,
      at: task.dueAt,
      durationMinutes: task.durationMinutes,
      title: task.title,
      who: link ? { label: link.label, href: link.href } : null,
      place: task.place,
      href: link?.href ?? "/tasks",
      contactId: link?.contactId ?? null,
      companyId: link?.companyId ?? null,
      dealId: link?.dealId ?? null,
      phone: link?.phone ?? null,
    };
  });
}

/** The deal's contact if it is still a live record, else its company, else nobody. */
function dealWho(deal: Deal): ScheduleWho | null {
  if (deal.contactId && deal.contactDeletedAt === null) {
    const name = `${deal.contactFirstName ?? ""} ${deal.contactLastName ?? ""}`.trim();
    if (name.length > 0) return { label: name, href: `/contacts/${deal.contactId}` };
  }
  if (deal.companyId && deal.companyName) {
    return { label: deal.companyName, href: `/companies/${deal.companyId}` };
  }
  return null;
}

/** A deal with no expected date is not expected on any particular day and is skipped. */
async function dealItems(range: ScheduleRange, deps: ScheduleDeps): Promise<ScheduleItem[]> {
  const deals = (await deps.listDeals(range)).filter((deal) => deal.expectedOn !== null);

  return deals.map((deal) => ({
    id: `deal-expected:${deal.id}`,
    kind: "deal-expected",
    sourceId: deal.id,
    date: deal.expectedOn as string,
    at: null,
    durationMinutes: null,
    title: deal.title,
    who: dealWho(deal),
    place: null,
    href: `/deals/${deal.id}`,
    contactId: deal.contactId,
    companyId: deal.companyId,
    dealId: deal.id,
    phone: null,
  }));
}

/**
 * `deps.listRules` already applied the upper bound; a rule due before
 * `range.from` belongs to a week that already passed and is dropped here.
 */
async function recurringItems(range: ScheduleRange, deps: ScheduleDeps): Promise<ScheduleItem[]> {
  const dues = (await deps.listRules(range)).filter((due) => due.rule.nextDueOn >= range.from);

  return dues.map((due) => {
    const rule = due.rule;
    const who: ScheduleWho | null =
      due.label && due.href ? { label: due.label, href: due.href } : null;
    return {
      id: `recurring-due:${rule.id}`,
      kind: "recurring-due",
      sourceId: rule.id,
      date: rule.nextDueOn,
      at: null,
      durationMinutes: null,
      title: rule.title,
      who,
      place: null,
      href: due.href ?? "/recurring",
      contactId: rule.contactId,
      companyId: rule.companyId,
      dealId: null,
      phone: due.phone,
    };
  });
}

/** The invoice statuses that still owe money and so still belong on a calendar. */
const DUE_INVOICE_STATUSES = new Set<string>(["sent", "partial"]);

/** The invoice's contact if it has one, else its company, else nobody. */
function invoiceWho(doc: Document): ScheduleWho | null {
  if (doc.contactId) {
    const name = `${doc.contactFirstName ?? ""} ${doc.contactLastName ?? ""}`.trim();
    if (name.length > 0) return { label: name, href: `/contacts/${doc.contactId}` };
  }
  if (doc.companyId && doc.companyName) {
    return { label: doc.companyName, href: `/companies/${doc.companyId}` };
  }
  return null;
}

/**
 * `deps.listInvoices` reads every invoice; the date range and the "still
 * owed" test are both applied here, against a plain `Set<string>` rather
 * than the typed status union - Lead A is changing that union in the same
 * round, and a row this feed cannot recognise yet must fail closed (left
 * off the Schedule) rather than crash it.
 */
async function invoiceDueItems(range: ScheduleRange, deps: ScheduleDeps): Promise<ScheduleItem[]> {
  const invoices = (await deps.listInvoices()).filter(
    (doc) =>
      doc.dueOn !== null &&
      doc.dueOn >= range.from &&
      doc.dueOn <= range.to &&
      DUE_INVOICE_STATUSES.has(doc.status),
  );

  return invoices.map((doc) => ({
    id: `invoice-due:${doc.id}`,
    kind: "invoice-due",
    sourceId: doc.id,
    date: doc.dueOn as string,
    at: null,
    durationMinutes: null,
    title: `Invoice ${doc.number}`,
    who: invoiceWho(doc),
    place: null,
    href: `/invoices/${doc.id}`,
    contactId: doc.contactId,
    companyId: doc.companyId,
    dealId: doc.dealId,
    phone: null,
  }));
}

async function invoiceIssueItems(
  range: ScheduleRange,
  deps: ScheduleDeps,
): Promise<ScheduleItem[]> {
  const schedules = (await deps.listInvoiceSchedules()).filter(
    (schedule) => schedule.nextIssueOn >= range.from && schedule.nextIssueOn <= range.to,
  );

  return schedules.map((schedule) => ({
    id: `invoice-issue:${schedule.id}`,
    kind: "invoice-issue",
    sourceId: schedule.id,
    date: schedule.nextIssueOn,
    at: null,
    durationMinutes: null,
    title: schedule.dealTitle,
    who: null,
    place: null,
    href: `/deals/${schedule.dealId}`,
    contactId: null,
    companyId: null,
    dealId: schedule.dealId,
    phone: null,
  }));
}

/* -------------------------------------------------------------------------- */
/* the one export                                                             */
/* -------------------------------------------------------------------------- */

/** Everything due in `range`, from every source, sorted the way a day reads. */
export async function scheduleItems(
  range: ScheduleRange,
  deps: ScheduleDeps = repoDeps,
): Promise<ScheduleItem[]> {
  const groups = await Promise.all([
    taskItems(range, deps),
    dealItems(range, deps),
    recurringItems(range, deps),
    invoiceDueItems(range, deps),
    invoiceIssueItems(range, deps),
  ]);
  return groups.flat().sort(compareScheduleItems);
}
