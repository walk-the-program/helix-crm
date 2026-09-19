/**
 * Companies. A company page shows every contact, every open and closed deal,
 * and a merged timeline, so the reads here return counts alongside the row.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError, type DuplicateWarning } from "@/db/errors";
import { normalizePhone } from "@/lib/phone";
import { nowIso } from "@/lib/dates";
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
} from "@/db/repos/_base";

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
    clauses.push("co.name LIKE ?");
    params.push(`%${filter.search.trim()}%`);
  }
  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function list(
  filter: CompanyFilter = {},
  page?: Page,
): Promise<{ rows: Company[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(COMPANY_COLS, "co")} FROM companies co${where.sql}
     ORDER BY co.name COLLATE NOCASE ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total FROM companies co${where.sql}`,
    where.params,
  );
  return { rows: mapRows(COMPANY_COLS, rows), total };
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
  const e164 = input.phone ? normalizePhone(input.phone).e164 : null;
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
