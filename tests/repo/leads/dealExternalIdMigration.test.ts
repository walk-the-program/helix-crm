/**
 * LR-OPS-W2 A2: does drizzle/0005_lead_dedup.sql survive a workspace that
 * already has a UNIQUE violation waiting for it?
 *
 * A bare `CREATE UNIQUE INDEX` on `deals(external_id)` would fail outright on
 * a workspace that already holds two live deals sharing one external_id -
 * and src/db/migrator.ts applies a migration as one all-or-nothing batch, so
 * a failed migration is fatal to boot, not a warning. This test builds
 * exactly that workspace by hand (migrated only through 0004, so the index
 * genuinely does not exist yet), then runs 0005 against it and checks the
 * de-duplication rule this packet chose: keep the oldest live row
 * (created_at, then id), soft-delete the rest into Trash, touch nothing that
 * does not collide.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { raw, setDriver } from "../../../src/db/client";
import {
  migrate,
  orderMigrations,
  type MigrationFile,
  type MigrationSource,
} from "../../../src/db/migrator";
import { __resetWriteLockForTests } from "../../../src/db/writeLock";
import { createTestDriver, type TestDriver } from "../driver";
import { DRIZZLE_DIR, diskMigrationSource } from "../harness";
import * as deals from "../../../src/db/repos/deals";

type Journal = { entries: { idx: number; tag: string }[] };

/** Every journal entry up to and including `tag` - lets a test stand a
 * workspace at a specific point in migration history, before 0005 exists. */
