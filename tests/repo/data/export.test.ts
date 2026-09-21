/**
 * Export repo test: real repos write through the seeded harness, then
 * buildEntityCsv/buildEverythingZip read the data back out as CSV/JSON.
 */
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import Papa from "papaparse";
import { createSeededHarness, type Harness } from "../harness";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as deals from "../../../src/db/repos/deals";
import * as tasks from "../../../src/db/repos/tasks";
import * as activities from "../../../src/db/repos/activities";
import * as tags from "../../../src/db/repos/tags";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import * as products from "../../../src/db/repos/products";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as customFields from "../../../src/db/repos/customFields";
import * as recurring from "../../../src/db/repos/recurring";
import * as templates from "../../../src/db/repos/templates";
import * as savedViews from "../../../src/db/repos/savedViews";
import * as attachments from "../../../src/db/repos/attachments";
import * as dealItems from "../../../src/db/repos/dealItems";
import {
  buildEntityCsv,
  buildEverythingZip,
  EXPORT_ENTITIES,
  entityLabel,
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

describe("exportRun: entityLabel and EXPORT_ENTITIES", () => {
  it("names every entity", () => {
    // Round 2 (F-LC-4): Services and Invoices joined the "By list" rows.
    // LR-PX-A W3: Payments joined them too.
    expect(EXPORT_ENTITIES).toEqual([
      "contacts",
      "companies",
      "deals",
      "tasks",
      "activities",
      "services",
      "invoices",
      "payments",
    ]);
    for (const entity of EXPORT_ENTITIES) {
      expect(entityLabel(entity).length).toBeGreaterThan(0);
    }
  });
});

describe("exportRun: buildEntityCsv", () => {
  it("exports contacts with flattened emails/phones/address/tags, excluding soft-deleted rows", async () => {
    h = await createSeededHarness();

    const acme = await companies.create({ name: "Acme Inc" });

    const ada = await contacts.create({
      firstName: "Ada",
      lastName: "Lovelace",
      companyId: acme.id,
      addressJson: JSON.stringify({
        street: "12 Analytical Way",
        city: "London",
        state: "",
        postal: "SW1A 1AA",
        country: "UK",
      }),
      notes: "Countess of Lovelace",
      emails: [
        { email: "ada@work.example", label: "work", isPrimary: true },
        { email: "ada@home.example", label: "home", isPrimary: false },
      ],
      phones: [
        { raw: "(415) 555-0132", label: "mobile", isPrimary: true },
        { raw: "call the office", label: "office", isPrimary: false },
      ],
    });
    const vip = await tags.ensure("VIP");
    await tags.attach(vip.id, "contact", ada.id);

    const gone = await contacts.create({ firstName: "Ghost", lastName: "Gone" });
    await contacts.softDelete(gone.id);

    const { csv, rows: rowCount } = await buildEntityCsv("contacts");
    expect(rowCount).toBe(1);

    const { headers, rows } = await csvRows(csv);
    expect(headers).toEqual([
      "First Name",
      "Last Name",
      "Company",
      "Emails",
      "Primary Email",
      "Phones",
      "Primary Phone",
      "Phones E164",
      "Address",
      "Source",
      "Tags",
      "Notes",
      "Created At",
    ]);
    expect(rows).toHaveLength(1);

    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader["First Name"]).toBe("Ada");
    expect(byHeader["Last Name"]).toBe("Lovelace");
    expect(byHeader.Company).toBe("Acme Inc");
    expect(byHeader.Emails).toBe("ada@work.example; ada@home.example");
    expect(byHeader["Primary Email"]).toBe("ada@work.example");
    expect(byHeader.Phones).toBe("(415) 555-0132; call the office");
    expect(byHeader["Primary Phone"]).toBe("(415) 555-0132");
    // A leading "+" is a formula-injection trigger char, so the guard
    // prefixes it with a quote (still quoted per RFC4180, unescaped by Papa).
    expect(byHeader["Phones E164"]).toBe("'+14155550132");
    expect(byHeader.Address).toBe("12 Analytical Way, London, SW1A 1AA, UK");
    expect(byHeader.Tags).toBe("VIP");
    expect(byHeader.Notes).toBe("Countess of Lovelace");
    expect(byHeader["Created At"].length).toBeGreaterThan(0);

    // The soft-deleted contact must not appear anywhere in the export.
    expect(csv).not.toContain("Ghost");
  });

  it("exports deals with money as a decimal string and excludes soft-deleted rows", async () => {
    h = await createSeededHarness();

    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.firstStage(pipeline.id);
    if (!stage) throw new Error("seeded pipeline has no first stage");

    const acme = await companies.create({ name: "Acme Inc" });
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });

    const deal = await deals.create({
      title: "Analytical Engine",
      valueCents: 150000,
      stageId: stage.id,
      contactId: ada.id,
      companyId: acme.id,
      expectedOn: "2026-12-01",
    });

    const closedOut = await deals.create({
      title: "Cancelled deal",
      valueCents: 5000,
      stageId: stage.id,
    });
    await deals.softDelete(closedOut.id);

    const { csv, rows: rowCount } = await buildEntityCsv("deals");
    expect(rowCount).toBe(1);

    const { headers, rows } = await csvRows(csv);
    expect(headers).toEqual([
      "Title",
      "Value",
      "Stage",
      "Pipeline",
      "Contact",
      "Company",
      "Expected On",
      "Source",
      "Outcome Reason",
      "Created At",
    ]);
    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader.Title).toBe("Analytical Engine");
    expect(byHeader.Value).toBe("1500.00");
    expect(byHeader.Stage).toBe(stage.name);
    expect(byHeader.Pipeline).toBe(pipeline.name);
    expect(byHeader.Contact).toBe("Ada Lovelace");
    expect(byHeader.Company).toBe("Acme Inc");
    expect(byHeader["Expected On"]).toBe("2026-12-01");
    expect(deal.id.length).toBeGreaterThan(0);

    expect(csv).not.toContain("Cancelled deal");
  });

  it("exports tasks and activities linked to contact/company/deal names", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.firstStage(pipeline.id);
    if (!stage) throw new Error("seeded pipeline has no first stage");

    const acme = await companies.create({ name: "Acme Inc" });
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const deal = await deals.create({
      title: "Analytical Engine",
      stageId: stage.id,
      contactId: ada.id,
      companyId: acme.id,
    });

    await tasks.create({
      title: "Follow up",
      dueOn: "2026-10-01",
      contactId: ada.id,
      companyId: acme.id,
      dealId: deal.id,
    });
    const doneTask = await tasks.create({ title: "Already done" });
    await tasks.complete(doneTask.id);

    await activities.create({
      kind: "call",
      body: "Discussed the engine",
      contactId: ada.id,
      companyId: acme.id,
      dealId: deal.id,
    });

    const { csv: taskCsv } = await buildEntityCsv("tasks");
    const { headers: taskHeaders, rows: taskRows } = await csvRows(taskCsv);
    // Length/Place/Note/Source added by LR-LA F-LA-6: a booked visit is a task
    // carrying exactly those first three (0007, 0009), and without them the
    // export handed a leaving client a visit with no address, no length and no
    // gate code.
    expect(taskHeaders).toEqual([
      "Title",
      "Done",
      "Due On",
      "Due At",
      "Length (minutes)",
      "Place",
      "Note",
      "Source",
      "Contact",
      "Company",
      "Deal",
      "Created At",
    ]);
    expect(taskRows).toHaveLength(2);
    const followUp = taskRows.find((r) => r[0] === "Follow up");
    expect(followUp?.[1]).toBe("false");
    expect(followUp?.[8]).toBe("Ada Lovelace");
    expect(followUp?.[9]).toBe("Acme Inc");
    expect(followUp?.[10]).toBe("Analytical Engine");
    const already = taskRows.find((r) => r[0] === "Already done");
    expect(already?.[1]).toBe("true");

    const { csv: activityCsv } = await buildEntityCsv("activities");
    const { headers: activityHeaders, rows: activityRows } = await csvRows(activityCsv);
    expect(activityHeaders).toEqual([
      "Kind",
      "Body",
      "Occurred At",
      "Contact",
      "Company",
      "Deal",
      "Created At",
    ]);
    // The call the test logged, plus the "Task added" entry that "Follow up"
    // wrote with itself (round 3, criterion 26). "Already done" is linked to
    // no record, so it has no timeline to write to and adds no row. The
    // export carries the whole timeline, system entries included.
    expect(activityRows).toHaveLength(2);
    const call = activityRows.find((r) => r[0] === "call");
    expect(call?.[1]).toBe("Discussed the engine");
    expect(call?.[3]).toBe("Ada Lovelace");
    expect(call?.[4]).toBe("Acme Inc");
    expect(call?.[5]).toBe("Analytical Engine");
    expect(activityRows.filter((r) => r[0] === "system").map((r) => r[1])).toEqual([
      "Task added: Follow up",
    ]);
  });

  it("guards a formula-like company name so it survives a spreadsheet round trip", async () => {
    h = await createSeededHarness();
    await companies.create({ name: "=2+2 Consulting" });

    const { csv } = await buildEntityCsv("companies");
    expect(csv).toContain(`"'=2+2 Consulting"`);

    const { rows } = await csvRows(csv);
    expect(rows[0][0]).toBe("'=2+2 Consulting");
  });

  it("guards a formula-like name and notes in a newly added table too (acceptance 6)", async () => {
    h = await createSeededHarness();
    // Same two trigger characters the packet calls out, on a table that did
    // not exist in the export before this round: a leading "=" in the name
    // and a leading "=" in a free-text column (description stands in for
    // "notes" here - products has no notes field).
    await products.create({
      name: "=SUM(A1:A9)",
      description: "=cmd|/c calc",
      unitPriceCents: 1000,
    });

    const { csv } = await buildEntityCsv("services");
    expect(csv).toContain(`"'=SUM(A1:A9)"`);
    expect(csv).toContain(`"'=cmd|/c calc"`);

    const { headers, rows } = await csvRows(csv);
    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader.Name).toBe("'=SUM(A1:A9)");
    expect(byHeader.Description).toBe("'=cmd|/c calc");
  });

  it("exports services (products) with price as a decimal string, excluding soft-deleted rows", async () => {
    h = await createSeededHarness();
    await products.create({
      name: "Lawn mowing",
      description: "Weekly, front and back",
      kind: "recurring",
      interval: "month",
      unitPriceCents: 12500,
      taxable: true,
    });
    const gone = await products.create({ name: "Retired service", unitPriceCents: 500 });
    await products.softDelete(gone.id);

    const { csv, rows: rowCount } = await buildEntityCsv("services");
    expect(rowCount).toBe(1);

    const { headers, rows } = await csvRows(csv);
    expect(headers).toEqual([
      "Name",
      "Description",
      "Kind",
      "Interval",
      "Price",
      "Taxable",
      "Active",
      "Created At",
    ]);
    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader.Name).toBe("Lawn mowing");
    expect(byHeader.Description).toBe("Weekly, front and back");
    expect(byHeader.Kind).toBe("Recurring");
    expect(byHeader.Interval).toBe("Month");
    expect(byHeader.Price).toBe("125.00");
    expect(byHeader.Taxable).toBe("true");
    expect(byHeader.Active).toBe("true");
    expect(csv).not.toContain("Retired service");
  });

  it("exports invoices with money readable and Kind distinguishing them from quotes (acceptance 7)", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.firstStage(pipeline.id);
    if (!stage) throw new Error("seeded pipeline has no first stage");
    const acme = await companies.create({ name: "Acme Inc" });
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const deal = await deals.create({
      title: "Analytical Engine",
      stageId: stage.id,
      contactId: ada.id,
      companyId: acme.id,
    });

    await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Engine build", qty: 1, unitCents: 150000, taxable: true }],
      taxRateBp: 825,
      prefix: "INV",
      issuedOn: "2026-09-01",
      dueOn: "2026-09-30",
    });
    await documents.create({
      kind: "quote",
      dealId: deal.id,
      items: [{ name: "Engine build (quoted)", qty: 1, unitCents: 150000 }],
      prefix: "QUO",
    });

    // "By list" Invoices: quotes are excluded, and the count matches the db.
    const { csv, rows: rowCount } = await buildEntityCsv("invoices");
    expect(rowCount).toBe(1);
    const { headers, rows } = await csvRows(csv);
    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader.Kind).toBe("Invoice");
    expect(byHeader.Deal).toBe("Analytical Engine");
    expect(byHeader.Contact).toBe("Ada Lovelace");
    expect(byHeader.Company).toBe("Acme Inc");
    expect(byHeader.Subtotal).toBe("1500.00");
    expect(byHeader["Tax Rate"]).toBe("8.25%");
    expect(byHeader.Total.length).toBeGreaterThan(0);
    expect(csv).not.toContain("quoted");
  });

  it("exports payments with money readable, the invoice number and the human method label (LR-PX-A W3)", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.firstStage(pipeline.id);
    if (!stage) throw new Error("seeded pipeline has no first stage");
    const acme = await companies.create({ name: "Acme Inc" });
    const deal = await deals.create({ title: "Analytical Engine", stageId: stage.id, companyId: acme.id });

    const invoice = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Engine build", qty: 1, unitCents: 150000 }],
      prefix: "INV",
      issuedOn: "2026-09-01",
    });
    await documents.send(invoice.id);
    await payments.create({
      documentId: invoice.id,
      amountCents: 60000,
      paidOn: "2026-09-10",
      method: "check",
      reference: "4412",
      note: "Deposit",
    });

    // A payment against an invoice the Trash has taken: excluded, because
    // every money query (and now the export) joins documents and tests
    // `d.deleted_at IS NULL` - soft-deleting the invoice does not touch its
    // payment rows (fix(payments) fae3c78), so the export has to filter on
    // the DOCUMENT's deleted_at, not only the payment's own.
    const trashedInvoice = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Retired job", qty: 1, unitCents: 40000 }],
      prefix: "INV",
      issuedOn: "2026-09-01",
    });
    await documents.send(trashedInvoice.id);
    await payments.create({ documentId: trashedInvoice.id, amountCents: 40000, paidOn: "2026-09-12", method: "cash" });
    await documents.softDelete(trashedInvoice.id);

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
    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader["Date Paid"]).toBe("2026-09-10");
    expect(byHeader["Invoice Number"]).toBe(invoice.number);
    expect(byHeader.Customer).toBe("Acme Inc");
    expect(byHeader.Deal).toBe("Analytical Engine");
    expect(byHeader.Amount).toBe("600.00");
    expect(byHeader.Method).toBe("Check");
    expect(byHeader.Reference).toBe("4412");
    expect(byHeader.Note).toBe("Deposit");
    expect(csv).not.toContain("Retired job");
    expect(csv).not.toContain("400.00");
  });
});

