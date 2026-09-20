/**
 * Renders real PDFs to verify the invoice/quote layout's page-break math and
 * that renderDocument() produces a well-formed PDF.
 *
 * pdf-lib cannot extract text back out of a PDF it loaded, so this suite
 * cannot assert "the page says $1,234.56" the way a snapshot of rendered
 * text would. A byte-level assertion was tried and dropped -- see the note
 * at the bottom of this file for why -- so what remains is page count and
 * non-empty output, which is what pdf-lib's own API can actually verify.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  planPageLayout,
  renderDocument,
  type RenderInput,
  type RenderLine,
} from "@/features/invoices/pdf/renderDocument";
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

/** Reads the same font/logo files off disk that the app fetches by URL in the browser. */
function loadTestAssets(): DocumentAssets {
  const fonts: FontBytes = {
    heading: readBytes("fonts", "ZillaSlab-SemiBold.ttf"),
    headingBold: readBytes("fonts", "ZillaSlab-Bold.ttf"),
    body: readBytes("fonts", "Lato-Regular.ttf"),
    bodyBold: readBytes("fonts", "Lato-Bold.ttf"),
  };
  const logoPng = readBytes("helix-logo-square.png");
  return { fonts, logoPng };
}

const BUSINESS = {
  name: "Rundle & Sons Plumbing",
  address: "412 Cedar Ave, Springfield, IL 62704",
  phone: "(217) 555-0142",
  email: "office@rundleplumbing.com",
  taxId: "EIN 47-2810934",
};

function makeLine(i: number, overrides: Partial<RenderLine> = {}): RenderLine {
  return {
    name: `Service call ${i + 1}`,
    description: i % 3 === 0 ? "Diagnostic visit and minor repair, including parts and labor for the afternoon appointment." : null,
    qty: 1,
    unitCents: 12500 + i * 100,
    taxable: true,
    kind: "service",
    interval: i % 5 === 0 ? "monthly" : null,
    ...overrides,
  };
}

function makeInput(lineCount: number, overrides: Partial<RenderInput> = {}): RenderInput {
  const lines = Array.from({ length: lineCount }, (_, i) => makeLine(i));
  const subtotalCents = lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitCents), 0);
  const taxRateBp = 825; // 8.25%
  const taxCents = Math.round((subtotalCents * taxRateBp) / 10000);
  const totalCents = subtotalCents + taxCents;

  return {
    kind: "invoice",
    number: "INV-2026-0417",
    issuedOn: "2026-09-01",
    dueOn: "2026-09-30",
    validUntil: null,
    business: BUSINESS,
    customer: {
      name: "Marguerite Okonkwo-Delacroix-Whitfield the Third",
      company: "Whitfield Family Holdings LLC",
      email: "marguerite@whitfieldholdings.example",
      phone: "(312) 555-0199",
      address: "88 Lakeshore Drive, Unit 1204\nChicago, IL 60601",
    },
    lines,
    subtotalCents,
    taxRateBp,
    taxCents,
    totalCents,
    currency: "USD",
    notes: "Thank you for your business. Please let us know if the repair holds up over the next week.",
    paymentInstructions: "Pay by check to Rundle & Sons Plumbing, or by card at the link in this email.",
    ...overrides,
  };
}

