import { it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { renderDocument, type RenderInput } from "@/features/invoices/pdf/renderDocument";
import type { DocumentAssets } from "@/features/invoices/pdf/assets";

const PDF_DIR = fileURLToPath(new URL("../../../src/features/invoices/pdf", import.meta.url));
const OUT = fileURLToPath(new URL("../../e2e-mac/.cache/screens/invoices", import.meta.url));
const read = (...p: string[]) => { try { return new Uint8Array(readFileSync(join(PDF_DIR, ...p))); } catch { return null; } };

/**
 * Writes one realistic invoice PDF so a human can look at it against
 * `assets/brand/guide/helix-crm-brand-guide.html`. It is skipped in a normal
 * `npm test` run because it writes a file and asserts nothing; the layout
 * itself is covered by pdfLayout.test.ts.
 *
 *   HELIX_PDF_SAMPLE=1 npx vitest run tests/unit/invoices/pdfSample.test.ts
 *   sips -s format png <the path it prints> --out sample-invoice.png
 *
 * The first render this produced put the first line of the business address
 * straight through the bottom edge of the logo, which is exactly the kind of
 * thing no assertion was ever going to catch.
 */
it.skipIf(!process.env.HELIX_PDF_SAMPLE)("writes a sample invoice to look at", async () => {
  const assets: DocumentAssets = {
    fonts: {
      heading: read("fonts", "ZillaSlab-SemiBold.ttf"),
      headingBold: read("fonts", "ZillaSlab-Bold.ttf"),
      body: read("fonts", "Lato-Regular.ttf"),
      bodyBold: read("fonts", "Lato-Bold.ttf"),
    },
    logoPng: read("helix-logo-square.png"),
  };
  const input: RenderInput = {
    kind: "invoice",
    number: "INV-2026-0042",
    issuedOn: "2026-09-05",
    dueOn: "2026-09-19",
    validUntil: null,
    business: {
      name: "Rundle & Sons Plumbing",
      address: "412 Cedar Avenue\nSpringfield, IL 62704",
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
    lines: [
      { name: "Emergency callout", description: "Saturday rate, burst feed to the milking parlour.", qty: 1, unitCents: 24500, taxable: false, kind: "one_time", interval: null },
      { name: "Copper pipe, 22mm", description: "12 metres, cut and fitted.", qty: 12, unitCents: 1450, taxable: true, kind: "one_time", interval: null },
      { name: "Labour", description: null, qty: 6, unitCents: 8500, taxable: false, kind: "one_time", interval: null },
      { name: "Boiler service plan", description: "Annual inspection and priority callout.", qty: 1, unitCents: 9900, taxable: false, kind: "recurring", interval: "month" },
    ],
    subtotalCents: 24500 + 17400 + 51000 + 9900,
    taxRateBp: 825,
    taxCents: Math.round(17400 * 825 / 10000),
    totalCents: 24500 + 17400 + 51000 + 9900 + Math.round(17400 * 825 / 10000),
    currency: "USD",
    notes: "Thanks for calling us out on a Saturday. The old feed has been capped off and left in place.",
    paymentInstructions: "Bank transfer to Rundle & Sons Plumbing, sort 40-11-09, account 8123 4457. Cheques payable to the same.",
  };
  const bytes = await renderDocument(input, assets);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "sample-invoice.pdf"), bytes);
  console.log("wrote", join(OUT, "sample-invoice.pdf"), bytes.length, "bytes");
});

/**
 * The same invoice for a customer with no contact name — an account booked
 * against a company, or an import that only ever captured the business.
 *
 * It exists to be looked at, not asserted on: the bug it guards is that the
 * bill-to block used to open with a blank bold line and then print the company
 * underneath as if it were a detail, which no assertion on bytes was going to
 * show. `billTo.test.ts` proves the rule; this proves it looks right.
 *
 *   HELIX_PDF_SAMPLE=1 npx vitest run tests/unit/invoices/pdfSample.test.ts
 */
it.skipIf(!process.env.HELIX_PDF_SAMPLE)(
  "writes a company-only invoice to look at",
  async () => {
    const assets: DocumentAssets = {
      fonts: {
        heading: read("fonts", "ZillaSlab-SemiBold.ttf"),
        headingBold: read("fonts", "ZillaSlab-Bold.ttf"),
        body: read("fonts", "Lato-Regular.ttf"),
        bodyBold: read("fonts", "Lato-Bold.ttf"),
      },
      logoPng: read("helix-logo-square.png"),
    };
    const input: RenderInput = {
      kind: "invoice",
      number: "INV-2026-0043",
      issuedOn: "2026-09-05",
      dueOn: "2026-09-19",
      validUntil: null,
      business: {
        name: "Rundle & Sons Plumbing",
        address: "412 Cedar Avenue\nSpringfield, IL 62704",
        phone: "(217) 555-0142",
        email: "office@rundleplumbing.com",
        taxId: "EIN 47-2810934",
      },
      customer: {
        name: "",
        company: "Ridgeway Farms",
        email: "accounts@ridgewayfarms.example",
        phone: "(217) 555-0188",
        address: "88 Harrow Lane\nChatham, IL 62629",
      },
      lines: [
        { name: "Quarterly parlour service", description: "Two visits, parts included.", qty: 1, unitCents: 48000, taxable: false, kind: "one_time", interval: null },
      ],
      subtotalCents: 48000,
      taxRateBp: 0,
      taxCents: 0,
      totalCents: 48000,
      currency: "USD",
      notes: null,
      paymentInstructions: "Bank transfer to Rundle & Sons Plumbing, sort 40-11-09, account 8123 4457.",
    };
    const bytes = await renderDocument(input, assets);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "sample-invoice-company-only.pdf"), bytes);
    console.log("wrote", join(OUT, "sample-invoice-company-only.pdf"), bytes.length, "bytes");
  },
);

