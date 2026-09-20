/**
 * Export: the queries, the zip, and the save-to-disk plumbing.
 *
 *   ExportScreen ---> buildEntityCsv / buildEverythingZip ---> raw.query
 *                 \-> saveEntityCsv / saveEverythingZip ---> fsBridge (dialog + write)
 *
 * Every query here is hand-written SQL through `raw.query` (never Drizzle,
 * never SELECT *), and every join aliases every column. Child rows that fan
 * out per contact (phones, emails, tags) are fetched with one extra query
 * each - grouped in JS by parent id - rather than one query per row, so a
 * 10k-contact export stays at a small, constant number of round trips.
 */
import { raw } from "@/db/client";
import { todayLocal } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import { pickSavePath, writeBytesAt, writeTextFileAt } from "@/features/data/lib/fsBridge";
import { toCsvFromObjects, type CsvCell } from "@/features/data/lib/exportCsv";

export type ExportEntity =
  | "contacts"
  | "companies"
  | "deals"
  | "tasks"
  | "activities"
  | "services"
  | "invoices";

export const EXPORT_ENTITIES: readonly ExportEntity[] = [
  "contacts",
  "companies",
  "deals",
  "tasks",
  "activities",
  "services",
  "invoices",
];

const ENTITY_LABELS: Record<ExportEntity, string> = {
  contacts: "Contacts",
  companies: "Companies",
  deals: "Deals",
  tasks: "Tasks",
  activities: "Activities",
  services: "Services",
  invoices: "Invoices",
};

export function entityLabel(entity: ExportEntity): string {
  return ENTITY_LABELS[entity];
}

/* -------------------------------------------------------------------------- */
/* small helpers                                                              */
/* -------------------------------------------------------------------------- */

type Header = { key: string; label: string };
type Row = Record<string, CsvCell>;

function headersFor(labels: string[]): Header[] {
  return labels.map((label) => ({ key: label, label }));
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function fullName(first: unknown, last: unknown): string {
  return `${str(first)} ${str(last)}`.trim();
}

/** better-sqlite3's raw mode hands back 0/1 for an INTEGER boolean column. */
function boolFromSql(value: unknown): boolean {
  return value === 1 || value === true;
}

/** "one_time" -> "One time", "recurring" -> "Recurring". */
function productKindLabel(kind: unknown): string {
  return str(kind) === "recurring" ? "Recurring" : "One time";
}

/** "month" -> "Month", "year" -> "Year", null -> "". */
function intervalLabel(interval: unknown): string {
  return capitalizeWord(interval);
}

/** "contact" -> "Contact", "company" -> "Company", "deal" -> "Deal". */
function capitalizeWord(value: unknown): string {
  const s = str(value);
  return s.length === 0 ? "" : s.charAt(0).toUpperCase() + s.slice(1);
}

/** "quote"/"invoice" -> "Quote"/"Invoice", matching the words the invoices feature shows. */
function documentKindLabel(kind: unknown): string {
  return str(kind) === "invoice" ? "Invoice" : str(kind) === "quote" ? "Quote" : capitalizeWord(kind);
}

/** "8.25%" from basis points 825, with no trailing zeros the owner did not type. */
function formatTaxRate(bp: unknown): string {
  const n = Number(bp ?? 0);
  const percent = n / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

/** "Every year", "Every 3 months" - the same words the reminders screen uses. */
function describeRecurringInterval(everyN: unknown, unit: unknown): string {
  const n = Math.max(1, Math.trunc(Number(everyN ?? 1)));
  const u = str(unit);
  return n === 1 ? `Every ${u}` : `Every ${n} ${u}s`;
}

/**
 * A custom field's options_json, flattened readably. Never throws: a null,
 * unparseable, or non-array value reads as "". Mirrors formatAddress below.
 */
function formatOptions(json: unknown): string {
  if (json === null || json === undefined) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(json));
  } catch {
    return "";
  }
  if (!Array.isArray(parsed)) return "";
  return parsed.map((v) => str(v)).join("; ");
}

/**
 * The value a custom_values row actually holds, picked by the field's kind:
 * number and date fields carry their number/date column, everything else
 * (text and choice) carries value_text.
 */
function customValueDisplay(fieldKind: unknown, text: unknown, num: unknown, date: unknown): string {
  if (str(fieldKind) === "number") return num === null || num === undefined ? "" : String(num);
  if (str(fieldKind) === "date") return str(date);
  return str(text);
}

