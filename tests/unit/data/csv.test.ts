/**
 * CSV sniffing and parsing, against the real fixture files.
 *
 * The row counts here are the ones tests/fixtures/README.md documents, so a
 * regression in the parser and a regression in a fixture are told apart.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ImportParseError,
  decodeCsvBytes,
  detectDelimiter,
  detectEncoding,
  detectNewline,
  parseCsvText,
  quoteCell,
  readHeaders,
  rowsToCsv,
  sniffCsv,
  stripBom,
} from "../../../src/lib/csv";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "..", "fixtures");

function bytes(...names: string[]): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, ...names)));
}

function text(...names: string[]): string {
  return sniffCsv(bytes(...names)).text;
}

describe("encoding", () => {
  it("strips a UTF-8 BOM and says it saw one", () => {
    const sniffed = sniffCsv(bytes("malformed", "bom.csv"));
    expect(sniffed.hadBom).toBe(true);
    expect(sniffed.text.startsWith("﻿")).toBe(false);
    expect(sniffed.encoding).toBe("utf-8");
  });

  it("leaves a file without a BOM alone", () => {
    const { hadBom, text: body } = stripBom("First Name,Last Name");
    expect(hadBom).toBe(false);
    expect(body).toBe("First Name,Last Name");
  });

  it("reads real UTF-8 as UTF-8", () => {
    expect(detectEncoding(bytes("hubspot-contacts.csv"))).toBe("utf-8");
    expect(text("hubspot-contacts.csv")).toContain("First Name");
  });

  it("falls back to windows-1252 when the bytes are not valid UTF-8", () => {
    // "José" written by a Windows spreadsheet: 0xE9 is é in cp1252 and an
    // illegal lead byte in UTF-8.
    const latin1 = new Uint8Array([
      0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x4a, 0x6f, 0x73, 0xe9, 0x0a,
    ]);
    expect(detectEncoding(latin1)).toBe("windows-1252");
    expect(decodeCsvBytes(latin1).text).toContain("José");
  });
});

describe("delimiter and newline sniffing", () => {
  it("finds the comma in every vendor export", () => {
    for (const name of [
      "hubspot-contacts.csv",
      "zoho-contacts.csv",
      "pipedrive-persons.csv",
      "google-contacts.csv",
      "excel-saveas.csv",
      "clearpath-prospects.csv",
    ]) {
      expect(detectDelimiter(text(name)), name).toBe(",");
    }
  });

  it("finds the semicolon in a European export whose numbers contain commas", () => {
    expect(detectDelimiter(text("malformed", "semicolon.csv"))).toBe(";");
  });

  it("is not fooled by commas inside quoted fields", () => {
    const sample = 'Name;City\n"Smith, John";Provo\n"Doe, Jane";Orem\n';
    expect(detectDelimiter(sample)).toBe(";");
  });

  it("reports CRLF and LF", () => {
    expect(detectNewline(text("malformed", "crlf.csv"))).toBe("\r\n");
    expect(detectNewline(text("hubspot-contacts.csv"))).toBe("\r\n");
    expect(detectNewline(text("zoho-contacts.csv"))).toBe("\n");
  });
});

describe("parsing the fixtures", () => {
  const expected: [string, number, number][] = [
    // file, data rows, columns
    ["hubspot-contacts.csv", 52, 18],
    ["zoho-contacts.csv", 47, 20],
    ["pipedrive-persons.csv", 58, 14],
    ["google-contacts.csv", 44, 30],
    ["excel-saveas.csv", 41, 12],
    ["clearpath-prospects.csv", 19, 13],
  ];

  for (const [name, rows, columns] of expected) {
    it(`reads ${name} as ${rows} rows of ${columns} columns`, () => {
      const parsed = parseCsvText(text(name));
      expect(parsed.headers).toHaveLength(columns);
      expect(parsed.rowCount).toBe(rows);
      expect(parsed.rows).toHaveLength(rows);
      for (const row of parsed.rows) expect(row).toHaveLength(columns);
    });
  }

  it("keeps a quoted comma inside one cell", () => {
    const parsed = parseCsvText(text("hubspot-contacts.csv"));
    const company = parsed.headers.indexOf("Associated Company");
    const withComma = parsed.rows.find((r) => r[company].includes(","));
    expect(withComma, "the HubSpot fixture has a company name with a comma").toBeTruthy();
  });

  it("keeps an escaped double quote", () => {
    const parsed = parseCsvText(text("zoho-contacts.csv"));
    const flat = parsed.rows.flat().join(" ");
    expect(flat).toContain('"');
  });

  it("reads the header row on its own", () => {
    const { headers, delimiter } = readHeaders(text("google-contacts.csv"));
    expect(delimiter).toBe(",");
    expect(headers[0]).toBe("First Name");
    expect(headers).toContain("E-mail 1 - Value");
  });

  it("handles a file whose header row is the only row", () => {
    const parsed = parseCsvText(text("malformed", "empty-with-headers.csv"));
    expect(parsed.rowCount).toBe(0);
    expect(parsed.headers.length).toBeGreaterThan(0);
  });

  it("reads a BOM file's first header without the BOM stuck to it", () => {
    const parsed = parseCsvText(text("malformed", "bom.csv"));
    expect(parsed.headers[0].charCodeAt(0)).not.toBe(0xfeff);
    expect(parsed.rowCount).toBe(5);
  });

  it("reads CRLF rows without a trailing empty row", () => {
    const parsed = parseCsvText(text("malformed", "crlf.csv"));
    expect(parsed.rowCount).toBe(5);
  });
});

describe("ragged files", () => {
  it("raises ImportParseError naming the row and the column", () => {
    let thrown: unknown;
    try {
      parseCsvText(text("malformed", "ragged.csv"));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ImportParseError);
    const error = thrown as ImportParseError;
    expect(error.row).toBeGreaterThan(1);
    expect(error.message).toMatch(/Row \d+ has \d+ values/);
    expect(error.sample).toBeTruthy();
  });

  it("pads and truncates instead when asked to be tolerant", () => {
    const parsed = parseCsvText(text("malformed", "ragged.csv"), { tolerant: true });
    for (const row of parsed.rows) {
      expect(row).toHaveLength(parsed.headers.length);
    }
    expect(parsed.rowCount).toBeGreaterThan(0);
  });

  it("stops reading at the preview limit", () => {
    const parsed = parseCsvText(text("hubspot-contacts.csv"), { limit: 20 });
    expect(parsed.rowCount).toBe(20);
  });
});

describe("writing rows back out", () => {
  it("quotes only what needs quoting", () => {
    expect(quoteCell("Provo")).toBe("Provo");
    expect(quoteCell("Smith, John")).toBe('"Smith, John"');
    expect(quoteCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(quoteCell(" padded ")).toBe('" padded "');
    expect(quoteCell("two\nlines")).toBe('"two\nlines"');
  });

  it("round trips through the parser", () => {
    const headers = ["Name", "Note"];
    const rows = [["Smith, John", 'He said "hi"'], ["Jane", ""]];
    const csv = rowsToCsv(headers, rows);
    expect(csv.endsWith("\r\n")).toBe(true);
    const parsed = parseCsvText(csv);
    expect(parsed.headers).toEqual(headers);
    expect(parsed.rows).toEqual(rows);
  });
});