describe("exportRun: the newly added zip tables (F-LC-4)", () => {
  it("documents.csv in the zip carries both quotes and invoices, unlike the By-list Invoices row", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.firstStage(pipeline.id);
    if (!stage) throw new Error("seeded pipeline has no first stage");
    const deal = await deals.create({ title: "Deck rebuild", stageId: stage.id });

    const invoice = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Deck", qty: 1, unitCents: 200000 }],
      prefix: "INV",
    });
    const quote = await documents.create({
      kind: "quote",
      dealId: deal.id,
      items: [{ name: "Deck (quoted)", qty: 1, unitCents: 200000 }],
      prefix: "QUO",
    });
    const { bytes } = await buildEverythingZip();
    const reopened = await JSZip.loadAsync(bytes);
    const csv = await reopened.file("documents.csv")?.async("string");
    expect(csv).toContain(invoice.number);
    expect(csv).toContain(quote.number);
    expect(csv).toContain("Invoice");
    expect(csv).toContain("Quote");
  });

  it("document_items.csv carries a line from each document, with money readable", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.firstStage(pipeline.id);
    if (!stage) throw new Error("seeded pipeline has no first stage");
    const deal = await deals.create({ title: "Fence job", stageId: stage.id });
    await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Fence panels", qty: 4, unitCents: 5000 }],
      prefix: "INV",
    });

    const { bytes } = await buildEverythingZip();
    const reopened = await JSZip.loadAsync(bytes);
    const csv = await reopened.file("document_items.csv")?.async("string");
    expect(csv).toContain("Fence panels");
    expect(csv).toContain("50.00");
  });

  it("tags.csv and tag_links.csv resolve a link to the tagged record's name", async () => {
    h = await createSeededHarness();
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const vip = await tags.ensure("VIP");
    await tags.attach(vip.id, "contact", ada.id);

    const { bytes } = await buildEverythingZip();
    const reopened = await JSZip.loadAsync(bytes);
    const tagsCsv = await reopened.file("tags.csv")?.async("string");
    expect(tagsCsv).toContain("VIP");

    const linksCsv = await reopened.file("tag_links.csv")?.async("string");
    const { headers, rows } = await csvRows(linksCsv ?? "");
    expect(headers).toEqual(["Tag", "Record Type", "Record Name", "Created At"]);
    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader.Tag).toBe("VIP");
    expect(byHeader["Record Type"]).toBe("Contact");
    expect(byHeader["Record Name"]).toBe("Ada Lovelace");
  });

  it("custom_fields.csv and custom_values.csv resolve a value to its record's name", async () => {
    h = await createSeededHarness();
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const field = await customFields.create({
      entityType: "contact",
      name: "Referral code",
      kind: "text",
    });
    await customFields.setValue(field.id, ada.id, { text: "ADA-100" });

    const { bytes } = await buildEverythingZip();
    const reopened = await JSZip.loadAsync(bytes);
    const fieldsCsv = await reopened.file("custom_fields.csv")?.async("string");
    expect(fieldsCsv).toContain("Referral code");

    const valuesCsv = await reopened.file("custom_values.csv")?.async("string");
    const { headers, rows } = await csvRows(valuesCsv ?? "");
    const byHeader = Object.fromEntries(headers.map((label, i) => [label, rows[0][i]]));
    expect(byHeader.Field).toBe("Referral code");
    expect(byHeader["Entity Type"]).toBe("Contact");
    expect(byHeader["Record Name"]).toBe("Ada Lovelace");
    expect(byHeader.Value).toBe("ADA-100");
  });

  it("recurring_rules.csv, templates.csv and saved_views.csv each carry a real row", async () => {
    h = await createSeededHarness();
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    await recurring.create({
      title: "Spring service",
      everyN: 1,
      unit: "year",
      nextDueOn: "2027-03-01",
      contactId: ada.id,
    });
    await templates.create({ kind: "email", name: "Follow-up", subject: "Hi", body: "Hello {{first_name}}" });
    await savedViews.create({ entityType: "deal", name: "Hot leads", query: { stage: "New" } });

    const { bytes } = await buildEverythingZip();
    const reopened = await JSZip.loadAsync(bytes);

    const recurringCsv = await reopened.file("recurring_rules.csv")?.async("string");
    expect(recurringCsv).toContain("Spring service");
    expect(recurringCsv).toContain("Ada Lovelace");
    expect(recurringCsv).toContain("Every year");

    const templatesCsv = await reopened.file("templates.csv")?.async("string");
    expect(templatesCsv).toContain("Follow-up");
    expect(templatesCsv).toContain("Email");

    const savedViewsCsv = await reopened.file("saved_views.csv")?.async("string");
    expect(savedViewsCsv).toContain("Hot leads");
    expect(savedViewsCsv).toContain("Deal");
  });

  it("a workspace with zero rows in a table still produces its CSV, header only (acceptance 2)", async () => {
    h = await createSeededHarness();
    const { bytes, files } = await buildEverythingZip();
    const reopened = await JSZip.loadAsync(bytes);
    for (const name of [
      "documents.csv",
      "document_items.csv",
      "services.csv",
      "payments.csv",
      "tags.csv",
      "tag_links.csv",
      "custom_fields.csv",
      "custom_values.csv",
      "recurring_rules.csv",
      "templates.csv",
      "saved_views.csv",
    ]) {
      expect(files).toContain(name);
      const text = await reopened.file(name)?.async("string");
      expect(text, `${name} should exist even when empty`).toBeTruthy();
      const lines = (text ?? "").split("\r\n").filter((l) => l.length > 0);
      expect(lines.length, `${name} should have a header row and no data rows`).toBe(1);
    }
  });
});