/**
 * id -> human name for contacts, companies and deals, loaded once and reused
 * across every row of a polymorphic entity_id column (tag_links, custom_values).
 * Same "whole table into memory" trade-off as the other aggregates in this
 * file; contacts/companies/deals are the tables an owner tags and puts custom
 * fields on, so this stays a small, constant number of round trips.
 */
type RecordNameMaps = {
  contact: Map<string, string>;
  company: Map<string, string>;
  deal: Map<string, string>;
};

async function recordNameMaps(): Promise<RecordNameMaps> {
  const [contactRows, companyRows, dealRows] = await Promise.all([
    raw.query(
      `SELECT c.id AS c_id, c.first_name AS c_first_name, c.last_name AS c_last_name
       FROM contacts c WHERE c.deleted_at IS NULL`,
    ),
    raw.query(`SELECT co.id AS co_id, co.name AS co_name FROM companies co WHERE co.deleted_at IS NULL`),
    raw.query(`SELECT d.id AS d_id, d.title AS d_title FROM deals d WHERE d.deleted_at IS NULL`),
  ]);
  const contact = new Map<string, string>();
  for (const r of contactRows) contact.set(String(r[0]), fullName(r[1], r[2]));
  const company = new Map<string, string>();
  for (const r of companyRows) company.set(String(r[0]), str(r[1]));
  const deal = new Map<string, string>();
  for (const r of dealRows) deal.set(String(r[0]), str(r[1]));
  return { contact, company, deal };
}

function resolveRecordName(maps: RecordNameMaps, entityType: unknown, entityId: unknown): string {
  const id = String(entityId);
  if (entityType === "contact") return maps.contact.get(id) ?? "";
  if (entityType === "company") return maps.company.get(id) ?? "";
  if (entityType === "deal") return maps.deal.get(id) ?? "";
  return "";
}

/**
 * The address_json fields, flattened readably. Never throws: a null or
 * unparseable value (or one that isn't a plain object) reads as "".
 */
function formatAddress(json: unknown): string {
  if (json === null || json === undefined) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(json));
  } catch {
    return "";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "";

  const fields = parsed as Record<string, unknown>;
  const street = str(fields.street).trim();
  const city = str(fields.city).trim();
  const state = str(fields.state).trim();
  const postal = str(fields.postal).trim();
  const country = str(fields.country).trim();

  const stateAndPostal = [state, postal].filter((p) => p.length > 0).join(" ");
  const cityLine = [city, stateAndPostal].filter((p) => p.length > 0).join(", ");
  return [street, cityLine, country].filter((p) => p.length > 0).join(", ");
}

/* -------------------------------------------------------------------------- */
/* child-row aggregates (one query each, grouped in JS)                       */
/* -------------------------------------------------------------------------- */

type PhoneAgg = { phones: string[]; e164s: string[]; primary: string | null };

async function contactPhoneAggregates(): Promise<Map<string, PhoneAgg>> {
  const rows = await raw.query(
    `SELECT p.contact_id AS p_contact_id, p.raw AS p_raw, p.e164 AS p_e164
     FROM contact_phones p
     WHERE p.deleted_at IS NULL
     ORDER BY p.contact_id ASC, p.is_primary DESC, p.created_at ASC`,
  );
  const map = new Map<string, PhoneAgg>();
  for (const r of rows) {
    const contactId = String(r[0]);
    const rawPhone = str(r[1]);
    const e164 = r[2] === null || r[2] === undefined ? null : String(r[2]);
    const agg = map.get(contactId) ?? { phones: [], e164s: [], primary: null };
    if (rawPhone.length > 0) {
      agg.phones.push(rawPhone);
      if (agg.primary === null) agg.primary = rawPhone;
    }
    if (e164) agg.e164s.push(e164);
    map.set(contactId, agg);
  }
  return map;
}

type EmailAgg = { emails: string[]; primary: string | null };

async function contactEmailAggregates(): Promise<Map<string, EmailAgg>> {
  const rows = await raw.query(
    `SELECT e.contact_id AS e_contact_id, e.email_lower AS e_email_lower
     FROM contact_emails e
     WHERE e.deleted_at IS NULL
     ORDER BY e.contact_id ASC, e.is_primary DESC, e.created_at ASC`,
  );
  const map = new Map<string, EmailAgg>();
  for (const r of rows) {
    const contactId = String(r[0]);
    const email = str(r[1]);
    if (email.length === 0) continue;
    const agg = map.get(contactId) ?? { emails: [], primary: null };
    agg.emails.push(email);
    if (agg.primary === null) agg.primary = email;
    map.set(contactId, agg);
  }
  return map;
}

