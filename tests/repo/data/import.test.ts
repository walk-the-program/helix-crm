/**
 * CSV import repo tests: real fixtures, through sniffCsv -> readHeaders ->
 * guessMapping -> runImport, against a real (in-memory) database.
 *
 * Row counts and the cross-file duplicate emails are documented in
 * tests/fixtures/README.md; the numbers asserted below come straight from
 * that table.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { getDriver, raw, setDriver } from "../../../src/db/client";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as tags from "../../../src/db/repos/tags";
import { ImportParseError, readHeaders, sniffCsv } from "../../../src/features/data/lib/csv";
import { guessMapping, type ColumnMapping } from "../../../src/features/data/lib/mapping";
import {
  ImportWriteError,
  runImport,
  type DedupePolicy,
  type ImportProgress,
  type ImportResult,
} from "../../../src/features/data/lib/importRun";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, "..", "..", "fixtures");

function fixtureBytes(...segments: string[]): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, ...segments)));
}

type ImportOpts = {
  policy?: DedupePolicy;
  dryRun?: boolean;
  onProgress?: (p: ImportProgress) => void;
  region?: string;
};

/** bytes -> sniff -> headers -> guessed mapping -> runImport, the real pipeline. */
async function importBytes(bytes: Uint8Array, opts: ImportOpts = {}): Promise<ImportResult> {
  const sniff = sniffCsv(bytes);
  const { headers, delimiter } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
  const mapping: ColumnMapping[] = guessMapping(headers);
  return runImport({
    text: sniff.text,
    mapping,
    delimiter,
    policy: opts.policy ?? "skip",
    region: opts.region,
    dryRun: opts.dryRun,
    onProgress: opts.onProgress,
  });
}

/** Plain in-memory CSV text (no bytes/sniffing needed), same pipeline otherwise. */
async function importText(text: string, opts: ImportOpts = {}): Promise<ImportResult> {
  const { headers, delimiter } = readHeaders(text);
  const mapping: ColumnMapping[] = guessMapping(headers);
  return runImport({
    text,
    mapping,
    delimiter,
    policy: opts.policy ?? "skip",
    region: opts.region,
    dryRun: opts.dryRun,
    onProgress: opts.onProgress,
  });
}

function syntheticContactsCsv(n: number): string {
  const lines = ["First Name,Last Name,Email"];
  for (let i = 0; i < n; i += 1) {
    lines.push(`Person${i},Test${i},person${i}@example.com`);
  }
  return `${lines.join("\n")}\n`;
}

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

/* -------------------------------------------------------------------------- */
/* 1. table-driven: every good fixture round-trips                            */
/* -------------------------------------------------------------------------- */

const GOOD_FIXTURES: { file: string; rows: number }[] = [
  { file: "hubspot-contacts.csv", rows: 52 },
  { file: "zoho-contacts.csv", rows: 47 },
  { file: "pipedrive-persons.csv", rows: 58 },
  { file: "google-contacts.csv", rows: 44 },
  { file: "excel-saveas.csv", rows: 41 },
  { file: "clearpath-prospects.csv", rows: 19 },
];

describe("CSV import: every good fixture round-trips", () => {
  it.each(GOOD_FIXTURES)(
    "$file imports its documented row count and lands in the database",
    async ({ file, rows }) => {
      h = await createHarness();
      const result = await importBytes(fixtureBytes(file), { policy: "skip" });

      expect(result.totalRows).toBe(rows);
      expect(result.created + result.updated + result.skipped).toBe(result.totalRows);
      expect(result.created).toBeGreaterThan(0);
      expect(result.companiesCreated).toBeGreaterThan(0);

      const list = await contacts.list({}, { limit: 1000 });
      expect(list.total).toBe(result.created);

      const companyList = await companies.list({}, { limit: 1000 });
      expect(companyList.total).toBe(result.companiesCreated);
      for (const company of companyList.rows) {
        const found = await companies.findByName(company.name);
        expect(found?.id).toBe(company.id);
      }
    },
  );
});

/* -------------------------------------------------------------------------- */
/* 2. spot checks: real values that must survive the round trip               */
/* -------------------------------------------------------------------------- */

