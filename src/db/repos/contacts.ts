/**
 * Contacts, with phones and emails as child rows.
 *
 * Phones are normalised to E.164 on save and kept raw as typed; an
 * unparseable number is stored with e164 = NULL, never rejected. Emails are
 * stored lowercased because email_lower is the dedupe key. There is no unique
 * constraint on either: duplicates are policy (import "create duplicates") and
 * are surfaced as a warning, not an error.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError, type DuplicateWarning } from "@/db/errors";
import { normalizePhone } from "@/lib/phone";
import { normalizeEmail } from "@/lib/email";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import {
  countRows,
  insertStatement,
  logWrite,
  mapRows,
  pageClause,
  restoreRow,
  selectList,
  softDeleteRow,
  purgeRow,
  stampNew,
  trimmed,
  trimmedOrNull,
  updateStatement,
  parseOrThrow,
  type Col,
  type Page,
} from "@/db/repos/_base";

export type ContactPhone = {
  id: string;
  contactId: string;
  raw: string;
  e164: string | null;
  label: string;
  isPrimary: boolean;
};

export type ContactEmail = {
  id: string;
  contactId: string;
  emailLower: string;
  label: string;
  isPrimary: boolean;
};

export type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  companyId: string | null;
  companyName: string | null;
  addressJson: string | null;
  sourceId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ContactWithChildren = Contact & {
  phones: ContactPhone[];
  emails: ContactEmail[];
};

export const phoneInput = z.object({
  id: z.string().optional(),
  raw: z.string(),
  label: z.string().default("mobile"),
  isPrimary: z.boolean().default(false),
});

export const emailInput = z.object({
  id: z.string().optional(),
  email: z.string(),
  label: z.string().default("work"),
  isPrimary: z.boolean().default(false),
});

export const newContactSchema = z.object({
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  companyId: z.string().nullable().optional(),
  addressJson: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  phones: z.array(phoneInput).optional(),
  emails: z.array(emailInput).optional(),
});

export type NewContact = z.input<typeof newContactSchema>;

export type ContactFilter = {
  search?: string;
  companyId?: string;
  sourceId?: string;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
};

const CONTACT_COLS: readonly Col<Contact>[] = [
  ["id", "c.id", "text"],
  ["firstName", "c.first_name", "text"],
  ["lastName", "c.last_name", "text"],
  ["companyId", "c.company_id", "textNull"],
  ["companyName", "co.name", "textNull"],
  ["addressJson", "c.address_json", "textNull"],
  ["sourceId", "c.source_id", "textNull"],
  ["notes", "c.notes", "textNull"],
  ["createdAt", "c.created_at", "text"],
  ["updatedAt", "c.updated_at", "text"],
  ["deletedAt", "c.deleted_at", "textNull"],
] as const;

const PHONE_COLS: readonly Col<ContactPhone>[] = [
  ["id", "p.id", "text"],
  ["contactId", "p.contact_id", "text"],
  ["raw", "p.raw", "text"],
  ["e164", "p.e164", "textNull"],
  ["label", "p.label", "text"],
  ["isPrimary", "p.is_primary", "bool"],
] as const;

const EMAIL_COLS: readonly Col<ContactEmail>[] = [
  ["id", "e.id", "text"],
  ["contactId", "e.contact_id", "text"],
  ["emailLower", "e.email_lower", "text"],
  ["label", "e.label", "text"],
  ["isPrimary", "e.is_primary", "bool"],
] as const;

const CONTACT_FROM = `FROM contacts c LEFT JOIN companies co ON co.id = c.company_id`;

function displayName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

export function contactName(c: {
  firstName: string;
  lastName: string;
}): string {
  const name = displayName(c);
  return name.length > 0 ? name : "(no name)";
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<ContactWithChildren | null> {
  const rows = await raw.query(
    `SELECT ${selectList(CONTACT_COLS, "c")} ${CONTACT_FROM} WHERE c.id = ?`,
    [id],
  );
  if (rows.length === 0) return null;
  const contact = mapRows(CONTACT_COLS, rows)[0];
  const [phones, emails] = await Promise.all([
    listPhones(id),
    listEmails(id),
  ]);
  return { ...contact, phones, emails };
}

export async function getOrThrow(id: string): Promise<ContactWithChildren> {
  const found = await get(id);
  if (!found) throw new NotFoundError("contact", id);
  return found;
}

export async function listPhones(contactId: string): Promise<ContactPhone[]> {
  const rows = await raw.query(
    `SELECT ${selectList(PHONE_COLS, "p")} FROM contact_phones p
     WHERE p.contact_id = ? AND p.deleted_at IS NULL
     ORDER BY p.is_primary DESC, p.created_at ASC`,
    [contactId],
  );
  return mapRows(PHONE_COLS, rows);
}

export async function listEmails(contactId: string): Promise<ContactEmail[]> {
  const rows = await raw.query(
    `SELECT ${selectList(EMAIL_COLS, "e")} FROM contact_emails e
     WHERE e.contact_id = ? AND e.deleted_at IS NULL
     ORDER BY e.is_primary DESC, e.created_at ASC`,
    [contactId],
  );
  return mapRows(EMAIL_COLS, rows);
}

function whereFor(filter: ContactFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.onlyDeleted) clauses.push("c.deleted_at IS NOT NULL");
  else if (!filter.includeDeleted) clauses.push("c.deleted_at IS NULL");

  if (filter.companyId) {
    clauses.push("c.company_id = ?");
    params.push(filter.companyId);
  }
  if (filter.sourceId) {
    clauses.push("c.source_id = ?");
    params.push(filter.sourceId);
  }
  if (filter.search && filter.search.trim().length > 0) {
    clauses.push(
      "(c.first_name LIKE ? OR c.last_name LIKE ? OR co.name LIKE ?)",
    );
    const like = `%${filter.search.trim()}%`;
    params.push(like, like, like);
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function list(
  filter: ContactFilter = {},
  page?: Page,
): Promise<{ rows: Contact[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(CONTACT_COLS, "c")} ${CONTACT_FROM}${where.sql}
     ORDER BY c.last_name COLLATE NOCASE ASC, c.first_name COLLATE NOCASE ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total ${CONTACT_FROM}${where.sql}`,
    where.params,
  );
  return { rows: mapRows(CONTACT_COLS, rows), total };
}

/* -------------------------------------------------------------------------- */
/* duplicate warning (email_lower first, then e164)                           */
/* -------------------------------------------------------------------------- */