// Round 2 (F-LC-4): the audit found the zip covered 5 of ~25 tables. This is
// now the authoritative list this feature is responsible for; it deliberately
// excludes document_sequences and settings/lead_sync/change_log/merges
// (internal bookkeeping, not the owner's data) and invoice_schedules (not in
// the packet's list for A).
//
// deal_items.csv and invoice_schedules.csv also joined in LR-LA (F-LA-6,
// second pass, raised by the independent review of the first). deals.csv
// carries only a deal's rolled-up Value and document_items.csv only captures
// its lines once a quote or invoice exists, so an open job's whole priced
// breakdown - services, quantities, the price agreed against the price the
// catalogue suggested - reached no file at all. invoice_schedules was excluded
// on the stale grounds of "not in the packet's list for A", written before
// recurring invoicing shipped; it is owner-set-up configuration and a client
// moving a recurring customer needs it.
//
// attachments.csv joined the list in LR-LA (F-LA-6). It was excluded as
// "binary files, not a CSV concern", which is true of the files and was then
// read as true of the table: the result was that a leaving client got an
// attachments folder full of stored names with nothing anywhere saying what
// they were or whose they were. The manifest is the join; the files stay where
// they are.
const ZIP_FILES = [
  "contacts.csv",
  "companies.csv",
  "deals.csv",
  "deal_items.csv",
  "tasks.csv",
  "activities.csv",
  "documents.csv",
  "document_items.csv",
  "services.csv",
  "payments.csv",
  "invoice_schedules.csv",
  "tags.csv",
  "tag_links.csv",
  "custom_fields.csv",
  "custom_values.csv",
  "recurring_rules.csv",
  "templates.csv",
  "saved_views.csv",
  "attachments.csv",
  "helix-export.json",
];