/** Live tags on every contact or every company, grouped by entity id. */
async function tagAggregates(entityType: "contact" | "company"): Promise<Map<string, string[]>> {
  const rows = await raw.query(
    `SELECT tl.entity_id AS tl_entity_id, t.name AS t_name
     FROM tag_links tl JOIN tags t ON t.id = tl.tag_id
     WHERE tl.entity_type = ? AND tl.deleted_at IS NULL AND t.deleted_at IS NULL
     ORDER BY tl.entity_id ASC, t.name COLLATE NOCASE ASC`,
    [entityType],
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const id = String(r[0]);
    const name = str(r[1]);
    const list = map.get(id);
    if (list) list.push(name);
    else map.set(id, [name]);
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* per-entity rows                                                            */
/* -------------------------------------------------------------------------- */

async function contactsRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor([
    "First Name",
    "Last Name",
    "Company",
    "Emails",
    "Primary Email",
    "Phones",
    "Primary Phone",
    "Phones E164",
    "Address",
    "Source",
    "Tags",
    "Notes",
    "Created At",
  ]);

  const [mainRows, phoneAgg, emailAgg, tagAgg] = await Promise.all([
    raw.query(
      `SELECT c.id AS c_id, c.first_name AS c_first_name, c.last_name AS c_last_name,
              co.name AS c_company_name, c.address_json AS c_address_json,
              s.name AS c_source_name, c.notes AS c_notes, c.created_at AS c_created_at
       FROM contacts c
       LEFT JOIN companies co ON co.id = c.company_id
       LEFT JOIN sources s ON s.id = c.source_id
       WHERE c.deleted_at IS NULL
       ORDER BY c.last_name COLLATE NOCASE ASC, c.first_name COLLATE NOCASE ASC`,
    ),
    contactPhoneAggregates(),
    contactEmailAggregates(),
    tagAggregates("contact"),
  ]);

  const rows = mainRows.map((r): Row => {
    const id = String(r[0]);
    const phones = phoneAgg.get(id);
    const emails = emailAgg.get(id);
    const tags = tagAgg.get(id) ?? [];
    return {
      "First Name": str(r[1]),
      "Last Name": str(r[2]),
      Company: str(r[3]),
      Emails: emails ? emails.emails.join("; ") : "",
      "Primary Email": emails?.primary ?? "",
      Phones: phones ? phones.phones.join("; ") : "",
      "Primary Phone": phones?.primary ?? "",
      "Phones E164": phones ? phones.e164s.join("; ") : "",
      Address: formatAddress(r[4]),
      Source: str(r[5]),
      Tags: tags.join("; "),
      Notes: str(r[6]),
      "Created At": str(r[7]),
    };
  });

  return { headers, rows };
}

async function companiesRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor([
    "Name",
    "Website",
    "Phone",
    "Phone E164",
    "Address",
    "Source",
    "Tags",
    "Notes",
    "Created At",
  ]);

  const [mainRows, tagAgg] = await Promise.all([
    raw.query(
      `SELECT co.id AS co_id, co.name AS co_name, co.website AS co_website,
              co.phone_raw AS co_phone_raw, co.phone_e164 AS co_phone_e164,
              co.address_json AS co_address_json, s.name AS co_source_name,
              co.notes AS co_notes, co.created_at AS co_created_at
       FROM companies co
       LEFT JOIN sources s ON s.id = co.source_id
       WHERE co.deleted_at IS NULL
       ORDER BY co.name COLLATE NOCASE ASC`,
    ),
    tagAggregates("company"),
  ]);

  const rows = mainRows.map((r): Row => {
    const id = String(r[0]);
    const tags = tagAgg.get(id) ?? [];
    return {
      Name: str(r[1]),
      Website: str(r[2]),
      Phone: str(r[3]),
      "Phone E164": str(r[4]),
      Address: formatAddress(r[5]),
      Source: str(r[6]),
      Tags: tags.join("; "),
      Notes: str(r[7]),
      "Created At": str(r[8]),
    };
  });

  return { headers, rows };
}

