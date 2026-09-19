/**
 * The database client.
 *
 *   repos ---> db (Drizzle sqlite-proxy) ---+
 *                                           +--> raw (RawDriver) --> Rust pipe
 *   migrator, search, trash ---> raw -------+                        (or better-sqlite3
 *                                                                     in tests, or the
 *                                                                     e2e bridge)
 *
 * The production driver is the Tauri `invoke` driver over the commands in
 * docs/CONTRACTS.md. Tests and the macOS e2e build call setDriver() before
 * anything touches the database.
 *
 * Rows come back as arrays in select order, which is exactly what Drizzle's
 * sqlite-proxy callback wants; joins must therefore alias every duplicate
 * column name (there is a regression test for that in tests/repo).
 */
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "@/db/schema";

export type DbInfo = {
  path: string;
  sizeBytes: number;
  fts5: boolean;
  sqliteVersion: string;
};

export type SqlParam = null | number | string | boolean | Uint8Array;

export type BatchStatement = { sql: string; params?: unknown[] };

export interface RawDriver {
  query(sql: string, params?: unknown[]): Promise<unknown[][]>;
  execute(sql: string, params?: unknown[]): Promise<number>;
  batch(stmts: BatchStatement[]): Promise<number>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  open(path: string): Promise<void>;
  close(): Promise<void>;
  backup(reason: string): Promise<string>;
  info(): Promise<DbInfo>;
}

/** The shape the Rust pipe returns on failure (serialised DbError). */
export type RustDbError = { code: string; message: string };

export class DbError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}

export class DbClosedError extends DbError {
  constructor(message = "The database is closed.") {
    super("DB_CLOSED", message);
    this.name = "DbClosedError";
  }
}

export class DbOpenError extends DbError {
  constructor(message: string) {
    super("DB_OPEN_FAILED", message);
    this.name = "DbOpenError";
  }
}

export class Fts5MissingError extends DbError {
  constructor(
    message = "This build of SQLite has no FTS5 support, so search cannot work.",
  ) {
    super("FTS_MISSING", message);
    this.name = "Fts5MissingError";
  }
}

function isRustDbError(value: unknown): value is RustDbError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as RustDbError).code === "string"
  );
}

/** Turn whatever `invoke` rejected with into a typed error. */
export function toDbError(err: unknown): DbError {
  if (err instanceof DbError) return err;
  if (isRustDbError(err)) {
    if (err.code === "DB_CLOSED") return new DbClosedError(err.message);
    if (err.code === "DB_OPEN_FAILED") return new DbOpenError(err.message);
    if (err.code === "FTS_MISSING") return new Fts5MissingError(err.message);
    return new DbError(err.code, err.message);
  }
  if (err instanceof Error) return new DbError("SQL_ERROR", err.message);
  return new DbError("SQL_ERROR", String(err));
}

/* -------------------------------------------------------------------------- */
/* the production driver: Tauri invoke                                        */
/* -------------------------------------------------------------------------- */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokeImpl: InvokeFn | null = null;

/**
 * The path db_open returned. Rust absolutises it (but does not canonicalise
 * it, so no Windows \\?\ prefix leaks into Diagnostics); store what it gives
 * back rather than what we asked for.
 */
let lastOpenPath: string | null = null;

export function openedDbPath(): string | null {
  return lastOpenPath;
}

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!invokeImpl) {
    const mod = await import("@tauri-apps/api/core");
    invokeImpl = mod.invoke as InvokeFn;
  }
  try {
    return await invokeImpl<T>(cmd, args);
  } catch (err) {
    throw toDbError(err);
  }
}

/**
 * Production driver. Command names and payload shapes come straight from
 * docs/CONTRACTS.md "Rust command contract".
 */