describe("exportRun: buildEverythingZip", () => {
  it("zips one CSV per table plus the full JSON dump", async () => {
    h = await createSeededHarness();
    await companies.create({ name: "Acme Inc" });
    await contacts.create({ firstName: "Ada", lastName: "Lovelace" });

    const { bytes, files } = await buildEverythingZip();
    expect(files.sort()).toEqual([...ZIP_FILES].sort());

    const reopened = await JSZip.loadAsync(bytes);
    expect(Object.keys(reopened.files).sort()).toEqual([...ZIP_FILES].sort());

    const contactsCsv = await reopened.file("contacts.csv")?.async("string");
    expect(contactsCsv).toContain("Ada");
    expect(contactsCsv).toContain("First Name,Last Name");

    const jsonText = await reopened.file("helix-export.json")?.async("string");
    const dump = JSON.parse(jsonText ?? "{}");
    expect(Object.keys(dump).sort()).toEqual(
      [
        "contacts",
        "companies",
        "deals",
        "dealItems",
        "tasks",
        "activities",
        "documents",
        "documentItems",
        "services",
        "payments",
        "invoiceSchedules",
        "tags",
        "tagLinks",
        "customFields",
        "customValues",
        "recurringRules",
        "templates",
        "savedViews",
        "attachments",
      ].sort(),
    );
    expect(Array.isArray(dump.contacts)).toBe(true);
    expect(dump.contacts[0]["First Name"]).toBe("Ada");
    expect(dump.companies[0].Name).toBe("Acme Inc");
  });
});