async function dealsRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor([
    "Title",
    "Value",
    "Stage",
    "Pipeline",
    "Contact",
    "Company",
    "Expected On",
    "Source",
    "Outcome Reason",
    "Created At",
  ]);

  const mainRows = await raw.query(
    `SELECT d.id AS d_id, d.title AS d_title, d.value_cents AS d_value_cents,
            s.name AS d_stage_name, p.name AS d_pipeline_name,
            c.first_name AS d_contact_first_name, c.last_name AS d_contact_last_name,
            co.name AS d_company_name, d.expected_on AS d_expected_on,
            src.name AS d_source_name, d.outcome_reason AS d_outcome_reason,
            d.created_at AS d_created_at
     FROM deals d
     JOIN stages s ON s.id = d.stage_id
     JOIN pipelines p ON p.id = s.pipeline_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN sources src ON src.id = d.source_id
     WHERE d.deleted_at IS NULL
     ORDER BY d.created_at ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      Title: str(r[1]),
      Value: centsToDecimalString(Number(r[2] ?? 0)),
      Stage: str(r[3]),
      Pipeline: str(r[4]),
      Contact: fullName(r[5], r[6]),
      Company: str(r[7]),
      "Expected On": str(r[8]),
      Source: str(r[9]),
      "Outcome Reason": str(r[10]),
      "Created At": str(r[11]),
    }),
  );

  return { headers, rows };
}

async function tasksRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor([
    "Title",
    "Done",
    "Due On",
    "Due At",
    "Contact",
    "Company",
    "Deal",
    "Created At",
  ]);

  const mainRows = await raw.query(
    `SELECT t.id AS t_id, t.title AS t_title, t.done_at AS t_done_at,
            t.due_on AS t_due_on, t.due_at AS t_due_at,
            c.first_name AS t_contact_first_name, c.last_name AS t_contact_last_name,
            co.name AS t_company_name, d.title AS t_deal_title,
            t.created_at AS t_created_at
     FROM tasks t
     LEFT JOIN contacts c ON c.id = t.contact_id
     LEFT JOIN companies co ON co.id = t.company_id
     LEFT JOIN deals d ON d.id = t.deal_id
     WHERE t.deleted_at IS NULL
     ORDER BY t.created_at ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      Title: str(r[1]),
      Done: r[2] !== null && r[2] !== undefined,
      "Due On": str(r[3]),
      "Due At": str(r[4]),
      Contact: fullName(r[5], r[6]),
      Company: str(r[7]),
      Deal: str(r[8]),
      "Created At": str(r[9]),
    }),
  );

  return { headers, rows };
}

async function activitiesRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor(["Kind", "Body", "Occurred At", "Contact", "Company", "Deal", "Created At"]);

  const mainRows = await raw.query(
    `SELECT a.id AS a_id, a.kind AS a_kind, a.body AS a_body, a.occurred_at AS a_occurred_at,
            c.first_name AS a_contact_first_name, c.last_name AS a_contact_last_name,
            co.name AS a_company_name, d.title AS a_deal_title,
            a.created_at AS a_created_at
     FROM activities a
     LEFT JOIN contacts c ON c.id = a.contact_id
     LEFT JOIN companies co ON co.id = a.company_id
     LEFT JOIN deals d ON d.id = a.deal_id
     WHERE a.deleted_at IS NULL
     ORDER BY a.occurred_at ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      Kind: str(r[1]),
      Body: str(r[2]),
      "Occurred At": str(r[3]),
      Contact: fullName(r[4], r[5]),
      Company: str(r[6]),
      Deal: str(r[7]),
      "Created At": str(r[8]),
    }),
  );

  return { headers, rows };
}

/** Services: the products table (round 3's catalog), by "By list" name "Services". */
async function productsRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor([
    "Name",
    "Description",
    "Kind",
    "Interval",
    "Price",
    "Taxable",
    "Active",
    "Created At",
  ]);

  const mainRows = await raw.query(
    `SELECT p.id AS p_id, p.name AS p_name, p.description AS p_description,
            p.kind AS p_kind, p.interval AS p_interval, p.unit_price_cents AS p_unit_price_cents,
            p.taxable AS p_taxable, p.active AS p_active, p.created_at AS p_created_at
     FROM products p
     WHERE p.deleted_at IS NULL
     ORDER BY p.position ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      Name: str(r[1]),
      Description: str(r[2]),
      Kind: productKindLabel(r[3]),
      Interval: intervalLabel(r[4]),
      Price: centsToDecimalString(Number(r[5] ?? 0)),
      Taxable: boolFromSql(r[6]),
      Active: boolFromSql(r[7]),
      "Created At": str(r[8]),
    }),
  );

  return { headers, rows };
}

