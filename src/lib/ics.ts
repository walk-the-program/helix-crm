// Pure iCalendar (RFC 5545) builder. No Tauri, no DOM, no repositories, no
// feature code - this module only produces the text of a .ics file. Whatever
// calls it is responsible for writing the file to disk and opening it.
//
// Conventions borrowed from src/lib/dates.ts: `dateOnly` is a local calendar
// day "YYYY-MM-DD"; `startAt` / `endAt` / `stamp` are ISO 8601 UTC instants.
// A timed event (startAt set) always wins over dateOnly.
//
// Missing/invalid date fallback: an event with no usable startAt and no
// parseable dateOnly is NOT dropped and does not emit an invalid DTSTART.
// It falls back to an all-day event on today's local calendar date. This
// keeps buildIcsCalendar total over its input (every event the caller passes
// produces exactly one VEVENT) rather than silently losing rows.
//
// Line endings are CRLF throughout, including the final line, per RFC 5545
// section 3.1. Content lines longer than 75 octets are folded with a single
// leading space on each continuation line (section 3.1), and TEXT values are
// escaped per section 3.3.11.

import { parseDateOnly, parseIso, toLocalDateString } from "./dates";

export type IcsEvent = {
  /** Stable, unique per record. The caller passes the row id; see uid(). */
  uid: string;
  /** The event title. */
  summary: string;
  /** Local calendar day "YYYY-MM-DD" for an all-day event. */
  dateOnly?: string | null;
  /** ISO 8601 UTC instant for a timed event. Wins over dateOnly. */
  startAt?: string | null;
  /** Timed events only. Defaults to one hour after startAt. */
  endAt?: string | null;
  /** Free text. The caller puts the record link text in here. */
  description?: string | null;
  /** A one-line street address, or null. */
  location?: string | null;
  /** DTSTAMP override, for tests. Defaults to now. */
  stamp?: string | null;
};

const CRLF = "\r\n";
const PRODID = "-//Helix CRM//Helix//EN";
const FOLD_LIMIT = 75;
const ONE_HOUR_MS = 60 * 60 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** "YYYY-MM-DD" -> "YYYYMMDD". Caller guarantees a valid parseDateOnly() result. */
function dateOnlyToBasic(dateOnly: string): string {
  return dateOnly.replace(/-/g, "");
}

/** "YYYY-MM-DD" -> the same day plus one, in "YYYYMMDD" form (DTEND is exclusive). */
function nextDayBasic(dateOnly: string): string {
  const d = parseDateOnly(dateOnly);
  if (!d) return dateOnlyToBasic(dateOnly);
  d.setDate(d.getDate() + 1);
  return dateOnlyToBasic(toLocalDateString(d));
}

/** A UTC Date -> "YYYYMMDDTHHMMSSZ". */
function utcBasic(d: Date): string {
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hour = pad2(d.getUTCHours());
  const minute = pad2(d.getUTCMinutes());
  const second = pad2(d.getUTCSeconds());
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

/**
 * True for a control character RFC 5545 does not allow in a TEXT value, or a
 * bidi override/embedding character.
 *
 * Section 3.3.11 builds TEXT out of SAFE-CHAR, which excludes the C0 controls
 * apart from HTAB; a NUL or a stray U+0001 in a SUMMARY is a malformed file
 * that a calendar app may reject or truncate. LF and CR are handled before
 * this runs - they become the `\n` escape - so by the time a character is
 * tested here, any control left is one that has no meaning in the format.
 *
 * The bidi characters are stripped for the same reason `sanitizeDisplayName`
 * strips them from an attachment name: a right-to-left override makes the
 * exported entry read differently in the owner's calendar than it did in
 * Helix, and a calendar entry is seen weeks later, out of context, on a phone.
 * Numeric code-point comparisons, never a regex literal holding the characters.
 */
function isUnsafeTextCodePoint(codePoint: number): boolean {
  if (codePoint === 0x0009) return false;
  if (codePoint < 0x0020 || codePoint === 0x007f) return true;
  if (codePoint === 0x200e || codePoint === 0x200f) return true;
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  return false;
}

/** Drop the characters above, one pass, surrogate pairs kept whole. */
function stripUnsafe(value: string): string {
  let out = "";
  for (const ch of value) {
    if (isUnsafeTextCodePoint(ch.codePointAt(0) ?? 0)) continue;
    out += ch;
  }
  return out;
}

/**
 * Escape a TEXT value per RFC 5545 section 3.3.11. Order matters.
 *
 * The line-break handling is what closes property injection: a CRLF inside a
 * value would otherwise end the content line and let the next characters be
 * read as a new property or component. `\r\n` and `\n` both become the literal
 * two-character `\n` escape and a lone `\r` is dropped, so nothing a caller
 * supplies can start a line. That is covered by a test that tries to inject a
 * `BEGIN:VALARM`. Control characters are stripped AFTER that, so removing them
 * can never expose a line break that the escaping had already neutralised.
 */
export function escapeText(value: string): string {
  const escaped = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
  return stripUnsafe(escaped);
}

/** The UTF-8 byte length of a single character (not a full string). */
function charByteLength(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code <= 0xffff) return 3;
  return 4;
}