describe("CSV import: spot checks on real values", () => {
  it("HubSpot: Sarah Mitchell gets an E.164 phone, a lowercased email and her company", async () => {
    h = await createHarness();
    await importBytes(fixtureBytes("hubspot-contacts.csv"), { policy: "skip" });

    const list = await contacts.list({}, { limit: 1000 });
    const row = list.rows.find((c) => c.firstName === "Sarah" && c.lastName === "Mitchell");
    expect(row).toBeDefined();

    const full = await contacts.get(row!.id);
    expect(full?.companyName).toBe("Sandy Landscape Co");
    expect(full?.emails.some((e) => e.emailLower === "sarah.mitchell83@gmail.com")).toBe(true);
    expect(full?.phones.some((p) => p.e164 === "+18015550142")).toBe(true);
  });

  it("Pipedrive: the single 'Person - Name' column splits into first and last name", async () => {
    h = await createHarness();
    await importBytes(fixtureBytes("pipedrive-persons.csv"), { policy: "skip" });

    const list = await contacts.list({}, { limit: 1000 });
    const row = list.rows.find((c) => c.firstName === "Maria" && c.lastName === "Gonzalez");
    expect(row).toBeDefined();
    expect(row?.companyName).toBe("Layton Plumbing Co");
  });

  it("Google Contacts: the Labels column '* myContacts ::: Suppliers' becomes two tags", async () => {
    h = await createHarness();
    await importBytes(fixtureBytes("google-contacts.csv"), { policy: "skip" });

    const list = await contacts.list({}, { limit: 1000 });
    const row = list.rows.find((c) => c.firstName === "Sarah" && c.lastName === "Mitchell");
    expect(row).toBeDefined();

    const rowTags = await tags.listForEntity("contact", row!.id);
    expect(rowTags.map((t) => t.name).sort()).toEqual(["Suppliers", "myContacts"].sort());
  });

  it("ClearPath: a row with no first/last name still imports under its company, and no deal is created", async () => {
    h = await createHarness();
    await importBytes(fixtureBytes("clearpath-prospects.csv"), { policy: "skip" });

    const list = await contacts.list({}, { limit: 1000 });
    const row = list.rows.find((c) => c.companyName === "Ironwood Landscaping");
    expect(row).toBeDefined();
    expect(row?.firstName).toBe("");
    expect(row?.lastName).toBe("");

    const dealRows = await raw.query("SELECT count(*) FROM deals");
    expect(Number(dealRows[0][0])).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. dedupe policies                                                         */
/* -------------------------------------------------------------------------- */

describe("CSV import: dedupe policies", () => {
  it("policy 'skip': the second import skips the emails shared with the first file", async () => {
    h = await createHarness();
    const first = await importBytes(fixtureBytes("hubspot-contacts.csv"), { policy: "skip" });
    const beforeSecond = await contacts.list({}, { limit: 1000 });
    expect(beforeSecond.total).toBe(first.created);

    const second = await importBytes(fixtureBytes("zoho-contacts.csv"), { policy: "skip" });
    // README: sarah.mitchell83@gmail.com and dchen.hvac@yahoo.com are the only
    // two of the six documented cross-file emails shared by hubspot AND zoho.
    expect(second.skipped).toBe(2);
    expect(second.updated).toBe(0);

    const afterSecond = await contacts.list({}, { limit: 1000 });
    expect(afterSecond.total).toBe(first.created + second.created);
  });

  it("policy 'update': fills in missing phones without overwriting a name that is already set", async () => {
    h = await createHarness();
    await importBytes(fixtureBytes("hubspot-contacts.csv"), { policy: "update" });
    const second = await importBytes(fixtureBytes("zoho-contacts.csv"), { policy: "update" });

    expect(second.updated).toBe(2);

    const list = await contacts.list({}, { limit: 1000 });

    // Sarah Mitchell: zoho spells her "Sara" but hubspot already filled in
    // "Sarah" - the update must not overwrite it.
    const sarah = list.rows.find((c) => c.lastName === "Mitchell" && c.companyName != null);
    expect(sarah?.firstName).toBe("Sarah");

    // David Chen: zoho's Mobile column ("435-555-0230") is a phone hubspot
    // never had, so it should be appended; his hubspot name ("David") must
    // survive over zoho's "Dave".
    const david = list.rows.find((c) => c.lastName === "Chen");
    expect(david?.firstName).toBe("David");
    const full = await contacts.get(david!.id);
    expect(full?.phones.some((p) => p.e164 === "+14355550230")).toBe(true);
    // The phone shared by both files (+13855550187) must not be duplicated.
    expect(full?.phones.filter((p) => p.e164 === "+13855550187")).toHaveLength(1);
  });

  it("policy 'duplicate': two contacts end up sharing the same email", async () => {
    h = await createHarness();
    await importBytes(fixtureBytes("hubspot-contacts.csv"), { policy: "duplicate" });
    await importBytes(fixtureBytes("zoho-contacts.csv"), { policy: "duplicate" });

    const dupes = await contacts.findDuplicates({ emails: ["sarah.mitchell83@gmail.com"] });
    expect(dupes).toHaveLength(2);
  });

  it("within-file dedupe: importing the same file twice with 'skip' creates nothing the second time", async () => {
    h = await createHarness();
    const first = await importBytes(fixtureBytes("hubspot-contacts.csv"), { policy: "skip" });
    const beforeSecond = await contacts.list({}, { limit: 1000 });

    const second = await importBytes(fixtureBytes("hubspot-contacts.csv"), { policy: "skip" });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(first.totalRows);

    const afterSecond = await contacts.list({}, { limit: 1000 });
    expect(afterSecond.total).toBe(beforeSecond.total);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. company create-or-link by exact name                                    */
/* -------------------------------------------------------------------------- */

describe("CSV import: company create-or-link by exact name", () => {
  it("links two rows with the same company name to one company, and a differently-spelled name to a second", async () => {
    h = await createHarness();
    const csv =
      "First Name,Last Name,Company,Email\n" +
      "Ada,Lovelace,Acme Inc,ada@example.com\n" +
      "Alan,Turing,Acme Inc,alan@example.com\n" +
      "Grace,Hopper,Acme Incorporated,grace@example.com\n";

    const result = await importText(csv, { policy: "skip" });
    expect(result.companiesCreated).toBe(2);

    const companyList = await companies.list({}, { limit: 10 });
    expect(companyList.total).toBe(2);

    const acmeInc = await companies.findByName("Acme Inc");
    const acmeIncorporated = await companies.findByName("Acme Incorporated");
    expect(acmeInc).not.toBeNull();
    expect(acmeIncorporated).not.toBeNull();
    expect(acmeInc?.id).not.toBe(acmeIncorporated?.id);

    const list = await contacts.list({}, { limit: 10 });
    const ada = list.rows.find((c) => c.firstName === "Ada");
    const alan = list.rows.find((c) => c.firstName === "Alan");
    const grace = list.rows.find((c) => c.firstName === "Grace");
    expect(ada?.companyId).toBe(acmeInc?.id);
    expect(alan?.companyId).toBe(acmeInc?.id);
    expect(grace?.companyId).toBe(acmeIncorporated?.id);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. empty and malformed files                                               */
/* -------------------------------------------------------------------------- */

describe("CSV import: empty and malformed files", () => {
  it("malformed/empty-with-headers.csv imports 0 rows and creates nothing", async () => {
    h = await createHarness();
    const result = await importBytes(fixtureBytes("malformed", "empty-with-headers.csv"), {
      policy: "skip",
    });
    expect(result.totalRows).toBe(0);
    expect(result.created).toBe(0);

    const list = await contacts.list({}, { limit: 10 });
    expect(list.total).toBe(0);
  });

  it("malformed/ragged.csv raises ImportParseError with a row number and writes nothing", async () => {
    h = await createHarness();

    let caught: unknown = null;
    try {
      await importBytes(fixtureBytes("malformed", "ragged.csv"), { policy: "skip" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ImportParseError);
    expect((caught as ImportParseError).row).toBe(2);

    const list = await contacts.list({}, { limit: 10 });
    expect(list.total).toBe(0);
  });

  it("malformed/bom.csv and malformed/crlf.csv import their 5 rows", async () => {
    h = await createHarness();
    const bomResult = await importBytes(fixtureBytes("malformed", "bom.csv"), { policy: "skip" });
    expect(bomResult.totalRows).toBe(5);
    expect(bomResult.created).toBe(5);
    h.dispose();

    h = await createHarness();
    const crlfResult = await importBytes(fixtureBytes("malformed", "crlf.csv"), { policy: "skip" });
    expect(crlfResult.totalRows).toBe(5);
    expect(crlfResult.created).toBe(5);
  });

  it("malformed/semicolon.csv imports using the sniffed ';' delimiter", async () => {
    h = await createHarness();
    const bytes = fixtureBytes("malformed", "semicolon.csv");
    const sniff = sniffCsv(bytes);
    expect(sniff.delimiter).toBe(";");

    const result = await importBytes(bytes, { policy: "skip" });
    expect(result.totalRows).toBe(5);
    expect(result.created).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. ImportWriteError leaves nothing behind                                  */
/* -------------------------------------------------------------------------- */

describe("CSV import: a write failure leaves nothing behind", () => {
  it("a batch failure mid-import rolls back the whole transaction", async () => {
    h = await createHarness();
    const original = getDriver();
    let batchCalls = 0;
    setDriver({
      ...original,
      async batch(stmts) {
        batchCalls += 1;
        // 1500 rows flush every BATCH_ROWS (500), so this is the third and
        // final flush - two earlier flushes already "succeeded" as far as
        // the driver is concerned, proving the outer transaction (not just
        // the failing statement) is what gets rolled back.
        if (batchCalls === 3) {
          throw new Error("simulated write failure");
        }
        return original.batch(stmts);
      },
    });

    let caught: unknown = null;
    try {
      await importText(syntheticContactsCsv(1500), { policy: "skip" });
    } catch (err) {
      caught = err;
    } finally {
      setDriver(original);
    }

    expect(caught).toBeInstanceOf(ImportWriteError);
    expect(batchCalls).toBe(3);

    const list = await contacts.list({}, { limit: 10 });
    expect(list.total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. dryRun                                                                  */
/* -------------------------------------------------------------------------- */

describe("CSV import: dryRun", () => {
  it("writes nothing but still reports the rows it would skip", async () => {
    h = await createHarness();
    // The blank row has "999" in an unmapped "Id" column so papaparse's
    // skipEmptyLines does not drop the line outright - it must survive CSV
    // parsing and be marked unimportable by applyMapping instead (no name,
    // company, email or phone).
    const csv =
      "Id,First Name,Last Name,Email\n" +
      "1,Ada,Lovelace,ada@example.com\n" +
      "999,,,\n" +
      "2,Alan,Turing,alan@example.com\n";

    const result = await importText(csv, { policy: "skip", dryRun: true });
    expect(result.totalRows).toBe(3);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedRows).toHaveLength(1);
    expect(result.skippedRows[0].reason.length).toBeGreaterThan(0);

    const list = await contacts.list({}, { limit: 10 });
    expect(list.total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. onProgress                                                             */
/* -------------------------------------------------------------------------- */

describe("CSV import: onProgress", () => {
  it("reports increasing processed counts within each phase and ends at 'done'", async () => {
    h = await createHarness();
    const calls: ImportProgress[] = [];

    const total = 2500;
    const result = await importText(syntheticContactsCsv(total), {
      policy: "skip",
      onProgress: (p) => calls.push({ ...p }),
    });

    expect(result.totalRows).toBe(total);
    expect(calls.length).toBeGreaterThan(3);
    expect(calls[0].phase).toBe("reading");

    const last = calls[calls.length - 1];
    expect(last).toEqual({ phase: "done", processed: total, total });

    const readingCalls = calls.filter((c) => c.phase === "reading");
    for (let i = 1; i < readingCalls.length; i += 1) {
      expect(readingCalls[i].processed).toBeGreaterThan(readingCalls[i - 1].processed);
    }

    const writingCalls = calls.filter((c) => c.phase === "writing");
    expect(writingCalls.length).toBeGreaterThan(0);
    for (let i = 1; i < writingCalls.length; i += 1) {
      expect(writingCalls[i].processed).toBeGreaterThan(writingCalls[i - 1].processed);
    }
  });
});
