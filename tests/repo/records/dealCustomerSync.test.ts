/**
 * A document never stores a different customer from its deal (round 3,
 * "Money model"). The deal is where the customer is corrected, so editing it
 * has to carry its quotes and invoices along.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as companies from "../../../src/db/repos/companies";
import * as contacts from "../../../src/db/repos/contacts";
import * as deals from "../../../src/db/repos/deals";
import * as documents from "../../../src/db/repos/documents";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

/** `documents.getOrThrow` answers { document, items }; these tests want the row. */
async function docById(id: string) {
  return (await documents.getOrThrow(id)).document;
}

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  return (await stages.list(pipeline.id))[0].id;
}

async function arrange() {
  h = await createSeededHarness();
  const acme = await companies.create({ name: "Acme Roofing" });
  const priya = await contacts.create({
    firstName: "Priya",
    lastName: "Raman",
    companyId: acme.id,
  });
  const deal = await deals.create({
    title: "Re-roof at 14 Elm",
    stageId: await firstStageId(),
    contactId: priya.id,
    companyId: acme.id,
  });
  const invoice = await documents.create({
    kind: "invoice",
    dealId: deal.id,
    prefix: "INV",
    items: [{ name: "Re-roof", qty: 1, unitCents: 120000, taxable: false }],
  });
  return { acme, priya, deal, invoice };
}

describe("deals.update keeps the deal's documents on the same customer", () => {
  it("moves the invoice's company when the deal's company changes", async () => {
    const { deal, invoice } = await arrange();
    const other = await companies.create({ name: "Bluebird Exteriors" });

    await deals.update(deal.id, { companyId: other.id });

    const after = await docById(invoice.id);
    expect(after.companyId).toBe(other.id);
  });

  it("moves the invoice's contact when the deal's contact changes", async () => {
    const { deal, invoice } = await arrange();
    const dale = await contacts.create({ firstName: "Dale", lastName: "Winters" });

    await deals.update(deal.id, { contactId: dale.id });

    const after = await docById(invoice.id);
    expect(after.contactId).toBe(dale.id);
  });

  it("clears the document's company when the deal's is cleared", async () => {
    const { deal, invoice } = await arrange();
    await deals.update(deal.id, { companyId: null });
    expect((await docById(invoice.id)).companyId).toBeNull();
  });

  it("leaves the documents alone when the edit is not about the customer", async () => {
    const { deal, invoice, acme, priya } = await arrange();
    const before = await docById(invoice.id);

    await deals.update(deal.id, { title: "Re-roof at 14 Elm Street" });

    const after = await docById(invoice.id);
    expect(after.companyId).toBe(acme.id);
    expect(after.contactId).toBe(priya.id);
    // Untouched, not rewritten with the same values.
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});
