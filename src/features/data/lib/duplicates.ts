/**
 * The duplicate scan.
 *
 *   contacts: two live contacts sharing an email_lower, or an E.164 phone
 *   companies: two live companies with the same name (ignoring case), or the
 *              same E.164 phone
 *
 * docs/PLAN.md item 15 runs this on launch and every 24 hours. The repository
 * layer has `contacts.findDuplicates`, but that answers "does this one record
 * clash with anything" for the create form; a whole-workspace pair scan is a
 * different query, so it lives here until it is promoted (docs/STATUS.md,
 * "Contract changes needed").
 *
 * Reads only. The merge itself is `src/db/repos/merge.ts`.
 */
import { raw } from "@/db/client";
import { get as getSetting, set as setSetting } from "@/db/repos/settings";
import { nowIso } from "@/lib/dates";

export type DuplicateEntity = "contact" | "company";
export type MatchedOn = "email" | "phone" | "name";

export type DuplicateSide = {
  id: string;
  label: string;
  /** What the merge screen shows beside the name: company, city, created. */
  detail: string;
  createdAt: string;
};

export type DuplicatePair = {
  entityType: DuplicateEntity;
  matchedOn: MatchedOn;
  /** The shared value, highlighted in the list. */
  value: string;
  a: DuplicateSide;
  b: DuplicateSide;
  /** Stable key for React and for "I already dismissed this one". */
  key: string;
};

const SCAN_EVERY_MS = 24 * 60 * 60 * 1000;

function pairKey(
  entityType: DuplicateEntity,
  matchedOn: MatchedOn,
  aId: string,
  bId: string,
): string {
  const [first, second] = aId < bId ? [aId, bId] : [bId, aId];
  return `${entityType}:${matchedOn}:${first}:${second}`;
}

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

export async function scanDuplicates(limit = 200): Promise<DuplicatePair[]> {
  const [contacts, companies] = await Promise.all([
    findContactPairs(limit),
    findCompanyPairs(limit),
  ]);
  return [...contacts, ...companies];
}

/** True when the last scan was more than a day ago (or never). */
export function scanIsDue(lastScanAt: string | null, now: Date = new Date()): boolean {
  if (!lastScanAt) return true;
  const last = new Date(lastScanAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= SCAN_EVERY_MS;
}

export async function markScanned(): Promise<void> {
  await setSetting("lastDuplicateScanAt", nowIso());
}

export async function lastScanAt(): Promise<string | null> {
  return getSetting("lastDuplicateScanAt");
}

export const DUPLICATE_SCAN_INTERVAL_MS = SCAN_EVERY_MS;

/* -------------------------------------------------------------------------- */
/* the merge screen's per-field view                                          */
/* -------------------------------------------------------------------------- */

export type MergeField = {
  /** The column on the entity's own table, which is what merge() expects. */
  column: string;
  label: string;
  aValue: string;
  bValue: string;
  /** False when both sides say the same thing: nothing to choose. */
  differs: boolean;
};

const CONTACT_FIELDS: { column: string; label: string }[] = [
  { column: "first_name", label: "First name" },
  { column: "last_name", label: "Last name" },
  { column: "company_id", label: "Company" },
  { column: "address_json", label: "Address" },
  { column: "source_id", label: "Source" },
  { column: "notes", label: "Notes" },
];

const COMPANY_FIELDS: { column: string; label: string }[] = [
  { column: "name", label: "Name" },
  { column: "website", label: "Website" },
  { column: "phone_raw", label: "Phone" },
  { column: "address_json", label: "Address" },
  { column: "source_id", label: "Source" },
  { column: "notes", label: "Notes" },
];

export function fieldsFor(entityType: DuplicateEntity): { column: string; label: string }[] {
  return entityType === "contact" ? CONTACT_FIELDS : COMPANY_FIELDS;
}

/** Read both records' raw column values so the owner can pick per field. */
export async function loadMergeFields(
  entityType: DuplicateEntity,
  aId: string,
  bId: string,
): Promise<MergeField[]> {
  const table = entityType === "contact" ? "contacts" : "companies";
  const fields = fieldsFor(entityType);
  const columns = fields.map((f) => `x.${f.column} AS x_${f.column}`).join(", ");
  const rows = await raw.query(
    `SELECT x.id AS x_id, ${columns} FROM ${table} x WHERE x.id IN (?, ?)`,
    [aId, bId],
  );

  const byId = new Map<string, unknown[]>();
  for (const row of rows) byId.set(String(row[0]), row);
  const a = byId.get(aId) ?? [];
  const b = byId.get(bId) ?? [];

  return fields.map((field, i) => {
    const aValue = a[i + 1] === null || a[i + 1] === undefined ? "" : String(a[i + 1]);
    const bValue = b[i + 1] === null || b[i + 1] === undefined ? "" : String(b[i + 1]);
    return { ...field, aValue, bValue, differs: aValue !== bValue };
  });
}

/**
 * Turn the owner's per-field choices into the `fieldPicks` merge() wants:
 * only the columns where the loser's value was chosen need writing.
 */
export function picksFor(
  fields: MergeField[],
  choice: Record<string, "a" | "b">,
  survivor: "a" | "b",
): Record<string, string | null> {
  const picks: Record<string, string | null> = {};
  for (const field of fields) {
    const chosen = choice[field.column] ?? survivor;
    if (chosen === survivor) continue;
    const value = chosen === "a" ? field.aValue : field.bValue;
    picks[field.column] = value.length > 0 ? value : null;
  }
  return picks;
}
