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

export class BackupWriteError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "BackupWriteError";
    this.cause = cause;
  }
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
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

  return file;
}

/** Applies planRetention() to what's on disk and removes the dropped files. */
export async function pruneBackups(
  now: Date = new Date(),
): Promise<{ deleted: number; keptBytes: number }> {
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
 * `dbPath` and the workspace id are captured *before* closing: once the
 * database is closed, raw.info() (which workspacePaths() calls) has nothing
 * to ask. If anything after step 3 throws, the database may be left closed;
 * this rethrows so the screen can tell the owner to restart Helix rather than
 * pretending the restore succeeded.
 */
export async function restoreFromBackup(file: BackupFile): Promise<void> {
  const { dbPath, workspaceId } = await workspacePaths();

  const resume = pauseTimers();
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
    resume();
  }
}
