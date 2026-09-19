/**
 * Grouping for the Tasks screen: Overdue, Today, Next 7 days, Later, Done.
 *
 * The rule is PLAN.md item 5. `due_on` is always set when any due date exists
 * and `due_at` only refines it, so the buckets are decided on `due_on` and
 * overdue additionally respects a time when one is present. Pure, so the
 * boundaries (midnight, "seven days", a task with no date at all) are testable
 * without a clock or a database.
 */
import { addDaysToDateString, isOverdue, todayLocal } from "@/lib/dates";

export type GroupableTask = {
  id: string;
  dueOn: string | null;
  dueAt: string | null;
  doneAt: string | null;
};

export const TASK_GROUP_IDS = ["overdue", "today", "next7", "later", "done"] as const;
export type TaskGroupId = (typeof TASK_GROUP_IDS)[number];

export const TASK_GROUP_LABELS: Record<TaskGroupId, string> = {
  overdue: "Overdue",
  today: "Today",
  next7: "Next 7 days",
  later: "Later",
  done: "Done",
};

export type TaskGroup<T> = { id: TaskGroupId; label: string; tasks: T[] };

export function groupIdFor(
  task: GroupableTask,
  reference: string = todayLocal(),
  now?: Date,
): TaskGroupId {
  if (task.doneAt) return "done";
  if (isOverdue(task, now)) return "overdue";
  if (task.dueOn === null) return "later";
  if (task.dueOn <= reference) return "today";
  if (task.dueOn <= addDaysToDateString(reference, 7)) return "next7";
  return "later";
}

/**
 * Inside a group: soonest first, then the timed ones before the all-day ones,
 * then oldest-created. Done is newest-completed first, because that is the
 * "did I already do this?" question.
 */
function compare(a: GroupableTask, b: GroupableTask, done: boolean): number {
  if (done) {
    return String(b.doneAt ?? "").localeCompare(String(a.doneAt ?? ""));
  }
  const aDue = a.dueOn ?? "9999-12-31";
  const bDue = b.dueOn ?? "9999-12-31";
  if (aDue !== bDue) return aDue.localeCompare(bDue);
  const aAt = a.dueAt ?? "";
  const bAt = b.dueAt ?? "";
  if (aAt !== bAt) {
    if (aAt === "") return 1;
    if (bAt === "") return -1;
    return aAt.localeCompare(bAt);
  }
  return a.id.localeCompare(b.id);
}

/** Every group, in screen order. Empty groups are dropped by the caller. */
export function groupTasks<T extends GroupableTask>(
  tasks: T[],
  reference: string = todayLocal(),
  now?: Date,
): TaskGroup<T>[] {
  const buckets: Record<TaskGroupId, T[]> = {
    overdue: [],
    today: [],
    next7: [],
    later: [],
    done: [],
  };

  for (const task of tasks) {
    buckets[groupIdFor(task, reference, now)].push(task);
  }

  return TASK_GROUP_IDS.map((id) => ({
    id,
    label: TASK_GROUP_LABELS[id],
    tasks: buckets[id].sort((a, b) => compare(a, b, id === "done")),
  }));
}

/** The one-line due label on a task row. */
export function dueLabel(
  task: GroupableTask,
  reference: string = todayLocal(),
  locale?: string,
): string {
  if (!task.dueOn) return "No due date";

  const time = task.dueAt ? formatTime(task.dueAt, locale) : "";
  const tomorrow = addDaysToDateString(reference, 1);

  let day: string;
  if (task.dueOn === reference) day = "Today";
  else if (task.dueOn === tomorrow) day = "Tomorrow";
  else day = formatDay(task.dueOn, locale);

  return time.length > 0 ? `${day} at ${time}` : day;
}

function formatDay(dateOnly: string, locale?: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) return dateOnly;
  const date = new Date(year, month - 1, day);
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return dateOnly;
  }
}

function formatTime(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

/**
 * A date and an optional "HH:MM" from the form become the pair the repository
 * wants. An empty date clears both.
 */
export function dueFromForm(
  dueOn: string,
  dueTime: string,
): { dueOn: string | null; dueAt: string | null } {
  const date = dueOn.trim();
  if (date.length === 0) return { dueOn: null, dueAt: null };

  const time = dueTime.trim();
  if (!/^\d{2}:\d{2}$/.test(time)) return { dueOn: date, dueAt: null };

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || !month || !day) return { dueOn: date, dueAt: null };

  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(local.getTime())) return { dueOn: date, dueAt: null };
  return { dueOn: date, dueAt: local.toISOString() };
}

/** The reverse, for the edit form: the local "HH:MM" behind a `due_at`. */
export function timeFromDueAt(dueAt: string | null): string {
  if (!dueAt) return "";
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
