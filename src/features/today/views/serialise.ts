/**
 * Pure normalisation for `ViewQuery`. No `@/db`, no React — this file is the
 * whole reason the saved-view shape can be unit-tested without a database and
 * safely deserialised from a column that a future version of this library, or
 * a hand-edited row, may have written differently.
 *
 * The guiding rule is "never throw, always land on something usable":
 * `deserialiseQuery` is the far end of a `JSON.parse` on a text column,
 * so anything that isn't the shape we expect degrades to whatever part of it
 * we can trust, rather than crashing the screen that asked for it. Every
 * output object is built field-by-field, in the same order, every time — that
 * is what keeps `JSON.stringify` stable and makes two logically-equal queries
 * compare equal regardless of how their source object happened to be built.
 */
import {
  VIEW_QUERY_VERSION,
  type FilterValue,
  type ViewFilter,
  type ViewFilterOp,
  type ViewQuery,
  type ViewSort,
} from "@/features/today/views/types";

// Re-exported so a caller working with these pure functions does not also
// need a separate import from `./types` just to stamp or compare a version.
export { VIEW_QUERY_VERSION };

const FILTER_OPS: readonly ViewFilterOp[] = [
  "eq",
  "neq",
  "in",
  "contains",
  "between",
  "gte",
  "lte",
  "isNull",
  "notNull",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `{ from, to }` values are rebuilt key-by-key so that two range values that
 * differ only in which key was assigned first still serialise identically.
 * Anything else (string, number, boolean, null, string[]) is returned as-is.
 */
function canonicaliseValue(value: unknown): FilterValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (isPlainObject(value)) {
    const out: { from?: string | null; to?: string | null } = {};
    if ("from" in value) {
      out.from = typeof value.from === "string" ? value.from : null;
    }
    if ("to" in value) {
      out.to = typeof value.to === "string" ? value.to : null;
    }
    return out;
  }
  return null;
}

function readOp(value: unknown): ViewFilterOp | null {
  return typeof value === "string" && (FILTER_OPS as string[]).includes(value)
    ? (value as ViewFilterOp)
    : null;
}

/** A single filter, from whatever shape survived JSON.parse. `null` when it cannot be trusted. */
function readFilter(candidate: unknown): ViewFilter | null {
  if (!isPlainObject(candidate)) return null;
  const field = typeof candidate.field === "string" ? candidate.field.trim() : "";
  if (!field) return null;
  const op = readOp(candidate.op);
  if (!op) return null;
  return { field, op, value: canonicaliseValue(candidate.value) };
}

/** A sort direction that is not literally "asc" or "desc" cannot be trusted, so the entry is dropped. */
function readSort(candidate: unknown): ViewSort | null {
  if (!isPlainObject(candidate)) return null;
  const field = typeof candidate.field === "string" ? candidate.field.trim() : "";
  if (!field) return null;
  if (candidate.direction !== "asc" && candidate.direction !== "desc") return null;
  return { field, direction: candidate.direction };
}

function readColumn(candidate: unknown): string | null {
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : null;
}

/** The query for a screen that has never saved anything: no filters, no sort, every column the screen defaults to. */
export function emptyQuery(): ViewQuery {
  return { version: VIEW_QUERY_VERSION, filters: [], sort: [], columns: [] };
}

function dedupeSort(sort: readonly ViewSort[]): ViewSort[] {
  const seen = new Set<string>();
  const out: ViewSort[] = [];
  for (const entry of sort) {
    if (seen.has(entry.field)) continue;
    seen.add(entry.field);
    out.push({ field: entry.field, direction: entry.direction });
  }
  return out;
}

function dedupeColumns(columns: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const column of columns) {
    if (seen.has(column)) continue;
    seen.add(column);
    out.push(column);
  }
  return out;
}

/**
 * Normalise a (possibly partial, possibly hand-built) query into the shape
 * every consumer can rely on: stamped version, no blank-field filters, first
 * sort per field wins, columns de-duplicated in the order given. Called twice
 * on the same input, it returns two objects that `JSON.stringify` to the same
 * string — that determinism is what makes saving a view idempotent and
 * `queryEquals` meaningful.
 */
