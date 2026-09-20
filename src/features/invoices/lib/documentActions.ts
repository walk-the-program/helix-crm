/**
 * What a document page can do right now, and which one thing it is busy with.
 *
 * Two small rules live here rather than in the screen, because both were bugs
 * Walker hit in 0.1.0 and both are worth a test that does not need a browser.
 *
 * 1. One busy state per action. The page used to hold a single `busy` flag
 *    that every button read, so pressing Download PDF put a spinner on Send as
 *    well - "when I hit the download PDF button, a thing appeared for both
 *    download PDF and send". `BusyState` is the one action in flight, and a
 *    button asks whether it is the one.
 *
 * 2. The status can be moved by hand. Sending was the only way to get an
 *    invoice out of Draft, which is wrong for an invoice handed over on paper:
 *    "It wouldn't let me change its status without hitting the send button".
 *    `statusChoices` lists where the document may go next, straight off the
 *    repository's own transition table, so the control can never offer a move
 *    the repository will refuse.
 *
 * Void is deliberately NOT in the status list. It is the one move that spends
 * a number and cannot be walked back, so it keeps its own destructive button
 * and its own confirmation rather than sitting one careless click away in a
 * dropdown.
 */
import { canTransition } from "@/db/repos/documents";
import { statusLabel } from "@/features/invoices/lib/format";

/** Every separately-spinnable thing the document page does. */
export type DocumentAction =
  | "download"
  | "send"
  | "status"
  | "accept"
  | "decline"
  | "pay"
  | "void"
  | "saveLines";

/** The one action in flight, or null when the page is idle. */
export type BusyState = DocumentAction | null;

/** True only for the action actually running. This is the whole of rule 1. */
export function isBusy(state: BusyState, action: DocumentAction): boolean {
  return state === action;
}

/** For the controls that must not be pressed while anything else is running. */
export function anyBusy(state: BusyState): boolean {
  return state !== null;
}

/** The moves offered by hand, in the order a document travels. */
const BY_HAND: Record<string, string[]> = {
  invoice: ["draft", "sent", "paid"],
  quote: ["draft", "sent", "accepted", "declined"],
};

export type StatusChoice = { value: string; label: string };

/**
 * The current status, plus every status the repository would accept from it.
 *
 * The current one is always first and always present, so the control has
 * something to show even on a settled document, where the list is that one
 * entry and the control is therefore disabled.
 */
export function statusChoices(kind: string, status: string): StatusChoice[] {
  const order = BY_HAND[kind] ?? BY_HAND.invoice;
  const reachable = order.filter(
    (candidate) => candidate !== status && canTransition(kind, status, candidate),
  );
  return [status, ...reachable].map((value) => ({ value, label: statusLabel(value) }));
}

/** A settled document has nowhere left to go by hand. */
export function statusIsFixed(kind: string, status: string): boolean {
  return statusChoices(kind, status).length <= 1;
}
