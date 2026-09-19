/**
 * The write lock.
 *
 *   write A ---> [lock] ---> run ---> release
 *   write B ------^ queued (UI shows "queued behind the import")
 *
 * One SQLite connection serialises every caller in Rust, so nobody ever sees
 * SQLITE_BUSY. What the lock adds is ordering on the JS side: a long
 * transaction (import, merge, restore) must not have a stray quick-add land in
 * the middle of it, and the background timers (backup, lead poll, duplicate
 * scan) must pause while it runs.
 */
import { raw } from "@/db/client";

type Resolver = () => void;

const queue: Resolver[] = [];
let held = false;

/** Observable state for the UI: "Saved, queued behind the import". */
export const writeState: {
  busy: boolean;
  label: string | null;
  queued: number;
} = {
  busy: false,
  label: null,
  queued: 0,
};

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to writeState changes (useSyncExternalStore-friendly). */
export function subscribeWriteState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let snapshot = { busy: false, label: null as string | null, queued: 0 };

/** Immutable snapshot for useSyncExternalStore. */
export function getWriteStateSnapshot(): {
  busy: boolean;
  label: string | null;
  queued: number;
} {
  return snapshot;
}

function publish(): void {
  snapshot = {
    busy: writeState.busy,
    label: writeState.label,
    queued: writeState.queued,
  };
  for (const listener of listeners) listener();
}

/**
 * The lock is NOT reentrant. A repository write must never call another
 * repository's write function: the inner call would queue behind the outer one
 * and both would wait forever. Compose writes by building statements and
 * sending them in one raw.batch, or by wrapping the whole thing in a single
 * withTransaction. This warning turns that mistake from a silent hang into a
 * line in the console that names the write holding the lock.
 */
const STUCK_AFTER_MS = 10_000;

async function acquire(label: string | null): Promise<void> {
  if (held) {
    writeState.queued += 1;
    publish();
    const holder = writeState.label;
    const stuck = setTimeout(() => {
      console.warn(
        `[helix] "${label ?? "a write"}" has waited ${STUCK_AFTER_MS / 1000}s behind "${
          holder ?? "another write"
        }". If one write calls another, the lock will never be released.`,
      );
    }, STUCK_AFTER_MS);
    try {
      await new Promise<void>((resolve) => queue.push(resolve));
    } finally {
      clearTimeout(stuck);
    }
    writeState.queued -= 1;
  }
  held = true;
  writeState.busy = true;
  writeState.label = label;
  publish();
}

function release(): void {
  const next = queue.shift();
  if (next) {
    // Stay held: the next waiter takes over without a gap.
    writeState.label = null;
    publish();
    next();
    return;
  }
  held = false;
  writeState.busy = false;
  writeState.label = null;
  publish();
}

/** True while any write holds the lock. */
export function isWriteBusy(): boolean {
  return held;
}

/**
 * Run `fn` with the write lock held. Every repository write goes through this.
 * `label` is what the UI shows while other writes queue behind it.
 */
export async function withWrite<T>(
  fn: () => Promise<T>,
  label: string | null = null,
): Promise<T> {
  await acquire(label);
  try {
    return await fn();
  } finally {
    release();
  }
}

let txDepth = 0;

/** True while a db_begin transaction opened here is still open. */
export function inTransaction(): boolean {
  return txDepth > 0;
}

/**
 * Run `fn` inside an explicit transaction, under the write lock.
 * Nested calls join the outer transaction (the Rust pipe turns a nested
 * db_batch into a SAVEPOINT, so partial rollback still works there).
 */
export async function withTransaction<T>(
  fn: () => Promise<T>,
  label: string | null = null,
): Promise<T> {
  if (txDepth > 0) {
    // Already inside a transaction held by this same lock holder.
    return fn();
  }
  return withWrite(async () => {
    await raw.begin();
    txDepth += 1;
    try {
      const result = await fn();
      txDepth -= 1;
      await raw.commit();
      return result;
    } catch (err) {
      txDepth -= 1;
      try {
        await raw.rollback();
      } catch {
        // db_rollback outside a transaction answers TX_STATE: the pipe had
        // already rolled back. Either way the original error is the one that
        // matters, so nothing here replaces it.
      }
      throw err;
    }
  }, label);
}

/* -------------------------------------------------------------------------- */
/* background timers                                                          */
/* -------------------------------------------------------------------------- */

let pauseCount = 0;
const pauseListeners = new Set<Listener>();

/** True while backup, lead-poll and duplicate-scan timers must hold off. */
export function timersPaused(): boolean {
  return pauseCount > 0;
}

export function subscribeTimers(listener: Listener): () => void {
  pauseListeners.add(listener);
  return () => {
    pauseListeners.delete(listener);
  };
}

/** Pause the background timers; call the returned function to resume. */
export function pauseTimers(): () => void {
  pauseCount += 1;
  for (const l of pauseListeners) l();
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    pauseCount = Math.max(0, pauseCount - 1);
    for (const l of pauseListeners) l();
  };
}

/** Test helper: drop any queued waiters and reset the lock. */
export function __resetWriteLockForTests(): void {
  queue.length = 0;
  held = false;
  txDepth = 0;
  pauseCount = 0;
  writeState.busy = false;
  writeState.label = null;
  writeState.queued = 0;
  publish();
}
