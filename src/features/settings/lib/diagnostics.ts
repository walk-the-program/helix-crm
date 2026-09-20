/**
 * What Diagnostics reads (PLAN.md "Observability").
 *
 * Every one of these can be missing: under the e2e harness there is no Tauri
 * runtime, on a fresh workspace there is no poll and no backup, and a machine
 * with no keychain answers nothing at all. Each reader therefore returns a
 * value or a reason, never a thrown error, so the screen always renders.
 *
 * Two of them are about encryption and read differently from the rest
 * (docs/CONTRACTS.md "Encryption at rest"):
 *
 *   - `db.encrypted` / `db.cipherVersion` come from `db_info()` and are
 *     OPTIONAL, because the e2e bridge and the unit-test driver are plain
 *     better-sqlite3 with no cipher. Absent means "this build cannot tell",
 *     which the screen shows as Unknown - never as "not encrypted".
 *   - `diskEncryption` is a separate Rust command that asks the OS about
 *     FileVault or BitLocker. It never throws and its `encrypted` is `null`
 *     when the check could not run, which is not the same as "off".
 */
import { version as APP_VERSION } from "../../../../package.json";
import { raw, type DbInfo } from "@/db/client";
import { appPaths, readRegistry, isTauri } from "@/app/appSettings";
import * as settingsRepo from "@/db/repos/settings";
import * as leadSync from "@/db/repos/leadSync";
import { migrationVersion } from "@/features/settings/lib/counts";
import { keychainAvailable } from "@/features/ai/lib/secrets";
import { formatDateTimeDisplay } from "@/lib/dates";

export { APP_VERSION };

/** What `disk_encryption_status` answers. It never fails, so there is no error. */
export type DiskEncryption = {
  platform: string;
  /** null means the check could not run or could not be read - not "off". */
  encrypted: boolean | null;
  detail: string;
};

export type Diagnostics = {
  appVersion: string;
  db: DbInfo | null;
  dbError: string | null;
  diskEncryption: DiskEncryption | null;
  appData: string | null;
  workspacesDir: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  migration: { version: string; appliedAt: string; count: number } | null;
  lastBackupAt: string | null;
  siteOrigin: string | null;
  lastPolledAt: string | null;
  lastPollError: string | null;
  keychain: boolean;
  logPath: string | null;
};

/**
 * The readable text out of whatever was thrown or rejected.
 *
 * Tauri v2 rejects a command with a plain `{ code, message }` object, not an
 * `Error` - the trap `src/features/leads/poller.ts` and
 * `src/features/data/lib/backupsFs.ts` already name and fix (F-LB-6):
 * `err instanceof Error` is false for that shape, and `String(err)` on a
 * plain object gives "[object Object]", which `raw.info()` (a `db_info`
 * `invoke()` call) could put straight onto this screen as the reason the
 * database size is unknown - the exact bare-exception-text this screen's own
 * design exists to prevent.
 */
function reason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(err);
}

/**
 * Whether the OS's own full-disk encryption is switched on.
 *
 * The Rust side returns the struct directly rather than a Result, so it can
 * never fail the app - but it is only there in the desktop build, and under the
 * e2e harness it is a stub. Outside Tauri, and on any refusal, this answers
 * null and the screen says it could not check.
 */
export async function readDiskEncryption(): Promise<DiskEncryption | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<DiskEncryption>("disk_encryption_status");
    if (!status || typeof status !== "object") return null;
    return {
      platform: typeof status.platform === "string" ? status.platform : "",
      encrypted: typeof status.encrypted === "boolean" ? status.encrypted : null,
      detail: typeof status.detail === "string" ? status.detail : "",
    };
  } catch {
    return null;
  }
}

/** <appData>/logs/helix.log: where src-tauri/src/lib.rs points the log plugin. */
export async function logFilePath(): Promise<string | null> {
  try {
    const paths = await appPaths();
    return `${paths.appData}/logs/helix.log`;
  } catch {
    return null;
  }
}

