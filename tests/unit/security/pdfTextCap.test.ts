/**
 * LR-SEC-W2, item 8: PDF generation and a 1 MB note.
 *
 * `src/features/invoices/pdf/renderDocument.ts`'s text wrapper falls back to
 * a character-by-character loop for any "word" (a run with no whitespace)
 * that doesn't fit the column on its own, re-measuring the whole run so far
 * on every character - quadratic in the length of that run. Measured
 * directly against pdf-lib (see the comment on `capPdfText` in
 * src/features/invoices/lib/pdfFile.ts): a single unbroken 5,000-character
 * run wraps in ~0.4s, 20,000 in ~6s, 50,000 in ~41s, so an attacker-sized
 * note (hundreds of KB to 1 MB, no spaces) would hang PDF generation on the
 * main thread rather than fail cleanly.
 *
 * `renderDocument.ts` is outside this worker's writable paths, so the fix
 * lives at the one boundary this worker does own: `buildRenderInput` in
 * `src/features/invoices/lib/pdfFile.ts` caps every free-text field to
 * 10,000 characters before it ever reaches the renderer. This proves that
 * boundary actually holds for a document with no linked contact or company
 * (so it needs no database).
 */
import { describe, expect, it } from "vitest";
import { buildRenderInput } from "../../../src/features/invoices/lib/pdfFile";
import type { Document, DocumentItem } from "../../../src/db/repos/documents";
import type { InvoiceSettings } from "../../../src/features/invoices/lib/settings";

const MAX_PDF_TEXT_CHARS = 10_000;

function baseDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    kind: "invoice",
    number: "INV-0001",
    dealId: null,
    dealTitle: null,
    contactId: null,
    contactFirstName: null,
    contactLastName: null,
    companyId: null,
    companyName: null,
    status: "draft",
    issuedOn: "2026-01-01",
    dueOn: null,
    validUntil: null,
    subtotalCents: 0,
    taxRateBp: 0,
    taxCents: 0,
    totalCents: 0,
    notes: null,
    paymentInstructions: null,
    convertedToId: null,
    sentAt: null,
    paidOn: null,
    paidMethod: null,
    paidNote: null,
    pdfPath: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function baseItem(overrides: Partial<DocumentItem> = {}): DocumentItem {
  return {
    id: "item-1",
    documentId: "doc-1",
    name: "Service",
    description: null,
    qty: 1,
    unitCents: 1000,
    taxable: false,
    kind: "one_time",
    interval: null,
    position: 0,
    ...overrides,
  };
}

const settings: InvoiceSettings = {
  invoicePrefix: "INV-",
  quotePrefix: "QUO-",
  taxRateBp: 0,
  dueDays: 30,
  businessName: "Acme Trades",
  businessAddress: "123 Main St",
  businessTaxId: "",
  paymentInstructions: "",
  ownerEmail: "owner@example.com",
  ownerPhone: "8015550100",
  currency: "USD",
  locale: "en-US",
};

describe("buildRenderInput: capping free text before it reaches the PDF renderer", () => {
  it("caps a huge note to MAX_PDF_TEXT_CHARS with a truncation marker", async () => {
    const hugeNote = "a".repeat(1_000_000); // the packet's "1 MB note"
    const input = await buildRenderInput(
      baseDocument({ notes: hugeNote }),
      [baseItem()],
      settings,
    );
    expect(input.notes).not.toBeNull();
    expect(input.notes!.length).toBe(MAX_PDF_TEXT_CHARS + 1); // + the ellipsis marker
    expect(input.notes!.endsWith("…")).toBe(true);
  });

  it("caps a huge payment-instructions field the same way", async () => {
    const huge = "b".repeat(500_000);
    const input = await buildRenderInput(
      baseDocument({ paymentInstructions: huge }),
      [baseItem()],
      settings,
    );
    expect(input.paymentInstructions!.length).toBe(MAX_PDF_TEXT_CHARS + 1);
  });

  it("caps a huge line-item description and name", async () => {
    const hugeDescription = "c".repeat(2_000_000);
    const hugeName = "d".repeat(50_000);
    const input = await buildRenderInput(baseDocument(), [
      baseItem({ description: hugeDescription, name: hugeName }),
    ], settings);
    expect(input.lines[0].description!.length).toBe(MAX_PDF_TEXT_CHARS + 1);
    expect(input.lines[0].name.length).toBe(MAX_PDF_TEXT_CHARS + 1);
  });

  it("leaves an ordinary note untouched", async () => {
    const input = await buildRenderInput(
      baseDocument({ notes: "Thanks for your business!" }),
      [baseItem()],
      settings,
    );
    expect(input.notes).toBe("Thanks for your business!");
  });

  it("leaves null free-text fields as null", async () => {
    const input = await buildRenderInput(baseDocument(), [baseItem()], settings);
    expect(input.notes).toBeNull();
    expect(input.paymentInstructions).toBeNull();
  });
});
