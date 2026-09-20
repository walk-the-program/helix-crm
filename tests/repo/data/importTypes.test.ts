/**
 * Companies, deals and services imports, through the real pipeline against a
 * real (in-memory) database:
 *
 *   bytes -> sniffCsv -> readHeaders -> guessMappingFor -> runTypedImport
 *
 * The fixtures are the two deal exports and the company export documented in
 * tests/fixtures/README.md, and the numbers below come from that table: how
 * many rows, how many carry a stage this workspace does not have, how many
 * carry an amount nothing can add up, and which contact emails are shared with
 * the contacts fixtures.
 *
 * The one thing worth stating out loud: a deals import never fails a row for a
 * thing it had to guess. An unknown stage lands in the first stage, an
 * unreadable amount becomes zero, a contact nobody matches is created. Each of
 * those puts a line in `warnings`, and every one of those lines is asserted
 * here, because that list is the entire promise of the result screen.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import { readHeaders, sniffCsv } from "../../../src/lib/csv";
import { guessMapping } from "../../../src/features/data/lib/mapping";
import { guessMappingFor, SKIP } from "../../../src/features/data/lib/typedMapping";
import { runImport } from "../../../src/features/data/lib/importRun";
import {
  runTypedImport,
  type TypedImportResult,
} from "../../../src/features/data/lib/typedImportRun";
import { importType } from "../../../src/features/data/import/fields/index";
import type { DedupePolicy } from "../../../src/features/data/lib/importRun";
import type { ImportTypeId } from "../../../src/features/data/import/fields/types";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, "..", "..", "fixtures");

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** bytes -> sniff -> headers -> the type's guess -> runTypedImport. */
async function importFixture(
  typeId: Exclude<ImportTypeId, "contacts">,
  name: string,
  policy: DedupePolicy = "skip",
): Promise<TypedImportResult> {
  const sniff = sniffCsv(fixtureBytes(name));
  const { headers, delimiter } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
  const mapping = guessMappingFor(importType(typeId), headers);
  return runTypedImport({ typeId, text: sniff.text, mapping, delimiter, policy });
}

/** The contacts fixtures go in through their own importer, unchanged. */
async function importContactsFixture(name: string) {
  const sniff = sniffCsv(fixtureBytes(name));
  const { headers, delimiter } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
  return runImport({
    text: sniff.text,
    mapping: guessMapping(headers),
    delimiter,
    policy: "skip",
  });
}

async function importText(
  typeId: Exclude<ImportTypeId, "contacts">,
  text: string,
  policy: DedupePolicy = "skip",
): Promise<TypedImportResult> {
  const { headers, delimiter } = readHeaders(text);
  const mapping = guessMappingFor(importType(typeId), headers);
  return runTypedImport({ typeId, text, mapping, delimiter, policy });
}

async function countRows(sql: string): Promise<number> {
  const rows = await raw.query(sql);
  return rows.length > 0 ? Number(rows[0][0]) : 0;
}

function warningsOfKind(result: TypedImportResult, kind: string) {
  return result.warnings.filter((w) => w.kind === kind);
}