export async function readDiagnostics(): Promise<Diagnostics> {
  const result: Diagnostics = {
    appVersion: APP_VERSION,
    db: null,
    dbError: null,
    diskEncryption: null,
    appData: null,
    workspacesDir: null,
    workspaceId: null,
    workspaceName: null,
    migration: null,
    lastBackupAt: null,
    siteOrigin: null,
    lastPolledAt: null,
    lastPollError: null,
    keychain: false,
    logPath: await logFilePath(),
  };

  try {
    result.db = await raw.info();
  } catch (err) {
    result.dbError = reason(err);
  }

  result.diskEncryption = await readDiskEncryption();

  try {
    const paths = await appPaths();
    result.appData = paths.appData;
    result.workspacesDir = paths.workspacesDir;
  } catch {
    // Outside Tauri appPaths answers with placeholders, so this is rare.
  }

  try {
    const registry = await readRegistry();
    const open =
      registry.workspaces.find((w) => w.id === registry.lastOpened) ??
      registry.workspaces[0] ??
      null;
    result.workspaceId = open?.id ?? null;
    result.workspaceName = open?.name ?? null;
    result.lastBackupAt = open?.lastBackupAt ?? null;
  } catch {
    // A missing or corrupt helix.json reads as an empty registry upstream.
  }

  try {
    result.migration = await migrationVersion();
  } catch {
    result.migration = null;
  }

  try {
    const origin = await settingsRepo.get("siteOrigin");
    result.siteOrigin = origin;
    if (origin) {
      const row = await leadSync.get(origin);
      result.lastPolledAt = row?.lastPolledAt ?? null;
      result.lastPollError = row?.lastError ?? null;
    }
  } catch {
    // No site connected yet, or the table is empty.
  }

  if (result.workspaceId) {
    result.keychain = await keychainAvailable(result.workspaceId);
  }

  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/* -------------------------------------------------------------------------- */
/* the two buttons                                                            */
/* -------------------------------------------------------------------------- */

export type ActionResult = { ok: true } | { ok: false; reason: string };

/** The log file's text, or why it could not be read. Never throws. */
export async function readLog(): Promise<
  { ok: true; text: string; path: string } | { ok: false; reason: string }
> {
  const path = await logFilePath();
  if (!path) return { ok: false, reason: "The app data folder is not known yet." };
  if (!isTauri()) {
    return {
      ok: false,
      reason: "The log file only exists in the desktop app.",
    };
  }
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    if (!(await fs.exists(path))) {
      return { ok: false, reason: `Nothing has been logged yet (${path}).` };
    }
    return { ok: true, text: await fs.readTextFile(path), path };
  } catch (err) {
    return { ok: false, reason: `${path} could not be read: ${reason(err)}` };
  }
}

export async function copyLog(): Promise<ActionResult> {
  const result = await readLog();
  if (!result.ok) return { ok: false, reason: result.reason };
  try {
    await navigator.clipboard.writeText(result.text);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `The clipboard refused it: ${reason(err)}` };
  }
}

/** Show the workspace folder in Finder or Explorer. */
export async function revealDataFolder(path: string | null): Promise<ActionResult> {
  if (!path) return { ok: false, reason: "The data folder is not known yet." };
  if (!isTauri()) {
    return { ok: false, reason: "Opening a folder only works in the desktop app." };
  }
  try {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.revealItemInDir(path);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: reason(err) };
  }
}

/* -------------------------------------------------------------------------- */
/* "Copy details": one plain-text block, for Walker (LR-CS-W3, PIECE 3)      */
/* -------------------------------------------------------------------------- */

/**
 * What the OS calls itself, from the same `disk_encryption_status` reading
 * the Encryption group already shows - never guessed, and "Unknown" when the
 * platform was never read (outside Tauri, or the check refused to run).
 */
function operatingSystemName(diskEncryption: DiskEncryption | null): string {
  if (diskEncryption?.platform === "macos") return "macOS";
  if (diskEncryption?.platform === "windows") return "Windows";
  if (diskEncryption?.platform) return diskEncryption.platform;
  return "Unknown";
}

