/**
 * The invoices feature: quotes, invoices, the recurring billing schedule, AR
 * aging and the branded PDF (D21, D22).
 *
 *   /invoices            the list: Unpaid, Paid, Quotes, All
 *   /invoices/new        one from scratch, for work that never had a deal
 *   /invoices/:id        the document: lines while it is a draft, then status
 *   /reports/receivables AR aging and what was collected this month
 *   /settings/invoices   numbering, tax rate, terms, payment instructions
 *
 * Two pieces of this feature live on somebody else's screen and are exported
 * rather than routed: `DealInvoicesPanel` mounts on the records feature's deal
 * page, and `UnpaidInvoicesSection` mounts on Today. Each is a whole component
 * in this folder with one line at the call site, which is what lets two agents
 * work on the same screen without a rebase conflict.
 *
 * `onBoot` starts the billing schedule runner. It writes nothing on its own
 * schedule that the owner has not already agreed to, and everything it raises
 * is a draft.
 */
import type { FeatureModule } from "@/app/feature";
import { Scroll } from "@/ui/icons";
import { navigate } from "wouter/use-browser-location";
import { InvoicesScreen } from "@/features/invoices/screens/InvoicesScreen";
import { NewDocumentScreen } from "@/features/invoices/screens/NewDocumentScreen";
import { DocumentPage } from "@/features/invoices/screens/DocumentPage";
import { ReceivablesScreen } from "@/features/invoices/screens/ReceivablesScreen";
import { InvoiceSettingsScreen } from "@/features/invoices/screens/InvoiceSettingsScreen";
import { start as startScheduleRunner } from "@/features/invoices/lib/scheduleRunner";

/** Mounted by the records feature on the deal page. */
export { DealInvoicesPanel } from "@/features/invoices/components/DealInvoicesPanel";
/** Mounted by the today feature on the Today screen. */
export { UnpaidInvoicesSection } from "@/features/invoices/components/UnpaidInvoices";
/** Mountable on the catalog feature's revenue report with one line. */
export { AgingBlock } from "@/features/invoices/components/AgingBlock";

/**
 * Between Reports (60) and Import (70). Invoices belong beside the money, not
 * beside the records - the owner who opens this is answering "who owes me",
 * which is the same question Reports answers.
 */
export const INVOICES_NAV_ORDER = 58;

export const feature: FeatureModule = {
  id: "invoices",
  routes: [
    { path: "/invoices", element: <InvoicesScreen /> },
    // Before "/invoices/:id", or wouter's Switch matches "new" as an id.
    { path: "/invoices/new", element: <NewDocumentScreen /> },
    { path: "/invoices/:id", element: <DocumentPage /> },
    { path: "/reports/receivables", element: <ReceivablesScreen /> },
    { path: "/settings/invoices", element: <InvoiceSettingsScreen /> },
  ],
  nav: [
    { label: "Invoices", to: "/invoices", icon: Scroll, order: INVOICES_NAV_ORDER },
  ],
  commands: [
    {
      id: "new-invoice",
      label: "New invoice",
      group: "Create",
      keywords: ["invoice", "bill", "quote", "money", "owed"],
      run: () => navigate("/invoices/new"),
    },
  ],
  async onBoot() {
    // Never fatal: boot.ts catches, and a schedule that did not run today is
    // correct again the moment the app is next opened.
    await startScheduleRunner();
  },
};

export default feature;
