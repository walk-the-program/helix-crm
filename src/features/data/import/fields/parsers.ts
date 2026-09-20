/**
 * Turning a CSV cell into a value, one parser per `ParserKind`.
 *
 * Every parser is total: it always returns a `ParseResult`, and it says what
 * went wrong in `warning` rather than throwing. An import must never stop on a
 * bad cell - the row still goes in, the owner gets told what Helix could not
 * read, and the warnings list on the result screen is the receipt.
 *
 * Pure: no database, no filesystem, no clock beyond what the caller passes.
 */
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { normalizePhone } from "@/lib/phone";
import { parseMoneyToCents } from "@/lib/money";
import type { FieldDefinition, ParseResult } from "@/features/data/import/fields/types";

export type ParseOptions = { region?: string };

const EMPTY: ParseResult = { value: null };

/* -------------------------------------------------------------------------- */
/* text                                                                       */
/* -------------------------------------------------------------------------- */

/** Whitespace collapsed, nothing else touched. */
export function parseText(raw: string): ParseResult {
  const value = raw.trim().replace(/\s+/g, " ");
  return value.length === 0 ? EMPTY : { value };
}

/* -------------------------------------------------------------------------- */
/* money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * "$12,500.00", "12500", "12.500,00", "(250)" -> cents.
 *
 * A cell a spreadsheet wrote as text ("call for quote", "TBD") is not an error
 * in an import: the deal goes in at zero and the owner is told which row.
 */
export function parseMoney(raw: string, label = "amount"): ParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return EMPTY;
  const cents = parseMoneyToCents(trimmed);
  if (cents === null) {
    // Named rather than prefixed with an article: the label is the column's
    // own word ("value", "price", "upfront"), and "an value" is how a
    // generated sentence tells the owner a machine wrote it.
    return {
      value: null,
      warning: `Helix could not read "${trimmed}" as a number, so the ${label} was left at zero.`,
    };
  }
  return { value: cents };
}

/* -------------------------------------------------------------------------- */
/* date                                                                       */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d, 12);
  return (
    probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
  );
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Two digits: 70..99 is last century, everything else is this one. */
function expandYear(y: number): number {
  if (y >= 1000) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

/**
 * Every date shape a CRM export or a spreadsheet actually writes, to
 * "YYYY-MM-DD".
 *
 * Slashed and dotted dates are read US-first (`3/4/2026` is 4 March), which is
 * what a Utah trade owner's spreadsheet means, and flipped when the first
 * number cannot be a month (`14/3/2026`).
 */
export function parseDate(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return EMPTY;

  const unreadable: ParseResult = {
    value: null,
    warning: `"${trimmed}" is not a date Helix can read. It was left blank.`,
  };

  // 2026-03-14, 2026-03-14T09:00:00Z, 2026/03/14
  const isoish = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(trimmed);
  if (isoish) {
    const [, y, m, d] = isoish.map(Number);
    return isRealDate(y, m, d) ? { value: iso(y, m, d) } : unreadable;
  }

  // 3/14/2026, 03-14-26, 14.03.2026
  const slashed = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(trimmed);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    const year = expandYear(Number(slashed[3]));
    const [month, day] = first > 12 && second <= 12 ? [second, first] : [first, second];
    return isRealDate(year, month, day) ? { value: iso(year, month, day) } : unreadable;
  }

  // 14 Mar 2026, 14-March-2026
  const dayFirst = /^(\d{1,2})[\s-]+([a-z]+)[\s,-]+(\d{2,4})$/i.exec(trimmed);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    const day = Number(dayFirst[1]);
    const year = expandYear(Number(dayFirst[3]));
    if (month && isRealDate(year, month, day)) return { value: iso(year, month, day) };
    return unreadable;
  }

  // Mar 14, 2026 / March 14 2026
  const monthFirst = /^([a-z]+)[\s.-]+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{2,4})$/i.exec(
    trimmed,
  );
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = expandYear(Number(monthFirst[3]));
    if (month && isRealDate(year, month, day)) return { value: iso(year, month, day) };
    return unreadable;
  }

  return unreadable;
}

/* -------------------------------------------------------------------------- */
/* phone and email                                                            */
/* -------------------------------------------------------------------------- */

/** E.164 when Helix can dial it, otherwise exactly what was typed, with a note. */
export function parsePhone(raw: string, options: ParseOptions = {}): ParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return EMPTY;
  const normalized = normalizePhone(trimmed, options.region);
  if (normalized.e164 === null) {
    return {
      value: normalized.raw,
      warning: `"${trimmed}" is not a phone number Helix can dial. It was saved exactly as typed.`,
    };
  }
  return { value: normalized.e164 };
}

export function parseEmail(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return EMPTY;
  const normalized = normalizeEmail(trimmed);
  if (!isValidEmail(trimmed)) {
    return {
      value: normalized.lower,
      warning: `"${trimmed}" does not look like an email address. It was saved as typed.`,
    };
  }
  return { value: normalized.lower };
}

/* -------------------------------------------------------------------------- */
/* choice                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One of a fixed set. An unrecognised cell falls back to the first choice and
 * says so rather than failing the row - the same rule the unknown stage
 * follows.
 */
export function parseChoice(
  raw: string,
  choices: readonly { value: string; aliases: readonly string[] }[],
  label = "value",
): ParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return EMPTY;
  const needle = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const choice of choices) {
    if (choice.value.toLowerCase() === needle) return { value: choice.value };
    if (choice.aliases.some((a) => a.toLowerCase() === needle)) {
      return { value: choice.value };
    }
  }
  const fallback = choices[0]?.value ?? null;
  return {
    value: fallback,
    warning: `"${trimmed}" is not a ${label} Helix knows${
      fallback ? `. It was set to "${fallback}"` : ""
    }.`,
  };
}

/* -------------------------------------------------------------------------- */
/* tags                                                                       */
/* -------------------------------------------------------------------------- */

/** "Repeat; Referral" or "Repeat, Referral" -> ["Repeat", "Referral"]. */
export function splitTagCell(raw: string): string[] {
  return raw
    .split(/[;,]|:::/)
    .map((tag) => tag.replace(/^\*/, "").trim())
    .filter((tag) => tag.length > 0);
}

export function parseTags(raw: string): ParseResult {
  const tags = splitTagCell(raw);
  return tags.length === 0 ? EMPTY : { value: tags.join(";") };
}

/* -------------------------------------------------------------------------- */
/* the one entry point the import path uses                                   */
/* -------------------------------------------------------------------------- */

export function parseCell(
  field: FieldDefinition,
  raw: string,
  options: ParseOptions = {},
): ParseResult {
  switch (field.parser) {
    case "money":
      return parseMoney(raw, field.label.toLowerCase());
    case "date":
      return parseDate(raw);
    case "phone":
      return parsePhone(raw, options);
    case "email":
      return parseEmail(raw);
    case "choice":
      return parseChoice(raw, field.choices ?? [], field.label.toLowerCase());
    case "tags":
      return parseTags(raw);
    case "text":
    default:
      return parseText(raw);
  }
}
