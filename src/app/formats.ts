/**
 * One place a screen asks how this workspace writes money and dates.
 *
 * The pure helpers in `src/lib/money.ts` and `src/lib/dates.ts` have always
 * taken an optional currency and locale, and they still do — nothing about
 * their signatures changes. The problem the CPO walk found was not the
 * helpers, it was the call sites: 54 money calls and 42 date calls passed
 * neither argument, so every Reports screen rendered US dollars in the
 * browser's locale to a workspace the owner had set to Canadian dollars
 * (docs/rounds/2026-09-20-cpo-cdqo-record.md, F-LC-1). Passing two more
 * arguments at ninety-six call sites is exactly the kind of thing that is
 * right on the day and wrong six months later, so the fix is a hook that
 * carries them for you:
 *
 *   const f = useFormats();
 *   f.money(deal.valueCents)   // "CA$12,450.00"
 *   f.date(task.dueOn)         // "14 Mar 2026"
 *   f.dateTime(activity.at)    // "14 Mar 2026, 09:30"
 *
 * It reads the same `qk.settings()` query the settings screens write through,
 * so changing Currency or Date format in Settings > Workspace updates every
 * mounted screen without a reload — which is the behaviour the setting always
 * promised and never had.
 *
 * Until the query resolves it formats with the repository's own defaults (USD,
 * en-US), which is what every call site did unconditionally before this
 * existed: the first paint is never worse than it was, and it is right one
 * tick later.
 *
 * `money(cents, currency?)` keeps an override for the one real case — a
 * document that was issued in a currency the workspace has since changed away
 * from should still print what it was issued in.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { qk } from "@/app/queryClient";
import * as settingsRepo from "@/db/repos/settings";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { formatDateDisplay, formatDateTimeDisplay } from "@/lib/dates";

/** What the repository falls back to, repeated here for the pre-load render. */
export const FALLBACK_CURRENCY = "USD";
export const FALLBACK_LOCALE = "en-US";
export const FALLBACK_REGION = "US";

/**
 * What a zero looks like inside a money table covering a period.
 *
 * A column of "$0.00" is eleven characters the eye has to read before it can
 * throw them away; an em dash says "nothing happened here" at a glance and
 * leaves the figures that matter as the only ink in the column. This is the
 * table rule only — a headline figure keeps "$0.00", because there the zero is
 * the answer to the question the screen asked. A dashed cell still sums as
 * zero, so no total moves.
 */
export const ZERO_DASH = "—";

export type Formats = {
  /** Integer cents → the workspace's currency and locale. */
  money: (cents: number, currency?: string) => string;
  /**
   * The same, except that a zero is `ZERO_DASH`. For a cell in a money table
   * covering a period; pair it with `dashZero` on the kit's `TD` so the dash
   * is drawn in faint ink.
   */
  moneyOrDash: (cents: number, currency?: string) => string;
  /** Integer cents → the same, abbreviated over $100k ("CA$1.2M"). */
  moneyCompact: (cents: number, currency?: string) => string;
  /** An ISO date or date-only string → the workspace's locale. */
  date: (value: string | null | undefined) => string;
  /** An ISO timestamp → the workspace's locale, with the time. */
  dateTime: (value: string | null | undefined) => string;
  /** The raw values, for the few places that need them (phone parsing, Intl). */
  currency: string;
  locale: string;
  region: string;
};

/**
 * Build the formatter set from explicit values.
 *
 * Exported so a unit test — and any non-React caller — can hold the same
 * behaviour without a QueryClient, and so the hook below is a two-line wrapper
 * rather than the place the logic lives.
 */
export function makeFormats(input: {
  currency?: string | null;
  locale?: string | null;
  region?: string | null;
}): Formats {
  const currency = input.currency || FALLBACK_CURRENCY;
  const locale = input.locale || FALLBACK_LOCALE;
  const region = input.region || FALLBACK_REGION;
  return {
    money: (cents, override) => formatMoney(cents, override || currency, locale),
    moneyOrDash: (cents, override) =>
      cents === 0 ? ZERO_DASH : formatMoney(cents, override || currency, locale),
    moneyCompact: (cents, override) =>
      formatMoneyCompact(cents, override || currency, locale),
    date: (value) => formatDateDisplay(value, locale),
    dateTime: (value) => formatDateTimeDisplay(value, locale),
    currency,
    locale,
    region,
  };
}

/**
 * The hook every screen uses.
 *
 * `qk.settings()` is the key `src/features/settings/lib/queries.ts` reads and
 * invalidates, so this is the same cache entry the settings screens already
 * keep warm — no second fetch, and one invalidation moves both.
 */
export function useFormats(): Formats {
  const { data } = useQuery({
    queryKey: qk.settings(),
    queryFn: () => settingsRepo.getAll(),
  });
  return useMemo(
    () =>
      makeFormats({
        currency: data?.currency,
        locale: data?.locale,
        region: data?.defaultRegion,
      }),
    [data?.currency, data?.locale, data?.defaultRegion],
  );
}
