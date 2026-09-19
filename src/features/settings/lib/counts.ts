/**
 * Counts the settings screens need before they let the owner delete something.
 *
 * "Delete this field" is only answerable if he can see what it would take with
 * it. `tags.counts()` already exists in the repository; the custom-field value
 * count does not, so it is written here against `raw` and listed in
 * docs/STATUS.md under "Contract changes needed" as `customFields.valueCount`.
 */
import { raw } from "@/db/client";

/** Live values stored against one custom field, across every entity. */
export async function customFieldValueCount(fieldId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT count(*) AS cv_total FROM custom_values cv
     WHERE cv.field_id = ? AND cv.deleted_at IS NULL`,
    [fieldId],
  );
  return rows.length > 0 ? Number(rows[0][0]) : 0;
}

/**
 * The migration the workspace file is on, for Diagnostics: the newest version
 * in `schema_migrations`, plus how many have been applied. Version strings are
 * the journal tags ("0000_init"), which sort in application order.
 */
export async function migrationVersion(): Promise<{
  version: string;
  appliedAt: string;
  count: number;
} | null> {
  const rows = await raw.query(
    `SELECT m.version AS m_version, m.applied_at AS m_applied_at FROM schema_migrations m
     ORDER BY m.version ASC`,
  );
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return {
    version: String(last[0]),
    appliedAt: String(last[1]),
    count: rows.length,
  };
}
