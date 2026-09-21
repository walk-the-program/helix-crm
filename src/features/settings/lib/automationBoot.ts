/**
 * Boots the follow-up automations (LR-PX-C, PX-4).
 *
 * Two separate things live here and they behave differently on purpose.
 *
 * **The quote-sent rule** is registered on `documents.onDocumentStatusChanged`
 * (LR-PX contract 2). The listener runs inside the same write that marks a
 * quote sent, so it must not touch the write lock itself - it plans statements
 * with `automations.runQuoteSent` and executes them with `raw.batch`, exactly
 * as the module doc comment on `src/db/repos/automations.ts` requires. A
 * listener that throws is meant to fail that write (docs/CONTRACTS.md,
 * contract 2), so nothing here catches its errors.
 *
 * **The overdue sweep** has no write of its own to ride along with, so it runs
 * on a beat.
 *
 * ```text
 *   startAutomations()
 *     -> register the quote-sent listener (idempotent)
 *     -> tick() now, then every 24 h until stopAutomations()
 * ```
 *
 * It used to run exactly once, at boot, and nothing rescheduled it
 * (LR-OPS-RECHECK, F-OPS-R-1). On a Mac an owner shuts the lid rather than
 * quitting, so "once per launch" and "once per day" are not the same promise
 * at all: a Helix left open for a fortnight swept for overdue invoices on the
 * first morning and never again, while the Settings screen went on calling it
 * the daily follow-up. The beat below is the same shape
 * `src/features/data/trash/purgeSweep.ts` already uses, for the same reason,
 * and inherits its three rules:
 *
 *   - **never fatal.** This is a feature `onBoot` hook. A sweep that throws
 *     would take the app's first paint with it, and nothing the owner is doing
 *     depends on a follow-up task existing this minute. A sweep that did not
 *     run is correct again on the next beat.
 *   - **never competes for the write lock.** `timersPaused()` is held during an
 *     import or a restore. The sweep skips that tick and looks again in a
 *     minute rather than queueing a few hundred task inserts behind a restore.
 *     It would only ever queue - `automationSweep` opens an ordinary
 *     `withTransaction`, and since F-OPS-12 there is no way for it to join
 *     somebody else's - but queueing behind a 100k-row import is still the
 *     wrong thing for a job whose next chance is tomorrow.
 *   - **never overlaps itself.** `sweeping` is the guard; the 24-hour chain
 *     only reaches its next `schedule()` after the current tick has fully
 *     returned.
 *
 * Sleep and wake: `setTimeout` does not fire while the lid is shut and fires
 * once, late, on wake - never a burst of catch-up firings. A daily sweep
 * arriving a few hours late is correct for a job that only exists while the
 * app is open, and it cannot double, because the work itself is idempotent
 * twice over: `automationSweep` pre-checks `automation_runs` and the unique
 * index on that table is the real guard underneath it.
 */
import { raw } from "@/db/client";
import { timersPaused } from "@/db/writeLock";
import {
  onDocumentStatusChanged,
  type DocumentStatusChange,
} from "@/db/repos/documents";
import { automationSweep, runQuoteSent } from "@/db/repos/automations";

/** Once a day, like the trash purge. */
export const AUTOMATION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** How long to wait before looking again when a write is in progress. */
const RETRY_WHILE_BUSY_MS = 60_000;

let unregister: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let sweeping = false;

function customerNameFor(document: DocumentStatusChange["document"]): string {
  const name = `${document.contactFirstName ?? ""} ${document.contactLastName ?? ""}`.trim();
  return name.length > 0 ? name : (document.companyName ?? "");
}

async function onStatusChanged(event: DocumentStatusChange): Promise<void> {
  if (event.document.kind !== "quote" || event.to !== "sent") return;
  const result = await runQuoteSent({
    documentId: event.document.id,
    number: event.document.number,
    dealId: event.document.dealId,
    contactId: event.document.contactId,
    companyId: event.document.companyId,
    customerName: customerNameFor(event.document),
    dealTitle: event.document.dealTitle,
  });
  if (result.statements.length > 0) {
    await raw.batch(result.statements);
  }
}

function schedule(delay: number): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void tick();
  }, delay);
}

/**
 * One sweep, then the next one scheduled. Exported so a test can drive the
 * beat directly instead of through a real 24-hour `setTimeout`, the same way
 * `purgeSweep.tick` and `poller.tick` are.
 */
export async function tick(): Promise<void> {
  if (timersPaused()) {
    schedule(RETRY_WHILE_BUSY_MS);
    return;
  }
  if (sweeping) {
    schedule(RETRY_WHILE_BUSY_MS);
    return;
  }
  sweeping = true;
  try {
    await automationSweep();
  } catch (err) {
    // The same guard `scheduleRunner.ts` and `poller.ts` use for their own
    // boot steps: a sweep that failed must not take the app down, and the
    // next one is a day away.
    console.warn(`[helix] the daily follow-up sweep could not run: ${String(err)}`);
  } finally {
    sweeping = false;
  }
  schedule(AUTOMATION_SWEEP_INTERVAL_MS);
}

/**
 * Registers the quote-sent rule on documents' status hook and starts the daily
 * overdue sweep. Idempotent: calling it twice registers one listener and keeps
 * one timer.
 */
export async function startAutomations(): Promise<void> {
  if (!unregister) {
    unregister = onDocumentStatusChanged(onStatusChanged);
  }
  if (started) return;
  started = true;
  await tick();
}

/** Unregisters the listener and stops the beat. Used on teardown and by tests. */
export function stopAutomations(): void {
  unregister?.();
  unregister = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  started = false;
  sweeping = false;
}
