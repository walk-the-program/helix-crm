/**
 * What "a thing you can import" is made of.
 *
 *   ImportTypeDefinition            one per thing the owner can bring in
 *     .fields: FieldDefinition[]    one per column Helix knows how to read
 *        .aliases                   how the guess finds the column
 *        .parser                    how the cell becomes a value
 *        .write                     where the value lands on the row draft
 *        .examples                  the three rows of the downloadable example
 *
 * A row is read into a `Draft`: a flat bag keyed by field key, with the
 * multi-value fields (tags, notes) collecting into arrays. Each type's write
 * path reads the draft it knows about and turns it into statements. That keeps
 * the parsing, the guessing, the preview and the example generator completely
 * type-agnostic - they only ever talk to this file.
 *
 * Contacts is deliberately NOT here. It has its own long-standing definition in
 * `lib/mapping.ts` with custom fields, per-column email/phone labels and its own
 * dedupe, and rewriting it on top of this would be a rewrite of the one import
 * path that already works. `IMPORT_TYPES` lists contacts with a `legacy: true`
 * marker and the wizard branches on it.
 */

export type ImportTypeId = "contacts" | "companies" | "deals" | "services";

/** How a cell becomes a value. Implemented in ./parsers.ts. */
export type ParserKind =
  | "text"
  | "money"
  | "date"
  | "phone"
  | "email"
  | "choice"
  | "tags";

/** What a parser gives back. `value` is null when the cell held nothing usable. */
export type ParseResult = {
  value: string | number | null;
  /** Shown on the preview row and collected into the result's warning list. */
  warning?: string;
};

export type DraftValue = string | number | string[] | null;

/** One CSV row, read into the fields it was mapped to. */
export type Draft = Record<string, DraftValue>;

export type FieldDefinition = {
  /** Stable key. Also the draft key, and what a remembered mapping stores. */
  key: string;
  /** What the owner sees, and the header of that column in the example file. */
  label: string;
  required?: boolean;
  /** Several columns may carry this field: the draft collects an array. */
  multiple?: boolean;
  /**
   * Normalised header text that should guess to this field. Compared with
   * `normalizeHeader` from lib/mapping.ts, so write them lower case and spaced:
   * "deal name", "close date".
   */
  aliases: readonly string[];
  parser: ParserKind;
  /** For parser "choice": the values a cell may hold, first one is the default. */
  choices?: readonly { value: string; aliases: readonly string[] }[];
  hint?: string;
  /**
   * Where the parsed value lands. The default assigns by key (pushing onto an
   * array for a `multiple` field), which is what almost every field wants.
   */
  write?: (draft: Draft, value: string | number, raw: string) => void;
  /** Exactly three cells, one per row of the downloadable example. */
  examples: readonly [string, string, string];
  /**
   * Example cells that have to come from this workspace rather than from a
   * constant - the deal stage column, so the file the owner downloads is
   * directly importable against the stages they actually have.
   */
  liveExamples?: (context: ExampleContext) => [string, string, string];
};

/** What the example generator knows about this workspace. */
export type ExampleContext = {
  /** The pipeline's stage names, in board order. Never empty. */
  stageNames: readonly string[];
};

export type ImportTypeDefinition = {
  id: ImportTypeId;
  /** "Deals". The radio label. */
  label: string;
  /** One sentence under the radio, in the product's voice. */
  hint: string;
  /** "helix-deals-example.csv". */
  exampleFileName: string;
  /** Plural noun for the counts on the result screen: "deals". */
  noun: string;
  fields: readonly FieldDefinition[];
  /**
   * Contacts only: the wizard runs the original mapping/preview/import path
   * for it rather than the generic one.
   */
  legacy?: boolean;
};

/** The default writer: assign by key, or append for a multi-value field. */
export function writeToDraft(
  field: FieldDefinition,
  draft: Draft,
  value: string | number,
  raw: string,
): void {
  if (field.write) {
    field.write(draft, value, raw);
    return;
  }
  if (field.multiple) {
    const existing = draft[field.key];
    const list = Array.isArray(existing) ? existing : [];
    list.push(String(value));
    draft[field.key] = list;
    return;
  }
  // First column wins: a file with two "Amount" columns keeps the leftmost.
  if (draft[field.key] === undefined || draft[field.key] === null) {
    draft[field.key] = value;
  }
}

/* -------------------------------------------------------------------------- */
/* reading a draft back out, without casts at every call site                 */
/* -------------------------------------------------------------------------- */

export function draftText(draft: Draft, key: string): string {
  const value = draft[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

export function draftNumber(draft: Draft, key: string): number | null {
  const value = draft[key];
  return typeof value === "number" ? value : null;
}

export function draftList(draft: Draft, key: string): string[] {
  const value = draft[key];
  if (Array.isArray(value)) return value.filter((v) => v.trim().length > 0);
  if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  return [];
}

export function emptyDraft(): Draft {
  return {};
}

export function fieldByKey(
  type: ImportTypeDefinition,
  key: string,
): FieldDefinition | undefined {
  return type.fields.find((f) => f.key === key);
}

export function requiredFields(type: ImportTypeDefinition): FieldDefinition[] {
  return type.fields.filter((f) => f.required === true);
}
