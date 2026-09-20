/**
 * Boots the follow-up automations (LR-PX-C, PX-4).
 *
 * Registers the quote-sent rule on `documents.onDocumentStatusChanged`
 * (LR-PX contract 2) and runs the daily overdue sweep once. The listener runs
 * inside the same write that marks a quote sent, so it must not touch the
 * write lock itself - it plans statements with `automations.runQuoteSent` and
 * executes them with `raw.batch`, exactly as the module doc comment on
 * `src/db/repos/automations.ts` requires. A listener that throws is meant to
 * fail that write (docs/CONTRACTS.md, contract 2), so nothing here catches
 * its errors.
 *
 * The sweep is different: it has no write of its own to ride along with, and
 * a boot is not allowed to go down because a sweep failed, so its failure is
 * caught and logged - the same guard `src/features/invoices/lib/scheduleRunner.ts`
 * and `src/features/leads/poller.ts` already use for their own boot steps. A
 * sweep that did not run today is correct again the next time Helix opens.
 */
import { raw } from "@/db/client";
import {
  onDocumentStatusChanged,
  type DocumentStatusChange,
} from "@/db/repos/documents";
import { automationSweep, runQuoteSent } from "@/db/repos/automations";

let unregister: (() => void) | null = null;

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

/**
 * Registers the quote-sent rule on documents' status hook and runs the daily
 * overdue sweep. Idempotent: calling it twice registers one listener.
 */
export async function startAutomations(): Promise<void> {
  if (!unregister) {
    unregister = onDocumentStatusChanged(onStatusChanged);
  }
  try {
    await automationSweep();
  } catch (err) {
    console.warn(`[helix] the daily follow-up sweep could not run: ${String(err)}`);
  }
}

/** Test helper: unregisters the listener. */
export function stopAutomations(): void {
  unregister?.();
  unregister = null;
}
