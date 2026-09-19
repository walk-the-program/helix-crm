// Pure date helpers.
//
// Storage convention (see docs/PLAN.md): `due_on` / `expected_on` are dates
// without time, always local-calendar strings ("YYYY-MM-DD"); `occurred_at` /
// `due_at` / general timestamps are ISO 8601 UTC strings, displayed local.
//
// Overdue rule: `due_at < now` when `due_at` is set, otherwise
// `due_on < today` (today is a local calendar day). A task with `doneAt` set
// is never overdue and never due today. A task with neither `dueOn` nor
// `dueAt` is never overdue.

import { differenceInCalendarDays } from "date-fns";

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(d: Date): string {
  return d.toISOString();
}

export function parseIso(s: string): Date | null {
  if (!s || s.trim() === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format a Date's LOCAL calendar fields as "YYYY-MM-DD". Never uses UTC. */
export function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${year}-${month}-${day}`;
}

export function todayLocal(): string {
  return toLocalDateString(new Date());
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a "YYYY-MM-DD" string into a Date at LOCAL midnight. */
export function parseDateOnly(s: string): Date | null {
  const match = DATE_ONLY_RE.exec(s.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Guard against overflow dates like 2026-02-31 rolling into March.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

export function addDaysToDateString(dateOnly: string, days: number): string {
  const d = parseDateOnly(dateOnly);
  if (!d) return dateOnly;
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

export function isOverdue(
  task: { dueOn?: string | null; dueAt?: string | null; doneAt?: string | null },
  now?: Date,
): boolean {
  if (task.doneAt) return false;

  const nowDate = now ?? new Date();

  if (task.dueAt) {
    const dueAt = parseIso(task.dueAt);
    if (!dueAt) return false;
    return dueAt.getTime() < nowDate.getTime();
  }

  if (task.dueOn) {
    const dueOn = parseDateOnly(task.dueOn);
    if (!dueOn) return false;
    const today = parseDateOnly(toLocalDateString(nowDate));
    if (!today) return false;
    return dueOn.getTime() < today.getTime();
  }

  return false;
}

export function isDueToday(
  task: { dueOn?: string | null; doneAt?: string | null },
  now?: Date,
): boolean {
  if (task.doneAt) return false;
  if (!task.dueOn) return false;

  const dueOn = parseDateOnly(task.dueOn);
  if (!dueOn) return false;

  const nowDate = now ?? new Date();
  const today = toLocalDateString(nowDate);
  return task.dueOn === today || toLocalDateString(dueOn) === today;
}

export function daysBetween(aIso: string, bIso: string): number {
  const a = parseIso(aIso);
  const b = parseIso(bIso);
  if (!a || !b) return 0;
  return differenceInCalendarDays(b, a);
}

export function formatDateDisplay(value: string | null | undefined, locale?: string): string {
  if (!value) return "";

  const dateOnly = parseDateOnly(value);
  const d = dateOnly ?? parseIso(value);
  if (!d) return "";

  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

export function formatDateTimeDisplay(value: string | null | undefined, locale?: string): string {
  if (!value) return "";

  const d = parseIso(value) ?? parseDateOnly(value);
  if (!d) return "";

  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

export function formatRelative(value: string | null | undefined, now?: Date): string {
  if (!value) return "";

  const d = parseIso(value) ?? parseDateOnly(value);
  if (!d) return "";

  const nowDate = now ?? new Date();

  if (toLocalDateString(d) === toLocalDateString(nowDate) && parseIso(value)) {
    // Same calendar day and a real timestamp (not a date-only value): "today".
    const diffMs = Math.abs(nowDate.getTime() - d.getTime());
    if (diffMs < 24 * 60 * 60 * 1000) return "today";
  }

  const isFuture = d.getTime() > nowDate.getTime();
  const diffMs = d.getTime() - nowDate.getTime();
  const diffDays = Math.round(Math.abs(diffMs) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "today";
  if (isFuture) {
    return diffDays === 1 ? "in 1 day" : `in ${diffDays} days`;
  }
  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
}
