/**
 * Companies. A company page shows every contact, every open and closed deal,
 * and a merged timeline, so the reads here return counts alongside the row.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError, type DuplicateWarning } from "@/db/errors";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { nowIso } from "@/lib/dates";
import * as settings from "@/db/repos/settings";
import {
  countRows,
  insertStatement,
  logWrite,
  mapRows,
  pageClause,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  stampNew,
  trimmed,
  trimmedOrNull,
  updateStatement,
  parseOrThrow,
  type Col,
  type Page,
  type Statement,
  pairKey,
  type DuplicatePair,
  type MatchedOn,
} from "@/db/repos/_base";
import {
  PICKER_LIMIT,
  bestRank,
  contains,
  digitsOf,
  ftsIds,
  idInClause,
  normalizeQuery,
  nullableTextOf,
  sortRanked,
  textOf,
  widen,
} from "@/db/repos/_pickers";

export type Company = {
  id: string;
  name: string;
  website: string | null;
  phoneE164: string | null;
  phoneRaw: string | null;
  addressJson: string | null;
  sourceId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/**
 * One row of the Companies list.
 *
 * The list showed the name, the phone and two tags; what it could not answer
 * was "is there work on here" (CPO audit, F-LA-7). Two correlated subqueries
 * in the same statement, declared here rather than on `Company` so the picker
 * and the dedupe scan keep their cheaper select.
 */
export type CompanyListRow = Company & {
  openDealCount: number;
  openDealValueCents: number;
};

