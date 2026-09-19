/**
 * The duplicate scan timer: once after boot, then every 24 hours while the
 * app is open (docs/PLAN.md item 15).
 *
 * Like the backup timer it respects `timersPaused()`, so an import or a
 * restore is never competing with a scan for the write lock. The scan itself
 * is read-only; only the "last scanned at" setting is a write, and that waits.
 */
import { timersPaused } from "@/db/writeLock";
import { queryClient } from "@/app/queryClient";
import { dqk } from "@/features/data/lib/queries";
import {
  DUPLICATE_SCAN_INTERVAL_MS,
  lastScanAt,
  markScanned,
  scanDuplicates,
  scanIsDue,
} from "@/features/data/lib/duplicates";

const RETRY_WHILE_BUSY_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let lastCount = 0;

/** How many candidate pairs the last scan found (the sidebar may show it). */
export function duplicateCount(): number {
  return lastCount;
}

async function scanOnce(): Promise<void> {
  if (timersPaused()) return;
  const pairs = await scanDuplicates();
  lastCount = pairs.length;
  await markScanned();
  queryClient.setQueryData(dqk.duplicatePairs("all"), pairs);
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
    await scanOnce();
  } catch (err) {
    // A failed scan is not worth a banner: nothing the owner does depends on
    // it, and the next one is a day away.
    console.warn("[helix] duplicate scan failed", err);
  }
  schedule(DUPLICATE_SCAN_INTERVAL_MS);
}

/** Idempotent: calling it twice does not create a second timer. */
export async function startDuplicateScanner(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const last = await lastScanAt();
    if (scanIsDue(last)) {
      await tick();
      return;
    }
    const elapsed = last ? Date.now() - new Date(last).getTime() : 0;
    schedule(Math.max(0, DUPLICATE_SCAN_INTERVAL_MS - elapsed));
  } catch (err) {
    console.warn("[helix] duplicate scanner could not start", err);
    started = false;
  }
}

export function stopDuplicateScanner(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  started = false;
}