export function serialiseQuery(input: Partial<ViewQuery>): ViewQuery {
  const filters = (input.filters ?? [])
    .filter((filter) => typeof filter?.field === "string" && filter.field.trim() !== "")
    .map((filter) => ({
      field: filter.field.trim(),
      op: filter.op,
      value: canonicaliseValue(filter.value),
    }));

  const sort = dedupeSort(
    (input.sort ?? []).filter((entry) => typeof entry?.field === "string" && entry.field.trim() !== ""),
  );

  const columns = dedupeColumns((input.columns ?? []).filter((c) => typeof c === "string"));

  return { version: VIEW_QUERY_VERSION, filters, sort, columns };
}

/**
 * The far end of `JSON.parse(row.queryJson)`. `raw` can be anything a
 * corrupted row, an old version of this library, or a stray string produced —
 * this never throws, and whatever recognisable fields it finds are kept.
 * Delegates the final shape to `serialiseQuery` so the two functions cannot
 * drift on what "normalised" means.
 */
export function deserialiseQuery(raw: unknown): ViewQuery {
  if (!isPlainObject(raw)) return emptyQuery();

  const filters = Array.isArray(raw.filters)
    ? raw.filters.map(readFilter).filter((f): f is ViewFilter => f !== null)
    : [];
  const sort = Array.isArray(raw.sort)
    ? raw.sort.map(readSort).filter((s): s is ViewSort => s !== null)
    : [];
  const columns = Array.isArray(raw.columns)
    ? raw.columns.map(readColumn).filter((c): c is string => c !== null)
    : [];

  // The incoming `version` is deliberately ignored beyond having triggered
  // this read: we do not yet have more than one wire shape to branch on, so
  // "unknown version" and "current version" are handled the same way — read
  // what looks right, stamp the current version on the way out.
  return serialiseQuery({ filters, sort, columns });
}

function filterValueEquals(a: FilterValue, b: FilterValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const range = a as { from?: string | null; to?: string | null };
    const other = b as { from?: string | null; to?: string | null };
    return (range.from ?? null) === (other.from ?? null) && (range.to ?? null) === (other.to ?? null);
  }
  return a === b;
}

/**
 * Structural equality after normalising both sides, so a view picked from
 * storage and a query built fresh in memory compare equal even if one has
 * trailing whitespace on a field name or its keys in a different order. This
 * is what a list screen uses to show "unsaved changes" under a picked view.
 */
export function queryEquals(a: ViewQuery, b: ViewQuery): boolean {
  const left = serialiseQuery(a);
  const right = serialiseQuery(b);

  if (left.filters.length !== right.filters.length) return false;
  if (left.sort.length !== right.sort.length) return false;
  if (left.columns.length !== right.columns.length) return false;

  for (let i = 0; i < left.filters.length; i++) {
    const lf = left.filters[i];
    const rf = right.filters[i];
    if (lf.field !== rf.field || lf.op !== rf.op || !filterValueEquals(lf.value, rf.value)) {
      return false;
    }
  }
  for (let i = 0; i < left.sort.length; i++) {
    if (left.sort[i].field !== right.sort[i].field || left.sort[i].direction !== right.sort[i].direction) {
      return false;
    }
  }
  for (let i = 0; i < left.columns.length; i++) {
    if (left.columns[i] !== right.columns[i]) return false;
  }
  return true;
}

/**
 * The picker's subtitle line. Plain sentence case, no jargon, because the
 * owner reading it is deciding which saved view to open, not debugging a
 * query builder.
 */
export function describeQuery(query: ViewQuery): string {
  const count = query.filters.length;
  const filterPart = count === 0 ? "No filters" : count === 1 ? "1 filter" : `${count} filters`;
  if (query.sort.length === 0) return filterPart;
  const sortedBy = query.sort.map((s) => s.field).join(", then ");
  return `${filterPart}, sorted by ${sortedBy}`;
}
