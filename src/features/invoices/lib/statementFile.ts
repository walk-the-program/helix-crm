/**
 * Writing a customer statement's PDF to disk and handing it to the OS.
 *
 *   ref + period ---> money.statementRows ---> RenderStatementInput
 *                                                     |
 *                                        bytes -> dialog.save -> fs.writeFile
 *
 * Same shape as `pdfFile.ts`'s `saveDocumentPdf`: the default folder is the
 * open workspace's own `documents/` folder (shared with invoice/quote PDFs --
 * `documentsDir` is exported from `pdfFile.ts` for exactly this reuse), the
 * owner can still steer the save dialog elsewhere, and the opener is asked to
 * open it afterwards with the same tolerance -- a save outside the workspace
 * folder is not a failure, it is the owner's own choice, so a refused open
 * reports nothing beyond leaving the file on disk.
 *
 * `saveStatementPdf`'s input and return type are a fixed contract (LR-PX-A
 * packet rev 1): `RecordPaymentDialog`'s sibling on the customer/company page
 * calls this by name, so its shape does not move without a packet revision.
 */
import { renderStatement, type RenderStatementInput, type RenderStatementRow } from "@/features/invoices/pdf/renderStatement";
import * as money from "@/db/repos/money";
import { readInvoiceSettings } from "@/features/invoices/lib/settings";
import { documentsDir, resolveCustomerBlock } from "@/features/invoices/lib/pdfFile";
import { joinPath } from "@/features/data/lib/fsBridge";

export type SaveStatementInput = {
  ref: { contactId: string | null; companyId: string | null };
  /** The customer's name, for the offered file name. */
  name: string;
  /** Local calendar days (YYYY-MM-DD), inclusive both ends. */
  fromDay: string;
  toDay: string;
};

/** "Statement-Ridgeway-Farms-2026-01-01-to-2026-03-31.pdf" -- the customer's name and the period, nothing else. */
function statementFileName(name: string, fromDay: string, toDay: string): string {
  const safeName = (name || "Customer").replace(/[^A-Za-z0-9._-]+/g, "-");
  return `Statement-${safeName}-${fromDay}-to-${toDay}.pdf`;
}

/**
 * Render, save and open. Returns the path, or null when the owner cancelled
 * the save dialog.
 */
export async function saveStatementPdf(input: SaveStatementInput): Promise<{ path: string | null }> {
  const [customer, settings, statement] = await Promise.all([
    resolveCustomerBlock({
      contactId: input.ref.contactId,
      companyId: input.ref.companyId,
      companyNameFallback: null,
    }),
    readInvoiceSettings(),
    money.statementRows(input.ref, input.fromDay, input.toDay),
  ]);

  const rows: RenderStatementRow[] = [
    {
      kind: "opening",
      on: input.fromDay,
      label: "Opening balance",
      chargeCents: null,
      paidCents: null,
      balanceCents: statement.openingBalanceCents,
    },
    ...statement.rows.map(
      (row): RenderStatementRow => ({
        kind: row.kind,
        on: row.on,
        label: row.label,
        chargeCents: row.chargeCents === 0 ? null : row.chargeCents,
        paidCents: row.paidCents === 0 ? null : row.paidCents,
        balanceCents: row.balanceCents,
      }),
    ),
  ];

  const renderInput: RenderStatementInput = {
    business: {
      name: settings.businessName,
      address: settings.businessAddress,
      phone: settings.ownerPhone,
      email: settings.ownerEmail,
      taxId: settings.businessTaxId,
    },
    customer,
    fromDay: input.fromDay,
    toDay: input.toDay,
    rows,
    closingBalanceCents: statement.closingBalanceCents,
    currency: settings.currency,
  };

  const bytes = await renderStatement(renderInput);

  const fileName = statementFileName(input.name, input.fromDay, input.toDay);
  const defaultPath = joinPath(await documentsDir(), fileName);

  const dialog = await import("@tauri-apps/plugin-dialog");
  const picked = await dialog.save({
    title: "Save this statement",
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (picked === null || picked === undefined) return { path: null };

  const target = String(picked);
  const fs = await import("@tauri-apps/plugin-fs");
  await fs.writeFile(target, bytes);

  try {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openPath(target);
  } catch {
    // The opener is scoped to the workspace folder (see pdfFile.ts's own
    // comment). Saving somewhere else is allowed and is not a failure; the
    // file is on disk either way.
  }

  return { path: target };
}