/* -------------------------------------------------------------------------- */
/* LR-LA F-LA-6: the attachments manifest                                     */
/* -------------------------------------------------------------------------- */

describe("exportRun: the attachments manifest", () => {
  /**
   * The files stay out of the zip on purpose. What was missing was any record
   * of them at all, which turned a leaving client's attachments folder - named
   * by stored name, not by anything a person chose - into a pile of blobs.
   * This proves the manifest is the join back to the records.
   */
  it("names each attached file, what it is stored as, and whose record it is on", async () => {
    h = await createSeededHarness();
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const acme = await companies.create({ name: "Acme Inc" });

    await attachments.create({
      entityType: "contact",
      entityId: ada.id,
      fileName: "signed-quote.pdf",
      storedName: "a1b2c3d4.pdf",
      bytes: 4096,
      mime: "application/pdf",
    });
    await attachments.create({
      entityType: "company",
      entityId: acme.id,
      fileName: "patio-before.jpg",
      storedName: "e5f6a7b8.jpg",
      bytes: 2_200_000,
      mime: "image/jpeg",
    });

    const { bytes } = await buildEverythingZip();
    const zip = await JSZip.loadAsync(bytes);
    const csv = await zip.file("attachments.csv")?.async("string");
    expect(csv, "attachments.csv is missing from the zip").toBeTruthy();

    const { headers, rows } = await csvRows(csv ?? "");
    expect(headers).toEqual([
      "File Name",
      "Stored As",
      "Size (bytes)",
      "Type",
      "Record Type",
      "Record Name",
      "Created At",
    ]);

    const quote = rows.find((r) => r[0] === "signed-quote.pdf");
    expect(quote, "the contact's attachment is not in the manifest").toBeTruthy();
    expect(quote?.[1]).toBe("a1b2c3d4.pdf");
    expect(quote?.[2]).toBe("4096");
    expect(quote?.[3]).toBe("application/pdf");
    expect(quote?.[4]).toBe("Contact");
    expect(quote?.[5]).toBe("Ada Lovelace");

    const photo = rows.find((r) => r[0] === "patio-before.jpg");
    expect(photo?.[4]).toBe("Company");
    expect(photo?.[5]).toBe("Acme Inc");

    // The manifest is a manifest: no file contents ride along with it.
    expect(Object.keys(zip.files)).not.toContain("a1b2c3d4.pdf");
    expect(Object.keys(zip.files)).not.toContain("attachments/");
  });

  it("leaves a deleted attachment out, the same as every other sheet", async () => {
    h = await createSeededHarness();
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const gone = await attachments.create({
      entityType: "contact",
      entityId: ada.id,
      fileName: "wrong-file.pdf",
      storedName: "deadbeef.pdf",
      bytes: 10,
      mime: "application/pdf",
    });
    await attachments.softDelete(gone.id);

    const { bytes } = await buildEverythingZip();
    const zip = await JSZip.loadAsync(bytes);
    const csv = (await zip.file("attachments.csv")?.async("string")) ?? "";
    expect(csv).not.toContain("wrong-file.pdf");
  });
});