export const tauriDriver: RawDriver = {
  async query(sql, params = []) {
    const res = await invoke<{ rows: unknown[][] }>("db_query", {
      sql,
      params,
    });
    return res.rows;
  },
  async execute(sql, params = []) {
    const res = await invoke<{ changes: number }>("db_execute", {
      sql,
      params,
    });
    return res.changes;
  },
  async batch(stmts) {
    const res = await invoke<{ changes: number }>("db_batch", {
      statements: stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
    });
    return res.changes;
  },
  async begin() {
    await invoke<void>("db_begin");
  },
  async commit() {
    await invoke<void>("db_commit");
  },
  async rollback() {
    await invoke<void>("db_rollback");
  },
  async open(path) {
    const res = await invoke<{ path: string }>("db_open", { path });
    lastOpenPath = res.path;
  },
  async close() {
    await invoke<void>("db_close");
    lastOpenPath = null;
  },
  async backup(reason) {
    const res = await invoke<{ path: string }>("db_backup", { reason });
    return res.path;
  },
  async info() {
    return invoke<DbInfo>("db_info");
  },
};

/* -------------------------------------------------------------------------- */
/* the swappable driver                                                       */
/* -------------------------------------------------------------------------- */

let current: RawDriver = tauriDriver;

/** Tests and the macOS e2e build swap the driver before boot. */
export function setDriver(driver: RawDriver): void {
  current = driver;
}

export function getDriver(): RawDriver {
  return current;
}

/**
 * `raw` is a stable facade: every call is forwarded to whichever driver is
 * installed right now, so modules may capture `raw` at import time.
 */
export const raw: RawDriver = {
  query: (sql, params) => current.query(sql, params),
  execute: (sql, params) => current.execute(sql, params),
  batch: (stmts) => current.batch(stmts),
  begin: () => current.begin(),
  commit: () => current.commit(),
  rollback: () => current.rollback(),
  open: async (path) => {
    lastOpenPath = path;
    await current.open(path);
  },
  close: async () => {
    await current.close();
    lastOpenPath = null;
  },
  backup: (reason) => current.backup(reason),
  info: () => current.info(),
};

/* -------------------------------------------------------------------------- */
/* Drizzle over the pipe                                                      */
/* -------------------------------------------------------------------------- */

type ProxyMethod = "run" | "all" | "values" | "get";

/**
 * The sqlite-proxy callback.
 *
 * Drizzle asks for one of four methods and always wants `{ rows }` back:
 *   run    - no result needed; use execute() so a write is not parsed as a query
 *   all    - every row, each row an array in select order
 *   values - the same as all (raw values)
 *   get    - the first row only, or undefined when there is none
 */
async function runProxy(
  sql: string,
  params: unknown[],
  method: ProxyMethod,
): Promise<{ rows: unknown[] }> {
  if (method === "run") {
    await raw.execute(sql, params);
    return { rows: [] };
  }
  const rows = await raw.query(sql, params);
  if (method === "get") {
    return { rows: rows.length > 0 ? (rows[0] as unknown[]) : [] };
  }
  return { rows };
}

export const db: SqliteRemoteDatabase<typeof schema> = drizzle<typeof schema>(
  (sql, params, method) => runProxy(sql, params, method as ProxyMethod),
  async (batch) => {
    // When nothing in the batch needs rows back, send it as one db_batch: the
    // pipe wraps it in a transaction, or in a savepoint when a transaction is
    // already open, and rolls back on any error. Mixed batches fall back to
    // sequential calls; repositories that need atomicity around reads use
    // withTransaction() instead.
    if (batch.length > 0 && batch.every((item) => item.method === "run")) {
      await raw.batch(
        batch.map((item) => ({ sql: item.sql, params: item.params })),
      );
      return batch.map(() => ({ rows: [] }));
    }
    const results: { rows: unknown[] }[] = [];
    for (const item of batch) {
      results.push(
        await runProxy(item.sql, item.params, item.method as ProxyMethod),
      );
    }
    return results;
  },
  { schema, logger: false },
);

export { schema };
