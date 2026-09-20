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
import { normalizePhone, formatPhone } from "@/lib/phone";
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
  rankText,
  sortRanked,
  textOf,
  widen,
} from "@/db/repos/_pickers";

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
  /**
   * Set when the linked company is in the Trash. The join does not filter it
   * out: dropping the name would read as "No company" on a contact who has
   * one. Screens say "(in Trash)" beside it instead (CPO audit, F-LA-9).
   */
  companyDeletedAt: string | null;
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

/**
 * One row of the Contacts list.
 *
 * The list used to show the name, the company and two tags, which is not what
 * the owner opens it for: PLAN.md says he scans for the name, the money and
 * the phone number, and there was no phone on the screen at all (CPO audit,
 * F-LA-7). These four extras come from correlated subqueries in the same
 * statement rather than a read per row, and they are declared here rather than
 * on `Contact` so that `get`, the pickers and the dedupe scan keep their
 * cheaper select.
 */
export type ContactListRow = Contact & {
  primaryPhoneRaw: string | null;
  primaryPhoneE164: string | null;
  /** The soonest open task on this person: the promise still outstanding. */
  nextTaskTitle: string | null;
  nextTaskDueOn: string | null;
  nextTaskDueAt: string | null;
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
  /**
   * True excludes a contact whose first and last name are both blank — the
   * company-only rows a website or CSV import tends to create. Done in SQL,
   * not filtered in JS after the fact, so `list`'s count and the virtualised
   * list it feeds stay in agreement.
   */
  hasName?: boolean;
};

