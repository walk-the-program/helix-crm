/**
 * Monday-first week arithmetic for the Schedule.
 *
 * The week starts on Monday, always - there is no setting for it and there
 * will not be one. A tradesperson's week is the working week, and a screen
 * that opened on Sunday would put the day just gone at the far end of the
 * grid instead of the near one.
 *
 * Every function here works on local calendar days ("YYYY-MM-DD") and does
 * the arithmetic on local `Date`s built by `parseDateOnly` - never on raw
 * milliseconds - so a week that crosses a daylight-saving change still comes
 * out with exactly seven distinct days. date-fns's own `startOfWeek`,
 * `addWeeks` and `addDays` do the same local-field arithmetic `due_on`
 * shifting already relies on elsewhere in the product (see
 * `tasks.shiftDueAtToDate`), which is why they are trusted here instead of
 * hand-rolled.
 *
 * A string that cannot be parsed comes back unchanged rather than throwing -
 * a corrupt or unexpected value should not take the whole week view down.
 */
import { addDays as addDaysFns, addWeeks, startOfWeek } from "date-fns";
import { parseDateOnly, toLocalDateString } from "@/lib/dates";

/** The Monday of the week `dateOnly` falls in. */
export function startOfWeekMonday(dateOnly: string): string {
  const parsed = parseDateOnly(dateOnly);
  if (!parsed) return dateOnly;
  return toLocalDateString(startOfWeek(parsed, { weekStartsOn: 1 }));
}

/** `dateOnly` shifted by a whole number of days, local calendar fields only. */
export function addDays(dateOnly: string, days: number): string {
  const parsed = parseDateOnly(dateOnly);
  if (!parsed) return dateOnly;
  return toLocalDateString(addDaysFns(parsed, days));
}

/** `dateOnly` shifted by a whole number of weeks, same weekday every time. */
export function addWeeksToDate(dateOnly: string, weeks: number): string {
  const parsed = parseDateOnly(dateOnly);
  if (!parsed) return dateOnly;
  return toLocalDateString(addWeeks(parsed, weeks));
}

/**
 * The seven days of the week that starts on `weekStart`, Monday first.
 *
 * `weekStart` is expected to already be a Monday (the caller normally got it
 * from `startOfWeekMonday`), but this does not re-derive it - a grid that
 * asked for the wrong Monday should show the wrong week, not a silently
 * corrected one.
 */
export function weekDays(weekStart: string): string[] {
  const parsed = parseDateOnly(weekStart);
  if (!parsed) return Array.from({ length: 7 }, () => weekStart);
  return Array.from({ length: 7 }, (_, i) => toLocalDateString(addDaysFns(parsed, i)));
}

/** Whether two "YYYY-MM-DD" values name the same calendar day. */
export function isSameDay(a: string, b: string): boolean {
  const da = parseDateOnly(a);
  const db = parseDateOnly(b);
  if (!da || !db) return a === b;
  return da.getTime() === db.getTime();
}

/** A locale-aware month name, guarded the way every label below is. */
function monthName(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(date);
}

/**
 * "22 – 28 September 2026" for a week inside one month; "28 September –
 * 4 October 2026" when it crosses one; the year is repeated on both ends
 * when it also crosses a year boundary. A locale that `Intl` rejects falls
 * back to the raw `weekStart` value, the way `src/lib/dates.ts` falls back
 * on a bad locale, rather than throwing out of a header render.
 */
export function weekRangeLabel(weekStart: string, locale?: string): string {
  const start = parseDateOnly(weekStart);
  if (!start) return weekStart;
  try {
    const end = addDaysFns(start, 6);
    const startDay = start.getDate();
    const endDay = end.getDate();
    const startMonth = monthName(start, locale);
    const endMonth = monthName(end, locale);
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();

    if (startYear !== endYear) {
      return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`;
    }
    if (startMonth !== endMonth) {
      return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${startYear}`;
    }
    return `${startDay} – ${endDay} ${startMonth} ${startYear}`;
  } catch {
    return weekStart;
  }
}

/** "Monday 22 September" - a day agenda's own title. */
export function dayLabel(dateOnly: string, locale?: string): string {
  const d = parseDateOnly(dateOnly);
  if (!d) return dateOnly;
  try {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d);
    return `${weekday} ${d.getDate()} ${monthName(d, locale)}`;
  } catch {
    return dateOnly;
  }
}

/** "Mon" - a week grid's column header. */
export function shortDayLabel(dateOnly: string, locale?: string): string {
  const d = parseDateOnly(dateOnly);
  if (!d) return dateOnly;
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  } catch {
    return dateOnly;
  }
}

/** "22" - the bare day number, through `Intl` so its digits follow the locale too. */
export function dayNumberLabel(dateOnly: string, locale?: string): string {
  const d = parseDateOnly(dateOnly);
  if (!d) return dateOnly;
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric" }).format(d);
  } catch {
    return dateOnly;
  }
}
