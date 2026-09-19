/**
 * CSV sniffing and parsing for the import wizard.
 *
 *   bytes --> decode (BOM, UTF-8 or latin-1) --> text --> sniff delimiter
 *         --> papaparse (row by row, never the whole file as objects)
 *
 * Everything in this file is pure: bytes in, data out, no filesystem and no
 * database. Written by the data agent as `src/features/data/lib/csv.ts` and
 * promoted here in wave 3, where docs/CONTRACTS.md always said it belonged.
 *
 * The parse is deliberately strict about ragged rows: docs/PLAN.md wants an
 * ImportParseError naming the row and the column, not a silent half-import.
 */
import Papa from "papaparse";

export type Delimiter = "," | ";" | "\t" | "|";
export type CsvEncoding = "utf-8" | "windows-1252";
export type Newline = "\r\n" | "\n";

export const DELIMITERS: readonly Delimiter[] = [",", ";", "\t", "|"] as const;

/** What the file turned out to be, shown on the import screen. */
export type CsvSniff = {
  encoding: CsvEncoding;
  hadBom: boolean;
  delimiter: Delimiter;
  newline: Newline;
};

export function delimiterLabel(d: Delimiter): string {
  if (d === ",") return "comma";
  if (d === ";") return "semicolon";
  if (d === "\t") return "tab";
  return "pipe";
}

/* -------------------------------------------------------------------------- */
/* errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A file Helix cannot read. Carries the row number (1-based, counting the
 * header as row 1) and the column it stopped on, because "the CSV is broken"
 * is not something anyone can act on.
 */
export class ImportParseError extends Error {
  readonly row: number | null;
  readonly column: string | null;
  readonly sample: string | null;
  constructor(
    message: string,
    details: { row?: number | null; column?: string | null; sample?: string | null } = {},
  ) {
    super(message);
    this.name = "ImportParseError";
    this.row = details.row ?? null;
    this.column = details.column ?? null;
    this.sample = details.sample ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/* decoding                                                                   */
/* -------------------------------------------------------------------------- */

const BOM = "﻿";

export function stripBom(text: string): { text: string; hadBom: boolean } {
  if (text.startsWith(BOM)) return { text: text.slice(1), hadBom: true };
  return { text, hadBom: false };
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/**
 * UTF-8 or latin-1?
 *
 * A strict UTF-8 decode either succeeds - in which case the file is UTF-8,
 * because a latin-1 file with any high byte is almost never valid UTF-8 - or
 * throws, in which case windows-1252 is the only encoding a spreadsheet on
 * either platform is likely to have produced.
 */
export function detectEncoding(bytes: Uint8Array): CsvEncoding {
  if (hasUtf8Bom(bytes)) return "utf-8";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    return "windows-1252";
  }
}

export function decodeCsvBytes(bytes: Uint8Array): {
  text: string;
  encoding: CsvEncoding;
  hadBom: boolean;
} {
  const encoding = detectEncoding(bytes);
  // TextDecoder("utf-8") eats a leading BOM itself, so the bytes are the only
  // honest place to ask whether the file had one.
  const fromBytes = hasUtf8Bom(bytes);
  const decoded = new TextDecoder(encoding).decode(bytes);
  const { text, hadBom } = stripBom(decoded);
  return { text, encoding, hadBom: hadBom || fromBytes };
}

/* -------------------------------------------------------------------------- */
/* sniffing                                                                   */
/* -------------------------------------------------------------------------- */

export function detectNewline(text: string): Newline {
  const crlf = text.indexOf("\r\n");
  if (crlf === -1) return "\n";
  const lf = text.indexOf("\n");
  return crlf === lf - 1 || crlf === lf ? "\r\n" : "\n";
}

/** Split off the first `maxLines` logical lines, respecting quoted newlines. */
function sampleLines(text: string, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length && lines.length < maxLines; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is an escaped quote.
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === "\n" && !inQuotes) {
      lines.push(current.replace(/\r$/, ""));
      current = "";
      continue;
    }
    current += ch;
  }
  if (lines.length < maxLines && current.trim().length > 0) lines.push(current);
  return lines.filter((l) => l.length > 0);
}

/** Count a character outside quoted sections. */
function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === char) count += 1;
  }
  return count;
}

/**
 * The delimiter is the candidate that splits every sampled line into the same
 * number of fields, with the most fields. Consistency beats frequency: a
 * European export uses `;` between fields and `,` inside decimal numbers, and
 * only the semicolon count is the same on every line.
 */
export function detectDelimiter(text: string, fallback: Delimiter = ","): Delimiter {
  const lines = sampleLines(text, 10);
  if (lines.length === 0) return fallback;

  let best: { delimiter: Delimiter; consistent: number; fields: number } | null = null;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, delimiter));
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const candidate = { delimiter, consistent, fields: first + 1 };
    if (
      !best ||
      candidate.consistent > best.consistent ||
      (candidate.consistent === best.consistent && candidate.fields > best.fields)
    ) {
      best = candidate;
    }
  }
  return best ? best.delimiter : fallback;
}

/** Decode and sniff in one step. */
export function sniffCsv(bytes: Uint8Array): CsvSniff & { text: string } {
  const { text, encoding, hadBom } = decodeCsvBytes(bytes);
  return {
    text,
    encoding,
    hadBom,
    delimiter: detectDelimiter(text),
    newline: detectNewline(text),
  };
}