/**
 * A long invoice built to stress the page-break math directly: 12 lines,
 * each with a name around 60 characters and a two-sentence description that
 * wraps, a customer with a long personal name and a long company name, an
 * odd tax rate, and both notes and payment instructions.
 *
 * This is F-LB-21's reproduction case. Under the counted 18-lines-per-page
 * break, 12 described rows plus the header/bill-to block on page one push
 * well past the 490pt or so actually left on the page, so this sample exists
 * to be looked at, before and after the measured-break fix, to see whether
 * rows, totals, or payment instructions land on top of the footer or run off
 * the bottom of the page.
 *
 *   HELIX_PDF_SAMPLE=1 npx vitest run tests/unit/invoices/pdfSample.test.ts
 */
it.skipIf(!process.env.HELIX_PDF_SAMPLE)(
  "writes a long-described invoice to look at (F-LB-21 repro)",
  async () => {
    const assets: DocumentAssets = {
      fonts: {
        heading: read("fonts", "ZillaSlab-SemiBold.ttf"),
        headingBold: read("fonts", "ZillaSlab-Bold.ttf"),
        body: read("fonts", "Lato-Regular.ttf"),
        bodyBold: read("fonts", "Lato-Bold.ttf"),
      },
      logoPng: read("helix-logo-square.png"),
    };

    const longNames = [
      "Emergency after-hours callout and diagnostic labour, full crew",
      "Full system pressure test and certification, residential unit",
      "Copper supply line replacement, kitchen and both bathrooms",
      "Tankless water heater installation and venting, garage location",
      "Sump pump replacement with battery backup and alarm module",
      "Main line camera inspection and written condition report",
      "Hydro-jet drain clearing, kitchen stack to municipal connection",
      "Water softener installation and whole-house bypass valve",
      "Backflow preventer testing and annual compliance filing",
      "Gas line pressure test and appliance reconnection, full house",
      "Fixture replacement package, powder room sink and shutoffs",
      "Annual maintenance plan renewal, priority scheduling included",
    ];

    const lines = longNames.map((name, i) => ({
      name,
      description:
        "Includes parts, labour, and disposal of the old fixtures per the estimate we walked through on site. " +
        "Follow-up inspection is scheduled within thirty days at no extra charge if anything needs adjustment.",
      qty: i % 4 === 0 ? 2 : 1,
      unitCents: 18500 + i * 725,
      taxable: i % 3 !== 0,
      kind: "service",
      interval: i === 11 ? "month" : null,
    }));

    const subtotalCents = lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitCents), 0);
    const taxRateBp = 825;
    const taxableSubtotal = lines
      .filter((line) => line.taxable)
      .reduce((sum, line) => sum + Math.round(line.qty * line.unitCents), 0);
    const taxCents = Math.round((taxableSubtotal * taxRateBp) / 10000);
    const totalCents = subtotalCents + taxCents;

    const input: RenderInput = {
      kind: "invoice",
      number: "INV-2026-0099",
      issuedOn: "2026-09-05",
      dueOn: "2026-09-19",
      validUntil: null,
      business: {
        name: "Rundle & Sons Plumbing",
        address: "412 Cedar Avenue\nSpringfield, IL 62704",
        phone: "(217) 555-0142",
        email: "office@rundleplumbing.com",
        taxId: "EIN 47-2810934",
      },
      customer: {
        name: "Marguerite Okonkwo-Delacroix-Whitfield the Third",
        company: "Whitfield Family Holdings and Ridgeway Agricultural Trust LLC",
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
      notes:
        "Thank you for your continued business over the past several seasons. Please let us know within " +
        "thirty days if any of the work above needs a follow-up visit, and we will schedule it at no charge.",
      paymentInstructions:
        "Pay by check to Rundle & Sons Plumbing, or by card at the link in this email. Balances outstanding " +
        "past thirty days accrue a 1.5% monthly service charge per the terms on the original estimate.",
    };

    const bytes = await renderDocument(input, assets);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "sample-invoice-long-lines.pdf"), bytes);
    console.log("wrote", join(OUT, "sample-invoice-long-lines.pdf"), bytes.length, "bytes");
  },
);
