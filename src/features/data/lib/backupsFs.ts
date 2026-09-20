/**
 * Backup listing, running, pruning and restoring (docs/PLAN.md item 17).
 *
 *   listBackups -----> backupsDir on disk, parsed through retention.ts
 *   runBackup -------> raw.backup() -> mirrors lastBackupAt (helix.json + settings table)
 *   pruneBackups ----> retention.planRetention() -> deletes the dropped files
 *   restoreFromBackup > pause timers, back up today, close, copy, reopen, re-migrate
 *
 * Every filesystem touch goes through fsBridge; every path is derived from
 * workspace.ts. Nothing here invents a write path itself.
 */
import { raw } from "@/db/client";
import { pauseTimers } from "@/db/writeLock";
import { readRegistry, touchWorkspace } from "@/app/appSettings";
import { openWorkspace } from "@/app/boot";
import * as settingsRepo from "@/db/repos/settings";
import { nowIso } from "@/lib/dates";
import {
  basenameOf,
  copyFileTo,
  fileSize,
  joinPath,
  readDirEntries,
  removePath,
} from "@/features/data/lib/fsBridge";
import { workspacePaths } from "@/features/data/lib/workspace";
import {
  parseBackupName,
  planRetention,
  totalBytes,
  type BackupFile,
} from "@/features/data/lib/retention";

export type { BackupFile };

/* -------------------------------------------------------------------------- */
/* the second copy                                                            */
/* -------------------------------------------------------------------------- */

export type MirrorResult = {
  path: string;
  copied: number;
  removed: number;
  /** Files that could not be copied, already formatted as "<name>: <reason>". */
  failed: string[];
};

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Copy this workspace's backups into the folder the owner chose.
 *
 * Rust derives the source from the open database and makes the destination
 * match it, so the thirty-day retention the app already applies is the only
 * retention rule there is (`src-tauri/src/backups.rs`).
 */
export async function mirrorBackups(destDir: string): Promise<MirrorResult> {
  const core = await import("@tauri-apps/api/core");
  return (core.invoke as InvokeFn)<MirrorResult>("backup_mirror", { destDir });
}

/** The chosen folder, or null. Read on the Backups screen and after a backup. */
export async function backupCopyDir(): Promise<string | null> {
  try {
    return await settingsRepo.get("backupCopyDir");
  } catch {
    return null;
  }
}

export async function setBackupCopyDir(dir: string | null): Promise<void> {
  await settingsRepo.set("backupCopyDir", dir);
}

export class BackupWriteError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "BackupWriteError";
    this.cause = cause;
  }
}

/**
 * The readable text out of whatever a rejected `invoke()` carries.
 *
 * Tauri v2 rejects a command with a plain `{ code, message }` object, not an
 * `Error`, so `String(err)` on the shape this module sees most - a refused
 * `db_backup` or `backup_mirror` - gives "[object Object]". The banner on the
 * Backups screen was showing "Helix could not save a backup: [object Object]"
 * for every real backup failure, which is the same trap the lead poller fell
 * into (F-LB-6) and was found again here by the copy-out tests.
 */
function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(err);
}

/** Newest first. A missing backups directory reads as an empty list, not an error. */
export async function listBackups(): Promise<BackupFile[]> {
  const { backupsDir } = await workspacePaths();
  const entries = await readDirEntries(backupsDir);

  const files: BackupFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile) continue;
    const parsed = parseBackupName(entry.name);
    if (!parsed) continue; // in-progress .db.tmp writes, or anything else in the folder
    const path = joinPath(backupsDir, entry.name);
    const bytes = (await fileSize(path)) ?? 0;
    files.push({ name: entry.name, path, at: parsed.at, reason: parsed.reason, bytes });
  }

  files.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return files;
}

/**
 * Runs a backup on the second, read-only connection (VACUUM INTO + rename,
 * per docs/CONTRACTS.md), then mirrors `lastBackupAt` into both places a
 * closed workspace or a fresh boot needs to read it from: helix.json (via
 * touchWorkspace) and the workspace's own `settings` table.
 */
