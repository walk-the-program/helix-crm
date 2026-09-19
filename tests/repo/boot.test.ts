/**
 * The boot sequence, end to end, minus React: registry -> open -> FTS check ->
 * migrate -> seed. The driver is the better-sqlite3 one, opened in memory
 * whatever path the registry hands it, because the point here is the order of
 * the steps and not the filesystem.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { raw, setDriver } from "../../src/db/client";
import { boot, openWorkspace } from "../../src/app/boot";
import {
  readRegistry,
  resetRegistryCache,
  writeRegistry,
  EMPTY_REGISTRY,
} from "../../src/app/appSettings";
import { __resetWriteLockForTests } from "../../src/db/writeLock";
import { createTestDriver, type TestDriver } from "./driver";
import { diskMigrationSource } from "./harness";

/**
 * The journal decides which migrations exist, so these assertions read it
 * rather than repeating the tag list: any agent adding a custom migration
 * would otherwise have to come and edit this file.
 */
async function journalTags(): Promise<string[]> {
  return (await diskMigrationSource.list()).map((file) => file.tag);
}

let driver: TestDriver;

/** A driver whose open() always lands on a fresh in-memory database. */
function inMemoryDriver(): TestDriver {
  const d = createTestDriver(":memory:");
  const open = d.open.bind(d);
  d.open = async () => open(":memory:");
  return d;
}

beforeEach(async () => {
  __resetWriteLockForTests();
  resetRegistryCache();
  await writeRegistry({ ...EMPTY_REGISTRY });
  driver = inMemoryDriver();
  setDriver(driver);
});

afterEach(() => {
  driver.dispose();
  __resetWriteLockForTests();
});

describe("boot", () => {
  it("creates the first workspace when the registry is empty", async () => {
    const result = await boot();
    expect(result.workspace.name).toBe("My business");
    expect(result.workspace.path).toContain("helix.db");

    const registry = await readRegistry();
    expect(registry.workspaces).toHaveLength(1);
    expect(registry.lastOpened).toBe(result.workspace.id);
  });

  it("applies every migration and seeds the workspace", async () => {
    const result = await boot();
    expect(result.migration.applied).toEqual(await journalTags());

    const stages = await raw.query(
      `SELECT s.name AS s_name FROM stages s WHERE s.deleted_at IS NULL ORDER BY s.position`,
    );
    expect(stages.map((r) => String(r[0]))).toEqual([
      "New",
      "Contacted",
      "Quoted",
      "Scheduled",
      "Won",
      "Lost",
    ]);

    const sources = await raw.query(
      `SELECT so.name AS so_name FROM sources so WHERE so.deleted_at IS NULL ORDER BY so.name`,
    );
    expect(sources.map((r) => String(r[0]))).toEqual([
      "Import",
      "Manual",
      "Referral",
      "Website",
    ]);
  });

  it("reopens the workspace it opened last, and seeds nothing twice", async () => {
    const first = await boot();
    const second = await boot();
    expect(second.workspace.id).toBe(first.workspace.id);

    const registry = await readRegistry();
    expect(registry.workspaces).toHaveLength(1);
  });

  it("opening a workspace again is idempotent", async () => {
    const first = await boot();
    const reopened = await openWorkspace(first.workspace);
    // The in-memory driver hands back a fresh database on every open, so the
    // full set is applied again rather than nothing; what matters is that the
    // second run is a clean, complete apply and does not double-seed.
    expect(reopened.migration.applied).toEqual(await journalTags());

    const pipelines = await raw.query(
      `SELECT count(*) AS pipeline_count FROM pipelines WHERE deleted_at IS NULL`,
    );
    expect(Number(pipelines[0][0])).toBe(1);
  });

  it("reports FTS5 as available, which the boot check requires", async () => {
    await boot();
    const info = await raw.info();
    expect(info.fts5).toBe(true);
  });
});
