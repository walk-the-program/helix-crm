/**
 * The `payments` export entity (LR-PX-A W3): a payments.csv in the
 * "everything" zip, a "By list" row, and a live row count -- built the same
 * way every neighbouring builder in exportRun.ts is, real repos through the
 * seeded harness, read back as CSV.
 */
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import Papa from "papaparse";
import { createSeededHarness, type Harness } from "../harness";
import * as companies from "../../../src/db/repos/companies";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import * as deals from "../../../src/db/repos/deals";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import {
  buildEntityCsv,
  buildEverythingZip,
  entityLabel,
  exportCounts,
} from "../../../src/features/data/lib/exportRun";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function csvRows(csv: string): Promise<{ headers: string[]; rows: string[][] }> {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true });
  expect(parsed.errors).toHaveLength(0);
  const [headers, ...rows] = parsed.data;
  return { headers, rows };
}

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  return all[0].id;
}

describe("exportRun: the payments entity", () => {
  it("names it and gives it a live row count", async () => {
    h = await createSeededHarness();
    expect(entityLabel("payments")).toBe("Payments");

    const counts = await exportCounts();
    expect(counts.payments).toBe(0);

    const companyId = (await companies.create({ name: "Ridgeway Farms" })).id;
    const deal = await deals.create({ title: "Fence job", stageId: await firstStageId(), companyId });
    const invoice = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Fence panels", qty: 4, unitCents: 5000 }],
      prefix: "INV",
      issuedOn: "2026-03-01",
    });
    await documents.send(invoice.id);
    await payments.create({
      documentId: invoice.id,
      amountCents: 12_000,
      paidOn: "2026-03-10",
      method: "check",
      reference: "4412",
      note: "Deposit",
    });

    expect((await exportCounts()).payments).toBe(1);
  });

  it("exports one payment with the right headers and a real row", async () => {
    h = await createSeededHarness();
    const companyId = (await companies.create({ name: "Ridgeway Farms" })).id;
    const deal = await deals.create({ title: "Fence job", stageId: await firstStageId(), companyId });
    const invoice = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Fence panels", qty: 4, unitCents: 5000 }],
      prefix: "INV",
      issuedOn: "2026-03-01",
    });
    await documents.send(invoice.id);
    await payments.create({
      documentId: invoice.id,
      amountCents: 12_000,
      paidOn: "2026-03-10",
      method: "check",
      reference: "4412",
      note: "Deposit",
    });

    const { csv, rows: rowCount } = await buildEntityCsv("payments");
    expect(rowCount).toBe(1);

    const { headers, rows } = await csvRows(csv);
    expect(headers).toEqual([
      "Date Paid",
      "Invoice Number",
      "Customer",
      "Deal",
      "Amount",
      "Method",
      "Reference",
      "Note",
      "Recorded",
    ]);
    expect(rows).toHaveLength(1);

    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader["Date Paid"]).toBe("2026-03-10");
    expect(byHeader["Invoice Number"]).toBe(invoice.number);
    expect(byHeader.Customer).toBe("Ridgeway Farms");
    expect(byHeader.Deal).toBe("Fence job");
    expect(byHeader.Amount).toBe("120.00");
    expect(byHeader.Method).toBe("Check");
    expect(byHeader.Reference).toBe("4412");
    expect(byHeader.Note).toBe("Deposit");
    expect(byHeader.Recorded.length).toBeGreaterThan(0);
  });

  it("excludes a soft-deleted payment and a payment on a soft-deleted invoice", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();

    const keptDeal = await deals.create({ title: "Kept deal", stageId });
    const keptInvoice = await documents.create({
      kind: "invoice",
      dealId: keptDeal.id,
      items: [{ name: "Service call", qty: 1, unitCents: 10_000 }],
      prefix: "INV",
      issuedOn: "2026-03-01",
    });
    await documents.send(keptInvoice.id);
    const keptPayment = await payments.create({
      documentId: keptInvoice.id,
      amountCents: 10_000,
      paidOn: "2026-03-05",
      method: "cash",
    });
    await payments.create({
      documentId: keptInvoice.id,
      amountCents: 0,
      paidOn: "2026-03-05",
      method: "cash",
    }).catch(() => null); // guard rail sanity: a zero amount is refused, not relevant to this test

    const removedDeal = await deals.create({ title: "Removed deal", stageId });
    const removedInvoice = await documents.create({
      kind: "invoice",
      dealId: removedDeal.id,
      items: [{ name: "Another job", qty: 1, unitCents: 20_000 }],
      prefix: "INV",
      issuedOn: "2026-03-01",
    });
    await documents.send(removedInvoice.id);
    await payments.create({ documentId: removedInvoice.id, amountCents: 20_000, paidOn: "2026-03-06", method: "cash" });
    await documents.softDelete(removedInvoice.id);

    await payments.remove(keptPayment.id);
    const restoredKept = await payments.create({
      documentId: keptInvoice.id,
      amountCents: 10_000,
      paidOn: "2026-03-07",
      method: "transfer",
    });

    const { csv, rows: rowCount } = await buildEntityCsv("payments");
    expect(rowCount).toBe(1);
    expect(csv).toContain(restoredKept.paidOn);
    expect(csv).not.toContain("2026-03-06");
  });

  it("appears as payments.csv in the everything zip, and in the JSON dump under 'payments'", async () => {
    h = await createSeededHarness();
    const companyId = (await companies.create({ name: "Ridgeway Farms" })).id;
    const deal = await deals.create({ title: "Fence job", stageId: await firstStageId(), companyId });
    const invoice = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Fence panels", qty: 4, unitCents: 5000 }],
      prefix: "INV",
      issuedOn: "2026-03-01",
    });
    await documents.send(invoice.id);
    await payments.create({ documentId: invoice.id, amountCents: 12_000, paidOn: "2026-03-10", method: "check" });

    const { bytes, files } = await buildEverythingZip();
    expect(files).toContain("payments.csv");

    const reopened = await JSZip.loadAsync(bytes);
    const paymentsCsv = await reopened.file("payments.csv")?.async("string");
    expect(paymentsCsv).toContain(invoice.number);
    expect(paymentsCsv).toContain("120.00");

    const jsonText = await reopened.file("helix-export.json")?.async("string");
    const dump = JSON.parse(jsonText ?? "{}");
    expect(Array.isArray(dump.payments)).toBe(true);
    expect(dump.payments[0]["Invoice Number"]).toBe(invoice.number);
  });
});