export const newCompanySchema = z.object({
  name: z.string().min(1, "A company needs a name."),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  addressJson: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type NewCompany = z.input<typeof newCompanySchema>;

export type CompanyFilter = {
  search?: string;
  sourceId?: string;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
};

const COMPANY_COLS: readonly Col<Company>[] = [
  ["id", "co.id", "text"],
  ["name", "co.name", "text"],
  ["website", "co.website", "textNull"],
  ["phoneE164", "co.phone_e164", "textNull"],
  ["phoneRaw", "co.phone_raw", "textNull"],
  ["addressJson", "co.address_json", "textNull"],
  ["sourceId", "co.source_id", "textNull"],
  ["notes", "co.notes", "textNull"],
  ["createdAt", "co.created_at", "text"],
  ["updatedAt", "co.updated_at", "text"],
  ["deletedAt", "co.deleted_at", "textNull"],
] as const;

const OPEN_DEALS = `FROM deals d JOIN stages st ON st.id = d.stage_id
     WHERE d.company_id = co.id AND d.deleted_at IS NULL
       AND st.is_won = 0 AND st.is_lost = 0`;

const COMPANY_LIST_COLS: readonly Col<CompanyListRow>[] = [
  ...COMPANY_COLS,
  ["openDealCount", `(SELECT count(*) ${OPEN_DEALS})`, "int"],
  [
    "openDealValueCents",
    `(SELECT coalesce(sum(d.value_cents), 0) ${OPEN_DEALS})`,
    "int",
  ],
] as const;

export async function get(id: string): Promise<Company | null> {
  const rows = await raw.query(
    `SELECT ${selectList(COMPANY_COLS, "co")} FROM companies co WHERE co.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(COMPANY_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Company> {
  const found = await get(id);
  if (!found) throw new NotFoundError("company", id);
  return found;
}

function whereFor(filter: CompanyFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.onlyDeleted) clauses.push("co.deleted_at IS NOT NULL");
  else if (!filter.includeDeleted) clauses.push("co.deleted_at IS NULL");
  if (filter.sourceId) {
    clauses.push("co.source_id = ?");
    params.push(filter.sourceId);
  }
  if (filter.search && filter.search.trim().length > 0) {
    // LIKE has no default escape character in SQLite: an unescaped % or _ in
    // the owner's own search text would otherwise act as a wildcard instead
    // of matching itself (docs/CONTRACTS.md, LR-SEC packet item 5). `contains`
    // is the same escaping the pickers in _pickers.ts already use.
    clauses.push("co.name LIKE ? ESCAPE '\\'");
    params.push(contains(filter.search.trim()));
  }
  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function list(
  filter: CompanyFilter = {},
  page?: Page,
): Promise<{ rows: CompanyListRow[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(COMPANY_LIST_COLS, "co")} FROM companies co${where.sql}
     ORDER BY co.name COLLATE NOCASE ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total FROM companies co${where.sql}`,
    where.params,
  );
  return { rows: mapRows(COMPANY_LIST_COLS, rows), total };
}

/** Exact-name lookup, used by the CSV import to link or create a company. */
export async function findByName(name: string): Promise<Company | null> {
  const trimmedName = trimmed(name);
  if (trimmedName.length === 0) return null;
  const rows = await raw.query(
    `SELECT ${selectList(COMPANY_COLS, "co")} FROM companies co
     WHERE co.name = ? AND co.deleted_at IS NULL
     ORDER BY co.created_at ASC LIMIT 1`,
    [trimmedName],
  );
  return rows.length > 0 ? mapRows(COMPANY_COLS, rows)[0] : null;
}

export async function findDuplicates(
  input: { name?: string; phone?: string },
  excludeId?: string,
): Promise<DuplicateWarning[]> {
  const out: DuplicateWarning[] = [];
  // One read of the workspace's phone region per call (F-LC-2): a GB or AU
  // workspace must not have "07700 900123" and "+44 7700 900123" normalise
  // to two different, non-matching e164 values.
  const region = input.phone ? await settings.get("defaultRegion") : undefined;
  const e164 = input.phone ? normalizePhone(input.phone, region).e164 : null;
  if (e164) {
    const rows = await raw.query(
      `SELECT co.id AS co_id, co.name AS co_name FROM companies co
       WHERE co.phone_e164 = ? AND co.deleted_at IS NULL ${excludeId ? "AND co.id <> ?" : ""}`,
      excludeId ? [e164, excludeId] : [e164],
    );
    for (const r of rows) {
      out.push({
        matchedOn: "phone",
        value: e164,
        entityType: "company",
        entityId: String(r[0]),
        label: String(r[1]),
      });
    }
  }
  return out;
}

export async function create(
  input: NewCompany,
  options: { region?: string; batchId?: string } = {},
): Promise<Company> {
  const parsed = parseOrThrow(newCompanySchema, input);
  return withWrite(async () => {
    const phone = parsed.phone ? normalizePhone(parsed.phone, options.region) : null;
    const stamps = stampNew();
    const row = {
      ...stamps,
      name: trimmed(parsed.name),
      website: trimmedOrNull(parsed.website),
      phoneRaw: phone && phone.raw.length > 0 ? phone.raw : null,
      phoneE164: phone?.e164 ?? null,
      addressJson: parsed.addressJson ?? null,
      sourceId: parsed.sourceId ?? null,
      notes: trimmedOrNull(parsed.notes),
      deletedAt: null,
    };
    const stmt = insertStatement("companies", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("company", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a company");
}

export type CompanyPatch = Partial<NewCompany>;

export async function update(
  id: string,
  patch: CompanyPatch,
  options: { region?: string; batchId?: string } = {},
): Promise<Company> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = trimmed(patch.name);
    if (patch.website !== undefined) values.website = trimmedOrNull(patch.website);
    if (patch.phone !== undefined) {
      const phone = patch.phone ? normalizePhone(patch.phone, options.region) : null;
      values.phoneRaw = phone && phone.raw.length > 0 ? phone.raw : null;
      values.phoneE164 = phone?.e164 ?? null;
    }
    if (patch.addressJson !== undefined)
      values.addressJson = patch.addressJson ?? null;
    if (patch.sourceId !== undefined) values.sourceId = patch.sourceId ?? null;
    if (patch.notes !== undefined) values.notes = trimmedOrNull(patch.notes);

    const stmt = updateStatement("companies", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("company", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a company");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("companies", "company", id, options.batchId),
    "Deleting a company",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("companies", "company", id, options.batchId),
    "Restoring a company",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("companies", "company", id, options.batchId),
    "Purging a company",
  );
}

/** Counts for the company page header. */
export async function counts(id: string): Promise<{
  contacts: number;
  openDeals: number;
  closedDeals: number;
}> {
  const rows = await raw.query(
    `SELECT
       (SELECT count(*) FROM contacts c WHERE c.company_id = ? AND c.deleted_at IS NULL) AS contact_count,
       (SELECT count(*) FROM deals d JOIN stages s ON s.id = d.stage_id
         WHERE d.company_id = ? AND d.deleted_at IS NULL AND s.is_won = 0 AND s.is_lost = 0) AS open_count,
       (SELECT count(*) FROM deals d JOIN stages s ON s.id = d.stage_id
         WHERE d.company_id = ? AND d.deleted_at IS NULL AND (s.is_won = 1 OR s.is_lost = 1)) AS closed_count`,
    [id, id, id],
  );
  const row = rows[0] ?? [0, 0, 0];
  return {
    contacts: Number(row[0]),
    openDeals: Number(row[1]),
    closedDeals: Number(row[2]),
  };
}

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/data/lib/importWrite.ts. */
/* -------------------------------------------------------------------------- */

/** A new company with nothing but a name: the import links by exact name. */
export function companyCreateStatement(
  name: string,
  options: { sourceId?: string | null } = {},
): { id: string; statement: Statement } {
  const s = stampNew();
  return {
    id: s.id,
    statement: insertStatement("companies", {
      ...s,
      name: name.trim(),
      website: null,
      phoneRaw: null,
      phoneE164: null,
      addressJson: null,
      sourceId: options.sourceId ?? null,
      notes: null,
      deletedAt: null,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/data/lib/duplicates.ts. */
/* -------------------------------------------------------------------------- */

/** Companies with the same name (case-insensitive) or the same phone. */
export async function findCompanyPairs(limit = 200): Promise<DuplicatePair[]> {
  const rows = await raw.query(
    `SELECT x.matched_value AS m_value, x.kind AS m_kind,
            a.id AS a_id, a.name AS a_name, a.created_at AS a_created,
            b.id AS b_id, b.name AS b_name, b.created_at AS b_created
     FROM (
       SELECT lower(c1.name) AS matched_value, 'name' AS kind,
              c1.id AS a_id, c2.id AS b_id
       FROM companies c1
       JOIN companies c2 ON lower(c2.name) = lower(c1.name) AND c2.id > c1.id
       WHERE c1.deleted_at IS NULL AND c2.deleted_at IS NULL
       UNION
       SELECT c1.phone_e164 AS matched_value, 'phone' AS kind,
              c1.id AS a_id, c2.id AS b_id
       FROM companies c1
       JOIN companies c2 ON c2.phone_e164 = c1.phone_e164 AND c2.id > c1.id
       WHERE c1.deleted_at IS NULL AND c2.deleted_at IS NULL
         AND c1.phone_e164 IS NOT NULL
     ) x
     JOIN companies a ON a.id = x.a_id AND a.deleted_at IS NULL
     JOIN companies b ON b.id = x.b_id AND b.deleted_at IS NULL
     ORDER BY x.kind ASC, a.created_at ASC
     LIMIT ?`,
    [limit],
  );

  const seen = new Set<string>();
  const pairs: DuplicatePair[] = [];
  for (const r of rows) {
    const aId = String(r[2]);
    const bId = String(r[5]);
    const dedupe = `${aId}:${bId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const matchedOn = String(r[1]) as MatchedOn;
    pairs.push({
      entityType: "company",
      matchedOn,
      value: String(r[0]),
      key: pairKey("company", matchedOn, aId, bId),
      a: {
        id: aId,
        label: String(r[3]),
        detail: "Company",
        createdAt: String(r[4]),
      },
      b: {
        id: bId,
        label: String(r[6]),
        detail: "Company",
        createdAt: String(r[7]),
      },
    });
  }
  return pairs;
}

/* -------------------------------------------------------------------------- */
/* type-ahead search, for the company pickers                                 */
/* -------------------------------------------------------------------------- */

export type CompanySearchResult = {
  id: string;
  label: string;
  detail?: string;
};

const COMPANY_SEARCH_SELECT = `
  SELECT co.id         AS co_id,
         co.name       AS co_name,
         co.website    AS co_website,
         co.phone_raw  AS co_phone_raw,
         co.phone_e164 AS co_phone_e164
  FROM companies co`;

function companyResult(r: readonly unknown[]): CompanySearchResult {
  const website = nullableTextOf(r[2]);
  const phone = nullableTextOf(r[3]) ?? nullableTextOf(r[4]);
  const detail = website ?? (phone ? formatPhone(phone) : null);
  return {
    id: textOf(r[0]),
    label: textOf(r[1]) || "(no name)",
    ...(detail ? { detail } : {}),
  };
}

/**
 * Companies matching what the owner has typed, best first. Matches the name,
 * the website and the phone; an empty query answers with the companies
 * touched most recently.
 */
export async function search(
  query: string,
  limit = PICKER_LIMIT,
): Promise<CompanySearchResult[]> {
  const q = normalizeQuery(query);

  if (q.length === 0) {
    const rows = await raw.query(
      `${COMPANY_SEARCH_SELECT}
       WHERE co.deleted_at IS NULL
       ORDER BY co.updated_at DESC, co.rowid DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(companyResult);
  }

  const ids = await ftsIds(q, "company", widen(limit));
  const like = contains(q);
  const digits = digitsOf(q);
  const digitLike = digits.length >= 3 ? `%${digits}%` : null;

  const rows = await raw.query(
    `${COMPANY_SEARCH_SELECT}
     WHERE co.deleted_at IS NULL AND (
       co.name LIKE ? ESCAPE '\\'
       OR co.website LIKE ? ESCAPE '\\'
       OR co.phone_raw LIKE ? ESCAPE '\\'
       ${digitLike ? "OR co.phone_e164 LIKE ?" : ""}
       OR ${idInClause("co.id", ids)}
     )
     LIMIT ?`,
    [
      like,
      like,
      like,
      ...(digitLike ? [digitLike] : []),
      ...ids,
      widen(limit),
    ],
  );

  const ranked = rows.map((r) => {
    const item = companyResult(r);
    const website = nullableTextOf(r[2]);
    const phone = nullableTextOf(r[3]) ?? nullableTextOf(r[4]);
    const phoneRank =
      digitLike && phone && digitsOf(phone).includes(digits) ? 2 : 3;
    return {
      rank: Math.min(bestRank([item.label, website], q), phoneRank),
      item,
    };
  });

  return sortRanked(ranked).slice(0, limit);
}