function sourceThrough(tag: string): MigrationSource {
  return {
    async list(): Promise<MigrationFile[]> {
      const journal = JSON.parse(
        readFileSync(join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8"),
      ) as Journal;
      const present = new Set(
        readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")),
      );
      const cutoff = journal.entries.find((e) => e.tag === tag);
      if (!cutoff) throw new Error(`No journal entry named ${tag}.`);
      const files = journal.entries
        .filter((e) => e.idx <= cutoff.idx)
        .map((entry) => {
          const name = `${entry.tag}.sql`;
          if (!present.has(name)) {
            throw new Error(`Journal names ${name} but the file is missing.`);
          }
          return {
            idx: entry.idx,
            tag: entry.tag,
            sql: readFileSync(join(DRIZZLE_DIR, name), "utf8"),
          };
        });
      return orderMigrations(files);
    },
  };
}

let driver: TestDriver | null = null;

afterEach(() => {
  __resetWriteLockForTests();
  driver?.dispose();
  driver = null;
});

async function insertDeal(
  id: string,
  stageId: string,
  position: number,
  externalId: string | null,
  at: string,
): Promise<void> {
  await raw.execute(
    `INSERT INTO deals
       (id, title, value_cents, currency, stage_id, stage_entered_at, position, external_id, created_at, updated_at)
     VALUES (?, ?, 0, 'USD', ?, ?, ?, ?, ?, ?)`,
    [id, `Deal ${id}`, stageId, at, position, externalId, at, at],
  );
}

describe("drizzle/0005_lead_dedup.sql - a workspace with a pre-existing UNIQUE violation (LR-OPS-W2 A2)", () => {
  it("keeps the oldest live deal at each duplicated external_id, soft-deletes the rest, and the index then blocks a new duplicate", async () => {
    __resetWriteLockForTests();
    driver = createTestDriver(":memory:");
    setDriver(driver);

    // Stand the workspace at 0004: the unique index genuinely does not exist
    // yet, so writing two live deals at the same external_id is possible -
    // exactly what a real workspace could have accumulated from a poll that
    // raced before this fix existed.
    await migrate({ source: sourceThrough("0004_revenue"), backup: false });

    const { seedWorkspace } = await import("../../../src/db/repos/seed");
    await seedWorkspace();
    const stageRows = await raw.query(
      "SELECT s.id FROM stages s ORDER BY s.position ASC LIMIT 1",
    );
    const stageId = String(stageRows[0][0]);

    // Two live deals sharing one external_id - the oldest wins.
    await insertDeal("dup-older", stageId, 0, "dup-ext-1", "2026-01-01T00:00:00.000Z");
    await insertDeal("dup-newer", stageId, 1, "dup-ext-1", "2026-02-01T00:00:00.000Z");
    // A three-way collision, to prove this is not just a "pick one of two" rule.
    await insertDeal("triple-a", stageId, 2, "dup-ext-2", "2026-01-10T00:00:00.000Z");
    await insertDeal("triple-b", stageId, 3, "dup-ext-2", "2026-01-05T00:00:00.000Z");
    await insertDeal("triple-c", stageId, 4, "dup-ext-2", "2026-01-20T00:00:00.000Z");
    // Untouched controls: a hand-entered deal with no external_id at all,
    // and a deal already sitting in Trash before the migration ever runs.
    await insertDeal("no-ext", stageId, 5, null, "2026-01-15T00:00:00.000Z");
    await insertDeal("already-trashed", stageId, 6, "dup-ext-3", "2025-12-01T00:00:00.000Z");
    await raw.execute(`UPDATE deals SET deleted_at = ? WHERE id = 'already-trashed'`, [
      "2025-12-15T00:00:00.000Z",
    ]);

    const beforeLive = await raw.query(
      "SELECT count(*) FROM deals WHERE external_id = 'dup-ext-1' AND deleted_at IS NULL",
    );
    expect(Number(beforeLive[0][0])).toBe(2);

    const result = await migrate({ source: diskMigrationSource, backup: false });
    expect(result.applied).toContain("0005_lead_dedup");

    // dup-ext-1: the oldest (dup-older) survives live; the newer one is
    // soft-deleted, not hard-deleted - recoverable from Trash for 30 days
    // like any other deleted deal.
    const older = await deals.get("dup-older");
    const newer = await deals.get("dup-newer");
    expect(older!.deletedAt).toBeNull();
    expect(newer!.deletedAt).not.toBeNull();

    // dup-ext-2 (three-way): triple-b (2026-01-05, earliest) survives; the
    // other two do not.
    const tripleA = await deals.get("triple-a");
    const tripleB = await deals.get("triple-b");
    const tripleC = await deals.get("triple-c");
    expect(tripleB!.deletedAt).toBeNull();
    expect(tripleA!.deletedAt).not.toBeNull();
    expect(tripleC!.deletedAt).not.toBeNull();

    // Untouched controls really were untouched.
    const noExt = await deals.get("no-ext");
    expect(noExt!.deletedAt).toBeNull();
    const alreadyTrashed = await deals.get("already-trashed");
    expect(alreadyTrashed!.deletedAt).toBe("2025-12-15T00:00:00.000Z");

    // Exactly one live row per external_id now, everywhere.
    const grouped = await raw.query(
      `SELECT external_id, count(*) FROM deals
       WHERE external_id IS NOT NULL AND deleted_at IS NULL
       GROUP BY external_id HAVING count(*) > 1`,
    );
    expect(grouped).toEqual([]);

    // No foreign key or search-trigger casualties from the soft-deletes.
    const fkViolations = await raw.query("PRAGMA foreign_key_check");
    expect(fkViolations).toEqual([]);

    // The index actually exists and does its job from here on: a brand-new
    // attempt at the same external_id is refused outright.
    await expect(
      insertDeal("dup-third", stageId, 7, "dup-ext-1", "2026-03-01T00:00:00.000Z"),
    ).rejects.toThrow(/unique constraint failed/i);
  });

  it("does nothing extra on a workspace with no violation to begin with", async () => {
    __resetWriteLockForTests();
    driver = createTestDriver(":memory:");
    setDriver(driver);

    await migrate({ source: sourceThrough("0004_revenue"), backup: false });
    const { seedWorkspace } = await import("../../../src/db/repos/seed");
    await seedWorkspace();
    const stageRows = await raw.query(
      "SELECT s.id FROM stages s ORDER BY s.position ASC LIMIT 1",
    );
    const stageId = String(stageRows[0][0]);
    await insertDeal("clean-1", stageId, 0, "clean-ext-1", "2026-01-01T00:00:00.000Z");
    await insertDeal("clean-2", stageId, 1, "clean-ext-2", "2026-01-01T00:00:00.000Z");

    const result = await migrate({ source: diskMigrationSource, backup: false });
    expect(result.applied).toContain("0005_lead_dedup");

    const one = await deals.get("clean-1");
    const two = await deals.get("clean-2");
    expect(one!.deletedAt).toBeNull();
    expect(two!.deletedAt).toBeNull();
  });
});