describe("import types", () => {
  let harness: Harness | null = null;

  afterEach(() => {
    harness?.dispose();
    harness = null;
  });

  async function seeded(): Promise<Harness> {
    harness = await createSeededHarness();
    return harness;
  }

  /* ------------------------------------------------------------------ */
  /* the guess                                                          */
  /* ------------------------------------------------------------------ */

  describe("guessing the columns", () => {
    it("reads a HubSpot deal export's header row", async () => {
      await seeded();
      const sniff = sniffCsv(fixtureBytes("hubspot-deals.csv"));
      const { headers } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
      const mapping = guessMappingFor(importType("deals"), headers);
      const fieldFor = (header: string) =>
        mapping.find((m) => m.header === header)?.field;

      expect(fieldFor("Deal Name")).toBe("title");
      expect(fieldFor("Amount")).toBe("value");
      expect(fieldFor("Deal Stage")).toBe("stage");
      expect(fieldFor("Close Date")).toBe("expectedOn");
      expect(fieldFor("Associated Contact")).toBe("contactName");
      expect(fieldFor("Associated Contact Email")).toBe("contactEmail");
      expect(fieldFor("Associated Company")).toBe("company");
      expect(fieldFor("Original Source")).toBe("source");
      expect(fieldFor("Notes")).toBe("notes");
      expect(fieldFor("Tags")).toBe("tags");

      // The exporter's own bookkeeping is left alone.
      expect(fieldFor("Record ID")).toBe(SKIP);
      expect(fieldFor("Deal Owner")).toBe(SKIP);
      expect(fieldFor("Create Date")).toBe(SKIP);
    });

    it("reads a Pipedrive deal export's header row", async () => {
      await seeded();
      const sniff = sniffCsv(fixtureBytes("pipedrive-deals.csv"));
      const { headers } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
      const mapping = guessMappingFor(importType("deals"), headers);
      const fieldFor = (header: string) =>
        mapping.find((m) => m.header === header)?.field;

      expect(fieldFor("Title")).toBe("title");
      expect(fieldFor("Value")).toBe("value");
      expect(fieldFor("Stage")).toBe("stage");
      expect(fieldFor("Expected close date")).toBe("expectedOn");
      expect(fieldFor("Person")).toBe("contactName");
      expect(fieldFor("Person - Email")).toBe("contactEmail");
      expect(fieldFor("Person - Phone")).toBe("contactPhone");
      expect(fieldFor("Organization")).toBe("company");
      expect(fieldFor("Note")).toBe("notes");
      expect(fieldFor("Label")).toBe("tags");
      expect(fieldFor("Currency")).toBe(SKIP);
      expect(fieldFor("Deal created")).toBe(SKIP);
    });

    it("reads a HubSpot company export's header row", async () => {
      await seeded();
      const sniff = sniffCsv(fixtureBytes("hubspot-companies.csv"));
      const { headers } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
      const mapping = guessMappingFor(importType("companies"), headers);
      const fieldFor = (header: string) =>
        mapping.find((m) => m.header === header)?.field;

      expect(fieldFor("Company name")).toBe("name");
      expect(fieldFor("Company Domain Name")).toBe("website");
      expect(fieldFor("Phone Number")).toBe("phone");
      expect(fieldFor("Street Address")).toBe("street");
      expect(fieldFor("City")).toBe("city");
      expect(fieldFor("State/Region")).toBe("state");
      expect(fieldFor("Postal Code")).toBe("postal");
      expect(fieldFor("Country/Region")).toBe("country");
      expect(fieldFor("Description")).toBe("notes");
      expect(fieldFor("Tags")).toBe("tags");
    });
  });

  /* ------------------------------------------------------------------ */
  /* companies                                                          */
  /* ------------------------------------------------------------------ */

  describe("companies", () => {
    it("imports the HubSpot company export and skips the repeated name", async () => {
      await seeded();
      const result = await importFixture("companies", "hubspot-companies.csv");

      expect(result.typeId).toBe("companies");
      expect(result.totalRows).toBe(25);
      // 24 distinct names: one name appears on two rows, and the second is
      // the one the "skip" policy leaves out.
      expect(result.created).toBe(24);
      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
      expect(await countRows("SELECT count(*) FROM companies WHERE deleted_at IS NULL")).toBe(24);

      // The skipped row says why, in words, and carries its original cells.
      expect(result.skippedRows).toHaveLength(1);
      expect(result.skippedRows[0].reason).toMatch(/already in helix/i);
    });

    it("fills in the blanks without overwriting anything already there", async () => {
      await seeded();
      await importText(
        "companies",
        ["Company name,Phone,Website", "Alpine Air Heating & Cooling,,typed-by-hand.example"].join(
          "\n",
        ),
      );

      const result = await importFixture("companies", "hubspot-companies.csv", "update");
      expect(result.created).toBe(23);
      expect(result.updated).toBe(2);

      const rows = await raw.query(
        `SELECT c.website, c.phone_raw FROM companies c
         WHERE c.name = 'Alpine Air Heating & Cooling' AND c.deleted_at IS NULL`,
      );
      // The website the owner typed stays; the phone the file has is added.
      expect(String(rows[0][0])).toBe("typed-by-hand.example");
      expect(String(rows[0][1])).toBe("+13855550148");
    });

    it("imports every row when the owner says to import anyway", async () => {
      await seeded();
      const result = await importFixture("companies", "hubspot-companies.csv", "duplicate");
      expect(result.created).toBe(25);
      expect(result.skipped).toBe(0);
    });

    it("refuses a row with no company name and says so", async () => {
      await seeded();
      const result = await importText(
        "companies",
        ["Company name,City", "Wasatch Peak Plumbing,Holladay", ",Provo"].join("\n"),
      );
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.skippedRows[0].reason).toMatch(/company name/i);
    });

    it("splits tags and links them to the company", async () => {
      await seeded();
      await importText(
        "companies",
        ["Company name,Tags", "Wasatch Peak Plumbing,Referral;Repeat"].join("\n"),
      );
      const rows = await raw.query(
        `SELECT t.name FROM tags t JOIN tag_links l ON l.tag_id = t.id
         WHERE l.entity_type = 'company' ORDER BY t.name ASC`,
      );
      expect(rows.map((r) => String(r[0]))).toEqual(["Referral", "Repeat"]);
    });
  });

  /* ------------------------------------------------------------------ */
  /* services                                                           */
  /* ------------------------------------------------------------------ */

  describe("services", () => {
    it("writes one-time and recurring work the way the catalog wants it", async () => {
      await seeded();
      const result = await importText(
        "services",
        [
          "Service,Description,Price,Billing,Taxable",
          "Water heater replacement,50-gallon gas swap,$1450.00,One-time,Yes",
          "Monthly lawn care,Mow and edge,$185.00,per month,No",
          "Annual furnace tune-up,Filter and safety check,$249.00,annual,Yes",
        ].join("\n"),
      );

      expect(result.created).toBe(3);
      expect(result.warnings).toEqual([]);

      const rows = await raw.query(
        `SELECT p.name, p.kind, p.interval, p.unit_price_cents, p.taxable, p.position
         FROM products p WHERE p.deleted_at IS NULL ORDER BY p.position ASC`,
      );
      expect(rows.map((r) => [String(r[0]), String(r[1]), r[2], Number(r[3]), Number(r[4])])).toEqual([
        ["Water heater replacement", "one_time", null, 145000, 1],
        ["Monthly lawn care", "recurring", "month", 18500, 0],
        ["Annual furnace tune-up", "recurring", "year", 24900, 1],
      ]);
      // Positions carry on from the bottom of the list.
      expect(rows.map((r) => Number(r[5]))).toEqual([0, 1, 2]);
    });

    it("matches a service already in the catalog by name", async () => {
      await seeded();
      const text = ["Service,Price", "Water heater replacement,$1450.00"].join("\n");
      await importText("services", text);

      const again = await importText("services", text);
      expect(again.created).toBe(0);
      expect(again.skipped).toBe(1);
      expect(again.skippedRows[0].reason).toMatch(/already in your services/i);

      const anyway = await importText("services", text, "duplicate");
      expect(anyway.created).toBe(1);
    });

    it("says what it did with a billing word it does not know", async () => {
      await seeded();
      const result = await importText(
        "services",
        ["Service,Billing", "Emergency callout,whenever"].join("\n"),
      );
      expect(result.created).toBe(1);
      const choice = warningsOfKind(result, "choice");
      expect(choice).toHaveLength(1);
      expect(choice[0].message).toContain("One-time");
    });
  });

  /* ------------------------------------------------------------------ */
  /* deals                                                              */
  /* ------------------------------------------------------------------ */

  describe("deals", () => {
    it("imports the HubSpot deal export, warning about the stage and the amount", async () => {
      await seeded();
      const result = await importFixture("deals", "hubspot-deals.csv");

      expect(result.typeId).toBe("deals");
      expect(result.totalRows).toBe(30);
      expect(result.created).toBe(30);
      expect(result.skipped).toBe(0);
      expect(await countRows("SELECT count(*) FROM deals WHERE deleted_at IS NULL")).toBe(30);

      // Exactly one row names a stage this workspace does not have, and it
      // lands in the first stage rather than failing.
      const stageWarnings = warningsOfKind(result, "stage");
      expect(stageWarnings).toHaveLength(1);
      expect(stageWarnings[0].message).toContain("Contract Sent");
      expect(stageWarnings[0].message).toContain("New");

      // Exactly one amount is not a number.
      const moneyWarnings = warningsOfKind(result, "money");
      expect(moneyWarnings).toHaveLength(1);
      expect(moneyWarnings[0].message).toContain("Call for quote");

      // A blank stage is not a warning: it just means the first stage.
      const first = await firstStageId();
      expect(
        await countRows(
          `SELECT count(*) FROM deals WHERE stage_id = '${first}' AND deleted_at IS NULL`,
        ),
      ).toBeGreaterThanOrEqual(3);
    });

    it("matches every stage name whatever the capitals", async () => {
      await seeded();
      await importText(
        "deals",
        [
          "Deal,Stage",
          "Water heater swap,quoted",
          "Furnace tune-up,QUOTED",
          "Gutter clean,Quoted",
        ].join("\n"),
      );
      const rows = await raw.query(
        `SELECT s.name, count(*) FROM deals d JOIN stages s ON s.id = d.stage_id
         WHERE d.deleted_at IS NULL GROUP BY s.name`,
      );
      expect(rows).toHaveLength(1);
      expect(String(rows[0][0])).toBe("Quoted");
      expect(Number(rows[0][1])).toBe(3);
    });

    it("ties a deal to the contact already in Helix instead of making a second one", async () => {
      await seeded();
      const contacts = await importContactsFixture("hubspot-contacts.csv");
      expect(contacts.created).toBe(52);

      const result = await importFixture("deals", "hubspot-deals.csv");
      expect(result.created).toBe(30);

      // Six rows reuse an email from the contacts fixture, so six people who
      // were already here pick up the deals - and one of them (David Chen)
      // has two jobs in the file, which is the whole point of matching rather
      // than creating.
      const shared = `('sarah.mitchell83@gmail.example','dchen.hvac@yahoo.example',
             'jwhitfield@comcast.example','amybrewer99@gmail.example',
             'joseph.martin347@example.com','maria.murphy131@example.com')`;
      const attachedDeals = await countRows(
        `SELECT count(*) FROM deals d
         JOIN contact_emails e ON e.contact_id = d.contact_id
         WHERE d.deleted_at IS NULL AND e.email_lower IN ${shared}`,
      );
      const attachedPeople = await countRows(
        `SELECT count(DISTINCT d.contact_id) FROM deals d
         JOIN contact_emails e ON e.contact_id = d.contact_id
         WHERE d.deleted_at IS NULL AND e.email_lower IN ${shared}`,
      );
      expect(attachedPeople).toBe(6);
      expect(attachedDeals).toBe(7);

      // Nobody was duplicated: the contacts fixture's 52 plus the people the
      // deal file introduced, and not one more.
      expect(
        await countRows("SELECT count(*) FROM contacts WHERE deleted_at IS NULL"),
      ).toBe(52 + result.contactsCreated);

      // Everyone else in the file is new, and every one of them is named in
      // the warning list - that is what "Helix added them" is for.
      expect(warningsOfKind(result, "contact").length).toBe(result.contactsCreated);
      expect(result.contactsCreated).toBeGreaterThan(0);
    });

    it("reuses a contact it created earlier in the same file", async () => {
      await seeded();
      const result = await importText(
        "deals",
        [
          "Deal,Contact,Contact email",
          "Water heater swap,Dana Whitfield,dana@wasatchpeak.example",
          "Softener install,Dana Whitfield,dana@wasatchpeak.example",
          "Hose bib repair,Dana Whitfield,",
        ].join("\n"),
      );

      expect(result.created).toBe(3);
      expect(result.contactsCreated).toBe(1);
      expect(
        await countRows("SELECT count(*) FROM contacts WHERE deleted_at IS NULL"),
      ).toBe(1);
      const distinct = await raw.query(
        `SELECT count(DISTINCT d.contact_id) FROM deals d WHERE d.deleted_at IS NULL`,
      );
      expect(Number(distinct[0][0])).toBe(1);
    });

    it("creates the company once and links every deal to it", async () => {
      await seeded();
      const result = await importText(
        "deals",
        [
          "Deal,Company",
          "Water heater swap,Wasatch Peak Plumbing",
          "Softener install,Wasatch Peak Plumbing",
        ].join("\n"),
      );
      expect(result.companiesCreated).toBe(1);
      const distinct = await raw.query(
        `SELECT count(DISTINCT d.company_id) FROM deals d WHERE d.deleted_at IS NULL`,
      );
      expect(Number(distinct[0][0])).toBe(1);
    });

    it("skips a job that is already open for the same customer", async () => {
      await seeded();
      const text = [
        "Deal,Contact email,Stage",
        "Water heater swap,dana@wasatchpeak.example,Quoted",
        "Softener install,dana@wasatchpeak.example,Quoted",
      ].join("\n");

      const first = await importText("deals", text);
      expect(first.created).toBe(2);

      const second = await importText("deals", text);
      expect(second.created).toBe(0);
      expect(second.skipped).toBe(2);
      expect(second.skippedRows[0].reason).toMatch(/already open/i);

      const third = await importText("deals", text, "duplicate");
      expect(third.created).toBe(2);
      expect(await countRows("SELECT count(*) FROM deals WHERE deleted_at IS NULL")).toBe(4);
    });

    it("does not skip a job that was already won", async () => {
      await seeded();
      await importText(
        "deals",
        ["Deal,Stage", "Annual service plan,Won"].join("\n"),
      );
      const again = await importText(
        "deals",
        ["Deal,Stage", "Annual service plan,New"].join("\n"),
      );
      // The match is against OPEN deals only: last year's won job must not
      // stop this year's renewal going in.
      expect(again.created).toBe(1);
    });

    it("a won date closes the deal and puts it in the won stage", async () => {
      await seeded();
      await importText(
        "deals",
        ["Deal,Won on", "Water heater swap,2026-09-04"].join("\n"),
      );
      const rows = await raw.query(
        `SELECT s.name, s.is_won, d.closed_at FROM deals d JOIN stages s ON s.id = d.stage_id
         WHERE d.deleted_at IS NULL`,
      );
      expect(String(rows[0][0])).toBe("Won");
      expect(Number(rows[0][1])).toBe(1);
      expect(String(rows[0][2])).toContain("2026-09-04");
    });

    it("a lost date closes the deal without touching a stage the file named", async () => {
      await seeded();
      await importText(
        "deals",
        ["Deal,Stage,Lost on", "Roof replacement,Quoted,2026-08-11"].join("\n"),
      );
      const rows = await raw.query(
        `SELECT s.name, d.closed_at FROM deals d JOIN stages s ON s.id = d.stage_id
         WHERE d.deleted_at IS NULL`,
      );
      // The stage column wins when it is filled in; the date still closes it.
      expect(String(rows[0][0])).toBe("Quoted");
      expect(String(rows[0][1])).toContain("2026-08-11");
    });

    it("reads every date shape the exports use", async () => {
      await seeded();
      await importText(
        "deals",
        [
          "Deal,Expected close",
          "US slashes,3/14/2026",
          "ISO,2026-03-14",
          "Long month,March 14 2026",
        ].join("\n"),
      );
      const rows = await raw.query(
        `SELECT DISTINCT d.expected_on FROM deals d WHERE d.deleted_at IS NULL`,
      );
      expect(rows.map((r) => String(r[0]))).toEqual(["2026-03-14"]);
    });

    it("splits upfront and monthly, and makes the value the annual total", async () => {
      await seeded();
      const result = await importText(
        "deals",
        ["Deal,Upfront,Monthly", "Softener with plan,$1200.00,$45.00"].join("\n"),
      );
      const rows = await raw.query(
        `SELECT d.value_cents, d.one_time_cents, d.recurring_monthly_cents
         FROM deals d WHERE d.deleted_at IS NULL`,
      );
      expect(Number(rows[0][1])).toBe(120000);
      expect(Number(rows[0][2])).toBe(4500);
      // value_cents is derived: one_time + 12 x monthly (drizzle/0004_revenue).
      expect(Number(rows[0][0])).toBe(120000 + 4500 * 12);
      expect(result.warnings).toEqual([]);
    });

    it("puts a lone total in one_time_cents", async () => {
      await seeded();
      const result = await importText(
        "deals",
        ["Deal,Value", 'Water heater swap,"$2,450.00"'].join("\n"),
      );
      const rows = await raw.query(
        `SELECT d.value_cents, d.one_time_cents, d.recurring_monthly_cents
         FROM deals d WHERE d.deleted_at IS NULL`,
      );
      expect(Number(rows[0][0])).toBe(245000);
      expect(Number(rows[0][1])).toBe(245000);
      expect(Number(rows[0][2])).toBe(0);
      expect(result.warnings).toEqual([]);
    });

    it("says so when a row's own total disagrees with its own split", async () => {
      await seeded();
      const result = await importText(
        "deals",
        ["Deal,Value,Upfront,Monthly", "Softener with plan,$2000.00,$1200.00,$45.00"].join("\n"),
      );
      const rows = await raw.query(
        `SELECT d.value_cents FROM deals d WHERE d.deleted_at IS NULL`,
      );
      // The split wins, because value_cents is derived from it.
      expect(Number(rows[0][0])).toBe(174000);
      const money = warningsOfKind(result, "money");
      expect(money).toHaveLength(1);
      expect(money[0].message).toMatch(/does not match/i);
    });

    it("writes the notes column as a note on the deal's timeline", async () => {
      await seeded();
      await importText(
        "deals",
        ["Deal,Notes", "Water heater swap,Access through the garage."].join("\n"),
      );
      const rows = await raw.query(
        `SELECT a.body FROM activities a WHERE a.deal_id IS NOT NULL AND a.deleted_at IS NULL`,
      );
      expect(rows).toHaveLength(1);
      expect(String(rows[0][0])).toBe("Access through the garage.");
    });

    it("refuses a row with no deal name and imports the rest", async () => {
      await seeded();
      const result = await importText(
        "deals",
        ["Deal,Value", "Water heater swap,$500", ",$900"].join("\n"),
      );
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.skippedRows[0].reason).toMatch(/deal/i);
    });

    it("imports the Pipedrive export too", async () => {
      await seeded();
      const result = await importFixture("deals", "pipedrive-deals.csv");
      expect(result.totalRows).toBe(30);
      expect(result.created).toBe(30);
      expect(warningsOfKind(result, "stage")).toHaveLength(1);
      expect(warningsOfKind(result, "stage")[0].message).toContain("Proposal Sent");
      expect(warningsOfKind(result, "money")).toHaveLength(1);
    });

    it("gives every deal in a stage its own position", async () => {
      await seeded();
      await importText(
        "deals",
        ["Deal,Stage", "One,Quoted", "Two,Quoted", "Three,Quoted"].join("\n"),
      );
      const rows = await raw.query(
        `SELECT d.position FROM deals d WHERE d.deleted_at IS NULL ORDER BY d.position ASC`,
      );
      expect(rows.map((r) => Number(r[0]))).toEqual([0, 1, 2]);
    });

    it("writes a stage event for every deal, so the board's history starts clean", async () => {
      await seeded();
      await importFixture("deals", "hubspot-deals.csv");
      expect(
        await countRows("SELECT count(*) FROM deal_stage_events WHERE deleted_at IS NULL"),
      ).toBe(30);
    });

    it("leaves nothing behind when the write fails", async () => {
      const h = await seeded();
      const before = await countRows("SELECT count(*) FROM deals WHERE deleted_at IS NULL");

      // Break the table the import is about to write into.
      h.driver.execute("DROP TABLE deal_stage_events", []);
      await expect(
        importText("deals", ["Deal,Stage", "Water heater swap,New"].join("\n")),
      ).rejects.toThrow(/nothing was imported/i);

      expect(await countRows("SELECT count(*) FROM deals WHERE deleted_at IS NULL")).toBe(before);
    });
  });
});

/** The first stage on the seeded board: where an unknown stage name lands. */
async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const first = await stages.firstStage(pipeline.id);
  if (!first) throw new Error("The seeded workspace has no stages.");
  return first.id;
}