describe("renderDocument", () => {
  const assets = loadTestAssets();

  it("renders a well-formed, non-empty PDF for a 3-line invoice (1 page)", async () => {
    const input = makeInput(3);
    const bytes = await renderDocument(input, assets);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("renders a well-formed PDF for a 40-line invoice, paginated across multiple pages", async () => {
    const input = makeInput(40);
    const bytes = await renderDocument(input, assets);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });

  it("renders a quote with 'Valid until' instead of 'Due', without throwing", async () => {
    const input = makeInput(5, {
      kind: "quote",
      number: "QUO-2026-0091",
      dueOn: null,
      validUntil: "2026-10-15",
    });
    const bytes = await renderDocument(input, assets);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("never throws when assets are entirely missing (falls back to Helvetica, no logo)", async () => {
    const emptyAssets: DocumentAssets = {
      fonts: { heading: null, headingBold: null, body: null, bodyBold: null },
      logoPng: null,
    };
    const input = makeInput(2);
    const bytes = await renderDocument(input, emptyAssets);
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Bill-to block: pdf-lib cannot read text back out of a rendered PDF (see
  // the note below), so what these can verify is that renderDocument never
  // throws or produces a malformed PDF for the customer shapes that used to
  // draw a blank first line -- a contact with no name, no contact at all,
  // and nothing but an email. The actual title/detail-line decisions are
  // covered exhaustively, as pure functions, in billTo.test.ts; renderDocument
  // itself is proven to consult that same decision in drawCustomerBlock.
  // ---------------------------------------------------------------------------
  describe("bill-to block with a missing name", () => {
    it("renders when the contact has no name but the document has a company", async () => {
      const input = makeInput(2, {
        customer: {
          name: "",
          company: "Whitfield Family Holdings LLC",
          email: "office@whitfieldholdings.example",
          phone: "(312) 555-0199",
          address: "88 Lakeshore Drive, Unit 1204\nChicago, IL 60601",
        },
      });
      const bytes = await renderDocument(input, assets);
      expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
      const loaded = await PDFDocument.load(bytes);
      expect(loaded.getPageCount()).toBe(1);
    });

    it("renders when there is no contact and no company, only an email", async () => {
      const input = makeInput(2, {
        customer: { name: "", company: "", email: "marguerite@example.com", phone: "", address: "" },
      });
      const bytes = await renderDocument(input, assets);
      expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
      const loaded = await PDFDocument.load(bytes);
      expect(loaded.getPageCount()).toBe(1);
    });

    it("renders when the document has no customer information at all", async () => {
      const input = makeInput(2, {
        customer: { name: "", company: "", email: "", phone: "", address: "" },
      });
      const bytes = await renderDocument(input, assets);
      expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
      const loaded = await PDFDocument.load(bytes);
      expect(loaded.getPageCount()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // F-LB-21: the page break is measured, not counted. pdf-lib cannot read a
  // drawn y-coordinate back out of a saved PDF, so what these assert is the
  // measured plan itself -- planPageLayout() runs the exact same startY,
  // row-height, and footer-block measurements renderDocument() draws from,
  // and returns the y left after each page's content instead of pixels on a
  // page. Asserting that number stays at or above CONTENT_BOTTOM_LIMIT is
  // the direct version of "nothing was drawn over the footer"; the sample
  // PDFs (HELIX_PDF_SAMPLE=1) are what a human looks at to confirm it.
  // ---------------------------------------------------------------------------
  describe("F-LB-21: measured page breaks", () => {
    const longDescription =
      "Includes parts, labour, and disposal of the old fixtures per the estimate we walked through on site. " +
      "Follow-up inspection is scheduled within thirty days at no extra charge if anything needs adjustment.";

    function describedLine(i: number): RenderLine {
      return makeLine(i, {
        name: `Service call with a long line item name to force truncation, unit ${i + 1}`,
        description: longDescription,
      });
    }

    function makeDescribedInput(lineCount: number, overrides: Partial<RenderInput> = {}): RenderInput {
      return makeInput(lineCount, {
        lines: Array.from({ length: lineCount }, (_, i) => describedLine(i)),
        ...overrides,
      });
    }

    it("keeps every page's content above the footer for 12 long-described lines", async () => {
      const input = makeDescribedInput(12);
      const plan = await planPageLayout(input, assets);

      expect(plan.rowsPerPage.reduce((a, b) => a + b, 0)).toBe(12);
      for (const bottomY of plan.contentBottomYPerPage) {
        expect(bottomY).toBeGreaterThanOrEqual(CONTENT_BOTTOM_LIMIT);
      }

      // Cross-check the diagnostic against the PDF renderDocument() actually produces.
      const bytes = await renderDocument(input, assets);
      const loaded = await PDFDocument.load(bytes);
      expect(loaded.getPageCount()).toBe(plan.pageCount);
    });

    it("paginates 18 long-described lines across more than one page", async () => {
      const input = makeDescribedInput(18);
      const plan = await planPageLayout(input, assets);

      expect(plan.pageCount).toBeGreaterThan(1);
      expect(plan.rowsPerPage.reduce((a, b) => a + b, 0)).toBe(18);
      for (const bottomY of plan.contentBottomYPerPage) {
        expect(bottomY).toBeGreaterThanOrEqual(CONTENT_BOTTOM_LIMIT);
      }

      const bytes = await renderDocument(input, assets);
      const loaded = await PDFDocument.load(bytes);
      expect(loaded.getPageCount()).toBe(plan.pageCount);
    });

    it("moves totals and payment instructions to a further page when the last page of rows leaves no room", async () => {
      // Find, by measurement (not a hard-coded guess), the largest number of
      // plain (no-description) rows that still fits on a single page with
      // short notes/payment text -- then reuse that same row count with long
      // notes/payment text, which the rows leave no room for.
      let fullPageRowCount = 1;
      for (let n = 1; n <= 40; n += 1) {
        const probe = makeInput(n, { lines: Array.from({ length: n }, (_, i) => makeLine(i, { description: null })) });
        const plan = await planPageLayout(probe, assets);
        if (plan.pageCount > 1) break;
        fullPageRowCount = n;
      }

      const longParagraph = Array.from(
        { length: 12 },
        () => "This is a long line of notes text meant to consume several wrapped lines of vertical space.",
      ).join(" ");

      const input = makeInput(fullPageRowCount, {
        lines: Array.from({ length: fullPageRowCount }, (_, i) => makeLine(i, { description: null })),
        notes: longParagraph,
        paymentInstructions: longParagraph,
      });
      const plan = await planPageLayout(input, assets);

      // All rows still fit on the first page; the totals/notes/payment block
      // did not, so it was pushed to a further page with no rows of its own.
      expect(plan.rowsPerPage[0]).toBe(fullPageRowCount);
      expect(plan.pageCount).toBeGreaterThan(1);
      expect(plan.rowsPerPage[plan.rowsPerPage.length - 1]).toBe(0);
      for (const bottomY of plan.contentBottomYPerPage) {
        expect(bottomY).toBeGreaterThanOrEqual(CONTENT_BOTTOM_LIMIT);
      }

      const bytes = await renderDocument(input, assets);
      const loaded = await PDFDocument.load(bytes);
      expect(loaded.getPageCount()).toBe(plan.pageCount);
    });

    it("draws a single row taller than an empty page without looping forever", async () => {
      // No real row can exceed ROW_HEIGHT + ROW_DESCRIPTION_EXTRA today, but
      // the planner's own "always accept the first row of a page" rule is
      // what prevents an infinite loop if one ever could -- this just proves
      // planning terminates and places every line somewhere.
      const input = makeDescribedInput(1);
      const plan = await planPageLayout(input, assets);
      expect(plan.rowsPerPage.reduce((a, b) => a + b, 0)).toBe(1);
      expect(plan.pageCount).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Byte-level content: tried and dropped. This was meant to assert the raw
  // saved bytes contain the document number and formatted total, using
  // `doc.save({ useObjectStreams: false })` to get an "uncompressed" save.
  //
  // That does not work, and not for the reason the useObjectStreams name
  // suggests. Verified directly (outside this suite, by inflating pdf-lib's
  // own output): `useObjectStreams: false` only changes how the PDF's
  // cross-reference table is written -- pdf-lib still runs every page's
  // content stream through FlateDecode regardless of that option, and pdf-lib
  // has no save option to turn that off. Even worse for this approach: pdf-lib
  // does not draw StandardFonts.Helvetica text as literal "(...)" ASCII
  // strings either -- it emits `<48657820> Tj`, a hex-encoded string, for
  // every drawText() call, custom font or not. So a plain substring search
  // for "INV-2026-0417" or a formatted total finds nothing, even though the
  // bytes are, in a hex-encoded and flate-compressed form, in there.
  //
  // Making this assertion real would mean re-implementing a chunk of a PDF
  // parser in the test (walk the object table, find each content stream,
  // zlib-inflate it, hex-decode the Tj/TJ operands, and search that) -- at
  // which point the test is no longer verifying this renderer, it is
  // verifying a hand-rolled PDF reader. Per this feature's brief: do not fake
  // a text-extraction assertion pdf-lib cannot back. What is left, and what
  // is actually asserted above, is that renderDocument() produces a
  // structurally valid PDF (loadable, correct page count) of a reasonable,
  // non-zero size.
  // -------------------------------------------------------------------------
});
