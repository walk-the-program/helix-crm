/**
 * The 30-day trash sweep (CPO finding F-LC-3, ruling R14).
 *
 * The Trash screen has always said "Deleted records stay here for 30 days,
 * then Helix removes them for good", and every row has carried a "Purges on"
 * date. Nothing performed it. `trash.expired()` existed and had no callers
 * anywhere in the product, so a workspace grew forever and the date on every
 * row was fiction — a screen stating a policy the code did not run.
 *
 * This is that policy. It runs once after boot and then every 24 hours while
 * the app is open, which is the same shape the backup timer and the duplicate
 * scan already use, and for the same reason: there is no server, so "while the
 * app is open" is the only time anything can happen.
 *
 * Three rules it inherits from its neighbours:
 *
 * 1. **Never fatal.** It is a feature `onBoot` hook. A sweep that throws would
 *    take the app's first paint with it, and nothing the owner is doing
 *    depends on a purge having happened this minute.
 * 2. **Never competes for the write lock.** `timersPaused()` is held during an
 *    import or a restore; the sweep skips that tick and looks again in a
 *    minute rather than queueing a few hundred deletes behind a restore.
 * 3. **Files before rows.** `trash.purge()` deletes the attachment ROWS and
 *    says in its own docstring that the files on disk are the caller's job and
 *    must be gone first. Nobody was that caller, so purging an attachment left
 *    its file in the workspace folder forever. This asks the filesystem first,
 *    and only then lets the row go — and if the file cannot be removed the row
 *    still goes, because a file we failed to delete is untidy while a row that
 *    will not die is a screen the owner cannot clear.
 *
 * What it deliberately does not do: decide what is expired. `trash.expired()`
 * owns the cutoff and owns the one exception to it — a deal with a sent or
 * paid document is never handed over, because purging it would cut a real
 * piece of paper loose (ruling R6b) — so this file never has to know that rule
 * exists.
 */
import { timersPaused } from "@/db/writeLock";
import { queryClient } from "@/app/queryClient";
import * as trash from "@/db/repos/trash";
import { newBatchId } from "@/lib/ids";
import { joinPath, removePath } from "@/features/data/lib/fsBridge";
import { workspacePaths } from "@/features/data/lib/workspace";

/** Once a day, like the duplicate scan. */
export const PURGE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** How long to wait before looking again when a write is in progress. */
const RETRY_WHILE_BUSY_MS = 60_000;

export type SweepResult = {
  /** Rows hard-deleted. */
  purged: number;
  /** Attachment files removed from the workspace folder. */
  filesRemoved: number;
  /** Rows `expired()` offered that could not be purged, with the reason. */
  failed: { entityType: string; entityId: string; reason: string }[];
};

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let lastResult: SweepResult = { purged: 0, filesRemoved: 0, failed: [] };

/** What the last sweep did. Read by Diagnostics; nothing else depends on it. */
export function lastSweepResult(): SweepResult {
  return lastResult;
}

/**
 * Purge everything past the cutoff, once.
 *
 * Exported for the tests and for a future "empty the trash now" button; the
 * timer below is the only caller in the product today.
 */
export async function sweepExpiredTrash(): Promise<SweepResult> {
  const result: SweepResult = { purged: 0, filesRemoved: 0, failed: [] };
  const rows = await trash.expired();
  if (rows.length === 0) {
    lastResult = result;
    return result;
  }

  const batchId = newBatchId();
  let attachmentsDir: string | null = null;

  for (const row of rows) {
    try {
      // The files first: `purge` takes the rows that name them.
      const files = await trash.attachmentFilesFor(row.entityType, row.entityId);
      if (files.length > 0) {
        if (attachmentsDir === null) {
          attachmentsDir = (await workspacePaths()).attachmentsDir;
        }
        for (const file of files) {
          try {
            await removePath(joinPath(attachmentsDir, file.storedName));
            result.filesRemoved += 1;
          } catch (err) {
            // Already gone, or the folder moved. The row still goes: a file we
            // could not delete is untidy, a row that will not die is a screen
            // the owner cannot clear.
            console.warn(`[helix] purge: could not remove ${file.storedName}`, err);
          }
        }
      }

      await trash.purge(row.entityType, row.entityId, { batchId });
      result.purged += 1;
    } catch (err) {
      result.failed.push({
        entityType: row.entityType,
        entityId: row.entityId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.purged > 0) {
    // The Trash screen, and anything counting what is in it.
    await queryClient.invalidateQueries({ queryKey: ["trash"] });
  }

  console.info(
    `[helix] purge: removed ${result.purged} record(s) past 30 days` +
      (result.filesRemoved > 0 ? `, ${result.filesRemoved} file(s)` : "") +
      (result.failed.length > 0 ? `, ${result.failed.length} could not be removed` : ""),
  );

  lastResult = result;
  return result;
}

function schedule(delay: number): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    void tick();
  }, delay);
}

async function tick(): Promise<void> {
  if (timersPaused()) {
    schedule(RETRY_WHILE_BUSY_MS);
    return;
  }
  try {
    await sweepExpiredTrash();
  } catch (err) {
    // A failed sweep is not worth a banner: nothing the owner does depends on
    // it, and the next one is a day away.
    console.warn("[helix] purge sweep failed", err);
  }
  schedule(PURGE_SWEEP_INTERVAL_MS);
}

/** Idempotent: calling it twice does not create a second timer. */
export async function startPurgeSweep(): Promise<void> {
  if (started) return;
  started = true;
  await tick();
}

export function stopPurgeSweep(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  started = false;
}