export async function findDuplicates(
  input: { emails?: string[]; phones?: string[] },
  excludeContactId?: string,
): Promise<DuplicateWarning[]> {
  const out: DuplicateWarning[] = [];

  const emails = (input.emails ?? [])
    .map((e) => normalizeEmail(e).lower)
    .filter((e) => e.length > 0);
  if (emails.length > 0) {
    const rows = await raw.query(
      `SELECT e.email_lower AS e_email_lower, c.id AS c_id,
              c.first_name AS c_first_name, c.last_name AS c_last_name
       FROM contact_emails e JOIN contacts c ON c.id = e.contact_id
       WHERE e.deleted_at IS NULL AND c.deleted_at IS NULL
         AND e.email_lower IN (${emails.map(() => "?").join(", ")})
         ${excludeContactId ? "AND c.id <> ?" : ""}`,
      excludeContactId ? [...emails, excludeContactId] : emails,
    );
    for (const r of rows) {
      out.push({
        matchedOn: "email",
        value: String(r[0]),
        entityType: "contact",
        entityId: String(r[1]),
        label: contactName({
          firstName: String(r[2] ?? ""),
          lastName: String(r[3] ?? ""),
        }),
      });
    }
  }

  const e164s = (input.phones ?? [])
    .map((p) => normalizePhone(p).e164)
    .filter((p): p is string => p !== null);
  if (e164s.length > 0) {
    const rows = await raw.query(
      `SELECT p.e164 AS p_e164, c.id AS c_id,
              c.first_name AS c_first_name, c.last_name AS c_last_name
       FROM contact_phones p JOIN contacts c ON c.id = p.contact_id
       WHERE p.deleted_at IS NULL AND c.deleted_at IS NULL
         AND p.e164 IN (${e164s.map(() => "?").join(", ")})
         ${excludeContactId ? "AND c.id <> ?" : ""}`,
      excludeContactId ? [...e164s, excludeContactId] : e164s,
    );
    for (const r of rows) {
      if (out.some((w) => w.entityId === String(r[1]))) continue;
      out.push({
        matchedOn: "phone",
        value: String(r[0]),
        entityType: "contact",
        entityId: String(r[1]),
        label: contactName({
          firstName: String(r[2] ?? ""),
          lastName: String(r[3] ?? ""),
        }),
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

type PhoneInput = z.output<typeof phoneInput>;
type EmailInput = z.output<typeof emailInput>;

function phoneRows(
  contactId: string,
  phones: PhoneInput[],
  region?: string,
): { sql: string; params: unknown[] }[] {
  return phones
    .filter((p) => trimmed(p.raw).length > 0)
    .map((p) => {
      const normalized = normalizePhone(p.raw, region);
      return insertStatement("contact_phones", {
        ...stampNew(),
        contactId,
        raw: normalized.raw,
        e164: normalized.e164,
        label: p.label,
        isPrimary: p.isPrimary,
      });
    });
}

function emailRows(
  contactId: string,
  emails: EmailInput[],
): { sql: string; params: unknown[] }[] {
  return emails
    .filter((e) => trimmed(e.email).length > 0)
    .map((e) =>
      insertStatement("contact_emails", {
        ...stampNew(),
        contactId,
        emailLower: normalizeEmail(e.email).lower,
        label: e.label,
        isPrimary: e.isPrimary,
      }),
    );
}

export async function create(
  input: NewContact,
  options: { region?: string; batchId?: string } = {},
): Promise<ContactWithChildren> {
  const parsed = parseOrThrow(newContactSchema, input);
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      firstName: trimmed(parsed.firstName),
      lastName: trimmed(parsed.lastName),
      companyId: parsed.companyId ?? null,
      addressJson: parsed.addressJson ?? null,
      sourceId: parsed.sourceId ?? null,
      notes: trimmedOrNull(parsed.notes),
      deletedAt: null,
    };
    await raw.batch([
      insertStatement("contacts", row),
      ...phoneRows(stamps.id, parsed.phones ?? [], options.region),
      ...emailRows(stamps.id, parsed.emails ?? []),
    ]);
    await logWrite("contact", stamps.id, "create", null, row, options.batchId);
    return getOrThrow(stamps.id);
  }, "Saving a contact");
}

export type ContactPatch = Partial<
  Pick<
    NewContact,
    "firstName" | "lastName" | "companyId" | "addressJson" | "sourceId" | "notes"
  >
>;

export async function update(
  id: string,
  patch: ContactPatch,
  options: { batchId?: string } = {},
): Promise<ContactWithChildren> {
  return withWrite(async () => {
    const before = await getOrThrow(id);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.firstName !== undefined) values.firstName = trimmed(patch.firstName);
    if (patch.lastName !== undefined) values.lastName = trimmed(patch.lastName);
    if (patch.companyId !== undefined) values.companyId = patch.companyId ?? null;
    if (patch.addressJson !== undefined)
      values.addressJson = patch.addressJson ?? null;
    if (patch.sourceId !== undefined) values.sourceId = patch.sourceId ?? null;
    if (patch.notes !== undefined) values.notes = trimmedOrNull(patch.notes);

    const stmt = updateStatement("contacts", id, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite("contact", id, "update", before, values, options.batchId);
    return getOrThrow(id);
  }, "Saving a contact");
}

export async function addPhone(
  contactId: string,
  input: { raw: string; label?: string; isPrimary?: boolean },
  options: { region?: string; batchId?: string } = {},
): Promise<ContactPhone> {
  return withWrite(async () => {
    const normalized = normalizePhone(input.raw, options.region);
    const stamps = stampNew();
    const row = {
      ...stamps,
      contactId,
      raw: normalized.raw,
      e164: normalized.e164,
      label: input.label ?? "mobile",
      isPrimary: input.isPrimary ?? false,
    };
    const stmt = insertStatement("contact_phones", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite(
      "contact_phone",
      stamps.id,
      "create",
      null,
      row,
      options.batchId,
    );
    const phones = await listPhones(contactId);
    const found = phones.find((p) => p.id === stamps.id);
    if (!found) throw new NotFoundError("contact_phone", stamps.id);
    return found;
  }, "Saving a phone number");
}

export async function updatePhone(
  phoneId: string,
  patch: { raw?: string; label?: string; isPrimary?: boolean },
  options: { region?: string; batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.raw !== undefined) {
      const normalized = normalizePhone(patch.raw, options.region);
      values.raw = normalized.raw;
      values.e164 = normalized.e164;
    }
    if (patch.label !== undefined) values.label = patch.label;
    if (patch.isPrimary !== undefined) values.isPrimary = patch.isPrimary;
    const stmt = updateStatement("contact_phones", phoneId, values);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite(
      "contact_phone",
      phoneId,
      "update",
      null,
      values,
      options.batchId,
    );
  }, "Saving a phone number");
}

export async function removePhone(phoneId: string): Promise<void> {
  await withWrite(async () => {
    await raw.execute(`DELETE FROM contact_phones WHERE id = ?`, [phoneId]);
    await logWrite("contact_phone", phoneId, "delete", null, null);
  }, "Removing a phone number");
}

export async function addEmail(
  contactId: string,
  input: { email: string; label?: string; isPrimary?: boolean },
  options: { batchId?: string } = {},
): Promise<ContactEmail> {
  return withWrite(async () => {
    const stamps = stampNew();
    const row = {
      ...stamps,
      contactId,
      emailLower: normalizeEmail(input.email).lower,
      label: input.label ?? "work",
      isPrimary: input.isPrimary ?? false,
    };
    const stmt = insertStatement("contact_emails", row);
    await raw.execute(stmt.sql, stmt.params);
    await logWrite(
      "contact_email",
      stamps.id,
      "create",
      null,
      row,
      options.batchId,
    );
    const emails = await listEmails(contactId);
    const found = emails.find((e) => e.id === stamps.id);
    if (!found) throw new NotFoundError("contact_email", stamps.id);
    return found;
  }, "Saving an email address");
}

export async function removeEmail(emailId: string): Promise<void> {
  await withWrite(async () => {
    await raw.execute(`DELETE FROM contact_emails WHERE id = ?`, [emailId]);
    await logWrite("contact_email", emailId, "delete", null, null);
  }, "Removing an email address");
}

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("contacts", "contact", id, options.batchId),
    "Deleting a contact",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("contacts", "contact", id, options.batchId),
    "Restoring a contact",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("contacts", "contact", id, options.batchId),
    "Purging a contact",
  );
}