/**
 * Whether Helix encrypted its own workspace file, in the one line this block
 * carries - the same Unknown-vs-off distinction `WorkspaceEncryption` in
 * DiagnosticsScreen.tsx draws, so this block never claims more than the
 * screen already does. `db.encrypted` absent means "this build cannot tell",
 * never "not encrypted" (docs/CONTRACTS.md "Encryption at rest").
 */
function workspaceFileEncryptionLine(db: DbInfo | null): string {
  if (!db || db.encrypted === undefined) return "Unknown (this build cannot tell)";
  if (db.encrypted === false) return "Not encrypted";
  return db.cipherVersion ? `Encrypted (SQLCipher ${db.cipherVersion})` : "Encrypted";
}

/**
 * The OS's own full-disk encryption, in one line. `encrypted: null` means the
 * check could not run, which this line calls Unknown rather than off - the
 * same distinction `DiskEncryptionValue` draws on screen.
 */
function diskEncryptionLine(status: DiskEncryption | null): string {
  if (!status || status.encrypted === null) {
    const detail = status?.detail;
    return detail ? `Unknown (could not check - ${detail})` : "Unknown (could not check)";
  }
  const name =
    status.platform === "macos" ? "FileVault" : status.platform === "windows" ? "BitLocker" : "Full-disk encryption";
  if (status.encrypted) return status.detail || `${name} is on.`;
  return status.detail || `${name} is off.`;
}

/**
 * "connected" / "failing" from the same two fields the Website leads group
 * already reads: a site is only ever failing when its last poll actually
 * recorded an error, never guessed from silence (`leadSync.saveCursor`
 * clears `lastError` on every success, `saveError` sets it - src/db/repos/
 * leadSync.ts).
 */
function websiteConnectionLine(data: Diagnostics): string {
  if (!data.siteOrigin) return "No site connected";
  const state = data.lastPollError ? "failing" : "connected";
  const lastChecked = data.lastPolledAt ? formatDateTimeDisplay(data.lastPolledAt) : "never";
  return `${data.siteOrigin} - ${state}, last checked ${lastChecked}`;
}

/**
 * One plain-text, paste-anywhere block: exactly what Walker needs to start
 * looking into a client's Helix, and nothing else. Every field here is one
 * this module already reads for the screen itself - no customer record,
 * recovery key, token or API key is ever in reach of this function, because
 * `Diagnostics` does not carry one (SEC/OPS/REV already drew that line; this
 * only formats what is already here). `tests/unit/settings/
 * supportBlock.test.ts` proves the absence against a workspace that actually
 * has contacts, companies and notes in it.
 *
 * `userAgent` is the one piece of "OS version, if cheaply available" this
 * build has without a new dependency or a network call (PLAN.md's own
 * observability note): the desktop webview's user agent string usually
 * carries the OS version the platform name alone does not.
 */
export function buildSupportDetails(
  data: Diagnostics,
  options: { userAgent?: string } = {},
): string {
  const userAgent =
    options.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const lines = [
    "Helix support details",
    "",
    `Helix version: ${data.appVersion}`,
    `Operating system: ${operatingSystemName(data.diskEncryption)}${
      userAgent ? ` (${userAgent})` : ""
    }`,
    `Workspace: ${data.workspaceId ?? "Unknown"}`,
    `Workspace file: ${workspaceFileEncryptionLine(data.db)}`,
    `Disk encryption: ${diskEncryptionLine(data.diskEncryption)}`,
    `Last backup: ${
      data.lastBackupAt ? formatDateTimeDisplay(data.lastBackupAt) : "No backup has run yet"
    }`,
    `Website: ${websiteConnectionLine(data)}`,
    `Last error: ${data.lastPollError ?? "None"}`,
  ];
  return lines.join("\n");
}

/** Put the block on the clipboard. Never throws. */
export async function copySupportDetails(data: Diagnostics): Promise<ActionResult> {
  try {
    await navigator.clipboard.writeText(buildSupportDetails(data));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `The clipboard refused it: ${reason(err)}` };
  }
}