/**
 * A quote or an invoice - one query, an optional `kind` filter. `kindFilter`
 * is null for the "everything" zip's documents.csv (both kinds, distinguished
 * by the Kind column) and "invoice" for the "By list" Invoices row.
 */
async function documentsRowsCore(
  kindFilter: "invoice" | "quote" | null,
): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor([
    "Kind",
    "Number",
    "Deal",
    "Contact",
    "Company",
    "Status",
    "Issued On",
    "Due On",
    "Valid Until",
    "Subtotal",
    "Tax Rate",
    "Tax",
    "Total",
    "Notes",
    "Payment Instructions",
    "Converted To",
    "Sent At",
    "Paid On",
    "Paid Method",
    "Paid Note",
    "Created At",
  ]);

  const params: unknown[] = [];
  let where = "d.deleted_at IS NULL";
  if (kindFilter) {
    where += " AND d.kind = ?";
    params.push(kindFilter);
  }

  const mainRows = await raw.query(
    `SELECT d.id AS d_id, d.kind AS d_kind, d.number AS d_number, dl.title AS d_deal_title,
            c.first_name AS d_contact_first_name, c.last_name AS d_contact_last_name,
            co.name AS d_company_name, d.status AS d_status, d.issued_on AS d_issued_on,
            d.due_on AS d_due_on, d.valid_until AS d_valid_until,
            d.subtotal_cents AS d_subtotal_cents, d.tax_rate_bp AS d_tax_rate_bp,
            d.tax_cents AS d_tax_cents, d.total_cents AS d_total_cents,
            d.notes AS d_notes, d.payment_instructions AS d_payment_instructions,
            conv.number AS d_converted_to_number, d.sent_at AS d_sent_at,
            d.paid_on AS d_paid_on, d.paid_method AS d_paid_method, d.paid_note AS d_paid_note,
            d.created_at AS d_created_at
     FROM documents d
     LEFT JOIN deals dl ON dl.id = d.deal_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN documents conv ON conv.id = d.converted_to_id
     WHERE ${where}
     ORDER BY d.created_at ASC`,
    params,
  );

  const rows = mainRows.map(
    (r): Row => ({
      Kind: documentKindLabel(r[1]),
      Number: str(r[2]),
      Deal: str(r[3]),
      Contact: fullName(r[4], r[5]),
      Company: str(r[6]),
      Status: capitalizeWord(r[7]),
      "Issued On": str(r[8]),
      "Due On": str(r[9]),
      "Valid Until": str(r[10]),
      Subtotal: centsToDecimalString(Number(r[11] ?? 0)),
      "Tax Rate": formatTaxRate(r[12]),
      Tax: centsToDecimalString(Number(r[13] ?? 0)),
      Total: centsToDecimalString(Number(r[14] ?? 0)),
      Notes: str(r[15]),
      "Payment Instructions": str(r[16]),
      "Converted To": str(r[17]),
      "Sent At": str(r[18]),
      "Paid On": str(r[19]),
      "Paid Method": str(r[20]),
      "Paid Note": str(r[21]),
      "Created At": str(r[22]),
    }),
  );

  return { headers, rows };
}

/** The "everything" zip's documents.csv: every quote and every invoice, one table. */
async function documentsRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  return documentsRowsCore(null);
}

/** The "By list" Invoices row: documents.csv filtered to kind = 'invoice'. */
async function invoicesRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  return documentsRowsCore("invoice");
}

