/**
 * The repository test harness.
 *
 * Every repo test gets a fresh in-memory database with the real migrations
 * applied by the real migrator, reached through the real Drizzle proxy. The
 * only substitution is the driver: better-sqlite3 instead of the Rust pipe.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setDriver } from "../../src/db/client";
import {
  migrate,
  orderMigrations,
  type MigrationFile,
  type MigrationSource,
} from "../../src/db/migrator";
import { __resetWriteLockForTests } from "../../src/db/writeLock";
import { createTestDriver, type TestDriver } from "./driver";

const here = dirname(fileURLToPath(import.meta.url));
export const DRIZZLE_DIR = join(here, "..", "..", "drizzle");

type Journal = { entries: { idx: number; tag: string }[] };

/** Reads the same journal and SQL files the app bundles with `?raw`. */
export const diskMigrationSource: MigrationSource = {
  async list(): Promise<MigrationFile[]> {
    const journal = JSON.parse(
      readFileSync(join(DRIZZLE_DIR, "meta", "_journal.json"), "utf8"),
    ) as Journal;
    const present = new Set(
      readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")),
    );
    const files = journal.entries.map((entry) => {
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

export type Harness = {
  driver: TestDriver;
  dispose: () => void;
};

/**
 * Fresh database, migrations applied, driver installed. Call dispose() in
 * afterEach so the handle is released.
 */
export async function createHarness(
  options: { backup?: boolean; path?: string } = {},
): Promise<Harness> {
  __resetWriteLockForTests();
  const driver = createTestDriver(options.path ?? ":memory:");
  setDriver(driver);
  await migrate({
    source: diskMigrationSource,
    backup: options.backup ?? false,
  });
  return {
    driver,
    dispose: () => {
      __resetWriteLockForTests();
      driver.dispose();
    },
  };
}

/** A harness with the first-boot seed applied (pipeline, stages, sources). */
export async function createSeededHarness(
  options: { backup?: boolean; path?: string } = {},
): Promise<Harness> {
  const harness = await createHarness(options);
  const { seedWorkspace } = await import("../../src/db/repos/seed");
  await seedWorkspace();
  return harness;
}
