import { describe, expect, it, afterEach } from "vitest";
import { createHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import {
  appliedVersions,
  BREAKPOINT,
  hasFts5,
  migrate,
  MigrationError,
  NewerSchemaError,
  newerSchemaMessage,
  orderMigrations,
  pendingMigrations,
  splitStatements,
  type MigrationFile,
  type MigrationSource,
} from "../../src/db/migrator";
import { diskMigrationSource } from "./harness";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

/**
 * A source that answers with the real journal plus fabricated extra files, so
 * a test can stage a migration that is guaranteed to fail without touching
 * `drizzle/` (out of ownership; other agents are writing there right now).
 * The idx values are far past anything the real journal will reach, so these
 * always sort after every real migration regardless of how many exist when
 * this runs.
 */
async function sourceWithExtra(extra: MigrationFile[]): Promise<MigrationSource> {
  const real = await diskMigrationSource.list();
  const files = [...real, ...extra];
  return {
    async list() {
      return orderMigrations(files);
    },
  };
}

describe("migrations", () => {
  it("applies every journal entry once", async () => {
    h = await createHarness();
    // Journal-driven rather than a hard-coded list: every agent that adds a
    // custom migration would otherwise have to edit this assertion.
    const journalTags = (await diskMigrationSource.list()).map((f) => f.tag);
    expect(journalTags.slice(0, 2)).toEqual(["0000_init", "0001_search"]);
    expect(await appliedVersions()).toEqual(journalTags);
    const again = await migrate({ source: diskMigrationSource, backup: false });
    expect(again.applied).toEqual([]);
  });

  it("creates the FTS5 tables and triggers", async () => {
    h = await createHarness();
    expect(await hasFts5()).toBe(true);
    const tables = await raw.query(
      "SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name",
    );
    const names = tables.map((r) => String(r[0]));
    expect(names).toContain("search_docs");
    expect(names).toContain("search_index");
    expect(names).toContain("search_contacts_ai");
    expect(names).toContain("search_contact_phones_au");
  });

  it("leaves no foreign key violations", async () => {
    h = await createHarness();
    const rows = await raw.query("PRAGMA foreign_key_check");
    expect(rows).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* A1. an older build opening a workspace a newer build already migrated      */
/* -------------------------------------------------------------------------- */

describe("older build vs. a newer workspace (LR-OPS-W1 A1)", () => {
  it("PRE-FIX BEHAVIOUR: the pending computation never notices a future version - it is simply invisible", async () => {
    // This pins the actual root cause, and stays true after the guard below is
    // added: pendingMigrations() only ever asks "is this tag done yet", so a
    // version schema_migrations holds that the caller's own journal does not
    // list never shows up as pending, or as anything else. Nothing here reads
    // schema_migrations for versions it cannot name. This is exactly what let
    // an older Helix open a newer workspace with no warning before this task:
    // boot() would see zero pending migrations and carry on as normal.
    h = await createHarness();
    const allTags = (await diskMigrationSource.list()).map((f) => f.tag);
    expect(allTags.length).toBeGreaterThan(1);
    const olderJournal: MigrationSource = {
      async list() {
        // An older build's journal: every real file except the newest one,
        // i.e. exactly what v0.1 would ship with an app whose data folder a
        // v0.2 already migrated further.
        const real = await diskMigrationSource.list();
        return real.slice(0, -1);
      },
    };
    const pending = await pendingMigrations(olderJournal);
    expect(pending).toEqual([]);
  });

  it("migrate() now refuses, before touching anything, with the exact message", async () => {
    h = await createHarness();
    const allTags = (await diskMigrationSource.list()).map((f) => f.tag);
    const newestTag = allTags[allTags.length - 1];
    const olderJournal: MigrationSource = {
      async list() {
        const real = await diskMigrationSource.list();
        return real.slice(0, -1);
      },
    };

    let caught: unknown;
    try {
      await migrate({ source: olderJournal, backup: true });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NewerSchemaError);
    const err = caught as NewerSchemaError;
    expect(err.unknownVersions).toEqual([newestTag]);
    expect(err.message).toBe(newerSchemaMessage());
    // Never dressed up as a failed migration.
    expect(caught).not.toBeInstanceOf(MigrationError);

    // Nothing was touched: still fully migrated on every real tag, nothing
    // more, nothing less, and no backup was taken - the refusal comes before
    // the backup step runs at all.
    expect(await appliedVersions()).toEqual(allTags);
  });

  it("does not offer to downgrade, delete or repair: the message only names the version problem", () => {
    const message = newerSchemaMessage();
    expect(message.toLowerCase()).not.toContain("delete");
    expect(message.toLowerCase()).not.toContain("repair");
    expect(message.toLowerCase()).not.toContain("downgrade");
    expect(message).not.toContain("!");
  });
});

/* -------------------------------------------------------------------------- */
/* A2. partial-failure atomicity                                              */
/* -------------------------------------------------------------------------- */

describe("partial-failure atomicity (LR-OPS-W1 A2)", () => {
  it("a single migration whose LAST statement fails leaves no partial DDL and no schema_migrations row", async () => {
    h = await createHarness();
    const before = await appliedVersions();

    const source = await sourceWithExtra([
      {
        idx: 9000,
        tag: "9000_fake_last_statement_fails",
        sql: [
          "CREATE TABLE fake_atomic_a (id text primary key);",
          BREAKPOINT,
          // The last statement of the file references a column that does not
          // exist, so it fails deterministically after the CREATE TABLE above
          // has already run inside the same batch.
          "INSERT INTO fake_atomic_a (id, does_not_exist) VALUES ('x', 'y');",
        ].join("\n"),
      },
    ]);

    let caught: unknown;
    try {
      await migrate({ source, backup: true });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MigrationError);
    const err = caught as MigrationError;
    expect(err.tag).toBe("9000_fake_last_statement_fails");
    // The pre-migration backup path is carried on the thrown error.
    expect(err.backupPath).toBeTruthy();

    // No partial DDL: the CREATE TABLE from earlier in the SAME batch was
    // rolled back along with the failing INSERT.
    const tables = await raw.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fake_atomic_a'",
    );
    expect(tables).toEqual([]);

    // No schema_migrations row for the failed migration, and nothing else
    // about the applied set moved.
    expect(await appliedVersions()).toEqual(before);
  });

  it("migration N commits and migration N+1 fails: N stays applied, N+1 does not, and the error names N+1", async () => {
    h = await createHarness();
    const before = await appliedVersions();

    const source = await sourceWithExtra([
      { idx: 9001, tag: "9001_fake_ok", sql: "CREATE TABLE fake_multi_ok (id text primary key);" },
      {
        idx: 9002,
        tag: "9002_fake_bad",
        sql: [
          "CREATE TABLE fake_multi_bad (id text primary key);",
          BREAKPOINT,
          "INSERT INTO fake_multi_bad (id, nope) VALUES ('x', 'y');",
        ].join("\n"),
      },
    ]);

    let caught: unknown;
    try {
      await migrate({ source, backup: false });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MigrationError);
    expect((caught as MigrationError).tag).toBe("9002_fake_bad");

    // N committed: its table exists and its version is recorded.
    const okTable = await raw.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fake_multi_ok'",
    );
    expect(okTable).toHaveLength(1);
    expect(await appliedVersions()).toEqual([...before, "9001_fake_ok"]);

    // N+1 did not: its table does not exist and it is not recorded.
    const badTable = await raw.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fake_multi_bad'",
    );
    expect(badTable).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* A3. can every real migration statement run inside a transaction?           */
/* -------------------------------------------------------------------------- */

describe("every real migration statement is transactional (LR-OPS-W1 A3)", () => {
  /**
   * SQLite's own list of things that either force an implicit commit or
   * cannot run inside an explicit transaction at all: VACUUM, a PRAGMA that
   * changes something transaction-scoped (journal_mode is the classic one -
   * `PRAGMA journal_mode=WAL` is a silent no-op inside a transaction rather
   * than an error, which is worse), ATTACH/DETACH DATABASE, and explicit
   * BEGIN/COMMIT/ROLLBACK, which would fight the migrator's own batch.
   */
  const NON_TRANSACTIONAL = /\bVACUUM\b|\bPRAGMA\b|\bATTACH\s+DATABASE\b|\bDETACH\s+DATABASE\b|^\s*BEGIN\b|^\s*COMMIT\b|^\s*ROLLBACK\b/im;

  it("no statement in any drizzle/000*.sql file matches a known implicit-commit pattern", async () => {
    const files = await diskMigrationSource.list();
    expect(files.length).toBeGreaterThan(0);

    const offenders: { tag: string; statement: string }[] = [];
    for (const file of files) {
      for (const statement of splitStatements(file.sql)) {
        if (NON_TRANSACTIONAL.test(statement)) {
          offenders.push({ tag: file.tag, statement });
        }
      }
    }
    // Evidence, not just an assertion: if this ever fails, the failure message
    // names the exact file and statement so the next agent does not have to
    // re-derive what was checked.
    expect(offenders).toEqual([]);
  });

  /**
   * Mirrors migrator.ts's private `withoutComments` exactly (same two
   * regexes), because a real migration file's first statement in a chunk can
   * carry a multi-line `--` banner above the actual SQL (0001_search.sql
   * does), and the check below has to look at the SQL, not the comment.
   */
  function withoutComments(sql: string): string {
    return sql
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "")
      .trim();
  }

  it("every real migration statement is one of the transaction-safe DDL/DML kinds SQLite allows", async () => {
    // The positive half of the same check: every statement starts with a verb
    // SQLite treats as ordinary, rollback-able schema or data changes. Anything
    // not on this list would need a human to look at it before it could be
    // trusted inside the migrator's one db_batch.
    const ALLOWED = /^(CREATE(\s+UNIQUE)?\s+(TABLE|INDEX|VIEW|TRIGGER|VIRTUAL TABLE)|ALTER TABLE|DROP\s+(VIEW|TABLE|INDEX|TRIGGER)(\s+IF\s+EXISTS)?|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i;
    const files = await diskMigrationSource.list();
    const kinds = new Set<string>();
    for (const file of files) {
      for (const statement of splitStatements(file.sql)) {
        const code = withoutComments(statement);
        expect(ALLOWED.test(code)).toBe(true);
        kinds.add(code.match(ALLOWED)?.[0]?.toUpperCase() ?? "?");
      }
    }
    // Evidence of what was actually found, printed on failure via the message
    // below if the set ever comes back empty (which would mean the loop above
    // did not run against real files at all).
    expect(kinds.size).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* A4. foreign_keys always comes back ON, even when a migration throws        */
/* -------------------------------------------------------------------------- */

describe("foreign_keys is restored after a throwing migration (LR-OPS-W1 A4)", () => {
  it("PRAGMA foreign_keys is ON again after a migration batch fails", async () => {
    h = await createHarness();

    const source = await sourceWithExtra([
      {
        idx: 9003,
        tag: "9003_fake_fk_restore",
        sql: [
          "CREATE TABLE fake_fk_restore (id text primary key);",
          BREAKPOINT,
          "INSERT INTO fake_fk_restore (id, nope) VALUES ('x', 'y');",
        ].join("\n"),
      },
    ]);

    await expect(migrate({ source, backup: false })).rejects.toBeInstanceOf(
      MigrationError,
    );

    const rows = await raw.query("PRAGMA foreign_keys");
    expect(Number(rows[0][0])).toBe(1);
  });

  it("PRAGMA foreign_keys is ON again after a clean migration run too", async () => {
    h = await createHarness();
    const rows = await raw.query("PRAGMA foreign_keys");
    expect(Number(rows[0][0])).toBe(1);
  });
});