/** document_items has no deleted_at of its own; a line is excluded when its document is. */
async function documentItemsRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor([
    "Document Number",
    "Document Kind",
    "Name",
    "Description",
    "Qty",
    "Unit Price",
    "Taxable",
    "Kind",
    "Interval",
  ]);

  const mainRows = await raw.query(
    `SELECT di.id AS di_id, doc.number AS di_doc_number, doc.kind AS di_doc_kind,
            di.name AS di_name, di.description AS di_description, di.qty AS di_qty,
            di.unit_cents AS di_unit_cents, di.taxable AS di_taxable,
            di.kind AS di_kind, di.interval AS di_interval
     FROM document_items di
     JOIN documents doc ON doc.id = di.document_id
     WHERE doc.deleted_at IS NULL
     ORDER BY doc.created_at ASC, di.position ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      "Document Number": str(r[1]),
      "Document Kind": documentKindLabel(r[2]),
      Name: str(r[3]),
      Description: str(r[4]),
      Qty: Number(r[5] ?? 0),
      "Unit Price": centsToDecimalString(Number(r[6] ?? 0)),
      Taxable: boolFromSql(r[7]),
      Kind: productKindLabel(r[8]),
      Interval: intervalLabel(r[9]),
    }),
  );

  return { headers, rows };
}

async function tagsRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor(["Name", "Color", "Created At"]);

  const mainRows = await raw.query(
    `SELECT t.id AS t_id, t.name AS t_name, t.color AS t_color, t.created_at AS t_created_at
     FROM tags t
     WHERE t.deleted_at IS NULL
     ORDER BY t.name COLLATE NOCASE ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      Name: str(r[1]),
      Color: str(r[2]),
      "Created At": str(r[3]),
    }),
  );

  return { headers, rows };
}

/**
 * tag_links is polymorphic (a contact, a company or a deal): there is no
 * single foreign key to join, so the record's name is resolved from the
 * pre-loaded id maps rather than invented via a three-way join.
 */
async function tagLinksRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor(["Tag", "Record Type", "Record Name", "Created At"]);

  const [mainRows, names] = await Promise.all([
    raw.query(
      `SELECT tl.id AS tl_id, tg.name AS tl_tag_name, tl.entity_type AS tl_entity_type,
              tl.entity_id AS tl_entity_id, tl.created_at AS tl_created_at
       FROM tag_links tl
       JOIN tags tg ON tg.id = tl.tag_id
       WHERE tl.deleted_at IS NULL AND tg.deleted_at IS NULL
       ORDER BY tl.created_at ASC`,
    ),
    recordNameMaps(),
  ]);

  const rows = mainRows.map(
    (r): Row => ({
      Tag: str(r[1]),
      "Record Type": capitalizeWord(r[2]),
      "Record Name": resolveRecordName(names, r[2], r[3]),
      "Created At": str(r[4]),
    }),
  );

  return { headers, rows };
}

async function customFieldsRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor(["Entity Type", "Name", "Kind", "Options", "Created At"]);

  const mainRows = await raw.query(
    `SELECT cf.id AS cf_id, cf.entity_type AS cf_entity_type, cf.name AS cf_name,
            cf.kind AS cf_kind, cf.options_json AS cf_options_json, cf.created_at AS cf_created_at
     FROM custom_fields cf
     WHERE cf.deleted_at IS NULL
     ORDER BY cf.entity_type ASC, cf.position ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      "Entity Type": capitalizeWord(r[1]),
      Name: str(r[2]),
      Kind: capitalizeWord(r[3]),
      Options: formatOptions(r[4]),
      "Created At": str(r[5]),
    }),
  );

  return { headers, rows };
}

/**
 * Likely the largest table in a busy workspace (one row per field per
 * record). Read in full, same as every other CSV here - no pagination was
 * added, so a very large custom_values table costs proportionally more
 * memory and time than the other exports.
 */
async function customValuesRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor(["Field", "Entity Type", "Record Name", "Value", "Created At"]);

  const [mainRows, names] = await Promise.all([
    raw.query(
      `SELECT cv.id AS cv_id, cf.name AS cv_field_name, cf.entity_type AS cv_entity_type,
              cf.kind AS cv_field_kind, cv.entity_id AS cv_entity_id,
              cv.value_text AS cv_value_text, cv.value_num AS cv_value_num,
              cv.value_date AS cv_value_date, cv.created_at AS cv_created_at
       FROM custom_values cv
       JOIN custom_fields cf ON cf.id = cv.field_id
       WHERE cv.deleted_at IS NULL AND cf.deleted_at IS NULL
       ORDER BY cv.created_at ASC`,
    ),
    recordNameMaps(),
  ]);

  const rows = mainRows.map(
    (r): Row => ({
      Field: str(r[1]),
      "Entity Type": capitalizeWord(r[2]),
      "Record Name": resolveRecordName(names, r[2], r[4]),
      Value: customValueDisplay(r[3], r[5], r[6], r[7]),
      "Created At": str(r[8]),
    }),
  );

  return { headers, rows };
}

async function recurringRulesRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor([
    "Title",
    "Contact",
    "Company",
    "Repeats",
    "Next Due On",
    "Last Completed On",
    "Active",
    "Created At",
  ]);

  const mainRows = await raw.query(
    `SELECT r.id AS r_id, r.title AS r_title,
            c.first_name AS r_contact_first_name, c.last_name AS r_contact_last_name,
            co.name AS r_company_name, r.every_n AS r_every_n, r.unit AS r_unit,
            r.next_due_on AS r_next_due_on, r.last_completed_on AS r_last_completed_on,
            r.active AS r_active, r.created_at AS r_created_at
     FROM recurring_rules r
     LEFT JOIN contacts c ON c.id = r.contact_id
     LEFT JOIN companies co ON co.id = r.company_id
     WHERE r.deleted_at IS NULL
     ORDER BY r.created_at ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      Title: str(r[1]),
      Contact: fullName(r[2], r[3]),
      Company: str(r[4]),
      Repeats: describeRecurringInterval(r[5], r[6]),
      "Next Due On": str(r[7]),
      "Last Completed On": str(r[8]),
      Active: boolFromSql(r[9]),
      "Created At": str(r[10]),
    }),
  );

  return { headers, rows };
}

