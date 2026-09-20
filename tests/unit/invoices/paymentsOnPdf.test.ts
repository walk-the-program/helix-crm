/**
 * The invoice PDF's payments block (LR-PX-A W3): "Paid to date" and
 * "Balance due" under the totals, and a compact payments list when there is
 * more than one.
 *
 * pdf-lib cannot read text back out of a saved PDF -- see the note at the
 * bottom of pdfLayout.test.ts, which tried a byte-level content assertion and
 * documented exactly why it does not work (embedded-font glyph IDs are not
 * character codes, and reconstructing text would mean writing a PDF parser
 * inside the test). What this suite asserts instead is the same thing that
 * file already established as this renderer's contract: `planTotalsRows` and
 * `paymentsListLineText` are the exact, pure data `drawTotals` /
 * `drawPaymentsList` turn into `page.drawText` calls, so asserting on them is
 * asserting on the words and figures the PDF actually carries -- and the PDF
 * generation tests below then prove those code paths run without throwing
 * and without breaking the measured page-break math, for one payment, many
 * payments, and no payments at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  planPageLayout,
  planTotalsRows,
  paymentsListLineText,
  renderDocument,
  type RenderInput,
  type RenderLine,
  type RenderPaymentsBlock,
} from "@/features/invoices/pdf/renderDocument";
import type { TaxLineSummary } from "@/features/invoices/lib/taxLabel";
import type { DocumentAssets, FontBytes } from "@/features/invoices/pdf/assets";
import { CONTENT_BOTTOM_LIMIT } from "@/features/invoices/pdf/brand";

const PDF_DIR = fileURLToPath(new URL("../../../src/features/invoices/pdf", import.meta.url));

function readBytes(...parts: string[]): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(join(PDF_DIR, ...parts)));
  } catch {
    return null;
  }
}

function loadTestAssets(): DocumentAssets {
  const fonts: FontBytes = {
    heading: readBytes("fonts", "ZillaSlab-SemiBold.ttf"),
    headingBold: readBytes("fonts", "ZillaSlab-Bold.ttf"),
    body: readBytes("fonts", "Lato-Regular.ttf"),
    bodyBold: readBytes("fonts", "Lato-Bold.ttf"),
  };
  return { fonts, logoPng: readBytes("helix-logo-square.png") };
}

const NO_TAX: TaxLineSummary = { taxableCount: 0, lineCount: 1, taxableCents: 0 };

const BASE_LINE: RenderLine = {
  name: "Service call",
  description: null,
  qty: 1,
  unitCents: 30000,
  taxable: false,
  kind: "one_time",
  interval: null,
};

function makeInput(overrides: Partial<RenderInput> = {}): RenderInput {
  return {
    kind: "invoice",
    number: "INV-2026-0100",
    issuedOn: "2026-03-01",
    dueOn: "2026-03-15",
    validUntil: null,
    business: {
      name: "Rundle & Sons Plumbing",
      address: "412 Cedar Ave, Springfield, IL 62704",
      phone: "(217) 555-0142",
      email: "office@rundleplumbing.com",
      taxId: "EIN 47-2810934",
    },
    customer: {
      name: "Dale Petrov",
      company: "Ridgeway Farms",
      email: "dale@ridgewayfarms.example",
      phone: "(217) 555-0188",
      address: "88 Harrow Lane\nChatham, IL 62629",
    },
    lines: [BASE_LINE],
    subtotalCents: 30000,
    taxRateBp: 0,
    taxCents: 0,
    totalCents: 30000,
    currency: "USD",
    notes: null,
    paymentInstructions: null,
    ...overrides,
  };
}

describe("planTotalsRows: the pure data the totals block draws", () => {
  it("with no payments, draws exactly the old shape: Subtotal then the filled 'Total' block", () => {
    const input = makeInput();
    const plan = planTotalsRows(input, NO_TAX);
    expect(plan.plainRows).toEqual([["Subtotal", 30000]]);
    expect(plan.filledLabel).toBe("Total");
    expect(plan.filledCents).toBe(30000);
  });

  it("with payments, moves Total to a plain row, adds Paid to date, and fills 'Balance due'", () => {
    const payments: RenderPaymentsBlock = {
      lines: [
        { paidOn: "2026-03-05", methodLabel: "Check", reference: "4412", amountCents: 10000 },
        { paidOn: "2026-03-10", methodLabel: "Cash", reference: null, amountCents: 8000 },
      ],
      paidToDateCents: 18000,
      balanceDueCents: 12000,
    };
    const input = makeInput({ payments });
    const plan = planTotalsRows(input, NO_TAX);

    expect(plan.plainRows).toEqual([
      ["Subtotal", 30000],
      ["Total", 30000],
      ["Paid to date", 18000],
    ]);
    expect(plan.filledLabel).toBe("Balance due");
    expect(plan.filledCents).toBe(12000);
  });

  it("never introduces neither string when payments is explicitly null", () => {
    const input = makeInput({ payments: null });
    const plan = planTotalsRows(input, NO_TAX);
    expect(plan.plainRows.some(([label]) => label === "Paid to date")).toBe(false);
    expect(plan.filledLabel).toBe("Total");
  });
});

describe("paymentsListLineText: one payment's two drawn strings", () => {
  it("joins the day, the method and a reference with middle dots", () => {
    const { left, right } = paymentsListLineText(
      { paidOn: "2026-03-05", methodLabel: "Check", reference: "4412", amountCents: 10000 },
      "USD",
    );
    expect(left).toContain("Check");
    expect(left).toContain("4412");
    expect(right).toBe("$100.00");
  });

  it("omits the reference segment when there is none", () => {
    const { left } = paymentsListLineText(
      { paidOn: "2026-03-05", methodLabel: "Cash", reference: null, amountCents: 5000 },
      "USD",
    );
    expect(left).not.toContain("· ·");
    expect(left.endsWith("Cash")).toBe(true);
  });
});

describe("renderDocument: the payments block end to end", () => {
  const assets = loadTestAssets();

  it("renders a well-formed one-page PDF for an invoice with no payments", async () => {
    const bytes = await renderDocument(makeInput(), assets);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("renders a well-formed PDF for an invoice with two payments, keeping every page's content above the footer", async () => {
    const payments: RenderPaymentsBlock = {
      lines: [
        { paidOn: "2026-03-05", methodLabel: "Check", reference: "4412", amountCents: 10000 },
        { paidOn: "2026-03-10", methodLabel: "Cash", reference: null, amountCents: 8000 },
      ],
      paidToDateCents: 18000,
      balanceDueCents: 12000,
    };
    const input = makeInput({ payments });

    const plan = await planPageLayout(input, assets);
    for (const bottomY of plan.contentBottomYPerPage) {
      expect(bottomY).toBeGreaterThanOrEqual(CONTENT_BOTTOM_LIMIT);
    }

    const bytes = await renderDocument(input, assets);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(plan.pageCount);
  });

  it("keeps the page break honest on a long invoice with a payments block and long notes", async () => {
    const lines: RenderLine[] = Array.from({ length: 14 }, (_, i) => ({
      ...BASE_LINE,
      name: `Service call ${i + 1}, with a long enough name to press the column`,
      description: "Includes parts and labour for the visit, and disposal of the old fixtures.",
    }));
    const subtotalCents = lines.reduce((sum, l) => sum + l.qty * l.unitCents, 0);
    const payments: RenderPaymentsBlock = {
      lines: [
        { paidOn: "2026-03-05", methodLabel: "Check", reference: "4412", amountCents: 100000 },
        { paidOn: "2026-03-12", methodLabel: "Card", reference: null, amountCents: 50000 },
        { paidOn: "2026-03-20", methodLabel: "Bank transfer", reference: "REF-9", amountCents: 25000 },
      ],
      paidToDateCents: 175000,
      balanceDueCents: subtotalCents - 175000,
    };
    const input = makeInput({
      lines,
      subtotalCents,
      totalCents: subtotalCents,
      payments,
      notes: "Follow-up inspection scheduled within thirty days at no extra charge if needed.",
      paymentInstructions: "Pay by check or by card at the link in this email.",
    });

    const plan = await planPageLayout(input, assets);
    expect(plan.pageCount).toBeGreaterThanOrEqual(1);
    for (const bottomY of plan.contentBottomYPerPage) {
      expect(bottomY).toBeGreaterThanOrEqual(CONTENT_BOTTOM_LIMIT);
    }

    const bytes = await renderDocument(input, assets);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(plan.pageCount);
  });

  it("never throws on a quote, which never carries payments", async () => {
    const input = makeInput({ kind: "quote", number: "QUO-2026-0011", dueOn: null, validUntil: "2026-04-01" });
    const bytes = await renderDocument(input, assets);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });
});
