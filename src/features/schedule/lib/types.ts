/**
 * What the Schedule shows: one shape for six different rows.
 *
 * The owner's week is not made of one kind of record. It is a visit at nine,
 * a job he said he would start on Thursday, a reminder that came round again,
 * an invoice that falls due on Friday and the monthly bill that goes out on
 * the first. Those live in five tables and the Schedule is the one place that
 * reads them together, so they arrive here as one union and the screens never
 * branch on which repository a row came from.
 *
 * Decision PX-6: there is no `schedule_items` table and there never will be.
 * `scheduleItems(range)` (./feed.ts) derives this list on every read from the
 * rows that are already the truth. A denormalised copy would be a second
 * answer to "when is that", and the two would disagree the first time someone
 * moved a date outside this screen.
 */

/**
 * The six kinds, in the order they sort within one day when neither has a
 * time. A visit comes before a task because the owner has to be somewhere;
 * the money rows come last because they are dates, not appointments.
 */
export const SCHEDULE_KINDS = [
  "visit",
  "task",
  "deal-expected",
  "recurring-due",
  "invoice-due",
  "invoice-issue",
] as const;

export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** Who the row is about, and the record page that says more. */
export type ScheduleWho = {
  label: string;
  href: string;
};

export type ScheduleItem = {
  /** `${kind}:${sourceId}`. Stable across reads; used as the React key. */
  id: string;
  kind: ScheduleKind;
  /** The id of the row this came from: a task, a deal, a rule, a document. */
  sourceId: string;
  /** The local calendar day it belongs to, "YYYY-MM-DD". Always set. */
  date: string;
  /**
   * The instant it starts, for a timed item; null for an all-day one. Only
   * tasks with a `due_at` ever have one — nothing else in the product carries
   * a time, which is exactly the gap the visit dialog fills.
   */
  at: string | null;
  /** How long to allow, in minutes. Null unless the task carries one. */
  durationMinutes: number | null;
  /** What it is, in the owner's words: the task title, the deal title, … */
  title: string;
  /** The customer. Null for a standalone task with no record attached. */
  who: ScheduleWho | null;
  /** Where the visit is. Only a task ever has one. */
  place: string | null;
  /** The record this row links to, e.g. "/deals/abc" or "/tasks". */
  href: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  /** The customer's first phone, for the calendar export's description. */
  phone: string | null;
};

/** An inclusive range of local calendar days. */
export type ScheduleRange = { from: string; to: string };

const KIND_RANK: Record<ScheduleKind, number> = {
  visit: 0,
  task: 1,
  "deal-expected": 2,
  "recurring-due": 3,
  "invoice-due": 4,
  "invoice-issue": 5,
};

/**
 * The order a day reads in: timed items first, earliest to latest, then the
 * all-day ones grouped by kind and then alphabetically, so the list does not
 * reshuffle itself between two reads of the same data.
 */
export function compareScheduleItems(a: ScheduleItem, b: ScheduleItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.at && !b.at) return -1;
  if (!a.at && b.at) return 1;
  if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A task with a time on it is a visit; a task without one is a task. */
export function kindForTask(task: { dueAt: string | null }): ScheduleKind {
  return task.dueAt ? "visit" : "task";
}

/** Everything on one calendar day, in day order. */
export function itemsOn(items: readonly ScheduleItem[], date: string): ScheduleItem[] {
  return items.filter((item) => item.date === date).sort(compareScheduleItems);
}

/** How many items each day of a range holds, keyed by "YYYY-MM-DD". */
export function countByDate(items: readonly ScheduleItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.date, (counts.get(item.date) ?? 0) + 1);
  }
  return counts;
}
