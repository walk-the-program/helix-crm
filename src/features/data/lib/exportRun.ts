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
import JSZip from "jszip";
import { raw } from "@/db/client";
import { todayLocal } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import { pickSavePath, writeBytesAt, writeTextFileAt } from "@/features/data/lib/fsBridge";
import { toCsvFromObjects, type CsvCell } from "@/features/data/lib/exportCsv";

export type ExportEntity = "contacts" | "companies" | "deals" | "tasks" | "activities";

export const EXPORT_ENTITIES: readonly ExportEntity[] = [
  "contacts",
  "companies",
  "deals",
  "tasks",
  "activities",
];

const ENTITY_LABELS: Record<ExportEntity, string> = {
  contacts: "Contacts",
  companies: "Companies",
  deals: "Deals",
  tasks: "Tasks",
  activities: "Activities",
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
  }
}

/* -------------------------------------------------------------------------- */
/* public: build (no I/O)                                                     */
/* -------------------------------------------------------------------------- */

export async function buildEntityCsv(entity: ExportEntity): Promise<{ csv: string; rows: number }> {
  const { headers, rows } = await rowsFor(entity);
  return { csv: toCsvFromObjects<Row>(headers, rows), rows: rows.length };
}

export async function buildEverythingZip(): Promise<{ bytes: Uint8Array; files: string[] }> {
  const zip = new JSZip();
  const files: string[] = [];
  const jsonDump: Partial<Record<ExportEntity, Row[]>> = {};

  for (const entity of EXPORT_ENTITIES) {
    const { headers, rows } = await rowsFor(entity);
    const fileName = `${entity}.csv`;
    zip.file(fileName, toCsvFromObjects<Row>(headers, rows));
    files.push(fileName);
    jsonDump[entity] = rows;
  }

  zip.file("helix-export.json", JSON.stringify(jsonDump, null, 2));
  files.push("helix-export.json");

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return { bytes, files };
}

const TABLE_FOR: Record<ExportEntity, string> = {
  contacts: "contacts",
  companies: "companies",
  deals: "deals",
  tasks: "tasks",
  activities: "activities",
};

export async function exportCounts(): Promise<Record<ExportEntity, number>> {
  const entries = await Promise.all(
    EXPORT_ENTITIES.map(async (entity) => {
      const rows = await raw.query(
        `SELECT count(*) AS row_count FROM ${TABLE_FOR[entity]} WHERE deleted_at IS NULL`,
      );
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
