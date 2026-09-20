// Pure money helpers. Money is ALWAYS integer cents in the database; these
// helpers convert to/from display strings.

const DEFAULT_CURRENCY = "USD";

export function formatMoney(cents: number, currency?: string, locale?: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency ?? DEFAULT_CURRENCY,
    }).format(amount);
  } catch {
    return `${currency ?? DEFAULT_CURRENCY} ${amount.toFixed(2)}`;
  }
}

export function formatMoneyCompact(cents: number, currency?: string, locale?: string): string {
  const abs = Math.abs(cents);
  if (abs < 1000_00) {
    return formatMoney(cents, currency, locale);
  }

  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency ?? DEFAULT_CURRENCY,
      notation: "compact",
      // Pinned on both ends: ICU otherwise clamps the currency default of two
      // decimals down to one and prints "$120.0K" on some Node builds.
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatMoney(cents, currency, locale);
  }
}

export function parseMoneyToCents(input: string, currency?: string): number | null {
  void currency;
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Strip currency symbols and any whitespace (including thin/non-breaking
  // spaces used as thousands separators in some locales).
  let cleaned = trimmed.replace(/[^\d.,\-+\s]/g, "").replace(/\s/g, "");
  if (cleaned === "") return null;

  const isNegative = /^-/.test(cleaned) || /^\(.*\)$/.test(trimmed);
  cleaned = cleaned.replace(/^[-+]/, "");
  if (cleaned === "") return null;

  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");

  let normalized: string;
  if (hasDot && hasComma) {
    // Whichever separator appears last is the decimal separator.
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastDot) {
      // Comma is decimal separator; dot(s) are thousands separators.
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // Dot is decimal separator; comma(s) are thousands separators.
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Only commas present: treat as decimal separator (e.g. "1234,56"),
    // unless it looks like a thousands grouping with exactly 3 digits after
    // each comma and more than one group (e.g. "1,234,567").
    const parts = cleaned.split(",");
    const looksLikeThousands =
      parts.length > 1 && parts.slice(1).every((p) => p.length === 3) && parts[0].length <= 3;
    normalized = looksLikeThousands ? parts.join("") : cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  if (!Number.isFinite(Number(normalized))) return null;

  const cents = decimalStringToCents(normalized);
  return isNegative && cents !== 0 ? -cents : cents;
}

/**
 * Converts a "123", "123.4", or "123.456..." string to integer cents using
 * string-based rounding (round-half-up on the third fractional digit), which
 * avoids binary floating-point rounding errors like `1.005 * 100 === 100.49999...`.
 */
function decimalStringToCents(normalized: string): number {
  const [intPart, fracPartRaw = ""] = normalized.split(".");
  const fracPadded = `${fracPartRaw}000`.slice(0, 3);
  const wholeCents = Number(intPart) * 100 + Number(fracPadded.slice(0, 2));
  const roundingDigit = Number(fracPadded[2]);
  return roundingDigit >= 5 ? wholeCents + 1 : wholeCents;
}

export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const wholePart = Math.floor(abs / 100);
  const centPart = abs % 100;
  const sign = negative && abs !== 0 ? "-" : "";
  return `${sign}${wholePart}.${pad2(centPart)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function sumCents(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/* -------------------------------------------------------------------------- */
/* the revenue breakdown (D20)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Money with the cents dropped when there are none.
 *
 * A price list is written in round numbers - $150, $1,500 - and ".00" after
 * every one of them is two characters of noise on every row of the board. An
 * amount that genuinely has cents keeps them, so nothing is ever rounded away
 * in front of the owner.
 */
export function formatMoneyTrim(cents: number, currency?: string, locale?: string): string {
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency ?? DEFAULT_CURRENCY,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return formatMoney(cents, currency, locale);
  }
}

/** "$150/mo". The short form, because it sits inside a row. */
export function formatMonthly(cents: number, currency?: string, locale?: string): string {
  return `${formatMoneyTrim(cents, currency, locale)}/mo`;
}

/**
 * What a deal is worth, said the way the owner says it.
 *
 * A deal priced from the services catalog has two halves, and one number
 * hiding both of them is the thing D20 set out to stop: "$3,300" tells him
 * nothing about whether that is a patio or a maintenance contract. So the
 * money is always written as the breakdown -
 *
 *   "$1,500 + $150/mo"   both halves
 *   "$1,500"             nothing recurring
 *   "$150/mo"            nothing up front
 *
 * - and `upfrontLabel` puts the word "Upfront" in front of the first half
 * where there is room for it, which is the deal page.
 */
export function formatBreakdown(
  oneTimeCents: number,
  recurringMonthlyCents: number,
  options: { currency?: string; locale?: string; upfrontLabel?: boolean } = {},
): string {
  const { currency, locale, upfrontLabel = false } = options;
  const upfront = formatMoneyTrim(oneTimeCents, currency, locale);
  const monthly = formatMonthly(recurringMonthlyCents, currency, locale);

  if (recurringMonthlyCents === 0) return upfront;
  if (oneTimeCents === 0) return monthly;
  return `${upfrontLabel ? "Upfront " : ""}${upfront} + ${monthly}`;
}