/* -------------------------------------------------------------------------- */
/* parsing                                                                    */
/* -------------------------------------------------------------------------- */

export type ParseOptions = {
  delimiter?: Delimiter;
  /** Pad short rows and drop extra cells instead of raising ImportParseError. */
  tolerant?: boolean;
  /** Stop after this many data rows (the preview reads 20). */
  limit?: number;
};

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  /** Data rows produced (never counts the header). */
  rowCount: number;
  delimiter: Delimiter;
};

function fieldMismatchMessage(
  headers: string[],
  row: string[],
  rowNumber: number,
): { message: string; column: string | null } {
  if (row.length < headers.length) {
    const column = headers[row.length] ?? null;
    return {
      message: `Row ${rowNumber} has ${row.length} values but the header has ${headers.length}. The first missing column is "${column ?? "(unnamed)"}".`,
      column,
    };
  }
  return {
    message: `Row ${rowNumber} has ${row.length} values but the header has ${headers.length}, so ${row.length - headers.length} extra value(s) have nowhere to go.`,
    column: null,
  };
}

/**
 * Walk the file row by row. `onRow` sees the raw cells and the 1-based row
 * number in the file (the header is row 1), so an error can name the line the
 * owner sees in a spreadsheet.
 *
 * papaparse's `step` keeps only one row in memory at a time, which is what
 * makes a 100k-row file affordable: the caller maps each row to the handful of
 * fields it kept and throws the rest away.
 */
export function walkCsv(
  text: string,
  options: ParseOptions,
  onRow: (cells: string[], rowNumber: number, headers: string[]) => void,
): { headers: string[]; rowCount: number; delimiter: Delimiter } {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const tolerant = options.tolerant ?? false;
  const limit = options.limit ?? Infinity;

  // A mutable holder rather than plain `let`: these are written inside the
  // step callback, and TypeScript's narrowing does not follow assignments made
  // in a nested function.
  const state: {
    headers: string[] | null;
    rowCount: number;
    lineNumber: number;
    failure: ImportParseError | null;
  } = { headers: null, rowCount: 0, lineNumber: 0, failure: null };

  // With a `step` callback papaparse streams and returns nothing, so any
  // structural complaint has to be collected row by row.
  const fatalErrors: Papa.ParseError[] = [];

  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: "greedy",
    header: false,
    step: (results, parser) => {
      if (state.failure) return;
      for (const error of results.errors ?? []) {
        if (error.type === "Quotes" || error.code === "UndetectableDelimiter") {
          fatalErrors.push(error);
        }
      }
      const cells = (results.data as string[]) ?? [];
      state.lineNumber += 1;

      const headers = state.headers;
      if (headers === null) {
        state.headers = cells.map((c) => c.trim());
        return;
      }

      if (limit <= 0) {
        parser.abort();
        return;
      }

      if (cells.length !== headers.length && !tolerant) {
        const { message, column } = fieldMismatchMessage(headers, cells, state.lineNumber);
        state.failure = new ImportParseError(message, {
          row: state.lineNumber,
          column,
          sample: cells.join(delimiter).slice(0, 200),
        });
        parser.abort();
        return;
      }

      const padded =
        cells.length === headers.length
          ? cells
          : cells.length < headers.length
            ? [...cells, ...Array<string>(headers.length - cells.length).fill("")]
            : cells.slice(0, headers.length);

      state.rowCount += 1;
      onRow(padded, state.lineNumber, headers);
      if (state.rowCount >= limit) parser.abort();
    },
  });

  if (state.failure) throw state.failure;

  // Anything papaparse itself could not make sense of (an unclosed quote, for
  // instance) that was not already reported as a field mismatch.
  const fatal = fatalErrors[0];
  if (fatal) {
    throw new ImportParseError(
      `Helix could not read this file: ${fatal.message}`,
      { row: typeof fatal.row === "number" ? fatal.row + 1 : null },
    );
  }

  if (state.headers === null) {
    throw new ImportParseError("This file is empty: there is not even a header row.");
  }

  return { headers: state.headers, rowCount: state.rowCount, delimiter };
}

/** Collect a whole file (or the first `limit` rows) into memory. */
export function parseCsvText(text: string, options: ParseOptions = {}): ParsedCsv {
  const rows: string[][] = [];
  const { headers, rowCount, delimiter } = walkCsv(text, options, (cells) => {
    rows.push(cells);
  });
  return { headers, rows, rowCount, delimiter };
}

/** Header row only, for the mapping step. */
export function readHeaders(text: string, options: ParseOptions = {}): {
  headers: string[];
  delimiter: Delimiter;
} {
  const { headers, delimiter } = walkCsv(text, { ...options, limit: 0 }, () => {});
  return { headers, delimiter };
}

/* -------------------------------------------------------------------------- */
/* writing (skipped rows come back out as a CSV)                              */
/* -------------------------------------------------------------------------- */

/** Quote a cell for output. The formula guard lives in lib/exportCsv.ts. */
export function quoteCell(value: string): string {
  if (/[",\r\n]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Rows back to CSV text, CRLF-terminated as every spreadsheet expects. */
export function rowsToCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(quoteCell).join(",")];
  for (const row of rows) lines.push(row.map(quoteCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