/**
 * Fold one content line at 75 octets per RFC 5545 section 3.1. Continuation
 * lines start with exactly one space. A multi-byte character is never split
 * across a fold boundary, and the fold never lands inside the two-character
 * "\n" escape pair produced by escapeText.
 */
export function foldLine(line: string): string {
  // Split into logical characters (surrogate pairs stay together) so we
  // never cut a multi-byte UTF-8 character in half.
  const chars = Array.from(line);

  const segments: string[] = [];
  let current = "";
  let currentBytes = 0;
  // First line's budget includes the property name, i.e. the full 75 octets.
  // Continuation lines carry at most 74 octets of payload after the leading
  // space, which is the same effective 75-octet-per-physical-line rule.
  let limit = FOLD_LIMIT;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const chBytes = charByteLength(ch);

    // Don't split the backslash-n escape pair: if this char is "n" and the
    // previous char we just placed is a trailing backslash that would be
    // left alone on this line, pull both onto the next line together.
    if (ch === "n" && current.endsWith("\\") && currentBytes + chBytes > limit) {
      // Move the trailing backslash to the next segment along with "n".
      current = current.slice(0, -1);
      currentBytes -= 1;
      segments.push(current);
      current = `\\${ch}`;
      currentBytes = 2;
      limit = FOLD_LIMIT - 1;
      continue;
    }

    if (currentBytes + chBytes > limit) {
      segments.push(current);
      current = ch;
      currentBytes = chBytes;
      // Continuation lines get one leading space, which costs 1 octet, so
      // their payload budget is 75 - 1 = 74 octets.
      limit = FOLD_LIMIT - 1;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  segments.push(current);

  return segments.map((seg, i) => (i === 0 ? seg : ` ${seg}`)).join(CRLF);
}

function contentLine(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

/** A safe .ics file name from a title, e.g. "send-revised-estimate.ics". */
export function icsFileName(summary: string): string {
  const slug = summary
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  return slug === "" ? "event.ics" : `${slug}.ics`;
}

/** A stable UID from a kind and a row id, e.g. "task-0193...@helix-crm". */
export function icsUid(kind: string, id: string): string {
  const safeId = id.replace(/[^A-Za-z0-9-]+/g, "-");
  return `${kind}-${safeId}@helix-crm`;
}

type ResolvedTiming =
  | { allDay: true; startBasic: string; endBasic: string }
  | { allDay: false; startBasic: string; endBasic: string };

function resolveTiming(event: IcsEvent): ResolvedTiming {
  if (event.startAt) {
    const start = parseIso(event.startAt);
    if (start) {
      const endRaw = event.endAt ? parseIso(event.endAt) : null;
      const end = endRaw && endRaw.getTime() > start.getTime() ? endRaw : new Date(start.getTime() + ONE_HOUR_MS);
      return { allDay: false, startBasic: utcBasic(start), endBasic: utcBasic(end) };
    }
  }

  const day = event.dateOnly && parseDateOnly(event.dateOnly) ? event.dateOnly! : toLocalDateString(new Date());
  return { allDay: true, startBasic: dateOnlyToBasic(day), endBasic: nextDayBasic(day) };
}

function buildVevent(event: IcsEvent): string {
  const timing = resolveTiming(event);
  const stampDate = (event.stamp ? parseIso(event.stamp) : null) ?? new Date();

  const lines: string[] = [];
  lines.push("BEGIN:VEVENT");
  lines.push(contentLine("UID", event.uid));
  lines.push(contentLine("DTSTAMP", utcBasic(stampDate)));

  if (timing.allDay) {
    lines.push(contentLine("DTSTART;VALUE=DATE", timing.startBasic));
    lines.push(contentLine("DTEND;VALUE=DATE", timing.endBasic));
  } else {
    lines.push(contentLine("DTSTART", timing.startBasic));
    lines.push(contentLine("DTEND", timing.endBasic));
  }

  lines.push(contentLine("SUMMARY", escapeText(event.summary)));

  if (event.description) {
    lines.push(contentLine("DESCRIPTION", escapeText(event.description)));
  }
  if (event.location) {
    lines.push(contentLine("LOCATION", escapeText(event.location)));
  }

  lines.push("END:VEVENT");
  return lines.join(CRLF);
}

export function buildIcs(event: IcsEvent): string {
  return buildIcsCalendar([event]);
}

/** Several events in one VCALENDAR. */
export function buildIcsCalendar(events: IcsEvent[]): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push(contentLine("PRODID", PRODID));
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");

  for (const event of events) {
    lines.push(buildVevent(event));
  }

  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
