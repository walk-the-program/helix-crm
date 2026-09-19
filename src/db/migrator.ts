/**
 * The migrator.
 *
 *   drizzle/meta/_journal.json          drizzle/NNNN_<tag>.sql
 *            |                                   |
 *            v                                   v
 *   [ordered tags] --minus--> schema_migrations --> [pending]
 *            |
 *            +--> pending? --> raw.backup("pre-migration")
 *            |
 *            +--> PRAGMA foreign_keys = OFF        (outside any transaction:
 *            |                                      inside one it is a no-op)
 *            +--> for each pending file:
 *            |       split on "--> statement-breakpoint"
 *            |       append INSERT INTO schema_migrations as the LAST statement
 *            |       send the whole thing as ONE db_batch
 *            |         (so the version lands in the same transaction)
 *            +--> PRAGMA foreign_key_check
 *            +--> PRAGMA foreign_keys = ON
 *
 * Migrations are forward-only. A failure leaves the database untouched (the
 * batch rolled back) and carries the pre-migration backup path so the caller
 * can offer the message in docs/PLAN.md's error map.
 */
import { raw } from "@/db/client";
import { nowIso } from "@/lib/dates";

export const BREAKPOINT = "--> statement-breakpoint";

export type MigrationFile = { idx: number; tag: string; sql: string };

export interface MigrationSource {
  list(): Promise<MigrationFile[]>;
}

export type JournalEntry = { idx: number; tag: string };
export type Journal = { entries: JournalEntry[] };

export class MigrationError extends Error {
  readonly tag: string;
  readonly backupPath: string | null;
  readonly cause: unknown;
  constructor(
    tag: string,
    message: string,
    backupPath: string | null,
    cause: unknown,
  ) {
    super(message);
    this.name = "MigrationError";
    this.tag = tag;
    this.backupPath = backupPath;
    this.cause = cause;
  }
}

/* -------------------------------------------------------------------------- */
/* pure helpers (unit tested)                                                 */
/* -------------------------------------------------------------------------- */

/** Journal order is authoritative: sort by idx, then by tag as a tie-break. */
export function orderMigrations<T extends { idx: number; tag: string }>(
  files: T[],
): T[] {
  return [...files].sort((a, b) =>
    a.idx === b.idx ? a.tag.localeCompare(b.tag) : a.idx - b.idx,
  );
}

function withoutComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .trim();
}

/** Split a migration file into executable statements. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((chunk) => chunk.trim())
    .filter((chunk) => withoutComments(chunk).length > 0);
}

/** The pending tags, in the order they must be applied. */
export function pendingTags(
  files: { idx: number; tag: string }[],
  applied: string[],
): string[] {
  const done = new Set(applied);
  return orderMigrations(files)
    .map((f) => f.tag)
    .filter((tag) => !done.has(tag));
}

/* -------------------------------------------------------------------------- */
/* the default source: Vite ?raw imports                                      */
/* -------------------------------------------------------------------------- */

type RawModules = Record<string, string>;

/**
 * In the app the SQL is bundled: `?raw` string imports plus the journal JSON,
 * so no filesystem access is needed at runtime. Tests pass a source that reads
 * the same files from disk.
 */
export const viteMigrationSource: MigrationSource = {
  async list(): Promise<MigrationFile[]> {
    const journal = (await import("../../drizzle/meta/_journal.json")) as {
      default: Journal;
    };
    const modules = import.meta.glob("../../drizzle/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as RawModules;

    const byTag = new Map<string, string>();
    for (const [path, sql] of Object.entries(modules)) {
      const name = path.split("/").pop() ?? path;
      byTag.set(name.replace(/\.sql$/, ""), sql);
    }

    const files: MigrationFile[] = [];
    for (const entry of journal.default.entries) {
      const sql = byTag.get(entry.tag);
      if (sql === undefined) {
        throw new MigrationError(
          entry.tag,
          `Migration ${entry.tag} is in the journal but its SQL file is missing.`,
          null,
          null,
        );
      }
      files.push({ idx: entry.idx, tag: entry.tag, sql });
    }
    return orderMigrations(files);
  },
};

/* -------------------------------------------------------------------------- */
/* runtime                                                                    */
/* -------------------------------------------------------------------------- */

async function tableExists(name: string): Promise<boolean> {
  const rows = await raw.query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [name],
  );
  return rows.length > 0;
}

