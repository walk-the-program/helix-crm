/**
 * The report period picker, as pure date arithmetic.
 *
 * Ranges are half-open UTC ISO instants: `from <= x < to`. The database stores
 * timestamps as ISO 8601 UTC strings, so a string comparison is the same thing
 * as a date comparison and needs no SQL date functions.
 *
 * The boundaries are worked out from the owner's local calendar - "this month"
 * is his month, not UTC's - and then converted, because a landscaper in Utah
 * closing a job at 6 pm on the 31st expects it in that month.
 */

export type PeriodId = "month" | "quarter" | "year" | "custom";

export type Period = {
  id: PeriodId;
  label: string;
  /** Inclusive ISO instant. */
  from: string;
  /** Exclusive ISO instant. */
  to: string;
};

export type Granularity = "month" | "quarter" | "year";

function localStart(year: number, month: number, day = 1): Date {
  return new Date(year, month, day, 0, 0, 0, 0);
}

/** The period the picker starts on, and the three it offers beside custom. */
export function periodFor(id: Exclude<PeriodId, "custom">, now = new Date()): Period {
  const year = now.getFullYear();
  const month = now.getMonth();

  if (id === "month") {
    return {
      id,
      label: "This month",
      from: localStart(year, month).toISOString(),
      to: localStart(year, month + 1).toISOString(),
    };
  }
  if (id === "quarter") {
    const firstMonth = Math.floor(month / 3) * 3;
    return {
      id,
      label: "This quarter",
      from: localStart(year, firstMonth).toISOString(),
      to: localStart(year, firstMonth + 3).toISOString(),
    };
  }
  return {
    id,
    label: "This year",
    from: localStart(year, 0).toISOString(),
    to: localStart(year + 1, 0).toISOString(),
  };
}

/**
 * A custom range from two `<input type="date">` values, inclusive at both ends
 * the way a person reads them: "1 March to 31 March" covers all of the 31st.
 */
export function customPeriod(fromDate: string, toDate: string): Period | null {
  const start = parseDateOnlyLocal(fromDate);
  const end = parseDateOnlyLocal(toDate);
  if (!start || !end) return null;
  if (end < start) return null;
  const exclusiveEnd = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() + 1,
  );
  return {
    id: "custom",
    label: `${fromDate} to ${toDate}`,
    from: start.toISOString(),
    to: exclusiveEnd.toISOString(),
  };
}

function parseDateOnlyLocal(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = localStart(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `<input type="date">` wants a local calendar day, not an ISO instant. */
export function toDateInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "2026-03" -> "Mar 2026", "2026-Q1" -> "Q1 2026", "2026" -> "2026". */
export function formatBucket(bucket: string, locale?: string): string {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(bucket);
  if (monthMatch) {
    const date = new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1);
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      year: "numeric",
    }).format(date);
  }
  const quarterMatch = /^(\d{4})-Q(\d)$/.exec(bucket);
  if (quarterMatch) return `Q${quarterMatch[2]} ${quarterMatch[1]}`;
  return bucket;
}

/** Days the range covers, used to pick a sensible default bucket size. */
export function daysIn(period: Period): number {
  return (
    (new Date(period.to).getTime() - new Date(period.from).getTime()) / 86_400_000
  );
}

/** One bucket is not a chart; this keeps the default honest. */
export function defaultGranularity(period: Period): Granularity {
  const days = daysIn(period);
  if (days <= 100) return "month";
  if (days <= 1200) return "quarter";
  return "year";
}
