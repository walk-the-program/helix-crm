/**
 * What the two PDFs actually SAY, read back out of the rendered bytes.
 *
 * `pdfLayout.test.ts` opens with "pdf-lib cannot extract text back out of a
 * PDF it loaded", and for the shipping PDF that is true: the invoice embeds
 * subsetted Zilla Slab and Lato through fontkit, so the content stream holds
 * glyph ids and reading them back would mean writing a font-aware extractor
 * inside a test. That note is why the payments work was first verified only
 * through the pure functions that produce the strings, which proves the
 * strings are right but not that they were ever drawn on a page.
 *
 * There is a way through, and it is the renderer's own fallback path.
 * `embedWithFallback` drops to `StandardFonts` whenever fontkit or a font file
 * is unavailable, and a standard font is WinAnsi encoded -- so the same
 * `renderDocument` and `renderStatement`, running the same layout code, with
 * no assets passed, write their text into the content stream as plain
 * characters. Decompressing the stream and decoding the text operators then
 * reads the page.
 *
 * What this suite therefore proves, and pdfLayout.test.ts cannot: the words
 * "Paid to date" and "Balance due" and the right figures are ON the invoice
 * when it has payments and are ABSENT when it does not, and the statement
 * carries its opening balance, each invoice and payment, and its closing
 * line. The glyphs differ between this path and the shipping one; the text
 * and the layout that places it do not.
 */
import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { renderDocument, type RenderInput } from "@/features/invoices/pdf/renderDocument";
import {
  renderStatement,
  type RenderStatementInput,
} from "@/features/invoices/pdf/renderStatement";
import type { DocumentAssets } from "@/features/invoices/pdf/assets";

/** No fonts and no logo: the renderer falls back to StandardFonts. */
const NO_ASSETS: DocumentAssets = {
  fonts: { heading: null, headingBold: null, body: null, bodyBold: null },
  logoPng: null,
};

/**
 * Every string the page draws, in drawing order.
 *
 * pdf-lib writes each `drawText` as a hex string followed by `Tj`; a literal
 * `(…) Tj` is accepted too so this does not depend on which form pdf-lib
 * happens to choose. Content streams are Flate-compressed on save, hence the
 * inflate, with a plain fallback for the uncompressed case.
 */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];

  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of("Contents"));
    const refs =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [doc.context.lookup(contents as never)];

    for (const stream of refs) {
      if (!(stream instanceof PDFRawStream)) continue;
      let raw = Buffer.from(stream.contents);
      try {
        raw = inflateSync(raw);
      } catch {
        // Not compressed; the bytes are already the content stream.
      }
      const text = raw.toString("latin1");

      for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
        out.push(Buffer.from(match[1], "hex").toString("latin1"));
      }
      for (const match of text.matchAll(/\(((?:\\.|[^()\\])*)\)\s*Tj/g)) {
        out.push(match[1].replace(/\\([()\\])/g, "$1"));
      }
    }
  }

  return out.join("\n");
}

function invoice(payments?: RenderInput["payments"]): RenderInput {
  return {
    kind: "invoice",
    number: "INV-2026-0004",
    issuedOn: "2026-03-01",
    dueOn: "2026-03-15",
    validUntil: null,
    business: {
      name: "Bishop Landscaping",
      address: "12 Mill Lane",
      phone: "555 0143",
      email: "sam@bishop.example",
      taxId: "",
    },
    customer: {
      name: "Dana Reed",
      company: "",
      email: "dana@reed.example",
      phone: "",
      address: "8 Pine Street",
    },
    lines: [
      {
        name: "Retaining wall",
        description: null,
        qty: 1,
        unitCents: 120000,
        taxable: false,
        kind: "one_time",
        interval: null,
      },
    ],
    subtotalCents: 120000,
    taxRateBp: 0,
    taxCents: 0,
    totalCents: 120000,
    currency: "USD",
    notes: null,
    paymentInstructions: null,
    payments: payments ?? null,
  };
}

