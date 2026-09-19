/**
 * Pure CSV writing for the export feature. No I/O, no Tauri imports: every
 * function here is a plain string transform so it can be unit tested without
 * a database or a webview.
 *
 * Formula-injection guard (docs/PLAN.md, "Security and threat model" /
 * "Export and backup"): a cell whose first character is one of `= + - @ TAB
 * CR` is prefixed with a single quote before it is quoted, so a spreadsheet
 * never treats an exported cell as a formula. Only a LEADING occurrence of
 * one of those characters triggers the guard - a value that merely contains
 * one later is left alone.
 */

export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function baseString(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Formula-injection guard: prefixes a cell whose first character is
 * `= + - @ TAB CR` with a single quote. Everything else passes through
 * unchanged (still as a plain, unquoted string - quoting is escapeCell's job).
 */
export function guardCell(value: CsvCell): string {
  const s = baseString(value);
  return FORMULA_TRIGGER.test(s) ? `'${s}` : s;
}

/**
 * The guard plus RFC 4180 quoting. A cell is quoted when it contains a comma,
 * a double quote, a carriage return or newline, has a leading or trailing
 * space, or was guarded above (a guarded cell is always quoted, even when
 * nothing else about it would require quoting - `"'=1+1"`).
 */
export function escapeCell(value: CsvCell): string {
  const raw = baseString(value);
  const guarded = guardCell(value);
  const wasGuarded = guarded !== raw;

  const needsQuote =
    wasGuarded ||
    guarded.includes(",") ||
    guarded.includes('"') ||
    guarded.includes("\n") ||
    guarded.includes("\r") ||
    guarded.startsWith(" ") ||
    guarded.endsWith(" ");

  if (!needsQuote) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** CRLF line endings, trailing newline, one header row. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map((h) => escapeCell(h)).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCell(cell)).join(","));
  }
  return lines.map((line) => line).join("\r\n") + "\r\n";
}

export function toCsvFromObjects<T extends Record<string, CsvCell>>(
  headers: { key: keyof T & string; label: string }[],
  rows: T[],
): string {
  const labels = headers.map((h) => h.label);
  const cells = rows.map((row) => headers.map((h) => row[h.key]));
  return toCsv(labels, cells);
}
