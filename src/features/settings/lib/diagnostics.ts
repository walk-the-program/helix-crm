/**
 * What Diagnostics reads (PLAN.md "Observability").
 *
 * Every one of these can be missing: under the e2e harness there is no Tauri
 * runtime, on a fresh workspace there is no poll and no backup, and a machine
 * with no keychain answers nothing at all. Each reader therefore returns a
 * value or a reason, never a thrown error, so the screen always renders.
 */
import { version as APP_VERSION } from "../../../../package.json";
import { raw, type DbInfo } from "@/db/client";
import { appPaths, readRegistry, isTauri } from "@/app/appSettings";
import * as settingsRepo from "@/db/repos/settings";
import * as leadSync from "@/db/repos/leadSync";
import { migrationVersion } from "@/features/settings/lib/counts";
import { keychainAvailable } from "@/features/ai/lib/secrets";

export { APP_VERSION };

export type Diagnostics = {
  appVersion: string;
  db: DbInfo | null;
  dbError: string | null;
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

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
