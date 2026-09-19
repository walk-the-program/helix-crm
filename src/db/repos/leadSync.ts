/**
 * The website lead poller's bookkeeping: one row per site origin.
 *
 * The cursor is a single opaque TEXT produced by the site (docs/CONTRACTS.md
 * "Site endpoint contract"); this repository stores and returns it verbatim
 * and never parses or builds one. The table has no soft-delete column - it is
 * a single-row-per-site cache, not an entity with a lifecycle - so `clear`
 * hard-deletes the row.
 */
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { NotFoundError } from "@/db/errors";
import { nowIso } from "@/lib/dates";
import { logWrite, mapRows, selectList, type Col } from "@/db/repos/_base";

export type LeadSyncRow = {
  siteOrigin: string;
  cursor: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

const LEAD_SYNC_COLS: readonly Col<LeadSyncRow>[] = [
  ["siteOrigin", "ls.site_origin", "text"],
  ["cursor", "ls.cursor", "textNull"],
  ["lastPolledAt", "ls.last_polled_at", "textNull"],
  ["lastError", "ls.last_error", "textNull"],
  ["updatedAt", "ls.updated_at", "text"],
] as const;

export async function get(siteOrigin: string): Promise<LeadSyncRow | null> {
  const rows = await raw.query(
    `SELECT ${selectList(LEAD_SYNC_COLS, "ls")} FROM lead_sync ls WHERE ls.site_origin = ?`,
    [siteOrigin],
  );
  return rows.length > 0 ? mapRows(LEAD_SYNC_COLS, rows)[0] : null;
}

/** Return the existing row or create an empty one. Idempotent under a race. */
export async function ensure(siteOrigin: string): Promise<LeadSyncRow> {
  const existing = await get(siteOrigin);
  if (existing) return existing;
  return withWrite(async () => {
    const at = nowIso();
    await raw.execute(
      `INSERT INTO lead_sync (site_origin, cursor, last_polled_at, last_error, updated_at)
       VALUES (?, NULL, NULL, NULL, ?)
       ON CONFLICT(site_origin) DO NOTHING`,
      [siteOrigin, at],
    );
    const row = await get(siteOrigin);
    if (!row) throw new NotFoundError("lead_sync", siteOrigin);
    if (row.updatedAt === at) {
      await logWrite("lead_sync", siteOrigin, "create", null, row);
    }
    return row;
  }, "Setting up lead sync");
}

/** Store the cursor verbatim, touch lastPolledAt, and clear lastError. */
export async function saveCursor(
  siteOrigin: string,
  cursor: string | null,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const before = await get(siteOrigin);
    const at = nowIso();
    await raw.execute(
      `INSERT INTO lead_sync (site_origin, cursor, last_polled_at, last_error, updated_at)
       VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(site_origin) DO UPDATE SET
         cursor = excluded.cursor,
         last_polled_at = excluded.last_polled_at,
         last_error = NULL,
         updated_at = excluded.updated_at`,
      [siteOrigin, cursor, at, at],
    );
    await logWrite(
      "lead_sync",
      siteOrigin,
      before ? "update" : "create",
      before,
      { cursor, lastPolledAt: at, lastError: null },
      options.batchId,
    );
  }, "Saving the lead sync cursor");
}

/** Touch lastPolledAt only; cursor and lastError are left as they were. */
export async function recordPoll(
  siteOrigin: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const before = await get(siteOrigin);
    const at = nowIso();
    await raw.execute(
      `INSERT INTO lead_sync (site_origin, cursor, last_polled_at, last_error, updated_at)
       VALUES (?, NULL, ?, NULL, ?)
       ON CONFLICT(site_origin) DO UPDATE SET
         last_polled_at = excluded.last_polled_at,
         updated_at = excluded.updated_at`,
      [siteOrigin, at, at],
    );
    await logWrite(
      "lead_sync",
      siteOrigin,
      before ? "update" : "create",
      before,
      { lastPolledAt: at },
      options.batchId,
    );
  }, "Recording a lead poll");
}

export async function recordError(
  siteOrigin: string,
  message: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const before = await get(siteOrigin);
    const at = nowIso();
    await raw.execute(
      `INSERT INTO lead_sync (site_origin, cursor, last_polled_at, last_error, updated_at)
       VALUES (?, NULL, ?, ?, ?)
       ON CONFLICT(site_origin) DO UPDATE SET
         last_polled_at = excluded.last_polled_at,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [siteOrigin, at, message, at],
    );
    await logWrite(
      "lead_sync",
      siteOrigin,
      before ? "update" : "create",
      before,
      { lastPolledAt: at, lastError: message },
      options.batchId,
    );
  }, "Recording a lead sync error");
}

/** Hard-delete the row for a site (e.g. when the site is disconnected). */
export async function clear(
  siteOrigin: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(async () => {
    const before = await get(siteOrigin);
    if (!before) return;
    await raw.execute(`DELETE FROM lead_sync WHERE site_origin = ?`, [siteOrigin]);
    await logWrite("lead_sync", siteOrigin, "delete", before, null, options.batchId);
  }, "Clearing lead sync state");
}
