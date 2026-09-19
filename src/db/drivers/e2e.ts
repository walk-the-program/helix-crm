/**
 * The macOS end-to-end driver.
 *
 * The Playwright harness binds better-sqlite3 in the Node process and exposes
 * it on the page as `window.__helixDb` (page.exposeFunction, so every member
 * is async). This driver forwards the RawDriver surface to that bridge, which
 * lets the whole app boot in a plain browser with no Tauri runtime.
 *
 * The bridge speaks the same shapes as the Rust pipe (docs/CONTRACTS.md), so
 * the repository code under test is byte-for-byte the production path.
 */
import type { BatchStatement, DbInfo, RawDriver } from "@/db/client";
import { DbError } from "@/db/client";

export interface HelixDbBridge {
  query(sql: string, params: unknown[]): Promise<unknown[][]>;
  execute(sql: string, params: unknown[]): Promise<number>;
  batch(stmts: { sql: string; params: unknown[] }[]): Promise<number>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  open(path: string): Promise<void>;
  close(): Promise<void>;
  backup(reason: string): Promise<string>;
  info(): Promise<DbInfo>;
}

declare global {
  interface Window {
    __helixDb?: HelixDbBridge;
  }
}

function bridge(): HelixDbBridge {
  const b = typeof window === "undefined" ? undefined : window.__helixDb;
  if (!b) {
    throw new DbError(
      "DB_CLOSED",
      "window.__helixDb is not bound: the e2e harness did not expose the database bridge.",
    );
  }
  return b;
}

/** True when the e2e bridge is available, so boot can pick this driver. */
export function hasE2eBridge(): boolean {
  return typeof window !== "undefined" && Boolean(window.__helixDb);
}

export const e2eDriver: RawDriver = {
  query: (sql: string, params: unknown[] = []) => bridge().query(sql, params),
  execute: (sql: string, params: unknown[] = []) =>
    bridge().execute(sql, params),
  batch: (stmts: BatchStatement[]) =>
    bridge().batch(stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] }))),
  begin: () => bridge().begin(),
  commit: () => bridge().commit(),
  rollback: () => bridge().rollback(),
  open: (path: string) => bridge().open(path),
  close: () => bridge().close(),
  backup: (reason: string) => bridge().backup(reason),
  info: () => bridge().info(),
};
