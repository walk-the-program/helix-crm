/**
 * The 100k-row timing test, kept in its own file so the normal suite stays
 * fast. The fixture is generated on demand with the committed generator
 * (tests/fixtures/malformed/gen-100k.mjs) into a scratch directory outside
 * the repo, and the import runs against a real file-backed database so the
 * timing means something.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import { readHeaders } from "../../../src/lib/csv";
import { guessMapping } from "../../../src/features/data/lib/mapping";
import { runImport } from "../../../src/features/data/lib/importRun";

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(here, "..", "..", "fixtures", "malformed", "gen-100k.mjs");

const ROWS = 100_000;
const TIME_BUDGET_MS = 20_000;

let scratchDir: string;
let csvPath: string;
let dbPath: string;

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "helix-import-100k-"));
  csvPath = join(scratchDir, "100k.csv");
  dbPath = join(scratchDir, "timing.db");
  execFileSync(process.execPath, [GENERATOR, csvPath, "--rows", String(ROWS)], {
    stdio: "pipe",
  });
}, 60_000);

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("CSV import: 100k rows", () => {
  it(
    "imports 100,000 rows against a real file-backed database within the time budget",
    { timeout: 180_000 },
    async () => {
      let h: Harness | null = null;
      try {
        h = await createHarness({ path: dbPath });

        const bytes = new Uint8Array(readFileSync(csvPath));
        const text = new TextDecoder("utf-8").decode(bytes);
        const { headers, delimiter } = readHeaders(text);
        const mapping = guessMapping(headers);

        const result = await runImport({
          text,
          mapping,
          delimiter,
          policy: "skip",
        });

        console.log(`[import-100k] runImport durationMs = ${result.durationMs}`);

        expect(result.totalRows).toBe(ROWS);
        expect(result.created + result.updated + result.skipped).toBe(ROWS);
        expect(result.durationMs).toBeLessThan(TIME_BUDGET_MS);

        const countRows = await raw.query("SELECT count(*) FROM contacts");
        expect(Number(countRows[0][0])).toBe(result.created);
      } finally {
        h?.dispose();
      }
    },
  );
});
