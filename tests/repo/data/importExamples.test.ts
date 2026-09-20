/**
 * The example-file promise, end to end: build the file Helix hands out for
 * every import type against a real seeded workspace, then feed it straight
 * back through the real import path and prove nothing gets lost.
 *
 *   createSeededHarness --> exampleContext() --> buildExampleFile(type)
 *                                                       |
 *                             contacts: guessMapping -> runImport
 *                        everyone else: guessMappingFor -> runTypedImport
 *                                                       |
 *                                                 created === 3, skipped === 0,
 *                                                 zero warnings
 *
 * `tests/unit/data/importExamples.test.ts` covers the pure header/mapping
 * shape with a stub context; this file is the one database check that the
 * three example rows are not just well-formed but actually importable.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import { readHeaders } from "../../../src/lib/csv";
import { guessMapping } from "../../../src/features/data/lib/mapping";
import { guessMappingFor } from "../../../src/features/data/lib/typedMapping";
import { runImport } from "../../../src/features/data/lib/importRun";
import { runTypedImport } from "../../../src/features/data/lib/typedImportRun";
import { buildExampleFile, exampleContext } from "../../../src/features/data/lib/examples";
import { IMPORT_TYPES } from "../../../src/features/data/import/fields/index";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("exampleContext", () => {
  it("returns the seeded pipeline's actual stage names, in board order", async () => {
    h = await createSeededHarness();

    const pipeline = await pipelines.getDefaultOrThrow();
    const seededStages = await stages.list(pipeline.id);
    expect(seededStages.length).toBeGreaterThan(0);

    const context = await exampleContext();
    expect(context.stageNames).toEqual(seededStages.map((s) => s.name));
  });
});

describe.each(IMPORT_TYPES.map((t) => [t.label, t] as const))(
  "%s example imports cleanly into a fresh workspace",
  (_label, type) => {
    it("creates all three rows with nothing skipped and nothing to warn about", async () => {
      h = await createSeededHarness();

      const context = await exampleContext();
      const file = buildExampleFile(type, context);
      const { headers, delimiter } = readHeaders(file.csv);

      if (type.legacy) {
        const mapping = guessMapping(headers);
        const result = await runImport({
          text: file.csv,
          mapping,
          delimiter,
          policy: "skip",
        });
        expect(result.created).toBe(3);
        expect(result.skipped).toBe(0);
      } else {
        const mapping = guessMappingFor(type, headers);
        const result = await runTypedImport({
          typeId: type.id,
          text: file.csv,
          mapping,
          delimiter,
          policy: "skip",
        });
        expect(result.created).toBe(3);
        expect(result.skipped).toBe(0);
        expect(result.warnings).toEqual([]);
      }
    });
  },
);