/** Versions already recorded in schema_migrations (empty on a fresh file). */
export async function appliedVersions(): Promise<string[]> {
  if (!(await tableExists("schema_migrations"))) return [];
  const rows = await raw.query(
    `SELECT sm.version AS sm_version FROM schema_migrations sm ORDER BY sm.version ASC`,
  );
  return rows.map((r) => String(r[0]));
}

export type MigrateResult = {
  applied: string[];
  alreadyApplied: string[];
  backupPath: string | null;
};

export type MigrateOptions = {
  source?: MigrationSource;
  /** Off in tests that do not care about a backup file. */
  backup?: boolean;
  onProgress?: (tag: string, index: number, total: number) => void;
};

/** Which migrations would run right now. */
export async function pendingMigrations(
  source: MigrationSource = viteMigrationSource,
): Promise<MigrationFile[]> {
  const files = await source.list();
  const applied = new Set(await appliedVersions());
  return orderMigrations(files).filter((f) => !applied.has(f.tag));
}

/**
 * Apply every pending migration. Safe to call on every boot: with nothing
 * pending it makes two cheap queries and returns.
 */
export async function migrate(
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const source = options.source ?? viteMigrationSource;
  const wantBackup = options.backup ?? true;

  const files = orderMigrations(await source.list());
  const already = await appliedVersions();
  const appliedSet = new Set(already);
  const pending = files.filter((f) => !appliedSet.has(f.tag));

  if (pending.length === 0) {
    return { applied: [], alreadyApplied: already, backupPath: null };
  }

  let backupPath: string | null = null;
  if (wantBackup) {
    try {
      backupPath = await raw.backup("pre-migration");
    } catch (err) {
      throw new MigrationError(
        pending[0].tag,
        `Helix could not back up your data before updating it, so the update was not started: ${String(err)}`,
        null,
        err,
      );
    }
  }

  // Outside any transaction: inside one this pragma is silently a no-op.
  await raw.execute("PRAGMA foreign_keys = OFF");

  const applied: string[] = [];
  try {
    for (let i = 0; i < pending.length; i += 1) {
      const file = pending[i];
      options.onProgress?.(file.tag, i, pending.length);

      const statements = splitStatements(file.sql).map((sql) => ({
        sql,
        params: [] as unknown[],
      }));
      // The version is recorded in the SAME transaction as the migration.
      statements.push({
        sql: `INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
        params: [file.tag, nowIso()],
      });

      try {
        await raw.batch(statements);
      } catch (err) {
        throw new MigrationError(
          file.tag,
          `Migration ${file.tag} failed and was rolled back: ${
            err instanceof Error ? err.message : String(err)
          }`,
          backupPath,
          err,
        );
      }
      applied.push(file.tag);
    }

    const violations = await raw.query("PRAGMA foreign_key_check");
    if (violations.length > 0) {
      throw new MigrationError(
        applied[applied.length - 1] ?? pending[0].tag,
        `The update left ${violations.length} broken reference(s) behind, so it was stopped.`,
        backupPath,
        violations,
      );
    }
  } finally {
    await raw.execute("PRAGMA foreign_keys = ON");
  }

  return { applied, alreadyApplied: already, backupPath };
}

/** Boot check from docs/PLAN.md: search cannot work without FTS5. */
export async function hasFts5(): Promise<boolean> {
  const rows = await raw.query(
    "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS fts5_enabled",
  );
  return rows.length > 0 && Number(rows[0][0]) === 1;
}
