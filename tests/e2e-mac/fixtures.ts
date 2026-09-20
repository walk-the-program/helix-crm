/**
 * The macOS e2e harness: everything the browser is missing because there is no
 * Tauri runtime under it.
 *
 * Two halves.
 *
 * 1. The database. `page.exposeFunction` binds one RPC into the page, and an
 *    init script wraps it as `window.__helixDb` with the ten methods
 *    `src/db/drivers/e2e.ts` calls. Behind it is a real better-sqlite3 file in
 *    a per-test temp directory, driven with the same semantics as the Rust
 *    pipe in docs/CONTRACTS.md: rows as arrays in select order, batch as
 *    BEGIN/COMMIT in autocommit and SAVEPOINT/RELEASE inside a transaction,
 *    backup as VACUUM INTO a .tmp then a rename.
 *
 * 2. Every other command. `plugin:dialog|*`, `plugin:fs|*`, `plugin:opener|*`,
 *    `plugin:log|*`, `secret_*`, `leads_fetch`, `copy_in` and `app_paths` are
 *    answered by a `__TAURI_INTERNALS__`-compatible invoke shim installed by
 *    the same init script, so `@tauri-apps/api` and the plugin packages work
 *    unmodified. A test steers them through `window.__helixE2E` and reads back
 *    what the app asked for.
 *
 * Usage:
 *
 *   import { test, expect } from "../fixtures";
 *   test("...", async ({ page, helix }) => { ... });
 *
 * Every `test(...)` callback in this suite must destructure `helix`, even
 * when the test body never touches it. Playwright only builds a fixture a
 * test (or one of its hooks) actually asks for, and `helix` is what installs
 * the database bridge and the Tauri invoke shim below. A spec that writes
 * `async ({ page }) => { ... }` and calls `page.goto("/")` gets a bare
 * `window.__TAURI_INTERNALS__` with nothing behind it — "Cannot read
 * properties of undefined (reading 'invoke')" and the boot error screen.
 */