/* -------------------------------------------------------------------------- */
/* LR-LA F-LA-6, second pass: a deal's own priced lines                        */
/* -------------------------------------------------------------------------- */

describe("exportRun: deal_items", () => {
  /**
   * The case that was silently missing. A job the owner has priced but not yet
   * quoted has all of its money in `deal_items`; `deals.csv` carries only the
   * rolled-up Value, and `document_items.csv` needs a quote or an invoice to
   * exist first. So a live pipeline exported with its whole priced breakdown
   * absent, which is most of what a pipeline is.
   */
  it("exports the priced services on a deal that was never quoted", async () => {
    h = await createSeededHarness();
    const pipeline = (await pipelines.list())[0];
    const stage = (await stages.list(pipeline.id))[0];
    const ada = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const deal = await deals.create({
      title: "Back fence replacement",
      stageId: stage.id,
      contactId: ada.id,
    });

    const service = await products.create({
      name: "Cedar fence panel",
      unitPriceCents: 12_000,
      kind: "one_time",
      taxable: true,
    });
    const line = await dealItems.addFromProduct(deal.id, service.id, { qty: 6 });
    // The owner knocked the price down on the day. The gap between what the
    // catalogue suggested and what was agreed is the owner's own pricing
    // history and lives nowhere else, so both columns are exported.
    await dealItems.update(line.id, { actualUnitCents: 10_500 });

    const { bytes } = await buildEverythingZip();
    const zip = await JSZip.loadAsync(bytes);
    const csv = await zip.file("deal_items.csv")?.async("string");
    expect(csv, "deal_items.csv is missing from the zip").toBeTruthy();

    const { headers, rows } = await csvRows(csv ?? "");
    expect(headers).toEqual([
      "Deal",
      "Name",
      "Description",
      "Qty",
      "Suggested Unit Price",
      "Unit Price",
      "Taxable",
      "Kind",
      "Interval",
    ]);

    const row = rows.find((r) => r[1] === "Cedar fence panel");
    expect(row, "the priced line is not in the export").toBeTruthy();
    expect(row?.[0]).toBe("Back fence replacement");
    expect(row?.[3]).toBe("6");
    expect(row?.[4]).toBe("120.00");
    expect(row?.[5]).toBe("105.00");
    expect(row?.[6]).toBe("true");
    expect(row?.[7]).toBe("One time");

    // And no quote or invoice was ever raised, which is the whole point.
    const documentItemsCsv = (await zip.file("document_items.csv")?.async("string")) ?? "";
    expect(documentItemsCsv).not.toContain("Cedar fence panel");
  });
});
