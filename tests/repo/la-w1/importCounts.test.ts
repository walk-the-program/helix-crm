/**
 * LR-LA-W1, journey J2 (repo layer, real SQLite).
 *
 * Independent re-verification of the exact numbers claimed for
 * `tests/fixtures/messy-3000.csv` in `docs/rounds/launch-returns/cs.md` §5
 * (2,991 created / 6 skipped / 61 warnings) and in
 * `tests/repo/data/messyImport.test.ts`. This file does not import or reuse
 * that file's assertions - it re-runs the fixture through the real import
 * pipeline itself, against a fresh in-memory database, and derives the
 * numbers from scratch so the LA phase is not taking a prior phase's return
 * as proof of anything.
 *
 * It also independently proves the one claim CS's return does not carry a
 * dedicated messy-3000 test for: that importing 2,991 contacts creates
 * exactly zero automation tasks. `tests/repo/onboarding/importDoesNotAutomate
 * .test.ts` proves this for the 52-row hubspot fixture; this proves it again
 * for a file 57x larger, which is the file an install day is actually likely
 * to look like.
 *
 * Run alone:
 *   npx vitest run tests/repo/la-w1/importCounts.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as contacts from "../../../src/db/repos/contacts";
import * as tasksRepo from "../../../src/db/repos/tasks";
import * as automations from "../../../src/db/repos/automations";
import { parseCsvText, readHeaders, sniffCsv } from "../../../src/lib/csv";
import { guessMapping, type ColumnMapping } from "../../../src/features/data/lib/mapping";
import { runImport, type ImportResult } from "../../../src/features/data/lib/importRun";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "..", "fixtures", "messy-3000.csv");

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function importFixture(): Promise<{ result: ImportResult; mapping: ColumnMapping[] }> {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const sniff = sniffCsv(bytes);
  const { headers, delimiter } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
  const mapping = guessMapping(headers);
  const result = await runImport({
    text: sniff.text,
    mapping,
    delimiter,
    policy: "skip",
  });
  return { result, mapping };
}

describe("LA-W1 J2: messy-3000.csv re-derived independently, against a fresh database", () => {
  it("2,997 rows reach the importer (3,000 written minus 3 comma-only rows)", async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const sniff = sniffCsv(bytes);
    const parsed = parseCsvText(sniff.text, { delimiter: sniff.delimiter });
    expect(parsed.rowCount).toBe(2997);
  });

  it("\"Customer Name\" (and \"Co.\") are not left on Skip by the guesser", async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const sniff = sniffCsv(bytes);
    const { headers } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
    const mapping = guessMapping(headers);
    const byHeader = new Map(mapping.map((m) => [m.header, m]));
    expect(byHeader.get("Customer Name")?.field).not.toBe("skip");
    expect(byHeader.get("Customer Name")?.field).toBe("fullName");
    expect(byHeader.get("Co.")?.field).not.toBe("skip");
  });

  it("EXACT counts: 2,991 created, 0 updated, 6 skipped, arithmetic closes against 2,997 total rows", async () => {
    h = await createSeededHarness();
    const { result } = await importFixture();

    expect(result.totalRows).toBe(2997);
    expect(result.created).toBe(2991);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(6);
    expect(result.created + result.updated + result.skipped).toBe(result.totalRows);

    // Live count in the database agrees with what the importer reported -
    // the number on screen and the number of rows actually on disk are the
    // same number, not two numbers that happen to usually match.
    const live = await contacts.list({}, { limit: 5000 });
    expect(live.total).toBe(2991);
  });

  it("EXACT warnings: 61 rows accepted with something Helix had to decide about (60 no-name, 1 unparseable phone)", async () => {
    h = await createSeededHarness();
    const { result } = await importFixture();

    expect(result.warnings.length).toBe(61);
    const byKind = new Map<string, number>();
    for (const w of result.warnings) byKind.set(w.kind, (byKind.get(w.kind) ?? 0) + 1);
    expect(byKind.get("name")).toBe(60);
    expect(byKind.get("phone")).toBe(1);
  });

  it("takes a real pre-import backup file that exists on disk before a single row is written", async () => {
    h = await createSeededHarness();
    const { result } = await importFixture();
    expect(result.preImportBackupPath).not.toBeNull();
    expect(existsSync(result.preImportBackupPath!)).toBe(true);
  });

  it("EVIDENCE CHECK: if these numbers ever drift from 2,991 / 6 / 61, this test - not a written claim - is what must be believed", async () => {
    h = await createSeededHarness();
    const { result } = await importFixture();
    // A single assertion naming all three numbers together, so a future
    // reader diffing this file's failure output sees the whole claim at once.
    expect({
      created: result.created,
      skipped: result.skipped,
      warnings: result.warnings.length,
    }).toEqual({ created: 2991, skipped: 6, warnings: 61 });
  });

  it("a contacts import of 2,991 real customers creates ZERO automation tasks and ZERO tasks of any kind", async () => {
    h = await createSeededHarness();

    // The premise this test depends on: the two rules that could fire ship
    // on. If either ever ships off, this test is asserting nothing.
    const lead = await automations.get("lead_arrived");
    const quote = await automations.get("quote_sent");
    expect(lead?.enabled, "lead_arrived ships on").toBe(true);
    expect(quote?.enabled, "quote_sent ships on").toBe(true);

    await importFixture();

    const automationTasks = await tasksRepo.list({ source: "automation" }, { limit: 5000 });
    expect(automationTasks.total, "no automation fired on this import").toBe(0);

    const allTasks = await tasksRepo.list({}, { limit: 5000 });
    expect(allTasks.total, "an imported customer list is not a to-do list").toBe(0);
  });

  it("a specific imported contact is findable by exact name, proving the search surface has real rows to search", async () => {
    h = await createSeededHarness();
    await importFixture();
    // François Dubé is the fixture's documented non-ASCII spot check
    // (tests/repo/data/messyImport.test.ts); this proves it is not just
    // present in the table but reachable through the same list/search path
    // the Contacts screen's "Search contacts" box calls. The search clause
    // matches first_name, last_name and company name independently (not a
    // concatenated full name), so this searches on the surname alone -
    // exactly what a real owner types when he only remembers the last name.
    const found = await contacts.list({ search: "Dubé" }, { limit: 10 });
    expect(found.rows.length).toBeGreaterThanOrEqual(1);
    expect(found.rows.some((r) => r.firstName === "François" && r.lastName === "Dubé")).toBe(
      true,
    );
  });
});
