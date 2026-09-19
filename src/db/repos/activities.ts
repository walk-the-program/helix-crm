/**
 * The timeline. One table serves contacts, companies and deals; a system entry
 * (stage change, task done, import, lead received, merge) is immutable, which
 * is enforced here rather than in the UI.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError, ValidationError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
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
  updateStatement,
  parseOrThrow,
  type Col,
  type Page,
} from "@/db/repos/_base";

export const ACTIVITY_KINDS = [
  "note",
  "call",
  "email",
  "meeting",
  "text",
  "system",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type Activity = {
  id: string;
  kind: ActivityKind;
  body: string;
  occurredAt: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  isSystem: boolean;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export const newActivitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS).default("note"),
  body: z.string().default(""),
  occurredAt: z.string().optional(),
  contactId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
});

export type NewActivity = z.input<typeof newActivitySchema>;

export type ActivityFilter = {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  kind?: ActivityKind;
  includeSystem?: boolean;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
  /** Company timeline: also include activities of that company's contacts. */
  mergedForCompanyId?: string;
};

const ACTIVITY_COLS: readonly Col<Activity>[] = [
  ["id", "a.id", "text"],
  ["kind", "a.kind", "text"],
  ["body", "a.body", "text"],
  ["occurredAt", "a.occurred_at", "text"],
  ["contactId", "a.contact_id", "textNull"],
  ["companyId", "a.company_id", "textNull"],
  ["dealId", "a.deal_id", "textNull"],
  ["isSystem", "a.is_system", "bool"],
  ["actorId", "a.actor_id", "text"],
  ["createdAt", "a.created_at", "text"],
  ["updatedAt", "a.updated_at", "text"],
  ["deletedAt", "a.deleted_at", "textNull"],
] as const;

export async function get(id: string): Promise<Activity | null> {
  const rows = await raw.query(
    `SELECT ${selectList(ACTIVITY_COLS, "a")} FROM activities a WHERE a.id = ?`,
    [id],
  );
  return rows.length > 0 ? mapRows(ACTIVITY_COLS, rows)[0] : null;
}

export async function getOrThrow(id: string): Promise<Activity> {
  const found = await get(id);
  if (!found) throw new NotFoundError("activity", id);
  return found;
}

function whereFor(filter: ActivityFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.onlyDeleted) clauses.push("a.deleted_at IS NOT NULL");
  else if (!filter.includeDeleted) clauses.push("a.deleted_at IS NULL");

  if (filter.mergedForCompanyId) {
    clauses.push(
      `(a.company_id = ?
        OR a.contact_id IN (SELECT c.id FROM contacts c WHERE c.company_id = ?)
        OR a.deal_id IN (SELECT d.id FROM deals d WHERE d.company_id = ?))`,
    );
    params.push(
      filter.mergedForCompanyId,
      filter.mergedForCompanyId,
      filter.mergedForCompanyId,
    );
  } else {
    if (filter.contactId) {
      clauses.push("a.contact_id = ?");
      params.push(filter.contactId);
    }
    if (filter.companyId) {
      clauses.push("a.company_id = ?");
      params.push(filter.companyId);
    }
    if (filter.dealId) {
      clauses.push("a.deal_id = ?");
      params.push(filter.dealId);
    }
  }

  if (filter.kind) {
    clauses.push("a.kind = ?");
    params.push(filter.kind);
  }
  if (filter.includeSystem === false) clauses.push("a.is_system = 0");

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function list(
  filter: ActivityFilter = {},
  page?: Page,
): Promise<{ rows: Activity[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(ACTIVITY_COLS, "a")} FROM activities a${where.sql}
     ORDER BY a.occurred_at DESC, a.created_at DESC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total FROM activities a${where.sql}`,
    where.params,
  );
  return { rows: mapRows(ACTIVITY_COLS, rows), total };
}

/** Today's "recent activity" section. */
export async function recent(limit = 20): Promise<Activity[]> {
  const rows = await raw.query(
    `SELECT ${selectList(ACTIVITY_COLS, "a")} FROM activities a
     WHERE a.deleted_at IS NULL ORDER BY a.occurred_at DESC LIMIT ?`,
    [limit],
  );
  return mapRows(ACTIVITY_COLS, rows);
}

export async function create(
  input: NewActivity,
  options: { batchId?: string } = {},
): Promise<Activity> {
  const parsed = parseOrThrow(newActivitySchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      kind: parsed.kind,
      body: parsed.body,
      occurredAt: parsed.occurredAt ?? nowIso(),
      contactId: parsed.contactId ?? null,
      companyId: parsed.companyId ?? null,
      dealId: parsed.dealId ?? null,
      isSystem: false,
      actorId: "owner",
      deletedAt: null,
    };
    const stmt = insertStatement("activities", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("activity", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a timeline entry");
}

/**
 * A system entry: written by the repositories themselves (stage change, task
 * done, import, lead received, merge). Immutable afterwards.
 */
export function systemStatement(input: {
  body: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  occurredAt?: string;
}): { id: string; sql: string; params: unknown[] } {
  const at = nowIso();
  const id = newId();
  const stmt = insertStatement("activities", {
    id,
    createdAt: at,
    updatedAt: at,
    kind: "system",
    body: input.body,
    occurredAt: input.occurredAt ?? at,
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    dealId: input.dealId ?? null,
    isSystem: true,
    actorId: "owner",
    deletedAt: null,
  });
  return { id, sql: stmt.sql, params: stmt.params };
}

export async function createSystem(
  input: {
    body: string;
    contactId?: string | null;
    companyId?: string | null;
    dealId?: string | null;
    occurredAt?: string;
  },
  options: { batchId?: string } = {},
): Promise<Activity> {
  return withWrite(async () => {
    const stmt = systemStatement(input);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite(
      "activity",
      stmt.id,
      "create",
      null,
      { system: true, body: input.body },
      options.batchId,
    );
    return getOrThrow(stmt.id);
  }, "Recording what happened");
}

export type ActivityPatch = Partial<
  Pick<NewActivity, "kind" | "body" | "occurredAt">
>;

export async function update(
  id: string,
  patch: ActivityPatch,
  options: { batchId?: string } = {},
): Promise<Activity> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    if (before.isSystem) {
      throw new ValidationError("System entries cannot be edited.", [
        { path: "id", message: "This entry was written by Helix." },
      ]);
    }
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.body !== undefined) values.body = trimmed(patch.body);
    if (patch.occurredAt !== undefined) values.occurredAt = patch.occurredAt;
    const stmt = updateStatement("activities", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("activity", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a timeline entry");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  const before = await getOrThrow(id);
  if (before.isSystem) {
    throw new ValidationError("System entries cannot be deleted.", [
      { path: "id", message: "This entry was written by Helix." },
    ]);
  }
  await withWrite(
    () => softDeleteRow("activities", "activity", id, options.batchId),
    "Deleting a timeline entry",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("activities", "activity", id, options.batchId),
    "Restoring a timeline entry",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("activities", "activity", id, options.batchId),
    "Purging a timeline entry",
  );
}
