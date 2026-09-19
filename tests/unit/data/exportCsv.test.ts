import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import {
  escapeCell,
  guardCell,
  toCsv,
  toCsvFromObjects,
} from "../../../src/features/data/lib/exportCsv";

describe("guardCell: formula-injection guard", () => {
  const triggers = ["=", "+", "-", "@", "\t", "\r"];

  for (const trigger of triggers) {
    it(`prefixes a leading ${JSON.stringify(trigger)} with a single quote`, () => {
      const value = `${trigger}cmd|'/bin/calc'!A1`;
      expect(guardCell(value)).toBe(`'${value}`);
    });
  }

  it("does not guard a value that only contains a trigger character later", () => {
    expect(guardCell("total = 5")).toBe("total = 5");
    expect(guardCell("a+b")).toBe("a+b");
    expect(guardCell("well-known")).toBe("well-known");
    expect(guardCell("me@example.com")).toBe("me@example.com");
    expect(guardCell("has\ttab inside")).toBe("has\ttab inside");
  });

  it("leaves ordinary text, numbers and booleans alone", () => {
    expect(guardCell("hello")).toBe("hello");
    expect(guardCell(42)).toBe("42");
    expect(guardCell(true)).toBe("true");
    expect(guardCell(false)).toBe("false");
  });

  it("null and undefined become an empty string", () => {
    expect(guardCell(null)).toBe("");
    expect(guardCell(undefined)).toBe("");
  });
});

describe("escapeCell: RFC4180 quoting", () => {
  it("quotes a cell containing a comma", () => {
    expect(escapeCell("Acme, Inc.")).toBe('"Acme, Inc."');
  });

  it("quotes a cell containing a double quote, doubling it", () => {
    expect(escapeCell('Say "hi"')).toBe('"Say ""hi"""');
  });

  it("quotes a cell containing a newline", () => {
    expect(escapeCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a cell with a leading or trailing space", () => {
    expect(escapeCell(" leading")).toBe('" leading"');
    expect(escapeCell("trailing ")).toBe('"trailing "');
  });

  it("does not quote a plain cell", () => {
    expect(escapeCell("plain")).toBe("plain");
    expect(escapeCell(42)).toBe("42");
  });

  it("writes null/undefined as an empty, unquoted cell", () => {
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
  });

  it("writes booleans as true/false", () => {
    expect(escapeCell(true)).toBe("true");
    expect(escapeCell(false)).toBe("false");
  });

  it("a guarded cell is always quoted, even if nothing else requires it", () => {
    expect(escapeCell("=1+1")).toBe(`"'=1+1"`);
    expect(escapeCell("-5")).toBe(`"'-5"`);
    expect(escapeCell("@mention")).toBe(`"'@mention"`);
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF and ends with a trailing newline", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv).toBe("A,B\r\n1,2\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("handles multiple rows and mixed cell types", () => {
    const csv = toCsv(
      ["Name", "Active", "Count", "Notes"],
      [
        ["Ada", true, 3, null],
        ["Grace, PhD", false, 0, "line\nbreak"],
      ],
    );
    expect(csv).toBe(
      'Name,Active,Count,Notes\r\nAda,true,3,\r\n"Grace, PhD",false,0,"line\nbreak"\r\n',
    );
  });
});

describe("toCsvFromObjects", () => {
  it("projects rows through the header key/label mapping", () => {
    const csv = toCsvFromObjects(
      [
        { key: "firstName", label: "First Name" },
        { key: "lastName", label: "Last Name" },
      ],
      [
        { firstName: "Ada", lastName: "Lovelace" },
        { firstName: "=evil", lastName: null },
      ],
    );
    expect(csv).toBe(
      'First Name,Last Name\r\nAda,Lovelace\r\n"\'=evil",\r\n',
    );
  });
});

describe("round trip through papaparse", () => {
  it("re-parses guarded, quoted, and plain cells back to their guarded string values", () => {
    const headers = ["Name", "Formula", "Notes", "Empty"];
    const rows = [
      ["Ada, Lovelace", "=1+1", 'She said "hi"\nnice to meet you', null],
      ["-Grace", "@Hopper", "well-known, prolific", undefined],
    ];
    const csv = toCsv(headers, rows);

    const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true });
    expect(parsed.errors).toHaveLength(0);

    const [parsedHeaders, ...parsedRows] = parsed.data;
    expect(parsedHeaders).toEqual(headers);

    expect(parsedRows[0]).toEqual(["Ada, Lovelace", "'=1+1", 'She said "hi"\nnice to meet you', ""]);
    expect(parsedRows[1]).toEqual(["'-Grace", "'@Hopper", "well-known, prolific", ""]);
  });
});
