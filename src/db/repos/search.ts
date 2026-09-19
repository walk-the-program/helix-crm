/**
 * Search: FTS5 MATCH against search_index, joined back to search_docs on
 * rowid for the entity type and id, then grouped by type for the palette.
 *
 * The index is owned entirely by triggers (drizzle/0001_search.sql), so
 * nothing here writes: a soft delete removes a row, a restore brings it back,
 * and changing a phone rebuilds its contact.
 *
 * User input is never interpolated. It is turned into a prefix query with
 * every token quoted, so a stray quote, hyphen or "NEAR" cannot be read as
 * FTS5 syntax.
 */
import { raw } from "@/db/client";

export type SearchEntityType =
  | "contact"
  | "company"
  | "deal"
  | "activity";

export type SearchHit = {
  entityType: SearchEntityType;
  entityId: string;
  text: string;
  rank: number;
};

export type SearchGroup = {
  entityType: SearchEntityType;
  hits: SearchHit[];
};

/**
 * Quote every token and add a prefix star, so "o'brien 801" becomes
 * `"o'brien"* "801"*` - valid FTS5 whatever the user typed.
 */
export function toMatchQuery(input: string): string {
  const tokens = input
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""'))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" ");
}

export async function search(
  query: string,
  options: { limit?: number; types?: SearchEntityType[] } = {},
): Promise<SearchHit[]> {
  const match = toMatchQuery(query);
  if (match.length === 0) return [];

  const limit = options.limit ?? 50;
  const types = options.types;
  const typeClause =
    types && types.length > 0
      ? ` AND sd.entity_type IN (${types.map(() => "?").join(", ")})`
      : "";

  const rows = await raw.query(
    `SELECT sd.entity_type AS sd_entity_type,
            sd.entity_id AS sd_entity_id,
            sd.text AS sd_text,
            bm25(search_index) AS hit_rank
     FROM search_index si
     JOIN search_docs sd ON sd.rowid = si.rowid
     WHERE search_index MATCH ?${typeClause}
     ORDER BY hit_rank ASC
     LIMIT ?`,
    types && types.length > 0 ? [match, ...types, limit] : [match, limit],
  );

  return rows.map((r) => ({
    entityType: String(r[0]) as SearchEntityType,
    entityId: String(r[1]),
    text: String(r[2]),
    rank: Number(r[3]),
  }));
}

const TYPE_ORDER: SearchEntityType[] = [
  "contact",
  "company",
  "deal",
  "activity",
];

/** The palette shows results grouped by type, in a fixed order. */
export async function searchGrouped(
  query: string,
  options: { limit?: number; perType?: number } = {},
): Promise<SearchGroup[]> {
  const hits = await search(query, { limit: options.limit ?? 50 });
  const perType = options.perType ?? 5;
  const groups: SearchGroup[] = [];
  for (const type of TYPE_ORDER) {
    const forType = hits.filter((h) => h.entityType === type).slice(0, perType);
    if (forType.length > 0) groups.push({ entityType: type, hits: forType });
  }
  return groups;
}

/** Diagnostics: how many documents the index holds, by type. */
export async function indexCounts(): Promise<
  { entityType: string; count: number }[]
> {
  const rows = await raw.query(
    `SELECT sd.entity_type AS sd_entity_type, count(*) AS doc_count
     FROM search_docs sd GROUP BY sd.entity_type ORDER BY sd.entity_type`,
  );
  return rows.map((r) => ({
    entityType: String(r[0]),
    count: Number(r[1]),
  }));
}

/**
 * Rebuild the FTS index from search_docs. Only needed after a restore from a
 * backup written by a build with a different tokenizer; the triggers keep it
 * in sync in normal use.
 */
export async function rebuildIndex(): Promise<void> {
  await raw.execute(
    `INSERT INTO search_index(search_index) VALUES ('rebuild')`,
  );
}
