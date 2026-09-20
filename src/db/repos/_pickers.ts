/**
 * Shared internals for the type-ahead picker searches
 * (contacts.search, companies.search, products.search).
 *
 * Every picker answers the same question — "the owner typed these few
 * characters; which records did they mean, best first?" — so the ranking and
 * the LIKE escaping live here once instead of three times.
 *
 * Two passes find the candidates:
 *
 *   1. FTS5 over search_docs, which indexes everything about a record (every
 *      phone, every email, the company name, the notes). It finds the rows a
 *      column LIKE cannot.
 *   2. Column LIKE on the obvious fields, which finds rows the index has not
 *      caught up with and works on a database with no FTS table at all.
 *
 * The union is then ranked in JS, because relevance here is not bm25: the
 * owner typing "pri" wants Priya Raman first, not the contact whose notes say
 * "priority". A prefix on the name beats a prefix on a word inside it, which
 * beats a substring, which beats a match on something that is not the label.
 */
import { raw } from "@/db/client";
import { toMatchQuery, type SearchEntityType } from "@/db/repos/search";

/** What every picker hands the Combobox. */
export type PickerItem = {
  id: string;
  label: string;
  detail?: string;
};

export const PICKER_LIMIT = 20;

/** Collapse whitespace so "  Ada   Lovelace " and "Ada Lovelace" rank alike. */
export function normalizeQuery(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/**
 * LIKE has no default escape character in SQLite, so a query containing % or _
 * would otherwise match everything. Escape them and pair every LIKE in this
 * module with ESCAPE '\'.
 */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%query%`, escaped. */
export function contains(query: string): string {
  return `%${likeEscape(query)}%`;
}

/** Digits only, for matching a typed phone number against E.164. */
export function digitsOf(value: string): string {
  return value.replace(/\D+/g, "");
}

const WORD_BREAK = /[\s,./@_'’-]+/;

/**
 * Relevance, lower is better:
 *   0 the text starts with the query      ("pri" → "Priya Raman")
 *   1 a word inside it starts with it     ("ram" → "Priya Raman")
 *   2 it appears anywhere                 ("iya" → "Priya Raman")
 *   3 no textual match (the FTS index found this row some other way)
 */
export function rankText(text: string | null | undefined, query: string): number {
  if (!text || query.length === 0) return 3;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.split(WORD_BREAK).some((word) => word.length > 0 && word.startsWith(q))) return 1;
  if (t.includes(q)) return 2;
  return 3;
}

/** The best (lowest) rank across several texts. */
export function bestRank(texts: (string | null | undefined)[], query: string): number {
  let best = 3;
  for (const text of texts) {
    const rank = rankText(text, query);
    if (rank < best) best = rank;
    if (best === 0) break;
  }
  return best;
}

export type Ranked<T> = { rank: number; item: T };

/** Relevance first, then name, then id so the order is total and stable. */
export function sortRanked<T extends PickerItem>(rows: Ranked<T>[]): T[] {
  return rows
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.item.label.localeCompare(b.item.label, undefined, { sensitivity: "base" }) ||
        a.item.id.localeCompare(b.item.id),
    )
    .map((r) => r.item);
}

/**
 * Candidate ids from the FTS index, best first. Returns [] rather than
 * throwing when the database has no search_index table, so a picker still
 * works on a half-migrated or restored database — the LIKE pass carries it.
 */
export async function ftsIds(
  query: string,
  entityType: SearchEntityType,
  limit: number,
): Promise<string[]> {
  const match = toMatchQuery(query);
  if (match.length === 0) return [];
  try {
    const rows = await raw.query(
      `SELECT sd.entity_id AS sd_entity_id
       FROM search_index si
       JOIN search_docs sd ON sd.rowid = si.rowid
       WHERE search_index MATCH ? AND sd.entity_type = ?
       ORDER BY bm25(search_index) ASC
       LIMIT ?`,
      [match, entityType, limit],
    );
    return rows.map((r) => String(r[0]));
  } catch {
    return [];
  }
}

/** `id IN (?, ?, ?)` for a candidate list, or a clause that matches nothing. */
export function idInClause(column: string, ids: string[]): string {
  if (ids.length === 0) return "0";
  return `${column} IN (${ids.map(() => "?").join(", ")})`;
}

/** How wide to cast the net before ranking trims it back to `limit`. */
export function widen(limit: number): number {
  return Math.max(limit * 4, 60);
}

export function textOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function nullableTextOf(value: unknown): string | null {
  const s = textOf(value);
  return s.length > 0 ? s : null;
}
