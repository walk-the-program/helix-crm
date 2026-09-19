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
    expect(EXPORT_ENTITIES).toEqual(["contacts", "companies", "deals", "tasks", "activities"]);
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
    expect(taskHeaders).toEqual([
      "Title",
      "Done",
      "Due On",
      "Due At",
      "Contact",
      "Company",
      "Deal",
      "Created At",
    ]);
    expect(taskRows).toHaveLength(2);
    const followUp = taskRows.find((r) => r[0] === "Follow up");
    expect(followUp?.[1]).toBe("false");
    expect(followUp?.[4]).toBe("Ada Lovelace");
    expect(followUp?.[5]).toBe("Acme Inc");
    expect(followUp?.[6]).toBe("Analytical Engine");
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
    expect(activityRows).toHaveLength(1);
    expect(activityRows[0][0]).toBe("call");
    expect(activityRows[0][1]).toBe("Discussed the engine");
    expect(activityRows[0][3]).toBe("Ada Lovelace");
    expect(activityRows[0][4]).toBe("Acme Inc");
    expect(activityRows[0][5]).toBe("Analytical Engine");
  });

  it("guards a formula-like company name so it survives a spreadsheet round trip", async () => {
    h = await createSeededHarness();
    await companies.create({ name: "=2+2 Consulting" });

    const { csv } = await buildEntityCsv("companies");
    expect(csv).toContain(`"'=2+2 Consulting"`);

    const { rows } = await csvRows(csv);
    expect(rows[0][0]).toBe("'=2+2 Consulting");
  });
});

describe("exportRun: buildEverythingZip", () => {
  it("zips one CSV per entity plus the full JSON dump", async () => {
    h = await createSeededHarness();
    await companies.create({ name: "Acme Inc" });
    await contacts.create({ firstName: "Ada", lastName: "Lovelace" });

    const { bytes, files } = await buildEverythingZip();
    expect(files.sort()).toEqual(
      [
        "contacts.csv",
        "companies.csv",
        "deals.csv",
        "tasks.csv",
        "activities.csv",
        "helix-export.json",
      ].sort(),
    );

    const reopened = await JSZip.loadAsync(bytes);
    expect(Object.keys(reopened.files).sort()).toEqual(
      [
        "contacts.csv",
        "companies.csv",
        "deals.csv",
        "tasks.csv",
        "activities.csv",
        "helix-export.json",
      ].sort(),
    );

    const contactsCsv = await reopened.file("contacts.csv")?.async("string");
    expect(contactsCsv).toContain("Ada");
    expect(contactsCsv).toContain("First Name,Last Name");

    const jsonText = await reopened.file("helix-export.json")?.async("string");
    const dump = JSON.parse(jsonText ?? "{}");
    expect(Object.keys(dump).sort()).toEqual(
      ["contacts", "companies", "deals", "tasks", "activities"].sort(),
    );
    expect(Array.isArray(dump.contacts)).toBe(true);
    expect(dump.contacts[0]["First Name"]).toBe("Ada");
    expect(dump.companies[0].Name).toBe("Acme Inc");
  });
});
