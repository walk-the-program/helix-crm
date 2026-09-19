/**
 * Statement builders the import folds into its own batches.
 *
 * Nothing here talks to the database: each function returns
 * `{ sql, params }`, which the import sends through `raw.batch` inside one
 * transaction. That is the only way to write a lot of rows without breaking
 * the write lock's rule that a repository write must never call another one
 * (docs/STATUS.md, foundations note 2).
 *
 * `contacts.createStatements` is the pattern; the pieces foundations did not
 * build - company create-or-link by exact name, tags, sources, custom fields,
 * and the update half of the dedupe policy - are here, and are listed under
 * "Contract changes needed" for promotion into the repositories.
 */
import { insertStatement, trimmedOrNull } from "@/db/repos/_base";
import { normalizePhone } from "@/lib/phone";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

export type Statement = { sql: string; params: unknown[] };

function stamps(): { id: string; createdAt: string; updatedAt: string } {
  const at = nowIso();
  return { id: newId(), createdAt: at, updatedAt: at };
}

/* -------------------------------------------------------------------------- */
/* multi-row inserts                                                          */
/* -------------------------------------------------------------------------- */

const SINGLE_INSERT = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]*)\)$/;

/**
 * Fold consecutive one-row inserts into the same table into one multi-row
 * insert, which is what docs/PLAN.md item 9 asks for: 500 rows arrive as a
 * handful of statements rather than several thousand.
 *
 * SQLite's default limit is 32766 bound parameters per statement, so a group
 * is split before it gets there.
 */
export const MAX_BOUND_PARAMS = 30_000;

export function coalesceInserts(statements: Statement[]): Statement[] {
  const out: Statement[] = [];

  type Group = { table: string; columns: string; tuple: string; rows: number; params: unknown[] };
  let group: Group | null = null;

  const flush = () => {
    if (!group) return;
    const values = Array.from({ length: group.rows }, () => `(${group!.tuple})`).join(", ");
    out.push({
      sql: `INSERT INTO ${group.table} (${group.columns}) VALUES ${values}`,
      params: group.params,
    });
    group = null;
  };

  for (const statement of statements) {
    const match = SINGLE_INSERT.exec(statement.sql);
    if (!match) {
      flush();
      out.push(statement);
      continue;
    }
    const [, table, columns, tuple] = match;
    const params = statement.params ?? [];
    if (
      group &&
      (group.table !== table ||
        group.columns !== columns ||
        group.params.length + params.length > MAX_BOUND_PARAMS)
    ) {
      flush();
    }
    if (!group) {
      group = { table, columns, tuple, rows: 0, params: [] };
    }
    group.rows += 1;
    group.params.push(...params);
  }
  flush();

  return out;
}

/**
 * Insert order between tables, so a batch can be regrouped without tripping a
 * foreign key: a company exists before the contact that points at it, a
 * contact before its phones, a tag before its link. Anything not listed
 * (and every statement that is not a plain insert, such as the update half of
 * the dedupe policy) goes last, in the order it was built.
 */
const TABLE_ORDER = [
  "sources",
  "companies",
  "tags",
  "custom_fields",
  "contacts",
  "contact_phones",
  "contact_emails",
  "tag_links",
  "custom_values",
];

/**
 * Regroup a batch so `coalesceInserts` can actually do its job.
 *
 * The import builds statements row by row - contact, phones, emails, tags -
 * so two inserts into the same table are almost never next to each other, and
 * a coalescer that only merges neighbours merges nothing: 100k rows went out
 * as ~400k statements and took 35 s. Bucketing by table first turns the same
 * work into a few multi-row inserts per batch.
 */
export function planBatch(statements: Statement[]): Statement[] {
  const buckets = new Map<string, { table: string; seen: number; rows: Statement[] }>();
  const others: Statement[] = [];

  statements.forEach((statement, index) => {
    const match = SINGLE_INSERT.exec(statement.sql);
    if (!match) {
      others.push(statement);
      return;
    }
    const [, table, columns] = match;
    const key = `${table}\u0000${columns}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(statement);
    else buckets.set(key, { table, seen: index, rows: [statement] });
  });

  const ordered = [...buckets.values()].sort((a, b) => {
    const ai = TABLE_ORDER.indexOf(a.table);
    const bi = TABLE_ORDER.indexOf(b.table);
    const aRank = ai === -1 ? TABLE_ORDER.length : ai;
    const bRank = bi === -1 ? TABLE_ORDER.length : bi;
    return aRank - bRank || a.seen - b.seen;
  });

  const out: Statement[] = [];
  for (const bucket of ordered) out.push(...coalesceInserts(bucket.rows));
  out.push(...others);
  return out;
}

/* -------------------------------------------------------------------------- */
/* companies, sources, tags, custom fields                                    */
/* -------------------------------------------------------------------------- */

/** A new company with nothing but a name: the import links by exact name. */
export function companyCreateStatement(
  name: string,
  options: { sourceId?: string | null } = {},
): { id: string; statement: Statement } {
  const s = stamps();
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

export function sourceCreateStatement(name: string): { id: string; statement: Statement } {
  const s = stamps();
  return {
    id: s.id,
    statement: insertStatement("sources", {
      ...s,
      name: name.trim(),
      kind: "import",
      deletedAt: null,
    }),
  };
}

export function tagCreateStatement(name: string): { id: string; statement: Statement } {
  const s = stamps();
  return {
    id: s.id,
    statement: insertStatement("tags", {
      ...s,
      name: name.trim(),
      color: "var(--stage-1)",
      deletedAt: null,
    }),
  };
}

export function tagLinkStatement(
  tagId: string,
  entityType: string,
  entityId: string,
): Statement {
  return insertStatement("tag_links", {
    ...stamps(),
    tagId,
    entityType,
    entityId,
    deletedAt: null,
  });
}

export function customFieldCreateStatement(
  entityType: string,
  name: string,
  position: number,
): { id: string; statement: Statement } {
  const s = stamps();
  return {
    id: s.id,
    statement: insertStatement("custom_fields", {
      ...s,
      entityType,
      name: name.trim(),
      kind: "text",
      optionsJson: null,
      position,
      deletedAt: null,
    }),
  };
}

export function customValueStatement(
  fieldId: string,
  entityId: string,
  value: string,
): Statement {
  return insertStatement("custom_values", {
    ...stamps(),
    fieldId,
    entityId,
    valueText: value,
    valueNum: null,
    valueDate: null,
    deletedAt: null,
  });
}

/* -------------------------------------------------------------------------- */
/* a whole contact                                                            */
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
  const s = stamps();
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
    ...stamps(),
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
    ...stamps(),
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