describe("the invoice PDF says what was paid and what is left", () => {
  it("prints Paid to date and Balance due, with the figures, when payments exist", async () => {
    const bytes = await renderDocument(
      invoice({
        paidToDateCents: 50000,
        balanceDueCents: 70000,
        lines: [
          { paidOn: "2026-03-04", methodLabel: "Check", reference: "4412", amountCents: 50000 },
        ],
      }),
      NO_ASSETS,
    );
    const text = await pdfText(bytes);

    expect(text).toContain("Paid to date");
    expect(text).toContain("Balance due");
    // The figures, not just the labels: a balance line with the wrong number
    // on it is worse than no balance line at all.
    expect(text).toContain("$1,200.00");
    expect(text).toContain("$500.00");
    expect(text).toContain("$700.00");
    expect(text).toContain("INV-2026-0004");
  });

  it("lists each payment with its day, method and reference when there are several", async () => {
    const bytes = await renderDocument(
      invoice({
        paidToDateCents: 90000,
        balanceDueCents: 30000,
        lines: [
          { paidOn: "2026-03-04", methodLabel: "Check", reference: "4412", amountCents: 50000 },
          { paidOn: "2026-03-20", methodLabel: "Bank transfer", reference: null, amountCents: 40000 },
        ],
      }),
      NO_ASSETS,
    );
    const text = await pdfText(bytes);

    expect(text).toContain("Check");
    expect(text).toContain("4412");
    expect(text).toContain("Bank transfer");
    expect(text).toContain("$400.00");
    expect(text).toContain("$900.00");
    expect(text).toContain("$300.00");
  });

  it("says neither when the invoice has no payments", async () => {
    const text = await pdfText(await renderDocument(invoice(), NO_ASSETS));

    expect(text).toContain("INV-2026-0004");
    expect(text).toContain("$1,200.00");
    // The whole point of the optional block: an unpaid invoice is the
    // document it always was, with no "$0.00 paid" row explaining itself.
    expect(text).not.toContain("Paid to date");
    expect(text).not.toContain("Balance due");
  });
});

describe("the statement PDF says where the customer stands", () => {
  const statement: RenderStatementInput = {
    business: {
      name: "Bishop Landscaping",
      address: "12 Mill Lane",
      phone: "555 0143",
      email: "sam@bishop.example",
      taxId: "",
    },
    customer: {
      name: "Dana Reed",
      company: "Reed Holdings",
      email: "dana@reed.example",
      phone: "",
      address: "8 Pine Street",
    },
    fromDay: "2026-03-01",
    toDay: "2026-03-31",
    rows: [
      {
        kind: "opening",
        on: "2026-03-01",
        label: "Opening balance",
        chargeCents: null,
        paidCents: null,
        balanceCents: 20000,
      },
      {
        kind: "invoice",
        on: "2026-03-02",
        label: "INV-2026-0004",
        chargeCents: 120000,
        paidCents: null,
        balanceCents: 140000,
      },
      {
        kind: "payment",
        on: "2026-03-04",
        label: "Check 4412",
        chargeCents: null,
        paidCents: 50000,
        balanceCents: 90000,
      },
      {
        kind: "payment",
        on: "2026-03-20",
        label: "Bank transfer",
        chargeCents: null,
        paidCents: 20000,
        balanceCents: 70000,
      },
    ],
    closingBalanceCents: 70000,
    currency: "USD",
  };

  it("carries the opening balance, every row, and the closing line", async () => {
    const text = await pdfText(await renderStatement(statement, NO_ASSETS));

    expect(text).toContain("Statement");
    expect(text).toContain("Dana Reed");
    expect(text).toContain("Opening balance");
    expect(text).toContain("$200.00");
    expect(text).toContain("INV-2026-0004");
    expect(text).toContain("$1,200.00");
    expect(text).toContain("Check 4412");
    expect(text).toContain("$500.00");
    expect(text).toContain("Bank transfer");
    // The closing position, which is the one number the customer reads.
    expect(text).toContain("$700.00");
    expect(text).toContain("outstanding");
  });

  it("closes on the state rather than a zero when nothing is owed", async () => {
    const settled: RenderStatementInput = {
      ...statement,
      rows: [
        { ...statement.rows[0], balanceCents: 0 },
        { ...statement.rows[1], balanceCents: 120000 },
        { ...statement.rows[2], paidCents: 120000, balanceCents: 0 },
      ],
      closingBalanceCents: 0,
    };
    const text = await pdfText(await renderStatement(settled, NO_ASSETS));

    expect(text).toContain("Nothing outstanding");
    expect(text).not.toContain("outstanding as of");
  });
});
