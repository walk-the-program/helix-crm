/**
 * Column-to-field mapping for everything that is not contacts: companies,
 * deals and the services catalog.
 *
 *   headers --> guessMappingFor(type) --> [TypedColumnMapping]   (owner edits)
 *   cells   --> readDraftRow(type)    --> DraftRow { draft, warnings }
 *
 * The same two moves `lib/mapping.ts` makes for contacts, driven by the field
 * definitions in `import/fields/` instead of by a list of regular expressions.
 * A field says which header names mean it; this file does the matching, the
 * parsing and the "what looks wrong on this row" pass.
 *
 * Pure: no database, no filesystem. What a row means in *this* workspace -
 * which stage, which contact, which company - is `lib/typedImportRun.ts`.
 */
import { normalizeHeader } from "@/features/data/lib/mapping";
import { parseCell } from "@/features/data/import/fields/parsers";
import {
  writeToDraft,
  type Draft,
  type FieldDefinition,
  type ImportTypeDefinition,
} from "@/features/data/import/fields/types";

/** The field id for "leave this column out". Shared with the contacts wizard. */
export const SKIP = "skip";

export type TypedColumnMapping = {
  /** The header exactly as it appears in the file. */
  header: string;
  index: number;
  /** A field key, or SKIP. */
  field: string;
  /** True while the guess is still the guess. */
  guessed: boolean;
};

export type RowWarning = {
  level: "error" | "warning";
  /** Groups the warning on the result screen: "money", "stage", "contact"... */
  kind: string;
  message: string;
  column?: string;
};

export type DraftRow = {
  rowNumber: number;
  draft: Draft;
  warnings: RowWarning[];
  /** False when a required field is empty: the row is counted as skipped. */
  importable: boolean;
};

/* -------------------------------------------------------------------------- */
/* the guess                                                                  */
/* -------------------------------------------------------------------------- */

/** alias -> field key. The earlier field wins a clash, so order matters. */
function aliasIndex(type: ImportTypeDefinition): Map<string, string> {
  const index = new Map<string, string>();
  for (const field of type.fields) {
    for (const alias of field.aliases) {
      const key = normalizeHeader(alias);
      if (!index.has(key)) index.set(key, field.key);
    }
    // A field's own label is always an alias for it: that is what makes the
    // example files Helix writes readable by the same mapper.
    const label = normalizeHeader(field.label);
    if (!index.has(label)) index.set(label, field.key);
  }
  return index;
}

function isMultiple(type: ImportTypeDefinition, key: string): boolean {
  return type.fields.find((f) => f.key === key)?.multiple === true;
}

/**
 * Match every header against the type's aliases. A field that can only be
 * filled once is not guessed twice - the leftmost column wins and the rest are
 * left on Skip for the owner, which is the same rule the contacts wizard uses.
 */
export function guessMappingFor(
  type: ImportTypeDefinition,
  headers: string[],
): TypedColumnMapping[] {
  const index = aliasIndex(type);
  const taken = new Set<string>();

  return headers.map((header, i) => {
    const normalized = normalizeHeader(header);
    const base = { header, index: i, guessed: true };
    if (normalized.length === 0) return { ...base, field: SKIP };

    const key = index.get(normalized);
    if (key === undefined) return { ...base, field: SKIP };
    if (!isMultiple(type, key) && taken.has(key)) return { ...base, field: SKIP };
    taken.add(key);
    return { ...base, field: key };
  });
}

/** A stable key for "this shape of file", scoped to the type it was mapped as. */
export function typedSignature(typeId: string, headers: string[]): string {
  const joined = headers.map((h) => normalizeHeader(h)).join("|");
  let hash = 5381;
  for (let i = 0; i < joined.length; i += 1) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  }
  return `${typeId}.${headers.length}-${(hash >>> 0).toString(36)}`;
}

export function toRememberedTyped(
  mapping: TypedColumnMapping[],
): { header: string; field: string }[] {
  return mapping.map((m) => ({ header: m.header, field: m.field }));
}

/** Rebuild a remembered mapping against the headers actually in this file. */
export function applyRememberedTyped(
  headers: string[],
  remembered: { header: string; field: string }[],
): TypedColumnMapping[] {
  const byHeader = new Map(remembered.map((r) => [normalizeHeader(r.header), r]));
  return headers.map((header, index) => {
    const hit = byHeader.get(normalizeHeader(header));
    return {
      header,
      index,
      field: hit?.field ?? SKIP,
      guessed: hit === undefined,
    };
  });
}

export function typedMappingSummary(
  type: ImportTypeDefinition,
  mapping: TypedColumnMapping[],
): { mapped: number; skipped: number; missingRequired: FieldDefinition[] } {
  const mapped = mapping.filter((m) => m.field !== SKIP);
  const present = new Set(mapped.map((m) => m.field));
  return {
    mapped: mapped.length,
    skipped: mapping.length - mapped.length,
    missingRequired: type.fields.filter((f) => f.required === true && !present.has(f.key)),
  };
}

/** True when every column the guess could make was made. Used by the example test. */
export function fullyMapped(mapping: TypedColumnMapping[]): boolean {
  return mapping.every((m) => m.field !== SKIP);
}

/* -------------------------------------------------------------------------- */
/* reading a row                                                              */
/* -------------------------------------------------------------------------- */

export function readDraftRow(
  type: ImportTypeDefinition,
  cells: string[],
  mapping: TypedColumnMapping[],
  rowNumber: number,
  options: { region?: string } = {},
): DraftRow {
  const draft: Draft = {};
  const warnings: RowWarning[] = [];
  const byKey = new Map(type.fields.map((f) => [f.key, f]));

  for (const column of mapping) {
    if (column.field === SKIP) continue;
    const field = byKey.get(column.field);
    if (!field) continue;
    const raw = cells[column.index] ?? "";
    if (raw.trim().length === 0) continue;

    const parsed = parseCell(field, raw, options);
    if (parsed.warning) {
      warnings.push({
        level: "warning",
        kind: field.parser,
        message: parsed.warning,
        column: column.header,
      });
    }
    if (parsed.value === null) continue;
    writeToDraft(field, draft, parsed.value, raw);
  }

  let importable = true;
  for (const field of type.fields) {
    if (field.required !== true) continue;
    const value = draft[field.key];
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      importable = false;
      warnings.push({
        level: "error",
        kind: "required",
        message: `No ${field.label.toLowerCase()} on this row, so there is nothing to file it under.`,
      });
    }
  }

  return { rowNumber, draft, warnings, importable };
}
