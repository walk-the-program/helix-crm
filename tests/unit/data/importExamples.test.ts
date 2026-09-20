/**
 * The promise behind "Download an example": every file Helix hands out is a
 * file Helix can read straight back in.
 *
 *   buildExampleCsv(type, context) --> CSV text
 *                    |
 *                    v
 *        readHeaders --> the right guesser --> 100% mapped, zero Skips
 *                    |
 *                    v
 *          readDraftRow on each of the 3 rows --> importable, no warnings
 *
 * Pure, no database: the stub `ExampleContext` below stands in for the
 * workspace's real stage names, which `tests/repo/data/importExamples.test.ts`
 * checks against a seeded pipeline instead.
 */
import { describe, expect, it } from "vitest";
import { readHeaders, parseCsvText } from "../../../src/lib/csv";
import { guessMapping } from "../../../src/features/data/lib/mapping";
import {
  fullyMapped,
  guessMappingFor,
  readDraftRow,
  SKIP,
} from "../../../src/features/data/lib/typedMapping";
import { buildExampleCsv } from "../../../src/features/data/lib/examples";
import { DEALS_IMPORT, IMPORT_TYPES } from "../../../src/features/data/import/fields/index";
import type { ExampleContext } from "../../../src/features/data/import/fields/types";

const STUB_CONTEXT: ExampleContext = { stageNames: ["New", "Quoted", "Won", "Lost"] };

describe.each(IMPORT_TYPES.map((t) => [t.label, t] as const))(
  "%s example file",
  (_label, type) => {
    const csv = buildExampleCsv(type, STUB_CONTEXT);

    it("uses CRLF for every line ending", () => {
      // Every newline in the file is part of a \r\n pair - none is a bare \n.
      expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
    });

    it("has exactly 4 lines of content: the header plus the three example rows", () => {
      const lines = csv.split("\r\n");
      expect(lines[lines.length - 1]).toBe("");
      expect(lines.slice(0, -1)).toHaveLength(4);
    });

    it("header row equals the type's field labels, in field order", () => {
      const { headers } = readHeaders(csv);
      expect(headers).toEqual(type.fields.map((f) => f.label));
    });

    it("is 100% auto-mapped: not one column comes back as skip", () => {
      const { headers } = readHeaders(csv);
      if (type.legacy) {
        const mapping = guessMapping(headers);
        const skipped = mapping.filter((m) => m.field === "skip").map((m) => m.header);
        expect(skipped, `left on Skip: ${skipped.join(", ")}`).toEqual([]);
      } else {
        const mapping = guessMappingFor(type, headers);
        const skipped = mapping.filter((m) => m.field === SKIP).map((m) => m.header);
        expect(skipped, `left on Skip: ${skipped.join(", ")}`).toEqual([]);
        expect(fullyMapped(mapping)).toBe(true);
      }
    });

    if (!type.legacy) {
      it("every one of the three example rows reads back importable, with no warnings", () => {
        const { headers, rows } = parseCsvText(csv);
        const mapping = guessMappingFor(type, headers);
        expect(rows).toHaveLength(3);
        rows.forEach((cells, i) => {
          const draftRow = readDraftRow(type, cells, mapping, i + 2);
          expect(
            draftRow.warnings,
            `row ${i + 1} of ${type.id}: ${JSON.stringify(draftRow.warnings)}`,
          ).toEqual([]);
          expect(draftRow.importable, `row ${i + 1} of ${type.id} was not importable`).toBe(true);
        });
      });
    }
  },
);

describe("deals example: the Stage column comes from the live workspace", () => {
  const csv = buildExampleCsv(DEALS_IMPORT, STUB_CONTEXT);
  const { headers, rows } = parseCsvText(csv);
  const stageIndex = headers.indexOf("Stage");
  const stageField = DEALS_IMPORT.fields.find((f) => f.key === "stage")!;

  it("has a Stage column", () => {
    expect(stageIndex).toBeGreaterThanOrEqual(0);
  });

  it("fills it with what liveExamples computes from the stub context's stageNames", () => {
    const expected = stageField.liveExamples!(STUB_CONTEXT);
    expect(rows.map((r) => r[stageIndex])).toEqual(expected);
  });

  it("is not the field's hard-coded fallback examples", () => {
    const expected = stageField.liveExamples!(STUB_CONTEXT);
    expect(expected).not.toEqual(stageField.examples);
    expect(rows.map((r) => r[stageIndex])).not.toEqual(stageField.examples);
  });

  it("every value it used is one of the stub context's own stage names", () => {
    for (const cell of rows.map((r) => r[stageIndex])) {
      expect(STUB_CONTEXT.stageNames).toContain(cell);
    }
  });
});
