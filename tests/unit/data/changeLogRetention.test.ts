/**
 * `change_log` retention (SEC audit, launch round 2026-09-20, acceptance A2).
 *
 * Finding: every create/update/delete is logged with the field values it
 * touched (`before_json`/`after_json`), and nothing ever removed an old row -
 * `src/db/changeLog.ts` says so in its own header ("Rows are never deleted,
 * not even when the entity is purged"). A purged contact's name, phone or
 * notes stayed recoverable from `change_log` forever, which is the opposite
 * of what deleting them was supposed to mean.
 *
 * `sweepOldChangeLog` (`src/features/data/trash/purgeSweep.ts`) bounds this to
 * `CHANGE_LOG_RETENTION_DAYS` (90, `src/features/data/lib/retention.ts`) -
 * three times `MERGE_REVERSAL_DAYS` (30), so the sweep can never remove a row
 * `merge.reverse` might still need. This needs the real `change_log` table, so
 * it borrows the repo harness rather than staying pure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSeededHarness, type Harness } from "../../repo/harness";
import { raw } from "@/db/client";
import * as contacts from "@/db/repos/contacts";
import { MERGE_REVERSAL_DAYS } from "@/db/repos/merge";
import { CHANGE_LOG_RETENTION_DAYS, changeLogCutoffIso } from "@/features/data/lib/retention";

// The sweep also looks for its own on-disk files; nothing in this test
// creates any, but the module import chain touches fsBridge, so keep the
// same shape the purge sweep's own tests use rather than let a real Tauri
// import be attempted under Vitest.
vi.mock("@/features/data/lib/workspace", () => ({
  workspacePaths: async () => ({
    workspaceId: "w1",
    dbPath: "/tmp/helix-test/helix.db",
    dir: "/tmp/helix-test",
    attachmentsDir: "/tmp/helix-test/attachments",
    backupsDir: "/tmp/helix-test/backups",
    documentsDir: "/tmp/helix-test/documents",
  }),
}));

const { sweepOldChangeLog } = await import("@/features/data/trash/purgeSweep");

let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
});

async function backdateChangeLog(id: string, daysAgo: number): Promise<void> {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  await raw.execute(`UPDATE change_log SET at = ? WHERE id = ?`, [at, id]);
}

async function changeLogCount(entityId: string): Promise<number> {
  const rows = await raw.query(`SELECT count(*) FROM change_log WHERE entity_id = ?`, [
    entityId,
  ]);
  return Number(rows[0][0]);
}

async function firstChangeLogId(entityId: string): Promise<string> {
  const rows = await raw.query(
    `SELECT id FROM change_log WHERE entity_id = ? ORDER BY at ASC LIMIT 1`,
    [entityId],
  );
  return String(rows[0][0]);
}

describe("CHANGE_LOG_RETENTION_DAYS", () => {
  it("is bounded, and well past the merge-reversal floor", () => {
    expect(CHANGE_LOG_RETENTION_DAYS).toBeGreaterThanOrEqual(MERGE_REVERSAL_DAYS);
    // Comfortably past it, not equal to it: a sweep timed to the exact day a
    // reversal stops being allowed would be one clock skew away from racing it.
    expect(CHANGE_LOG_RETENTION_DAYS).toBeGreaterThan(MERGE_REVERSAL_DAYS);
  });

  it("computes a plain cutoff with no side effects", () => {
    const now = new Date("2026-09-20T00:00:00.000Z");
    expect(changeLogCutoffIso(now, 90)).toBe("2026-06-22T00:00:00.000Z");
  });
});

describe("sweepOldChangeLog", () => {
  it("removes a row past the retention window and keeps a recent one", async () => {
    h = await createSeededHarness();

    const old = await contacts.create({ firstName: "Ancient", lastName: "History" });
    const recent = await contacts.create({ firstName: "Fresh", lastName: "Note" });

    expect(await changeLogCount(old.id)).toBeGreaterThan(0);
    await backdateChangeLog(await firstChangeLogId(old.id), CHANGE_LOG_RETENTION_DAYS + 1);
    await backdateChangeLog(await firstChangeLogId(recent.id), CHANGE_LOG_RETENTION_DAYS - 1);

    const removed = await sweepOldChangeLog();

    expect(removed).toBe(1);
    expect(await changeLogCount(old.id)).toBe(0);
    expect(await changeLogCount(recent.id)).toBe(1);
  });

  it("never removes a row still inside the 30-day merge reversal window", async () => {
    h = await createSeededHarness();
    const twentyNineDaysOld = await contacts.create({ firstName: "Still", lastName: "Reversible" });
    await backdateChangeLog(await firstChangeLogId(twentyNineDaysOld.id), MERGE_REVERSAL_DAYS - 1);

    await sweepOldChangeLog();

    expect(await changeLogCount(twentyNineDaysOld.id)).toBe(1);
  });

  it("does nothing, and reports zero, when nothing is old enough", async () => {
    h = await createSeededHarness();
    await contacts.create({ firstName: "Brand", lastName: "New" });

    expect(await sweepOldChangeLog()).toBe(0);
  });
});
