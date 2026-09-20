/**
 * Writing a document's PDF to disk and handing it to the OS.
 *
 *   document + settings ---> RenderInput ---> renderDocument (pdf-lib)
 *          |                                         |
 *          |                              bytes -> dialog.save -> fs.writeFile
 *          +-- pdf_path <----------------------------+-> opener.openPath
 *
 * The default folder is the open workspace's own `documents/` folder, created
 * on demand. That is not a convenience: `src-tauri/capabilities/default.json`
 * scopes `fs` writes to the app data folder and `opener:allow-open-path` to
 * `$APPDATA/workspaces/**`, so a PDF written inside the workspace is the one
 * the app is permitted to both write and then open. The owner can still steer
 * the save dialog somewhere else; if he does, the write or the open may be
 * refused by the capability, and this reports that in a plain sentence rather
 * than throwing a permission error at him.
 */
import { renderDocument, type RenderInput, type RenderLine } from "@/features/invoices/pdf/renderDocument";
import type { Document, DocumentItem } from "@/db/repos/documents";
import * as documentsRepo from "@/db/repos/documents";
import { workspacePaths } from "@/features/data/lib/workspace";
import { joinPath } from "@/features/data/lib/fsBridge";
import { contactName } from "@/db/repos/contacts";
import * as contactsRepo from "@/db/repos/contacts";
import * as companiesRepo from "@/db/repos/companies";
import { formatAddressLines, parseAddress } from "@/features/records/lib/address";
import { pdfFileName } from "@/features/invoices/lib/format";
import type { InvoiceSettings } from "@/features/invoices/lib/settings";

export type SaveResult = {
  /** Null when the owner cancelled the dialog. */
  path: string | null;
  opened: boolean;
};

/** The workspace's documents/ folder, created if it is not there yet. */
export async function documentsDir(): Promise<string> {
  const paths = await workspacePaths();
  const dir = joinPath(paths.dir, "documents");
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // mkdir on a folder that already exists is not an error worth surfacing;
    // if the folder genuinely cannot be made, the write below says so.
  }
  return dir;
}

/** The customer block, resolved from whichever of the two the document has. */
async function customerFor(document: Document): Promise<RenderInput["customer"]> {
  let name = "";
  let email = "";
  let phone = "";
  let address = "";
  let company = document.companyName ?? "";

  if (document.contactId) {
    const contact = await contactsRepo.get(document.contactId);
    if (contact) {
      name = contactName(contact);
      const primaryEmail =
        contact.emails.find((e) => e.isPrimary) ?? contact.emails[0] ?? null;
      const primaryPhone =
        contact.phones.find((p) => p.isPrimary) ?? contact.phones[0] ?? null;
      email = primaryEmail?.emailLower ?? "";
      phone = primaryPhone?.e164 ?? primaryPhone?.raw ?? "";
      address = addressText(contact.addressJson);
    }
  }

  if (document.companyId) {
    const record = await companiesRepo.get(document.companyId);
    if (record) {
      company = record.name;
      if (!phone) phone = record.phoneE164 ?? record.phoneRaw ?? "";
      // The company's address wins when the contact has none of their own: an
      // invoice goes to where the business is, not to where the person lives.
      if (!address) address = addressText(record.addressJson);
    }
  }

  return { name, company, email, phone, address };
}

/**
 * An address is a JSON string in this schema (`address_json`), parsed by the
 * records feature's own helper so the PDF and the record page can never
 * disagree about what a stored address means.
 */
function addressText(addressJson: string | null): string {
  return formatAddressLines(parseAddress(addressJson)).join("\n");
}

function toRenderLines(items: DocumentItem[]): RenderLine[] {
  return items.map((item) => ({
    name: item.name,
    description: item.description,
    qty: item.qty,
    unitCents: item.unitCents,
    taxable: item.taxable,
    kind: item.kind,
    interval: item.interval,
  }));
}

/** Everything the renderer needs, assembled from the row and the settings. */
export async function buildRenderInput(
  document: Document,
  items: DocumentItem[],
  settings: InvoiceSettings,
): Promise<RenderInput> {
  return {
    kind: document.kind === "quote" ? "quote" : "invoice",
    number: document.number,
    issuedOn: document.issuedOn,
    dueOn: document.dueOn,
    validUntil: document.validUntil,
    business: {
      name: settings.businessName,
      address: settings.businessAddress,
      phone: settings.ownerPhone,
      email: settings.ownerEmail,
      taxId: settings.businessTaxId,
    },
    customer: await customerFor(document),
    lines: toRenderLines(items),
    subtotalCents: document.subtotalCents,
    taxRateBp: document.taxRateBp,
    taxCents: document.taxCents,
    totalCents: document.totalCents,
    currency: settings.currency,
    notes: document.notes,
    paymentInstructions:
      document.paymentInstructions || settings.paymentInstructions || null,
  };
}

/**
 * Render, save and open. Returns the path, or null when the owner cancelled.
 *
 * `openAfter` is false for a plain "Download PDF" and true for "Send", where
 * the whole point of the action is that he is about to look at it and attach
 * it to an email.
 */
export async function saveDocumentPdf(
  document: Document,
  items: DocumentItem[],
  settings: InvoiceSettings,
  options: { openAfter?: boolean } = {},
): Promise<SaveResult> {
  const input = await buildRenderInput(document, items, settings);
  const bytes = await renderDocument(input);

  const fileName = pdfFileName(document.number);
  const defaultPath = joinPath(await documentsDir(), fileName);

  const dialog = await import("@tauri-apps/plugin-dialog");
  const picked = await dialog.save({
    title: document.kind === "quote" ? "Save this quote" : "Save this invoice",
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (picked === null || picked === undefined) return { path: null, opened: false };

  const target = String(picked);
  const fs = await import("@tauri-apps/plugin-fs");
  await fs.writeFile(target, bytes);

  await documentsRepo.setPdfPath(document.id, target);

  let opened = false;
  if (options.openAfter !== false) {
    try {
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.openPath(target);
      opened = true;
    } catch {
      // The opener is scoped to the workspace folder. Saving somewhere else is
      // allowed and is not a failure; the file is on disk either way.
      opened = false;
    }
  }

  return { path: target, opened };
}
