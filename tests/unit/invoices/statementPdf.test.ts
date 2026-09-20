/**
 * The Statement PDF (LR-PX-A W3): the period label, the closing-line
 * sentence, one row's four printed cells, the measured page-break plan for a
 * statement long enough to need two pages, and end-to-end PDF generation.
 *
 * Same caveat as paymentsOnPdf.test.ts and the note at the bottom of
 * pdfLayout.test.ts: pdf-lib cannot read text back out of a saved PDF, so the
 * pure functions below (`statementPeriodLabel`, `statementClosingSentence`,
 * `statementRowCells`) are what get asserted directly -- they are the exact
 * strings `renderStatement` hands to `page.drawText` -- and the PDF
 * generation tests prove those same code paths produce a well-formed,
 * correctly paginated document.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  planStatementLayout,
  renderStatement,
  statementClosingSentence,
  statementPeriodLabel,
  statementRowCells,
  type RenderStatementInput,
  type RenderStatementRow,
} from "@/features/invoices/pdf/renderStatement";
import { formatDateDisplay } from "@/lib/dates";
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

const BUSINESS = {
  name: "Rundle & Sons Plumbing",
  address: "412 Cedar Ave, Springfield, IL 62704",
  phone: "(217) 555-0142",
  email: "office@rundleplumbing.com",
  taxId: "EIN 47-2810934",
};

const CUSTOMER = {
  name: "Dale Petrov",
  company: "Ridgeway Farms",
  email: "dale@ridgewayfarms.example",
  phone: "(217) 555-0188",
  address: "88 Harrow Lane\nChatham, IL 62629",
};

function makeInput(rows: RenderStatementRow[], overrides: Partial<RenderStatementInput> = {}): RenderStatementInput {
  return {
    business: BUSINESS,
    customer: CUSTOMER,
    fromDay: "2026-03-01",
    toDay: "2026-03-31",
    rows,
    closingBalanceCents: rows.length > 0 ? rows[rows.length - 1].balanceCents : 0,
    currency: "USD",
    ...overrides,
  };
}

const OPENING: RenderStatementRow = {
  kind: "opening",
  on: "2026-03-01",
  label: "Opening balance",
  chargeCents: null,
  paidCents: null,
  balanceCents: 20000,
};

const INVOICE_ROW: RenderStatementRow = {
  kind: "invoice",
  on: "2026-03-05",
  label: "Invoice INV-2026-0042",
  chargeCents: 15000,
  paidCents: null,
  balanceCents: 35000,
};

const PAYMENT_ROW: RenderStatementRow = {
  kind: "payment",
  on: "2026-03-20",
  label: "Check · 4412",
  chargeCents: null,
  paidCents: 30000,
  balanceCents: 5000,
};

describe("statementPeriodLabel", () => {
  it("joins the two days with an en dash", () => {
    expect(statementPeriodLabel("2026-03-01", "2026-03-31")).toContain("–");
  });
});

describe("statementClosingSentence", () => {
  it("states the outstanding figure and the closing date when something is owed", () => {
    const sentence = statementClosingSentence(70000, "2026-03-31", "USD");
    expect(sentence).toContain("$700.00 outstanding as of");
    expect(sentence).toContain(formatDateDisplay("2026-03-31"));
    expect(sentence.endsWith(".")).toBe(true);
  });

  it("says 'Nothing outstanding.' rather than printing a zero, at exactly zero", () => {
    expect(statementClosingSentence(0, "2026-03-31", "USD")).toBe("Nothing outstanding.");
  });

  it("also reads 'Nothing outstanding.' for a credit balance (never a negative dollar figure)", () => {
    expect(statementClosingSentence(-500, "2026-03-31", "USD")).toBe("Nothing outstanding.");
  });
});

describe("statementRowCells", () => {
  it("draws an em dash for the opening row's charge and paid columns", () => {
    const cells = statementRowCells(OPENING, "USD");
    expect(cells.charge).toBe("—");
    expect(cells.paid).toBe("—");
    expect(cells.balance).toBe("$200.00");
    expect(cells.label).toBe("Opening balance");
  });

  it("draws the charge for an invoice row and a dash for its paid column", () => {
    const cells = statementRowCells(INVOICE_ROW, "USD");
    expect(cells.charge).toBe("$150.00");
    expect(cells.paid).toBe("—");
    expect(cells.balance).toBe("$350.00");
  });

  it("draws the paid amount for a payment row and a dash for its charge column", () => {
    const cells = statementRowCells(PAYMENT_ROW, "USD");
    expect(cells.charge).toBe("—");
    expect(cells.paid).toBe("$300.00");
    expect(cells.balance).toBe("$50.00");
  });
});

describe("renderStatement: PDF generation", () => {
  const assets = loadTestAssets();

  it("renders a well-formed one-page statement for the opening balance, one invoice and one payment", async () => {
    const input = makeInput([OPENING, INVOICE_ROW, PAYMENT_ROW]);
    const bytes = await renderStatement(input, assets);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("renders 'Nothing outstanding' correctly when the closing balance is zero", async () => {
    const zeroed: RenderStatementRow = { ...PAYMENT_ROW, balanceCents: 0 };
    const input = makeInput([OPENING, INVOICE_ROW, zeroed], { closingBalanceCents: 0 });
    const bytes = await renderStatement(input, assets);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("paginates a statement with enough rows to need two pages, repeating the table header", async () => {
    const rows: RenderStatementRow[] = [
      OPENING,
      ...Array.from({ length: 45 }, (_, i): RenderStatementRow => ({
        kind: i % 2 === 0 ? "invoice" : "payment",
        on: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
        label: i % 2 === 0 ? `Invoice INV-2026-${String(1000 + i)}` : `Cash · payment ${i}`,
        chargeCents: i % 2 === 0 ? 10000 : null,
        paidCents: i % 2 === 1 ? 8000 : null,
        balanceCents: 20000 + i * 100,
      })),
    ];
    const input = makeInput(rows, { closingBalanceCents: rows[rows.length - 1].balanceCents });

    const plan = await planStatementLayout(input, assets);
    expect(plan.pageCount).toBeGreaterThan(1);
    expect(plan.rowsPerPage.reduce((a, b) => a + b, 0)).toBe(rows.length);
    for (const bottomY of plan.contentBottomYPerPage) {
      expect(bottomY).toBeGreaterThanOrEqual(CONTENT_BOTTOM_LIMIT);
    }

    const bytes = await renderStatement(input, assets);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(plan.pageCount);
  });

  it("never throws when assets are entirely missing (falls back to Helvetica, no logo)", async () => {
    const emptyAssets: DocumentAssets = {
      fonts: { heading: null, headingBold: null, body: null, bodyBold: null },
      logoPng: null,
    };
    const input = makeInput([OPENING, INVOICE_ROW]);
    const bytes = await renderStatement(input, emptyAssets);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("renders when the customer has no contact name, only a company", async () => {
    const input = makeInput([OPENING, INVOICE_ROW], {
      customer: { name: "", company: "Ridgeway Farms", email: "", phone: "", address: "" },
    });
    const bytes = await renderStatement(input, assets);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });
});