export async function runBackup(reason: string): Promise<BackupFile> {
  let path: string;
  try {
    path = await raw.backup(reason);
  } catch (err) {
    throw new BackupWriteError(
      `Helix could not save a backup: ${reasonOf(err)}`,
      err,
    );
  }

  const name = basenameOf(path);
  const parsed = parseBackupName(name);
  const at = parsed?.at ?? nowIso();
  const bytes = (await fileSize(path)) ?? 0;
  const file: BackupFile = {
    name,
    path,
    at,
    reason: parsed?.reason ?? reason,
    bytes,
  };

  // Bookkeeping only: the backup file itself already exists on disk, so a
  // failure here must never be reported to the caller as a failed backup.
  try {
    const { workspaceId } = await workspacePaths();
    if (workspaceId) {
      await touchWorkspace(workspaceId, { lastBackupAt: at });
    }
  } catch (err) {
    console.error("[helix] could not mirror lastBackupAt into helix.json", err);
  }
  try {
    await settingsRepo.set("lastBackupAt", at);
  } catch (err) {
    console.error("[helix] could not mirror lastBackupAt into settings", err);
  }

  // The second copy, when the owner has asked for one. It runs after the backup
  // rather than as part of it, and its failure is reported separately: a
  // detached drive or a signed-out sync folder must not turn a backup that
  // succeeded into a backup that failed. `lastMirrorError` is what the Backups
  // screen shows so the owner is still told.
  await copyOutIfConfigured();

  return file;
}

let lastMirror: { at: string; result: MirrorResult } | null = null;
let lastMirrorError: string | null = null;

/** What the last copy-out did, for the Backups screen. */
export function lastMirrorState(): {
  at: string | null;
  result: MirrorResult | null;
  error: string | null;
} {
  return { at: lastMirror?.at ?? null, result: lastMirror?.result ?? null, error: lastMirrorError };
}

/** Test seam: the module-level record of the last copy-out. */
export function resetMirrorStateForTests(): void {
  lastMirror = null;
  lastMirrorError = null;
}

export async function copyOutIfConfigured(): Promise<MirrorResult | null> {
  const dir = await backupCopyDir();
  if (!dir) return null;
  try {
    const result = await mirrorBackups(dir);
    lastMirror = { at: nowIso(), result };
    lastMirrorError =
      result.failed.length > 0
        ? `${result.failed.length} file(s) could not be copied to ${result.path}.`
        : null;
    return result;
  } catch (err) {
    lastMirrorError = `Helix could not copy your backups to ${dir}: ${reasonOf(err)}`;
    console.error("[helix] backup copy-out failed", err);
    return null;
  }
}

/**
 * The backup an import is undone with.
 *
 * `importRun.ts` has always said, in a comment, that "undo for an import is
 * restore the backup, not walk the log": it writes ONE `change_log` row for a
 * whole file rather than one per contact, because a hundred thousand of them
 * would double the work. That reasoning is sound and the backup it points at
 * did not exist. An import that updates existing contacts - which it does,
 * happily, on a dedupe match - overwrote real data with nothing behind it but
 * the last scheduled backup, which can be six hours old (LR-OPS, F-OPS-4).
 *
 * So the same rule the migrator already follows: take the backup first, and if
 * it cannot be taken, do not start. `migrate()` refuses on exactly this
 * reasoning, and an import is the other operation in this product that rewrites
 * a lot of rows at once.
 */
export async function backupBeforeImport(): Promise<BackupFile> {
  try {
    return await runBackup("pre-import");
  } catch (err) {
    throw new BackupWriteError(
      "Helix could not back up your data before the import, so the import was " +
        `not started. Nothing has been changed. ${reasonOf(err)}`,
      err,
    );
  }
}

