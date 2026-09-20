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
