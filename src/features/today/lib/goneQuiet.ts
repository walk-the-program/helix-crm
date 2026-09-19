/**
 * The gone-quiet rule, as pure arithmetic.
 *
 * docs/PLAN.md item 11: an open deal whose last sign of life —
 * `max(stage_entered_at, the newest activity's occurred_at)` — is older than
 * its stage's `quiet_days` surfaces on Today. `quiet_days = 0` disables the
 * rule for that stage. Won and lost stages are never quiet: the deal is done.
 *
 * `deals.goneQuiet()` already does this selection in SQL, and Today uses it —
 * one query beats pulling every open deal into JavaScript. What SQL cannot
 * give back cheaply is the *explanation* each row has to carry ("No activity
 * for 21 days · Limit 14"), and date arithmetic buried in a `julianday()`
 * expression cannot be unit tested. So the same rule lives here twice on
 * purpose: SQL decides which rows to fetch, this module decides what the row
 * says and double-checks the verdict, and `tests/unit/today/goneQuiet.test.ts`
 * pins the edges (a deal that has never had an activity, a stage with
 * quiet_days 0, a future timestamp from a laptop with a wrong clock).
 *
 * Everything here counts whole days between two instants — not calendar days.
 * A deal that went quiet at 9am on the 1st is 14 days quiet at 9am on the
 * 15th, not at midnight on the 15th. That matches the `julianday()` difference
 * the repository uses, so the two never disagree about a boundary.
 */

import { parseIso } from "@/lib/dates";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The minimum a deal must carry for the rule to have an opinion about it. */
export type QuietInput = {
  /** When the deal entered its current stage (ISO 8601 UTC). */
  stageEnteredAt: string;
  /** The newest non-deleted activity on the deal, or null if it has none. */
  lastActivityAt?: string | null;
  /** The stage's quiet_days. 0 disables the rule. */
  quietDays: number;
  /** Won and lost deals are out of the rule whatever their dates say. */
  stageIsWon?: boolean;
  stageIsLost?: boolean;
};

export type QuietVerdict = {
  /** True when the deal belongs in Today's "Gone quiet" section. */
  quiet: boolean;
  /** The later of stage entry and last activity — the last sign of life. */
  lastTouchAt: string | null;
  /** Whole days since that last sign of life. 0 when it cannot be worked out. */
  daysQuiet: number;
  /** The stage's limit, echoed back so the row can say "Limit 14". */
  limitDays: number;
  /**
   * Why the rule did not fire, for the cases where it did not. `null` when it
   * did. Useful in tests and in a future "why is this not here?" affordance.
   */
  reason: "quiet" | "closed" | "disabled" | "recent" | "unknown-dates";
};

/**
 * The later of two ISO timestamps, ignoring ones that will not parse. A row
 * with a corrupt date must not silently become "quiet for 20,000 days".
 */
export function lastTouch(
  stageEnteredAt: string,
  lastActivityAt?: string | null,
): string | null {
  const entered = parseIso(stageEnteredAt);
  const activity = lastActivityAt ? parseIso(lastActivityAt) : null;
  if (!entered && !activity) return null;
  if (!entered) return activity!.toISOString();
  if (!activity) return entered.toISOString();
  return (activity.getTime() > entered.getTime() ? activity : entered).toISOString();
}

/**
 * Whole days between two instants, floored, never negative.
 *
 * Floored, because "13.9 days quiet" is 13 days quiet and a 14-day limit has
 * not been crossed yet. Never negative, because a laptop whose clock is ahead
 * writes timestamps in the future, and "-3 days quiet" on screen would be a
 * bug report we cannot reproduce.
 */
export function daysSince(fromIso: string | null, nowIso: string): number {
  const from = fromIso ? parseIso(fromIso) : null;
  const now = parseIso(nowIso);
  if (!from || !now) return 0;
  const diff = now.getTime() - from.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / MS_PER_DAY);
}

/** The rule itself. */
export function quietVerdict(input: QuietInput, nowIso: string): QuietVerdict {
  const limitDays = Number.isFinite(input.quietDays)
    ? Math.max(0, Math.trunc(input.quietDays))
    : 0;
  const touched = lastTouch(input.stageEnteredAt, input.lastActivityAt);
  const daysQuiet = daysSince(touched, nowIso);

  const base = { lastTouchAt: touched, daysQuiet, limitDays };

  if (input.stageIsWon || input.stageIsLost) {
    return { ...base, quiet: false, reason: "closed" };
  }
  if (limitDays === 0) {
    return { ...base, quiet: false, reason: "disabled" };
  }
  if (touched === null) {
    return { ...base, quiet: false, reason: "unknown-dates" };
  }
  if (daysQuiet < limitDays) {
    return { ...base, quiet: false, reason: "recent" };
  }
  return { ...base, quiet: true, reason: "quiet" };
}

/** Convenience wrapper: just the boolean. */
export function isGoneQuiet(input: QuietInput, nowIso: string): boolean {
  return quietVerdict(input, nowIso).quiet;
}

/**
 * The sentence under a Gone quiet row. Spelled out rather than "21d/14d",
 * because the owner reads this at a kitchen table, not in a terminal.
 */
export function describeQuiet(verdict: QuietVerdict): string {
  const days =
    verdict.daysQuiet === 1 ? "1 day" : `${verdict.daysQuiet} days`;
  const never = verdict.lastTouchAt === null;
  if (never) return `No activity yet · Limit ${verdict.limitDays} days`;
  return `No activity for ${days} · Limit ${verdict.limitDays} days`;
}

/**
 * Sort order for the section: the longest-quiet deal first, then the largest
 * value, then the title, so the list is stable between renders.
 */
export function compareQuiet(
  a: { daysQuiet: number; valueCents: number; title: string },
  b: { daysQuiet: number; valueCents: number; title: string },
): number {
  if (a.daysQuiet !== b.daysQuiet) return b.daysQuiet - a.daysQuiet;
  if (a.valueCents !== b.valueCents) return b.valueCents - a.valueCents;
  return a.title.localeCompare(b.title);
}

/**
 * Snoozing a quiet deal for a week is not a stored field: it writes a system
 * activity, which moves `max(stage_entered_at, last activity)` to now, and the
 * deal drops out of the rule for another `quiet_days`. That means "snooze a
 * week" only really lasts a week when the stage's limit is 7 — with the
 * default 14 it buys a fortnight. Rather than pretend, the button says what it
 * does and this helper writes the body the timeline shows.
 *
 * Doing it this way keeps one source of truth (the activity trail) instead of
 * a second, invisible snooze column that the rule would also have to consult.
 */
export function snoozeActivityBody(limitDays: number): string {
  return `Snoozed on Today. Back in ${limitDays} ${limitDays === 1 ? "day" : "days"} if nothing happens.`;
}