/** Used by the CSV import and the lead poller: dedupe on email, then phone. */
export async function findByEmailOrPhone(
  email: string | null,
  phone: string | null,
): Promise<string | null> {
  const lower = email ? normalizeEmail(email).lower : "";
  if (lower.length > 0) {
    const rows = await raw.query(
      `SELECT c.id AS c_id FROM contact_emails e JOIN contacts c ON c.id = e.contact_id
       WHERE e.email_lower = ? AND e.deleted_at IS NULL AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC LIMIT 1`,
      [lower],
    );
    if (rows.length > 0) return String(rows[0][0]);
  }
  const e164 = phone ? normalizePhone(phone).e164 : null;
  if (e164) {
    const rows = await raw.query(
      `SELECT c.id AS c_id FROM contact_phones p JOIN contacts c ON c.id = p.contact_id
       WHERE p.e164 = ? AND p.deleted_at IS NULL AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC LIMIT 1`,
      [e164],
    );
    if (rows.length > 0) return String(rows[0][0]);
  }
  return null;
}

/** Statements only, so the CSV import can fold contacts into its own batch. */
export function createStatements(
  input: {
    firstName?: string;
    lastName?: string;
    companyId?: string | null;
    sourceId?: string | null;
    notes?: string | null;
    phones?: { raw: string; label?: string; isPrimary?: boolean }[];
    emails?: { email: string; label?: string; isPrimary?: boolean }[];
  },
  region?: string,
): { id: string; statements: { sql: string; params: unknown[] }[] } {
  const stamps = { id: newId(), createdAt: nowIso(), updatedAt: nowIso() };
  const statements = [
    insertStatement("contacts", {
      ...stamps,
      firstName: trimmed(input.firstName),
      lastName: trimmed(input.lastName),
      companyId: input.companyId ?? null,
      sourceId: input.sourceId ?? null,
      notes: trimmedOrNull(input.notes),
      deletedAt: null,
    }),
    ...phoneRows(
      stamps.id,
      (input.phones ?? []).map((p) => ({
        raw: p.raw,
        label: p.label ?? "mobile",
        isPrimary: p.isPrimary ?? false,
      })),
      region,
    ),
    ...emailRows(
      stamps.id,
      (input.emails ?? []).map((e) => ({
        email: e.email,
        label: e.label ?? "work",
        isPrimary: e.isPrimary ?? false,
      })),
    ),
  ];
  return { id: stamps.id, statements };
}