const CONTACT_COLS: readonly Col<Contact>[] = [
  ["id", "c.id", "text"],
  ["firstName", "c.first_name", "text"],
  ["lastName", "c.last_name", "text"],
  ["companyId", "c.company_id", "textNull"],
  ["companyName", "co.name", "textNull"],
  ["companyDeletedAt", "co.deleted_at", "textNull"],
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

/**
 * `CONTACT_COLS` plus what the list screen shows and nothing else reads.
 *
 * The task subqueries repeat their WHERE because SQLite has no LATERAL: three
 * correlated reads of one indexed column are still one statement and one plan,
 * which is what "no N+1" means here. `due_on IS NULL` sorts last so a dated
 * promise always wins over an undated one - the same order `tasks.list` uses.
 */
const NEXT_TASK = `SELECT %s FROM tasks t
     WHERE t.contact_id = c.id AND t.deleted_at IS NULL AND t.done_at IS NULL
     ORDER BY (t.due_on IS NULL) ASC, t.due_on ASC, t.due_at ASC, t.created_at ASC
     LIMIT 1`;

const CONTACT_LIST_COLS: readonly Col<ContactListRow>[] = [
  ...CONTACT_COLS,
  [
    "primaryPhoneRaw",
    `(SELECT p.raw FROM contact_phones p
      WHERE p.contact_id = c.id AND p.deleted_at IS NULL
      ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1)`,
    "textNull",
  ],
  [
    "primaryPhoneE164",
    `(SELECT p.e164 FROM contact_phones p
      WHERE p.contact_id = c.id AND p.deleted_at IS NULL
      ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1)`,
    "textNull",
  ],
  ["nextTaskTitle", `(${NEXT_TASK.replace("%s", "t.title")})`, "textNull"],
  ["nextTaskDueOn", `(${NEXT_TASK.replace("%s", "t.due_on")})`, "textNull"],
  ["nextTaskDueAt", `(${NEXT_TASK.replace("%s", "t.due_at")})`, "textNull"],
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
  if (filter.hasName) {
    clauses.push("(trim(c.first_name) <> '' OR trim(c.last_name) <> '')");
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
): Promise<{ rows: ContactListRow[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(CONTACT_LIST_COLS, "c")} ${CONTACT_FROM}${where.sql}
     ORDER BY c.last_name COLLATE NOCASE ASC, c.first_name COLLATE NOCASE ASC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT count(*) AS total ${CONTACT_FROM}${where.sql}`,
    where.params,
  );
  return { rows: mapRows(CONTACT_LIST_COLS, rows), total };
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

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/data/lib/importWrite.ts. */
/* -------------------------------------------------------------------------- */

export type ImportedContact = {
  firstName: string;
  lastName: string;
  companyId: string | null;
  sourceId: string | null;
  notes: string | null;
  addressJson: string | null;
  phones: { raw: string; label: string }[];
  emails: { email: string; label: string }[];
};

/**
 * A contact and its child rows, modelled on `contacts.createStatements` but
 * with `address_json` written in the same insert. The repository version does
 * not take an address, and an import that followed every contact with an
 * `UPDATE contacts SET address_json` would put a statement between each pair
 * of inserts, which is exactly what stops a batch coalescing (see planBatch).
 * Listed in docs/STATUS.md for promotion into the repository.
 */
export function importContactStatements(
  input: ImportedContact,
  region?: string,
): { id: string; statements: Statement[] } {
  const s = stampNew();
  const statements: Statement[] = [
    insertStatement("contacts", {
      ...s,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      companyId: input.companyId,
      addressJson: input.addressJson,
      sourceId: input.sourceId,
      notes: trimmedOrNull(input.notes),
      deletedAt: null,
    }),
  ];
  input.phones.forEach((phone, i) => {
    if (phone.raw.trim().length === 0) return;
    statements.push(
      contactPhoneStatement(s.id, phone.raw, phone.label, {
        region,
        isPrimary: i === 0,
      }),
    );
  });
  input.emails.forEach((email, i) => {
    if (email.email.trim().length === 0) return;
    statements.push(contactEmailStatement(s.id, email.email, email.label, i === 0));
  });
  return { id: s.id, statements };
}

/* -------------------------------------------------------------------------- */
/* child rows on an existing contact (the "update" dedupe policy)             */
/* -------------------------------------------------------------------------- */

export function contactEmailStatement(
  contactId: string,
  email: string,
  label = "work",
  isPrimary = false,
): Statement {
  return insertStatement("contact_emails", {
    ...stampNew(),
    contactId,
    emailLower: email.trim().toLowerCase(),
    label,
    isPrimary,
    deletedAt: null,
  });
}

export function contactPhoneStatement(
  contactId: string,
  rawPhone: string,
  label = "phone",
  options: { region?: string; isPrimary?: boolean } = {},
): Statement {
  const normalized = normalizePhone(rawPhone, options.region);
  return insertStatement("contact_phones", {
    ...stampNew(),
    contactId,
    raw: normalized.raw,
    e164: normalized.e164,
    label,
    isPrimary: options.isPrimary ?? false,
    deletedAt: null,
  });
}

/**
 * The fields an "update" import may fill in. Only values the CSV actually
 * carries are written, and only over a column that is empty today: an import
 * must never quietly overwrite something the owner typed.
 */
export type ContactUpdate = {
  firstName?: string;
  lastName?: string;
  companyId?: string | null;
  addressJson?: string | null;
  sourceId?: string | null;
  notes?: string | null;
};

export function contactUpdateStatement(
  contactId: string,
  patch: ContactUpdate,
): Statement | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  const add = (column: string, value: unknown) => {
    // COALESCE(NULLIF(col, ''), ?) keeps whatever is already there.
    sets.push(`${column} = COALESCE(NULLIF(${column}, ''), ?)`);
    params.push(value);
  };

  if (patch.firstName !== undefined && patch.firstName.length > 0) {
    add("first_name", patch.firstName);
  }
  if (patch.lastName !== undefined && patch.lastName.length > 0) {
    add("last_name", patch.lastName);
  }
  if (patch.companyId !== undefined && patch.companyId !== null) {
    add("company_id", patch.companyId);
  }
  if (patch.addressJson !== undefined && patch.addressJson !== null) {
    add("address_json", patch.addressJson);
  }
  if (patch.sourceId !== undefined && patch.sourceId !== null) {
    add("source_id", patch.sourceId);
  }
  const notes = trimmedOrNull(patch.notes ?? null);
  if (notes !== null) {
    // Notes append rather than replace: nothing the owner wrote is lost.
    sets.push(
      `notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END`,
    );
    params.push(notes, notes);
  }

  if (sets.length === 0) return null;
  sets.push("updated_at = ?");
  params.push(nowIso(), contactId);
  return {
    sql: `UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`,
    params,
  };
}

/* -------------------------------------------------------------------------- */
/* Promoted in wave 3 from src/features/data/lib/duplicates.ts. */
/* -------------------------------------------------------------------------- */

function contactLabel(first: string, last: string): string {
  const name = `${first} ${last}`.trim();
  return name.length > 0 ? name : "(no name)";
}

/**
 * Contacts that share an email address, then contacts that share a phone
 * number. A pair already found on email is not reported again on phone.
 */
export async function findContactPairs(limit = 200): Promise<DuplicatePair[]> {
  const shared = `
    SELECT x.matched_value AS m_value, x.kind AS m_kind,
           a.id AS a_id, a.first_name AS a_first, a.last_name AS a_last,
           a.created_at AS a_created, ca.name AS a_company,
           b.id AS b_id, b.first_name AS b_first, b.last_name AS b_last,
           b.created_at AS b_created, cb.name AS b_company
    FROM (
      SELECT e1.email_lower AS matched_value, 'email' AS kind,
             e1.contact_id AS a_id, e2.contact_id AS b_id
      FROM contact_emails e1
      JOIN contact_emails e2
        ON e2.email_lower = e1.email_lower AND e2.contact_id > e1.contact_id
      WHERE e1.deleted_at IS NULL AND e2.deleted_at IS NULL
        AND length(e1.email_lower) > 0
      UNION
      SELECT p1.e164 AS matched_value, 'phone' AS kind,
             p1.contact_id AS a_id, p2.contact_id AS b_id
      FROM contact_phones p1
      JOIN contact_phones p2
        ON p2.e164 = p1.e164 AND p2.contact_id > p1.contact_id
      WHERE p1.deleted_at IS NULL AND p2.deleted_at IS NULL
        AND p1.e164 IS NOT NULL
    ) x
    JOIN contacts a ON a.id = x.a_id AND a.deleted_at IS NULL
    JOIN contacts b ON b.id = x.b_id AND b.deleted_at IS NULL
    LEFT JOIN companies ca ON ca.id = a.company_id
    LEFT JOIN companies cb ON cb.id = b.company_id
    ORDER BY x.kind ASC, a.created_at ASC
    LIMIT ?`;

  const rows = await raw.query(shared, [limit]);
  const seen = new Set<string>();
  const pairs: DuplicatePair[] = [];

  for (const r of rows) {
    const value = String(r[0]);
    const matchedOn = String(r[1]) as MatchedOn;
    const aId = String(r[2]);
    const bId = String(r[7]);
    const dedupe = `${aId}:${bId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    pairs.push({
      entityType: "contact",
      matchedOn,
      value,
      key: pairKey("contact", matchedOn, aId, bId),
      a: {
        id: aId,
        label: contactLabel(String(r[3] ?? ""), String(r[4] ?? "")),
        detail: String(r[6] ?? "") || "No company",
        createdAt: String(r[5]),
      },
      b: {
        id: bId,
        label: contactLabel(String(r[8] ?? ""), String(r[9] ?? "")),
        detail: String(r[11] ?? "") || "No company",
        createdAt: String(r[10]),
      },
    });
  }
  return pairs;
}

/* -------------------------------------------------------------------------- */
/* type-ahead search, for the contact pickers                                 */
/* -------------------------------------------------------------------------- */

/**
 * One row of a contact picker. `companyId` is here because every picker that
 * chooses a contact sits next to one that chooses a company: picking the
 * contact fills the company, and the owner can still change it.
 */
export type ContactSearchResult = {
  id: string;
  label: string;
  detail?: string;
  companyId: string | null;
  companyName: string | null;
};

const CONTACT_SEARCH_SELECT = `
  SELECT c.id          AS c_id,
         c.first_name  AS c_first_name,
         c.last_name   AS c_last_name,
         c.company_id  AS c_company_id,
         co.name       AS co_name,
         (SELECT e.email_lower FROM contact_emails e
           WHERE e.contact_id = c.id AND e.deleted_at IS NULL
           ORDER BY e.is_primary DESC, e.created_at ASC LIMIT 1) AS c_email,
         (SELECT p.raw FROM contact_phones p
           WHERE p.contact_id = c.id AND p.deleted_at IS NULL
           ORDER BY p.is_primary DESC, p.created_at ASC LIMIT 1) AS c_phone
  FROM contacts c
  LEFT JOIN companies co ON co.id = c.company_id`;

function contactResult(r: readonly unknown[]): ContactSearchResult {
  const first = textOf(r[1]);
  const last = textOf(r[2]);
  const companyName = nullableTextOf(r[4]);
  const email = nullableTextOf(r[5]);
  const phone = nullableTextOf(r[6]);
  const detail = companyName ?? email ?? (phone ? formatPhone(phone) : null);
  return {
    id: textOf(r[0]),
    label: contactName({ firstName: first, lastName: last }),
    ...(detail ? { detail } : {}),
    companyId: nullableTextOf(r[3]),
    companyName,
  };
}

/**
 * Contacts matching what the owner has typed, best first.
 *
 * Matches a name, an email, a phone (typed any way - the digits are compared
 * against E.164) or the company name, plus anything the FTS index catches.
 * An empty query answers with the contacts touched most recently, so opening
 * the picker is useful before a single keystroke.
 */
export async function search(
  query: string,
  limit = PICKER_LIMIT,
): Promise<ContactSearchResult[]> {
  const q = normalizeQuery(query);

  if (q.length === 0) {
    const rows = await raw.query(
      `${CONTACT_SEARCH_SELECT}
       WHERE c.deleted_at IS NULL
       ORDER BY c.updated_at DESC, c.rowid DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(contactResult);
  }

  const ids = await ftsIds(q, "contact", widen(limit));
  const like = contains(q);
  const digits = digitsOf(q);
  const digitLike = digits.length >= 3 ? `%${digits}%` : null;

  const rows = await raw.query(
    `${CONTACT_SEARCH_SELECT}
     WHERE c.deleted_at IS NULL AND (
       trim(c.first_name || ' ' || c.last_name) LIKE ? ESCAPE '\\'
       OR c.first_name LIKE ? ESCAPE '\\'
       OR c.last_name LIKE ? ESCAPE '\\'
       OR co.name LIKE ? ESCAPE '\\'
       OR EXISTS (SELECT 1 FROM contact_emails e
                   WHERE e.contact_id = c.id AND e.deleted_at IS NULL
                     AND e.email_lower LIKE ? ESCAPE '\\')
       OR EXISTS (SELECT 1 FROM contact_phones p
                   WHERE p.contact_id = c.id AND p.deleted_at IS NULL
                     AND (p.raw LIKE ? ESCAPE '\\'
                          ${digitLike ? "OR p.e164 LIKE ?" : ""}))
       OR ${idInClause("c.id", ids)}
     )
     LIMIT ?`,
    [
      like,
      like,
      like,
      like,
      like,
      like,
      ...(digitLike ? [digitLike] : []),
      ...ids,
      widen(limit),
    ],
  );

  const ranked = rows.map((r) => {
    const item = contactResult(r);
    const email = nullableTextOf(r[5]);
    const phone = nullableTextOf(r[6]);
    const phoneRank =
      digitLike && phone && digitsOf(phone).includes(digits) ? 2 : 3;
    return {
      rank: Math.min(
        bestRank([item.label, email], q),
        // A hit on the company is a weaker reason to show a contact than a
        // hit on their own name, so it never outranks one.
        Math.min(rankText(item.companyName, q) + 1, 3),
        phoneRank,
      ),
      item,
    };
  });

  return sortRanked(ranked).slice(0, limit);
}
