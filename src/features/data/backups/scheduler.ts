/**
 * The boot backup timer (docs/PLAN.md item 17).
 *
 *   startBackupScheduler()
 *     -> resolve lastBackupAt (settings table, else helix.json)
 *     -> shouldBackupOnBoot? run one ("boot")
 *     -> setTimeout chained on msUntilNextBackup, forever, until stopBackupScheduler()
 *
 * Sleep and wake (LR-OPS). A chained setTimeout does not run while the lid is
 * shut, so a laptop that sleeps for ten hours misses one or two beats. That
 * costs nothing here, and deliberately so: every delay is recomputed from
 * `lastBackupAt` rather than from a fixed cadence, so a tick that arrives late
 * finds `msUntilNextBackup` already at 0 and backs up immediately, and a launch
 * after a long sleep is handled by `shouldBackupOnBoot` before the timer is even
 * started. Nothing accumulates and nothing double-fires: `scheduleNext` clears
 * the previous timer before setting the next, and `tick` is only ever called by
 * that one timer. `tests/unit/data/retention.test.ts` pins both sums (a backup
 * seven hours old answers 0 ms; one fifty minutes old answers the remainder).
 *
 * Every tick checks timersPaused() first: an import or a restore holds the
 * write lock's timer pause, and a backup must never queue behind one - it
 * just skips that tick and checks again a minute later. A failed backup sets
 * the persistent `lastError` banner state and keeps the schedule alive; nothing
 * here ever throws out of the scheduler, because a broken backup must not take
 * the app down (this is a feature onBoot hook).
 */
import { timersPaused } from "@/db/writeLock";
import { readRegistry } from "@/app/appSettings";
import { get as getSetting } from "@/db/repos/settings";
import { workspacePaths } from "@/features/data/lib/workspace";
import { pruneBackups, runBackup } from "@/features/data/lib/backupsFs";
import {
  BACKUP_INTERVAL_MS,
  msUntilNextBackup,
  shouldBackupOnBoot,
} from "@/features/data/lib/retention";

export type BackupStatus = {
  lastBackupAt: string | null;
  lastError: string | null;
  running: boolean;
};

let status: BackupStatus = { lastBackupAt: null, lastError: null, running: false };

type Listener = () => void;
const listeners = new Set<Listener>();

function publish(): void {
  for (const listener of listeners) listener();
}

export function subscribeBackupStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getBackupStatus(): BackupStatus {
  return status;
}

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Never tick faster than this, whatever the arithmetic says. */
const MIN_TICK_MS = 60_000;
/** After a failure there is no lastBackupAt to count from: wait, then retry. */
const RETRY_AFTER_ERROR_MS = 5 * 60_000;

/**
 * The delay to the next tick. `msUntilNextBackup` answers 0 when there is no
 * last backup to count from, which is exactly the state a failed backup
 * leaves behind - so on a disk-full machine the bare arithmetic would spin.
 */
function nextDelay(): number {
  const scheduled = msUntilNextBackup(status.lastBackupAt, new Date());
  if (status.lastError !== null) return Math.max(scheduled, RETRY_AFTER_ERROR_MS);
  return Math.max(scheduled, status.lastBackupAt === null ? MIN_TICK_MS : 0);
}

function scheduleNext(delayMs: number): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    void tick();
  }, delayMs);
}

/** settings table first (authoritative for the open workspace), then the helix.json mirror. */
async function resolveLastBackupAt(): Promise<string | null> {
  try {
    const fromSettings = await getSetting("lastBackupAt");
    if (fromSettings) return fromSettings;
  } catch {
    // fall through to the registry mirror below
  }
  try {
    const { workspaceId } = await workspacePaths();
    if (!workspaceId) return null;
    const registry = await readRegistry();
    return registry.workspaces.find((w) => w.id === workspaceId)?.lastBackupAt ?? null;
  } catch {
    return null;
  }
}

async function runOneBackup(reason: string): Promise<void> {
  try {
    const file = await runBackup(reason);
    status = { lastBackupAt: file.at, lastError: null, running: false };
    publish();
    try {
      await pruneBackups();
    } catch (err) {
      console.error("[helix] backup pruning failed", err);
    }
  } catch (err) {
    status = {
      ...status,
      lastError: err instanceof Error ? err.message : String(err),
      running: false,
    };
    publish();
  }
}

async function tick(): Promise<void> {
  if (!started) return;
  try {
    if (timersPaused()) {
      // An import or a restore is running: never queue a backup behind a
      // write. Check back in a minute instead of waiting a full interval.
      scheduleNext(MIN_TICK_MS);
      return;
    }
    status = { ...status, running: true };
    publish();
    await runOneBackup("scheduled");
  } catch (err) {
    console.error("[helix] backup tick failed", err);
    status = { ...status, running: false };
    publish();
  }
  if (started) {
    scheduleNext(nextDelay());
  }
}

/** Idempotent; safe to call twice (a second call is a no-op). */
export async function startBackupScheduler(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const lastBackupAt = await resolveLastBackupAt();
    status = { ...status, lastBackupAt };

    if (shouldBackupOnBoot(lastBackupAt, new Date()) && !timersPaused()) {
      status = { ...status, running: true };
      publish();
      await runOneBackup("boot");
    }
  } catch (err) {
    console.error("[helix] backup scheduler failed to resolve boot state", err);
  }

  if (!started) return; // stopBackupScheduler() may have run while we awaited above
  scheduleNext(timersPaused() ? MIN_TICK_MS : nextDelay());
}

export function stopBackupScheduler(): void {
  started = false;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

// BACKUP_INTERVAL_MS is re-exported for callers that display "every 6 hours"
// without importing retention.ts directly.
export { BACKUP_INTERVAL_MS };