import { test as base, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The database bridge
// ---------------------------------------------------------------------------

/** What the page gets back. Errors travel as data so the code survives. */
type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

type DbInfo = {
  path: string;
  sizeBytes: number;
  fts5: boolean;
  sqliteVersion: string;
};

class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * JS sends `null | number | string | boolean | Uint8Array`; better-sqlite3
 * refuses booleans and typed arrays, so bind them the way the Rust side does:
 * booleans as 0/1, byte arrays as Buffers.
 */
function bind(params: unknown[]): unknown[] {
  return params.map((param) => {
    if (typeof param === "boolean") return param ? 1 : 0;
    if (param instanceof Uint8Array) return Buffer.from(param);
    if (param === undefined) return null;
    return param;
  });
}

function sqlError(err: unknown): BridgeError {
  const message = err instanceof Error ? err.message : String(err);
  return new BridgeError("SQL_ERROR", message);
}

/** The Node half of `window.__helixDb`. One instance per test. */
class DbBridge {
  private db: Database.Database | null = null;
  private openPath: string | null = null;
  /** Mirrors the Rust side's explicit transaction flag. */
  private inTx = false;

  constructor(private readonly workspaceDir: string) {}

  private live(): Database.Database {
    if (!this.db) throw new BridgeError("DB_CLOSED", "The database is closed.");
    return this.db;
  }

  open(path: string): void {
    if (this.db) this.close();
    try {
      // The app creates the workspace folder through the (stubbed) fs plugin,
      // so the real directory has to be made here, as Rust's db_open does.
      mkdirSync(dirname(path), { recursive: true });
      this.db = new Database(path);
    } catch (err) {
      throw new BridgeError("DB_OPEN_FAILED", err instanceof Error ? err.message : String(err));
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.openPath = path;
    this.inTx = false;
  }

  close(): void {
    if (!this.db) return;
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // A checkpoint failure must not strand the handle.
    }
    this.db.close();
    this.db = null;
    this.openPath = null;
    this.inTx = false;
  }

  query(sql: string, params: unknown[]): unknown[][] {
    const stmt = this.live().prepare(sql);
    try {
      // raw(true) gives arrays in select order, which is what the sqlite-proxy
      // callback wants and what the Rust pipe returns.
      return stmt.raw(true).all(...bind(params)) as unknown[][];
    } catch (err) {
      if (err instanceof Error && /does not return data/i.test(err.message)) {
        stmt.run(...bind(params));
        return [];
      }
      throw sqlError(err);
    }
  }

  execute(sql: string, params: unknown[]): number {
    try {
      return this.live().prepare(sql).run(...bind(params)).changes;
    } catch (err) {
      throw sqlError(err);
    }
  }

  begin(): void {
    if (this.inTx) throw new BridgeError("TX_STATE", "A transaction is already open.");
    this.live().exec("BEGIN");
    this.inTx = true;
  }

  commit(): void {
    if (!this.inTx) throw new BridgeError("TX_STATE", "No transaction is open.");
    this.live().exec("COMMIT");
    this.inTx = false;
  }

  rollback(): void {
    if (!this.inTx) throw new BridgeError("TX_STATE", "No transaction is open.");
    this.live().exec("ROLLBACK");
    this.inTx = false;
  }

  /**
   * Atomic either way: a plain transaction when nothing is open, a savepoint
   * when one is (an import already holds the outer transaction). A failure
   * mid-batch undoes the whole batch and leaves the outer transaction intact.
   */
  batch(stmts: { sql: string; params?: unknown[] }[]): number {
    const db = this.live();
    const nested = this.inTx;
    const savepoint = `helix_batch_${Date.now().toString(36)}`;

    db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN");
    let changes = 0;
    try {
      for (const stmt of stmts) {
        changes += db.prepare(stmt.sql).run(...bind(stmt.params ?? [])).changes;
      }
    } catch (err) {
      if (nested) {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
      } else {
        db.exec("ROLLBACK");
      }
      throw sqlError(err);
    }
    db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return changes;
  }

  backup(reason: string): string {
    const db = this.live();
    const dir = join(this.workspaceDir, "backups");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeReason = reason.replace(/[^a-z0-9-]+/gi, "-");
    const final = join(dir, `${stamp}-${safeReason}.db`);
    const tmp = `${final}.tmp`;
    try {
      db.prepare("VACUUM INTO ?").run(tmp);
      renameSync(tmp, final);
    } catch (err) {
      throw new BridgeError("BACKUP_FAILED", err instanceof Error ? err.message : String(err));
    }
    return final;
  }

  info(): DbInfo {
    const db = this.live();
    let fts5 = false;
    try {
      db.exec("CREATE VIRTUAL TABLE temp.__helix_fts_probe USING fts5(x)");
      db.exec("DROP TABLE temp.__helix_fts_probe");
      fts5 = true;
    } catch {
      fts5 = false;
    }
    const version = db.prepare("SELECT sqlite_version() AS v").get() as { v: string };
    let sizeBytes = 0;
    try {
      sizeBytes = this.openPath ? statSync(this.openPath).size : 0;
    } catch {
      sizeBytes = 0;
    }
    return { path: this.openPath ?? "", sizeBytes, fts5, sqliteVersion: version.v };
  }

  call(method: string, args: unknown[]): unknown {
    switch (method) {
      case "open":
        this.open(String(args[0]));
        return null;
      case "close":
        this.close();
        return null;
      case "query":
        return this.query(String(args[0]), (args[1] as unknown[]) ?? []);
      case "execute":
        return this.execute(String(args[0]), (args[1] as unknown[]) ?? []);
      case "batch":
        return this.batch((args[0] as { sql: string; params?: unknown[] }[]) ?? []);
      case "begin":
        this.begin();
        return null;
      case "commit":
        this.commit();
        return null;
      case "rollback":
        this.rollback();
        return null;
      case "backup":
        return this.backup(String(args[0] ?? "manual"));
      case "info":
        return this.info();
      default:
        throw new BridgeError("SQL_ERROR", `Unknown database method "${method}".`);
    }
  }
}

// ---------------------------------------------------------------------------
// The page-side shim, installed before any app code runs
// ---------------------------------------------------------------------------

/**
 * Runs in the browser. `__helixDbCall` and `__helixInvoke` are already bound by
 * exposeFunction; this wraps them into the two shapes the app expects.
 *
 * It is written as one self-contained function with no imports because
 * addInitScript serialises it.
 */
function installShim(seed: {
  appData: string;
  workspacesDir: string;
  files?: Record<string, string>;
  /** See the `onboarding` fixture option below. Defaults to true. */
  skipOnboarding?: boolean;
}): void {
  type Rpc = (method: string, args: unknown[]) => Promise<RpcResultLike>;
  type RpcResultLike =
    | { ok: true; value: unknown }
    | { ok: false; error: { code: string; message: string } };

  const w = window as unknown as Record<string, unknown>;
  const dbCall = w.__helixDbCall as Rpc;
  const invokeCall = w.__helixInvoke as Rpc;

  function unwrap(result: RpcResultLike): unknown {
    if (result.ok) return result.value;
    const err = new Error(result.error.message) as Error & { code?: string };
    err.name = "DbError";
    err.code = result.error.code;
    throw err;
  }

  const db = {
    query: (sql: string, params: unknown[] = []) => dbCall("query", [sql, params]).then(unwrap),
    execute: (sql: string, params: unknown[] = []) => dbCall("execute", [sql, params]).then(unwrap),
    batch: (stmts: unknown[]) => dbCall("batch", [stmts]).then(unwrap),
    begin: () => dbCall("begin", []).then(unwrap),
    commit: () => dbCall("commit", []).then(unwrap),
    rollback: () => dbCall("rollback", []).then(unwrap),
    open: (path: string) => dbCall("open", [path]).then(unwrap),
    close: () => dbCall("close", []).then(unwrap),
    backup: (reason: string) => dbCall("backup", [reason]).then(unwrap),
    info: () => dbCall("info", []).then(unwrap),
  };
  w.__helixDb = db;

  // What a test steers and reads back.
  const state = {
    appData: seed.appData,
    workspacesDir: seed.workspacesDir,
    /** Paths the next dialog open/save calls return, consumed in order. */
    dialogQueue: [] as (string | string[] | null)[],
    /** Answer for ask/confirm. */
    confirmAnswer: true,
    /** What leads_fetch returns next. */
    leads: { leads: [] as unknown[], nextCursor: null as string | null },
    /** Keychain stand-in: "<workspaceId>:<kind>" -> value. */
    secrets: {} as Record<string, string>,
    /** In-memory files for plugin:fs. */
    files: { ...(seed.files ?? {}) } as Record<string, string>,
    /** Everything the app opened through the OS opener. */
    opened: [] as string[],
    /** Every invoke, in order, for assertions. `path` is the resolved fs
     *  target (header-decoded when present, else `args.path`); for a
     *  non-fs command it is just `String(args?.path)`, harmless and unused. */
    calls: [] as { cmd: string; args: unknown; path: string }[],
  };
  w.__helixE2E = state;

  function nextDialog(): string | string[] | null {
    return state.dialogQueue.length ? (state.dialogQueue.shift() ?? null) : null;
  }

  // ---------------------------------------------------------------------
  // plugin:fs -- `state.files` is a flat `path -> text` map. There is no
  // real filesystem underneath it: a "directory" only exists because some
  // other file's path uses it as a prefix, split on `/` or `\`. That is
  // enough for `read_dir` to derive children, `stat`/`lstat`/`exists` to
  // tell a file from a directory, and `mkdir`/`create` to be no-ops (there
  // is nothing that needs to exist ahead of time).
  // ---------------------------------------------------------------------

  /** Tauri v2 sends a write's path as a request header, not an argument. */
  function resolvePath(args: unknown, options?: { headers?: Record<string, string> }): string {
    const headerPath = options?.headers?.path;
    if (typeof headerPath === "string") {
      try {
        return decodeURIComponent(headerPath);
      } catch {
        return headerPath;
      }
    }
    const a = args as Record<string, unknown> | null | undefined;
    return String(a?.path);
  }

  /** The payload for write_text_file/write_file: a Uint8Array, or that same
   *  data after crossing the shim as a plain array of byte numbers. */
  function decodeBytes(payload: unknown): string {
    if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
    if (Array.isArray(payload)) return new TextDecoder().decode(new Uint8Array(payload));
    if (payload && typeof payload === "object") {
      return new TextDecoder().decode(new Uint8Array(Object.values(payload as Record<string, number>)));
    }
    return String(payload ?? "");
  }

  function stripTrailingSep(p: string): string {
    return p.replace(/[\\/]+$/, "");
  }

  function isKnownFile(path: string): boolean {
    return Object.prototype.hasOwnProperty.call(state.files, path);
  }

  /** True when some file's path uses `dir` (plus a separator) as a prefix. */
  function isKnownDir(dirRaw: string): boolean {
    const dir = stripTrailingSep(dirRaw);
    return Object.keys(state.files).some((key) => childSegment(key, dir) !== null);
  }

  /** The first path segment of `key` under `dir`, or null when `key` is not under `dir`. */
  function childSegment(key: string, dir: string): string | null {
    if (!key.startsWith(dir)) return null;
    const rest = key.slice(dir.length);
    if (rest.length === 0) return null;
    const sep = rest[0];
    if (sep !== "/" && sep !== "\\") return null;
    return rest.slice(1);
  }

  type DirEntry = { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean };

  function listDir(dirRaw: string): DirEntry[] {
    const dir = stripTrailingSep(dirRaw);
    const seen = new Map<string, boolean>(); // name -> isDirectory
    for (const key of Object.keys(state.files)) {
      const rest = childSegment(key, dir);
      if (rest === null) continue;
      const sepIdx = rest.search(/[\\/]/);
      const isLeaf = sepIdx === -1;
      const name = isLeaf ? rest : rest.slice(0, sepIdx);
      seen.set(name, (seen.get(name) ?? false) || !isLeaf);
    }
    return Array.from(seen, ([name, isDirectory]) => ({
      name,
      isDirectory,
      isFile: !isDirectory,
      isSymlink: false,
    }));
  }

  function byteLength(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  function fileInfo(path: string) {
    const isFile = isKnownFile(path);
    const isDirectory = !isFile && isKnownDir(path);
    if (!isFile && !isDirectory) {
      throw new Error(`e2e: no such file or directory "${path}"`);
    }
    return {
      isFile,
      isDirectory,
      isSymlink: false,
      size: isFile ? byteLength(state.files[path]) : 0,
      mtime: null,
      atime: null,
      birthtime: null,
      readonly: false,
      fileAttributes: null,
      dev: null,
      ino: null,
      mode: null,
      nlink: null,
      uid: null,
      gid: null,
      rdev: null,
      blksize: null,
      blocks: null,
    };
  }

  async function invoke(
    cmd: string,
    args?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<unknown> {
    const path = resolvePath(args, options);
    state.calls.push({ cmd, args: args ?? null, path });
    const a = (args ?? {}) as Record<string, any>;

    // The database pipe, in case anything reaches for invoke directly.
    if (cmd.startsWith("db_")) {
      const method = cmd.slice(3);
      const map: Record<string, unknown[]> = {
        open: [a.path],
        close: [],
        query: [a.sql, a.params ?? []],
        execute: [a.sql, a.params ?? []],
        batch: [a.statements ?? []],
        begin: [],
        commit: [],
        rollback: [],
        backup: [a.reason ?? "manual"],
        info: [],
      };
      const value = await dbCall(method, map[method] ?? []).then(unwrap);
      // The commands return objects; the bridge returns the bare value.
      if (method === "query") return { rows: value };
      if (method === "execute" || method === "batch") return { changes: value };
      if (method === "open") return { path: a.path };
      if (method === "backup") {
        // The real backup lands on the real temp filesystem, not in
        // `state.files` (better-sqlite3's VACUUM INTO on the Node side has
        // no way to reach into this page's state). Registering the path
        // here with a placeholder is what lets `read_dir` over the backups
        // directory see it, so listBackups()/restore have something to work
        // with under this harness.
        state.files[String(value)] = "e2e-backup-placeholder";
        return { path: value };
      }
      return value ?? null;
    }

    switch (cmd) {
      // --- dialog ---------------------------------------------------------
      case "plugin:dialog|open":
      case "plugin:dialog|save":
        return nextDialog();
      case "plugin:dialog|ask":
      case "plugin:dialog|confirm":
        return state.confirmAnswer;
      case "plugin:dialog|message":
        return null;

      // --- fs ---------------------------------------------------------------
      case "plugin:fs|read_text_file":
      case "plugin:fs|readTextFile":
        // The plugin decodes bytes, not a string.
        return Array.from(new TextEncoder().encode(state.files[path] ?? ""));
      case "plugin:fs|write_text_file":
      case "plugin:fs|writeTextFile":
      case "plugin:fs|write_file":
      case "plugin:fs|writeFile":
        // The payload is the raw bytes (args itself), not `args.data`: the
        // path travels as a request header (see resolvePath above).
        state.files[path] = decodeBytes(args);
        return null;
      case "plugin:fs|exists":
        return isKnownFile(path) || isKnownDir(path);
      case "plugin:fs|mkdir":
      case "plugin:fs|create":
        return null;
      case "plugin:fs|remove": {
        const recursive = Boolean(a.options?.recursive);
        const existed = isKnownFile(path);
        if (existed) delete state.files[path];
        let removedNested = false;
        if (recursive) {
          const dir = path.replace(/[\\/]+$/, "");
          for (const key of Object.keys(state.files)) {
            if (childSegment(key, dir) !== null) {
              delete state.files[key];
              removedNested = true;
            }
          }
        }
        if (!existed && !removedNested) {
          return Promise.reject(new Error(`e2e: no such file or directory "${path}"`));
        }
        return null;
      }
      case "plugin:fs|copy_file": {
        const from = String(a.fromPath ?? "");
        const to = String(a.toPath ?? "");
        if (!isKnownFile(from)) {
          return Promise.reject(new Error(`e2e: copy_file source "${from}" does not exist`));
        }
        state.files[to] = state.files[from];
        return null;
      }
      case "plugin:fs|read_dir":
        return listDir(path);
      case "plugin:fs|stat":
      case "plugin:fs|lstat":
        return fileInfo(path);
      case "plugin:fs|size":
        return fileInfo(path).size;

      // --- opener -----------------------------------------------------------
      case "plugin:opener|open_url":
      case "plugin:opener|open_path":
        state.opened.push(String(a.url ?? a.path ?? ""));
        return null;

      // --- log --------------------------------------------------------------
      case "plugin:log|log":
        return null;

      // --- Helix's own commands ---------------------------------------------
      case "secret_set":
        state.secrets[`${a.workspaceId}:${a.kind}`] = String(a.value ?? "");
        return null;
      case "secret_get":
        return { value: state.secrets[`${a.workspaceId}:${a.kind}`] ?? null };
      case "secret_delete":
        delete state.secrets[`${a.workspaceId}:${a.kind}`];
        return null;
      case "leads_fetch":
        return state.leads;
      case "copy_in": {
        const src = String(a.src ?? "");
        const ext = src.includes(".") ? src.slice(src.lastIndexOf(".") + 1) : "bin";
        return { storedName: `e2e-${state.calls.length}.${ext}`, bytes: 1024, mime: "application/octet-stream" };
      }
      case "app_paths":
        return { appData: state.appData, workspacesDir: state.workspacesDir };

      default:
        // Anything unstubbed is a real gap, not a silent null.
        return Promise.reject(new Error(`e2e: no stub for Tauri command "${cmd}"`));
    }
  }

  // Tauri v2 talks to the webview through this object; @tauri-apps/api and
  // every plugin package go through invoke/transformCallback on it.
  const callbacks = new Map<number, (payload: unknown) => void>();
  let nextCallbackId = 1;

  w.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback: (payload: unknown) => void, once = false) {
      const id = nextCallbackId++;
      callbacks.set(id, (payload: unknown) => {
        if (once) callbacks.delete(id);
        callback(payload);
      });
      (w as Record<string, unknown>)[`_${id}`] = callbacks.get(id);
      return id;
    },
    convertFileSrc(path: string) {
      return `e2e-asset://${path}`;
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    plugins: {},
  };
  // Older aliases some packages still reach for.
  w.__TAURI_INVOKE__ = invoke;
  w.__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: "macos" };

  // Tells the app it is under the e2e harness, alongside VITE_E2E at build time.
  w.__HELIX_E2E__ = true;

  // The onboarding gate's stand-in for a settings row. Every spec here starts
  // from an empty workspace and its first goto("/") expects the shell, and the
  // gate fires on exactly that shape - so the harness answers "already skipped"
  // unless a spec says otherwise. It cannot be arranged as a real setting: the
  // `settings` table does not exist until the app runs its first migration,
  // which happens after the page has loaded. The app only reads this flag in the
  // VITE_E2E build (src/features/onboarding/gate.ts).
  w.__helixSkipOnboarding = seed.skipOnboarding !== false;
}

// ---------------------------------------------------------------------------
// The Playwright fixture
// ---------------------------------------------------------------------------

export type HelixHarness = {
  /** The temp workspace directory this test's database lives in. */
  workspaceDir: string;
  /** The database file path the app is told to open. */
  dbPath: string;
  /** Direct access to the same database, for arranging and asserting. */
  bridge: DbBridge;
};

export const test = base.extend<{
  /**
   * Whether the first-run setup flow may appear.
   *
   * "skip" (the default) makes the app behave as though the owner had already
   * taken "Skip for now", so a spec that starts from an empty workspace and
   * expects the shell keeps working. A spec about onboarding itself declares
   * `test.use({ onboarding: "show" })` and gets the gate.
   */
  onboarding: "skip" | "show";
  helix: HelixHarness;
}>({
  onboarding: ["skip", { option: true }],

  helix: async ({ page, onboarding }, use) => {
    const root = mkdtempSync(join(tmpdir(), "helix-e2e-"));
    const workspaceDir = join(root, "workspaces", "e2e-workspace");
    mkdirSync(join(workspaceDir, "attachments"), { recursive: true });
    const dbPath = join(workspaceDir, "helix.db");

    const bridge = new DbBridge(workspaceDir);

    const wrap = (fn: () => unknown): RpcResult => {
      try {
        return { ok: true, value: fn() ?? null };
      } catch (err) {
        const code = err instanceof BridgeError ? err.code : "SQL_ERROR";
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: { code, message } };
      }
    };

    await page.exposeFunction("__helixDbCall", (method: string, args: unknown[]): RpcResult =>
      wrap(() => bridge.call(method, args ?? [])),
    );
    // Reserved for stubs that need to reach the filesystem later; the shim
    // answers everything in the page today.
    await page.exposeFunction("__helixInvoke", (method: string, _args: unknown[]): RpcResult =>
      wrap(() => {
        throw new BridgeError("IO_ERROR", `No Node-side stub for "${method}".`);
      }),
    );

    // Pre-seed helix.json so the app opens THIS test's database instead of
    // creating a fresh workspace under a new id.
    const registry = {
      workspaces: [
        { id: "e2e-workspace", name: "E2E Workspace", path: dbPath, lastPolledAt: null, lastBackupAt: null, archived: false },
      ],
      lastOpened: "e2e-workspace",
      theme: "light",
      density: "comfortable",
    };
    await page.addInitScript(installShim, {
      appData: root,
      workspacesDir: join(root, "workspaces"),
      files: { [join(root, "helix.json")]: JSON.stringify(registry) },
      skipOnboarding: onboarding !== "show",
    });
    // The app opens its workspace itself, but tests that arrange rows before
    // the first paint need the file to exist.
    bridge.open(dbPath);

    await use({ workspaceDir, dbPath, bridge });

    bridge.close();
    rmSync(root, { recursive: true, force: true });
  },
});

export { expect };
