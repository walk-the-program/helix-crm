/**
 * The duplicate scan.
 *
 *   contacts: two live contacts sharing an email_lower, or an E.164 phone
 *   companies: two live companies with the same name (ignoring case), or the
 *              same E.164 phone
 *
 * docs/PLAN.md item 15 runs this on launch and every 24 hours. The two pair
 * queries were promoted into `contacts.findContactPairs` and
 * `companies.findCompanyPairs` in wave 3 and are re-exported here; what is
 * left is the schedule (when to scan, when it was last run) and the merge
 * field picker, both of which are screen state, not repository reads.
 *
 * Reads only. The merge itself is `src/db/repos/merge.ts`.
 */
import { raw } from "@/db/client";
import { get as getSetting, set as setSetting } from "@/db/repos/settings";
import { findContactPairs } from "@/db/repos/contacts";
import { findCompanyPairs } from "@/db/repos/companies";
import type {
  DuplicateEntity,
  DuplicatePair,
} from "@/db/repos/_base";
import { nowIso } from "@/lib/dates";

const SCAN_EVERY_MS = 24 * 60 * 60 * 1000;



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
