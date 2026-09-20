/**
 * LR-SEC-W2, item 4: import file-size and row-count limits.
 *
 * Before this packet there was no enforced ceiling anywhere on the CSV
 * import path: `readFileBytes`/`file.arrayBuffer()` loaded a file of any
 * size into memory, and `readMappedRows`/`readDraftRows` collected every row
 * into an array with no cap (only the *diagnostic* lists - skipped rows,
 * warnings - were capped at 5,000). `MAX_IMPORT_FILE_BYTES` (filePick.ts,
 * 100 MB) and `MAX_IMPORT_ROWS` (importRun.ts, 250,000, shared by
 * typedImportRun.ts) close that gap. This file proves both actually stop a
 * hostile-sized input rather than merely existing as unused constants.
 */
import { describe, expect, it } from "vitest";
import {
  ImportFileTooLargeError,
  MAX_IMPORT_FILE_BYTES,
  loadCsvFromFile,
} from "../../../src/features/data/lib/filePick";
import {
  ImportRowLimitError,
  MAX_IMPORT_ROWS,
  readMappedRows,
} from "../../../src/features/data/lib/importRun";
import { readDraftRows } from "../../../src/features/data/lib/typedImportRun";

function csvWithRows(count: number): string {
  const lines = ["name"];
  for (let i = 0; i < count; i += 1) lines.push(`row-${i}`);
  return lines.join("\n") + "\n";
}

describe("MAX_IMPORT_FILE_BYTES: the file-size ceiling", () => {
  it("refuses a file over the limit with a plain-English message, before ever decoding it", async () => {
    const oversized = new Uint8Array(MAX_IMPORT_FILE_BYTES + 1);
    const file = new File([oversized], "huge.csv", { type: "text/csv" });
    await expect(loadCsvFromFile(file)).rejects.toBeInstanceOf(ImportFileTooLargeError);
    await expect(loadCsvFromFile(file)).rejects.toThrow(/100 MB/);
  });

  it("accepts a file right at the limit", async () => {
    const atLimit = new TextEncoder().encode(`name\n${"a".repeat(100)}\n`);
    const file = new File([atLimit], "small.csv", { type: "text/csv" });
    await expect(loadCsvFromFile(file)).resolves.toMatchObject({ name: "small.csv" });
  });
});

describe("MAX_IMPORT_ROWS: the row-count ceiling (contacts import)", () => {
  it("stops with a plain-English message once a file has more rows than the ceiling", async () => {
    const text = csvWithRows(MAX_IMPORT_ROWS + 1);
    await expect(readMappedRows(text, [])).rejects.toBeInstanceOf(ImportRowLimitError);
    await expect(readMappedRows(text, [])).rejects.toThrow(/more than 250,000 rows/);
  });

  it("does not throw for a file comfortably under the ceiling", async () => {
    const text = csvWithRows(10);
    const result = await readMappedRows(text, []);
    expect(result.rows).toHaveLength(10);
  });
}, 30_000);

describe("MAX_IMPORT_ROWS: the row-count ceiling (typed import: companies)", () => {
  it("stops with a plain-English message once a file has more rows than the ceiling", async () => {
    const text = csvWithRows(MAX_IMPORT_ROWS + 1);
    await expect(readDraftRows("companies", text, [])).rejects.toBeInstanceOf(
      ImportRowLimitError,
    );
  });

  it("does not throw for a file comfortably under the ceiling", async () => {
    const text = csvWithRows(10);
    const result = await readDraftRows("companies", text, []);
    expect(result.rows).toHaveLength(10);
  });
}, 30_000);
