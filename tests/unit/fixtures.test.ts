/**
 * The fixtures are test data, but they are also a claim: that they look like
 * what HubSpot, Zoho, Pipedrive, Google Contacts and Excel actually hand a
 * small-business owner. This suite holds them to it, so a careless edit cannot
 * quietly turn them into clean, uninteresting files.
 *
 * It parses every fixture with the same papaparse the importer uses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse, type ParseResult } from "papaparse";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const MALFORMED = join(FIXTURES, "malformed");

type Row = Record<string, string>;

function read(...parts: string[]): string {
  return readFileSync(join(FIXTURES, ...parts), "utf8");
}

function parseWithHeader(text: string): ParseResult<Row> {
  // skipEmptyLines matches what the importer does: a file that ends with a
  // newline is normal, and the phantom final row is not a defect.
  return parse<Row>(text, { header: true, skipEmptyLines: true });
}

/** The five exports a real owner would bring in. */
const MAIN_FIXTURES = [
  "hubspot-contacts.csv",
  "zoho-contacts.csv",
  "pipedrive-persons.csv",
  "google-contacts.csv",
  "excel-saveas.csv",
] as const;

/** The first column of each export, which is also the BOM's landing spot. */
const FIRST_FIELD: Record<string, string> = {
  "hubspot-contacts.csv": "Record ID",
  "zoho-contacts.csv": "Record Id",
  "pipedrive-persons.csv": "Person - ID",
  "google-contacts.csv": "First Name",
  "excel-saveas.csv": "Name",
};