/**
 * True from the moment a restore starts until it has finished, win or lose.
 *
 * `pauseTimers()` stops a NEW scheduler tick from starting; it does nothing to
 * one that checked a moment earlier and is already running. That tick finishes
 * its backup and then calls `pruneBackups`, which deletes whatever retention
 * has dropped - and if the file the owner chose to restore is the oldest one
 * past the window, it can be deleted while `restoreFromBackup` is copying from
 * it (found by LR-OPS-W2 as B4). The Rust `backup_guard` serialises the two
 * database operations correctly; nothing coordinated the two pieces of code
 * that touch the backups FOLDER. This does.
 *
 * A prune skipped is a few stale files kept until the next backup six hours
 * later, which costs nothing. A prune that races a restore costs the restore.
 */
let restoring = false;

/** Test seam: the module-level restore flag. */
export function resetRestoreStateForTests(): void {
  restoring = false;
}

/** Applies planRetention() to what's on disk and removes the dropped files. */
export async function pruneBackups(
  now: Date = new Date(),
): Promise<{ deleted: number; keptBytes: number }> {
  if (restoring) {
    console.info("[helix] prune skipped: a restore is reading from the backups folder");
    return { deleted: 0, keptBytes: 0 };
  }
  const files = await listBackups();
  const { keep, drop } = planRetention(files, now);

  let deleted = 0;
  for (const file of drop) {
    try {
      await removePath(file.path);
      deleted += 1;
    } catch (err) {
      // A file already gone (or briefly locked by the backup connection) must
      // not stop the rest of the prune from running.
      console.error(`[helix] could not delete backup ${file.name}`, err);
    }
  }

  return { deleted, keptBytes: totalBytes(keep) };
}

/**
 * Restore over live data (docs/PLAN.md "Restore over live data"). Exact order:
 *   1. pause the background timers (resumed in `finally`, whatever happens)
 *   2. back up today's file first (`pre-restore`)
 *   3. close the database (checkpoints, drops -wal/-shm)
 *   4. copy the chosen backup into place
 *   5. reopen it
 *   6. re-run the boot path so migrations and the query cache re-run
 *
 * A backup that starts while this is running (LR-OPS). Three things stop them
 * colliding, and they are worth naming because the failure would be silent:
 * `pauseTimers()` makes the scheduler skip its tick rather than queue; the
 * screen covers itself while a restore is in flight, so "Back up now" cannot be
 * pressed; and if one were somehow already in flight, `db_close` takes the Rust
 * `backup_guard` before it closes, so the close waits for the VACUUM INTO to
 * finish and the file copy below can never land under a reader. Lock order is
 * always backup_guard -> state (see the header of `src-tauri/src/db.rs`).
 *
 * `dbPath` and the workspace id are captured *before* closing: once the
 * database is closed, raw.info() (which workspacePaths() calls) has nothing
 * to ask. If anything after step 3 throws, the database may be left closed;
 * this rethrows so the screen can tell the owner to restart Helix rather than
 * pretending the restore succeeded.
 */
export async function restoreFromBackup(file: BackupFile): Promise<void> {
  const { dbPath, workspaceId } = await workspacePaths();

  const resume = pauseTimers();
  // Set before anything else and cleared in the same `finally` as the timers:
  // an in-flight scheduler tick that already passed its own `timersPaused()`
  // check will still call `pruneBackups` when its backup finishes, and the
  // file it is allowed to delete may be the very one being copied below.
  restoring = true;
  try {
    await raw.backup("pre-restore");
    await raw.close();
    await copyFileTo(file.path, dbPath);
    await raw.open(dbPath);

    const registry = await readRegistry();
    const entry = registry.workspaces.find((w) => w.id === workspaceId);
    if (entry) {
      await openWorkspace(entry);
    } else {
      // No registry entry matches this workspace (id could not be resolved,
      // or the entry was removed underneath us): there is no WorkspaceEntry
      // to hand openWorkspace, so fall back to a full reload, which re-derives
      // everything - including a fresh registry read - from scratch.
      window.location.reload();
    }
  } finally {
    restoring = false;
    resume();
  }
}