async function templatesRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor(["Kind", "Name", "Subject", "Body", "Created At"]);

  const mainRows = await raw.query(
    `SELECT tp.id AS tp_id, tp.kind AS tp_kind, tp.name AS tp_name, tp.subject AS tp_subject,
            tp.body AS tp_body, tp.created_at AS tp_created_at
     FROM templates tp
     WHERE tp.deleted_at IS NULL
     ORDER BY tp.kind ASC, tp.position ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      Kind: capitalizeWord(r[1]),
      Name: str(r[2]),
      Subject: str(r[3]),
      Body: str(r[4]),
      "Created At": str(r[5]),
    }),
  );

  return { headers, rows };
}

async function savedViewsRows(): Promise<{ headers: Header[]; rows: Row[] }> {
  const headers = headersFor(["Entity Type", "Name", "Query", "Pinned", "Created At"]);

  const mainRows = await raw.query(
    `SELECT sv.id AS sv_id, sv.entity_type AS sv_entity_type, sv.name AS sv_name,
            sv.query_json AS sv_query_json, sv.pinned AS sv_pinned, sv.created_at AS sv_created_at
     FROM saved_views sv
     WHERE sv.deleted_at IS NULL
     ORDER BY sv.entity_type ASC, sv.position ASC`,
  );

  const rows = mainRows.map(
    (r): Row => ({
      "Entity Type": capitalizeWord(r[1]),
      Name: str(r[2]),
      Query: str(r[3]),
      Pinned: boolFromSql(r[4]),
      "Created At": str(r[5]),
    }),
  );

  return { headers, rows };
}

async function rowsFor(entity: ExportEntity): Promise<{ headers: Header[]; rows: Row[] }> {
  switch (entity) {
    case "contacts":
      return contactsRows();
    case "companies":
      return companiesRows();
    case "deals":
      return dealsRows();
    case "tasks":
      return tasksRows();
    case "activities":
      return activitiesRows();
    case "services":
      return productsRows();
    case "invoices":
      return invoicesRows();
  }
}

/* -------------------------------------------------------------------------- */
/* public: build (no I/O)                                                     */
/* -------------------------------------------------------------------------- */

export async function buildEntityCsv(entity: ExportEntity): Promise<{ csv: string; rows: number }> {
  const { headers, rows } = await rowsFor(entity);
  return { csv: toCsvFromObjects<Row>(headers, rows), rows: rows.length };
}

/**
 * The "everything" zip's own table list - deliberately not EXPORT_ENTITIES.
 * The "By list" Invoices row is invoices only (kind = 'invoice'), but the zip
 * carries the whole documents table, quotes and invoices together with the
 * Kind column telling them apart, which is why documents.csv is built from
 * `documentsRows` rather than reusing `invoicesRows`. "Services" is the one
 * name that means the same thing in both places, so it reuses `productsRows`.
 */
type ZipEntry = {
  fileName: string;
  jsonKey: string;
  build: () => Promise<{ headers: Header[]; rows: Row[] }>;
};

const ZIP_ENTRIES: readonly ZipEntry[] = [
  { fileName: "contacts.csv", jsonKey: "contacts", build: contactsRows },
  { fileName: "companies.csv", jsonKey: "companies", build: companiesRows },
  { fileName: "deals.csv", jsonKey: "deals", build: dealsRows },
  { fileName: "tasks.csv", jsonKey: "tasks", build: tasksRows },
  { fileName: "activities.csv", jsonKey: "activities", build: activitiesRows },
  { fileName: "documents.csv", jsonKey: "documents", build: documentsRows },
  { fileName: "document_items.csv", jsonKey: "documentItems", build: documentItemsRows },
  { fileName: "services.csv", jsonKey: "services", build: productsRows },
  { fileName: "tags.csv", jsonKey: "tags", build: tagsRows },
  { fileName: "tag_links.csv", jsonKey: "tagLinks", build: tagLinksRows },
  { fileName: "custom_fields.csv", jsonKey: "customFields", build: customFieldsRows },
  { fileName: "custom_values.csv", jsonKey: "customValues", build: customValuesRows },
  { fileName: "recurring_rules.csv", jsonKey: "recurringRules", build: recurringRulesRows },
  { fileName: "templates.csv", jsonKey: "templates", build: templatesRows },
  { fileName: "saved_views.csv", jsonKey: "savedViews", build: savedViewsRows },
];

export async function buildEverythingZip(): Promise<{ bytes: Uint8Array; files: string[] }> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const files: string[] = [];
  const jsonDump: Record<string, Row[]> = {};

  for (const entry of ZIP_ENTRIES) {
    const { headers, rows } = await entry.build();
    zip.file(entry.fileName, toCsvFromObjects<Row>(headers, rows));
    files.push(entry.fileName);
    jsonDump[entry.jsonKey] = rows;
  }

  zip.file("helix-export.json", JSON.stringify(jsonDump, null, 2));
  files.push("helix-export.json");

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return { bytes, files };
}

/** The "By list" row counts - one query per entity, invoices scoped to kind = 'invoice'. */
const COUNT_SQL_FOR: Record<ExportEntity, string> = {
  contacts: `SELECT count(*) AS row_count FROM contacts WHERE deleted_at IS NULL`,
  companies: `SELECT count(*) AS row_count FROM companies WHERE deleted_at IS NULL`,
  deals: `SELECT count(*) AS row_count FROM deals WHERE deleted_at IS NULL`,
  tasks: `SELECT count(*) AS row_count FROM tasks WHERE deleted_at IS NULL`,
  activities: `SELECT count(*) AS row_count FROM activities WHERE deleted_at IS NULL`,
  services: `SELECT count(*) AS row_count FROM products WHERE deleted_at IS NULL`,
  invoices: `SELECT count(*) AS row_count FROM documents WHERE deleted_at IS NULL AND kind = 'invoice'`,
};

export async function exportCounts(): Promise<Record<ExportEntity, number>> {
  const entries = await Promise.all(
    EXPORT_ENTITIES.map(async (entity) => {
      const rows = await raw.query(COUNT_SQL_FOR[entity]);
      return [entity, rows.length > 0 ? Number(rows[0][0]) : 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<ExportEntity, number>;
}

/* -------------------------------------------------------------------------- */
/* public: save (dialog + write, through fsBridge)                            */
/* -------------------------------------------------------------------------- */

export async function saveEntityCsv(
  entity: ExportEntity,
): Promise<{ path: string | null; rows: number }> {
  const { csv, rows } = await buildEntityCsv(entity);
  const path = await pickSavePath({
    title: `Export ${entityLabel(entity)}`,
    defaultPath: `helix-${entity}-${todayLocal()}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (path === null) return { path: null, rows };
  await writeTextFileAt(path, csv);
  return { path, rows };
}

export async function saveEverythingZip(): Promise<{ path: string | null; files: number }> {
  const { bytes, files } = await buildEverythingZip();
  const path = await pickSavePath({
    title: "Export everything",
    defaultPath: `helix-export-${todayLocal()}.zip`,
    filters: [{ name: "Zip archive", extensions: ["zip"] }],
  });
  if (path === null) return { path: null, files: files.length };
  await writeBytesAt(path, bytes);
  return { path, files: files.length };
}
