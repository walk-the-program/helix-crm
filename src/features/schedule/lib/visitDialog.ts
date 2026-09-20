/**
 * Opening the "Schedule a visit" dialog from anywhere.
 *
 * The dialog itself is mounted once, by this feature's `overlays` slot, so the
 * command palette, the Schedule screen's empty state, a day agenda and a
 * record page all open the same form rather than each growing a copy of it.
 * A window event is the seam, exactly as `openSearch()` does it
 * (src/features/today/search/overlay.tsx): a caller that is not inside React —
 * a FeatureCommand's `run` — can still open it.
 */

/** What the dialog should start with. Every field is optional. */
export type VisitPrefill = {
  /** A day to land on, "YYYY-MM-DD". Defaults to today. */
  date?: string | null;
  /** "HH:MM" local. Defaults to the next round hour inside working hours. */
  time?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  /** Edit an existing task instead of creating one. */
  taskId?: string | null;
};

export const OPEN_VISIT_EVENT = "helix:open-visit";

/** Open the visit dialog. Safe to call from outside React and from tests. */
export function openVisitDialog(prefill: VisitPrefill = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<VisitPrefill>(OPEN_VISIT_EVENT, { detail: prefill }),
  );
}
