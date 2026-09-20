/**
 * The words on a Schedule row: what kind of thing it is, when it happens,
 * and how long it takes.
 *
 * All three read off the row rather than off the table it came from, so a
 * screen never has to know that a "visit" and a "task" are both rows in
 * `tasks`, or that "invoice due" and "invoice to issue" are both documents.
 * `kindLabel` is the one place any of these six words gets typed, and it
 * takes the workspace's vocabulary rather than assuming Deals - a shop that
 * calls them jobs should see "Job expected" on this screen exactly as it
 * does everywhere else (DESIGN.md, the vocabulary system).
 */
import { parseIso } from "@/lib/dates";
import type { Vocabulary } from "@/lib/vocabulary";
import type { ScheduleItem, ScheduleKind } from "@/features/schedule/lib/types";

/** "Visit", "Task", "Job expected", "Reminder due", … - the owner's word for the row. */
export function kindLabel(kind: ScheduleKind, vocabulary: Vocabulary): string {
  switch (kind) {
    case "visit":
      return "Visit";
    case "task":
      return "Task";
    case "deal-expected":
      return `${vocabulary.one} expected`;
    case "recurring-due":
      return "Reminder due";
    case "invoice-due":
      return "Invoice due";
    case "invoice-issue":
      return "Invoice to issue";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * A fixed 24-hour clock ("09:00"), not the browser's own AM/PM choice.
 *
 * `TimePicker` lets the locale decide AM/PM because a value the owner is
 * typing should look the way his own clock does. A schedule row is not being
 * typed into - it sits next to six other rows on the same day, and a column
 * of "9:00 AM" beside "1:30 PM" beside "9:00 AM" again reads worse than one
 * that never changes shape. `locale` still reaches `Intl`, so the digits
 * themselves follow the workspace's script.
 */
function clockLabel(iso: string, locale?: string): string {
  const d = parseIso(iso);
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  } catch {
    return "";
  }
}

function addMinutesIso(iso: string, minutes: number): string | null {
  const d = parseIso(iso);
  if (!d) return null;
  return new Date(d.getTime() + minutes * 60 * 1000).toISOString();
}

/** "09:00", or "09:00 – 10:30" once a duration is known. Empty for an all-day row. */
export function timeLabel(item: ScheduleItem, locale?: string): string {
  if (!item.at) return "";
  const start = clockLabel(item.at, locale);
  if (!start) return "";
  if (!item.durationMinutes) return start;

  const endIso = addMinutesIso(item.at, item.durationMinutes);
  const end = endIso ? clockLabel(endIso, locale) : "";
  return end ? `${start} – ${end}` : start;
}

/** "30 min", "1 hr", "1 hr 30 min" - how long to allow. Empty when there is nothing to allow. */
export function durationLabel(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins} min`;
  if (mins === 0) return `${hrs} hr`;
  return `${hrs} hr ${mins} min`;
}
