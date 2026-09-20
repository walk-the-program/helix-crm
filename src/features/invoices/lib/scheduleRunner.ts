/**
 * The one background job this feature has, and it is barely one.
 *
 *   boot (after first paint) --> issueDue(today) --> draft invoices
 *          |                                              |
 *          +-- every 24 h while the window is open -------+
 *
 * There is no timer in the data model. `invoice_schedules.next_issue_on` is
 * the only state, and a workspace that was closed for a year catches up the
 * moment it opens - the run below is a convenience for a window that stays
 * open across midnight, not a thing the product's correctness depends on.
 *
 * Two rules it holds to, both borrowed from the lead poller:
 *   - a run is skipped while `timersPaused()`, because an import or a merge
 *     owns the write lock and a batch of invoice writes must not queue behind
 *     it and then land in the middle of somebody's restore;
 *   - every invoice it raises is a DRAFT. Nothing is sent to a customer by a
 *     timer, ever.
 */
import { timersPaused } from "@/db/writeLock";
import { queryClient } from "@/app/queryClient";
import { todayLocal } from "@/lib/dates";
import * as schedules from "@/db/repos/invoiceSchedules";
import { readInvoiceSettings } from "@/features/invoices/lib/settings";
import { iqk } from "@/features/invoices/lib/hooks";

/** Once a day. A billing schedule is a calendar thing; a minute is not. */
export const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Long enough for the first paint to finish before any write starts. */
const FIRST_RUN_DELAY_MS = 2_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let running = false;

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * One pass. Exported so the repo tests and the e2e harness can drive it
 * directly rather than waiting out a timer.
 */
export async function run(
  reference: string = todayLocal(),
): Promise<{ issued: number; failed: number; skipped: boolean }> {
  if (running) return { issued: 0, failed: 0, skipped: true };
  if (timersPaused()) return { issued: 0, failed: 0, skipped: true };

  running = true;
  try {
    const settings = await readInvoiceSettings();
    // A deal that was won since the last run needs its schedule before
    // anything can be billed against it. Both steps are one pass so a deal won
    // last month bills for last month on the very next launch.
    await schedules.ensureForWonDeals(reference);
    const result = await schedules.issueDue(reference, {
      prefix: settings.invoicePrefix,
      taxRateBp: settings.taxRateBp,
      dueDays: settings.dueDays,
      paymentInstructions: settings.paymentInstructions || null,
    });

    if (result.issued.length > 0) {
      void queryClient.invalidateQueries({ queryKey: iqk.all() });
    }
    if (result.failed.length > 0) {
      // A schedule whose deal lost its services cannot bill, and that is the
      // owner's business to fix on the deal, not an error to interrupt him
      // with. It goes to the log and the run carries on.
      console.warn(
        `[helix] ${result.failed.length} billing schedule(s) could not raise an invoice.`,
        result.failed,
      );
    }
    return { issued: result.issued.length, failed: result.failed.length, skipped: false };
  } finally {
    running = false;
  }
}

function scheduleNext(delayMs: number): void {
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    void run()
      .catch(() => {
        // A failed run is not a failed app. The next one tries again.
      })
      .finally(() => scheduleNext(RUN_INTERVAL_MS));
  }, delayMs);
}

/** Idempotent, as `FeatureModule.onBoot` requires. */
export async function start(): Promise<void> {
  if (started) return;
  started = true;
  scheduleNext(FIRST_RUN_DELAY_MS);
}

/** Test helper: stop the timer and forget that it ever started. */
export function stop(): void {
  clearTimer();
  started = false;
  running = false;
}
