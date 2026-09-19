/**
 * The test driver: better-sqlite3 behind the same RawDriver interface the Rust
 * pipe implements, so repository tests exercise the production code path
 * (Drizzle sqlite-proxy -> raw -> driver) byte for byte.
 *
 * The savepoint semantics mirror src-tauri's db_batch exactly:
 *   autocommit  -> BEGIN ... COMMIT, ROLLBACK on any error
 *   in a tx     -> SAVEPOINT ... RELEASE, ROLLBACK TO + RELEASE on any error
 */
import Database from "better-sqlite3";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BatchStatement, DbInfo, RawDriver } from "../../src/db/client";

export type TestDriver = RawDriver & {
  /** The underlying handle, for assertions that bypass the repository layer. */
  handle(): Database.Database;
  dispose(): void;
};

function isPragma(sql: string): boolean {
  return /^\s*pragma\b/i.test(sql);
}

function bind(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p === undefined) return null;
    return p;
  });
}

export function createTestDriver(path = ":memory:"): TestDriver {
  let db: Database.Database | null = new Database(path);
  let dbPath = path;
  let savepointSeq = 0;
  let backupDir: string | null = null;

  function handle(): Database.Database {
    if (!db) {
      const err = new Error("The database is closed.") as Error & {
        code: string;
      };
      err.code = "DB_CLOSED";
      throw err;
    }
    return db;
  }

  function init(d: Database.Database): void {
    d.pragma("foreign_keys = ON");
    d.pragma("busy_timeout = 5000");
    if (path !== ":memory:") d.pragma("journal_mode = WAL");
  }

  init(handle());

  function runOne(sql: string, params: unknown[]): number {
    const d = handle();
    if (isPragma(sql) && params.length === 0) {
      d.exec(sql);
      return 0;
    }
    return d.prepare(sql).run(...bind(params)).changes;
  }

  const driver: TestDriver = {
    async query(sql, params = []) {
      const d = handle();
      const stmt = d.prepare(sql);
      if (!stmt.reader) {
        stmt.run(...bind(params));
        return [];
      }
      return stmt.raw(true).all(...bind(params)) as unknown[][];
    },

    async execute(sql, params = []) {
      return runOne(sql, params);
    },

    async batch(stmts: BatchStatement[]) {
      const d = handle();
      const nested = d.inTransaction;
      const name = `helix_sp_${(savepointSeq += 1)}`;
      let changes = 0;

      if (nested) d.exec(`SAVEPOINT ${name}`);
      else d.exec("BEGIN");

      try {
        for (const s of stmts) changes += runOne(s.sql, s.params ?? []);
        if (nested) d.exec(`RELEASE ${name}`);
        else d.exec("COMMIT");
        return changes;
      } catch (err) {
        if (nested) {
          d.exec(`ROLLBACK TO ${name}`);
          d.exec(`RELEASE ${name}`);
        } else {
          d.exec("ROLLBACK");
        }
        throw err;
      }
    },

    async begin() {
      const d = handle();
      if (d.inTransaction) {
        const err = new Error("A transaction is already open.") as Error & {
          code: string;
        };
        err.code = "TX_STATE";
        throw err;
      }
      d.exec("BEGIN");
    },

    async commit() {
      const d = handle();
      if (!d.inTransaction) {
        const err = new Error("No transaction is open.") as Error & {
          code: string;
        };
        err.code = "TX_STATE";
        throw err;
      }
      d.exec("COMMIT");
    },

    async rollback() {
      const d = handle();
      if (!d.inTransaction) {
        // Same as the Rust pipe: rolling back outside a transaction is TX_STATE.
        const err = new Error("No transaction is open.") as Error & {
          code: string;
        };
        err.code = "TX_STATE";
        throw err;
      }
      d.exec("ROLLBACK");
    },

    async open(nextPath: string) {
      if (db) db.close();
      dbPath = nextPath;
      db = new Database(nextPath);
      init(db);
    },

    async close() {
      if (!db) return;
      if (dbPath !== ":memory:") db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      db = null;
    },

    async backup(reason: string) {
      const d = handle();
      backupDir ??= mkdtempSync(join(tmpdir(), "helix-backups-"));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dest = join(backupDir, `${stamp}-${reason}.db`);
      d.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
      return dest;
    },

    async info(): Promise<DbInfo> {
      const d = handle();
      const fts5 = d
        .prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5')")
        .pluck()
        .get() as number;
      const version = d
        .prepare("SELECT sqlite_version()")
        .pluck()
        .get() as string;
      let sizeBytes = 0;
      if (dbPath === ":memory:") {
        const pageCount = d.pragma("page_count", { simple: true }) as number;
        const pageSize = d.pragma("page_size", { simple: true }) as number;
        sizeBytes = pageCount * pageSize;
      } else {
        // Like db_info, the size includes the -wal file.
        for (const candidate of [dbPath, `${dbPath}-wal`]) {
          try {
            sizeBytes += statSync(candidate).size;
          } catch {
            // Absent files simply add nothing.
          }
        }
      }
      return { path: dbPath, sizeBytes, fts5: fts5 === 1, sqliteVersion: version };
    },

    handle,

    dispose() {
      if (db) {
        db.close();
        db = null;
      }
    },
  };

  return driver;
}