describe("the vendor export fixtures", () => {
  it.each(MAIN_FIXTURES)("%s parses with no errors", (name) => {
    const result = parseWithHeader(read(name));
    expect(result.errors, JSON.stringify(result.errors.slice(0, 3))).toHaveLength(0);
    expect(result.meta.delimiter).toBe(",");
    expect(result.meta.fields?.[0]).toBe(FIRST_FIELD[name]);
  });

  it.each(MAIN_FIXTURES)("%s has 40 to 60 rows, every one the full width", (name) => {
    const text = read(name);
    const withHeader = parseWithHeader(text);
    expect(withHeader.data.length).toBeGreaterThanOrEqual(40);
    expect(withHeader.data.length).toBeLessThanOrEqual(60);

    // Parsed without a header, every row must have the same number of cells as
    // the header row: a ragged vendor export is a different fixture.
    const raw = parse<string[]>(text, { skipEmptyLines: true });
    const width = raw.data[0].length;
    const ragged = raw.data.filter((row) => row.length !== width);
    expect(ragged, `${ragged.length} rows are not ${width} cells wide`).toHaveLength(0);
  });

  it.each(MAIN_FIXTURES)("%s keeps the messy realities an importer has to survive", (name) => {
    const text = read(name);
    const rows = parseWithHeader(text).data;
    const cells = rows.flatMap((row) => Object.values(row));

    const phones = cells.filter((cell) => /\d{3}[^a-z]*\d{3}[^a-z]*\d{4}/i.test(cell));
    const formats = new Set(
      phones.map((phone) => {
        if (/^\+/.test(phone)) return "international";
        if (/^\(/.test(phone)) return "parens";
        if (/\./.test(phone)) return "dots";
        if (/-/.test(phone)) return "dashes";
        return "digits";
      }),
    );
    expect(formats.size, `only ${[...formats]} in ${name}`).toBeGreaterThanOrEqual(3);

    const blanks = cells.filter((cell) => cell === "").length;
    expect(blanks, "a real export is full of empty cells").toBeGreaterThan(10);

    // A quoted comma survived the round trip.
    expect(cells.some((cell) => cell.includes(","))).toBe(true);
    // So did an escaped double quote.
    expect(text).toMatch(/""/);
  });

  it("carries the 47-character company name that breaks narrow columns", () => {
    const names = MAIN_FIXTURES.flatMap((name) =>
      parseWithHeader(read(name)).data.flatMap((row) => Object.values(row)),
    ).filter((cell) => cell.trim().length === 47);
    expect(names.length, "no 47-character cell found").toBeGreaterThan(0);
  });

  it("repeats six people across at least three files, for the dedupe tests", () => {
    const byEmail = new Map<string, Set<string>>();
    for (const name of MAIN_FIXTURES) {
      for (const row of parseWithHeader(read(name)).data) {
        for (const [field, value] of Object.entries(row)) {
          if (!/e-?mail/i.test(field)) continue;
          const email = value.trim().toLowerCase();
          if (!email.includes("@")) continue;
          if (!byEmail.has(email)) byEmail.set(email, new Set());
          byEmail.get(email)!.add(name);
        }
      }
    }
    const shared = [...byEmail.entries()].filter(([, files]) => files.size >= 3);
    expect(shared.length, `shared emails: ${shared.map(([email]) => email).join(", ")}`).toBeGreaterThanOrEqual(6);
  });

  it("holds a full-name column that the importer has to split", () => {
    const rows = parseWithHeader(read("pipedrive-persons.csv")).data;
    expect(rows[0]["Person - Name"]).toMatch(/\S+\s+\S+/);
    expect(Object.keys(rows[0])).not.toContain("First Name");
  });

  it("keeps Excel's two trailing phantom columns", () => {
    const raw = parse<string[]>(read("excel-saveas.csv"), { skipEmptyLines: true });
    expect(raw.data[0].slice(-2)).toEqual(["", ""]);

    // Two unnamed columns collide, so papaparse renames the second one and
    // warns on stderr. The import mapper has to cope with both, which is the
    // whole reason this file ships with them.
    const fields = parseWithHeader(read("excel-saveas.csv")).meta.fields ?? [];
    expect(fields.slice(-2)).toEqual(["", "_1"]);
  });
});

describe("the malformed fixtures", () => {
  it("bom.csv starts with a byte order mark that papaparse strips", () => {
    const text = readFileSync(join(MALFORMED, "bom.csv"), "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const result = parseWithHeader(text);
    expect(result.meta.fields?.[0]).toBe("First Name");
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("crlf.csv uses CRLF throughout", () => {
    const text = readFileSync(join(MALFORMED, "crlf.csv"), "utf8");
    expect(text).toContain("\r\n");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(parseWithHeader(text).meta.linebreak).toBe("\r\n");
  });

  it("semicolon.csv is detected as semicolon-delimited", () => {
    const text = readFileSync(join(MALFORMED, "semicolon.csv"), "utf8");
    const result = parseWithHeader(text);
    expect(result.meta.delimiter).toBe(";");
    expect(result.errors).toHaveLength(0);
    // Decimal commas, which is the reason the delimiter moved in the first place.
    expect(text).toMatch(/\d+,\d+/);
  });

  it("ragged.csv is ragged, and papaparse says so", () => {
    const text = readFileSync(join(MALFORMED, "ragged.csv"), "utf8");
    const result = parseWithHeader(text);
    expect(result.errors.length).toBeGreaterThan(0);
    const codes = new Set(result.errors.map((error) => error.code));
    expect([...codes].some((code) => code === "TooFewFields" || code === "TooManyFields")).toBe(true);
  });

  it("empty-with-headers.csv has headers and nothing else", () => {
    const text = readFileSync(join(MALFORMED, "empty-with-headers.csv"), "utf8");
    const result = parseWithHeader(text);
    expect(result.meta.fields?.length).toBeGreaterThan(0);
    expect(result.data).toHaveLength(0);
  });

  it("gen-100k.mjs is present and its output is not committed", () => {
    expect(existsSync(join(MALFORMED, "gen-100k.mjs"))).toBe(true);
    const committed = readdirSync(MALFORMED);
    expect(committed).not.toContain("100k.csv");
    expect(readFileSync(join(MALFORMED, ".gitignore"), "utf8")).toContain("100k.csv");
  });
});

describe("the ClearPath prospect export", () => {
  it("parses, and every row is a deal Helix can import", () => {
    const result = parseWithHeader(read("clearpath-prospects.csv"));
    expect(result.errors).toHaveLength(0);
    expect(result.meta.fields).toEqual([
      "First name",
      "Last name",
      "Company",
      "Email",
      "Phone",
      "City",
      "State",
      "Deal title",
      "Deal stage",
      "Deal value",
      "Source",
      "Notes",
      "Tags",
    ]);
    expect(result.data.length).toBeGreaterThan(0);

    const stages = new Set(result.data.map((row) => row["Deal stage"]));
    for (const stage of stages) {
      expect(["New", "Contacted", "Quoted", "Scheduled", "Won", "Lost"]).toContain(stage);
    }
    for (const row of result.data) {
      expect(row.Source).toBe("Import");
      expect(row["Deal value"]).toBe("1500");
      expect(row["Deal title"]).toMatch(/ website$/);
      // The mapped stage is lossy, so the original status rides along as a tag.
      expect(row.Tags).toMatch(/^clearpath/);
    }
  });
});
