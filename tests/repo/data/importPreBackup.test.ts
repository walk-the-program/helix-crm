/**
 * The backup an import is undone with (LR-OPS, F-OPS-4).
 *
 * `importRun.ts` writes ONE `change_log` row for a whole file rather than one
 * per contact, and says so in a comment: "undo for an import is restore the
 * backup, not walk the log". The reasoning is right - a hundred thousand rows
 * would double the work - and the backup it pointed at was never taken. An
 * import that updates existing contacts on a dedupe match, which is the normal
 * case for a second export from the same vendor, overwrote real data with
 * nothing behind it but the last scheduled backup, up to six hours old.
 *
 * Two rules, and the second is the one that matters:
 *
 *   1. a real import takes a `pre-import` backup and reports where it went;
 *   2. an import that cannot take one does not start.
 *
 * The migrator already refuses on exactly this reasoning. An import is the
 * other operation in this product that rewrites a lot of rows at once.
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import { readHeaders, sniffCsv } from "../../../src/lib/csv";
import { guessMapping } from "../../../src/features/data/lib/mapping";
import { runImport } from "../../../src/features/data/lib/importRun";
import { BackupWriteError } from "../../../src/features/data/lib/backupsFs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "..", "fixtures", "hubspot-contacts.csv");

let harness: Harness | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  harness?.dispose();
  harness = null;
});

async function liveContacts(): Promise<number> {
  const rows = await raw.query("SELECT count(*) FROM contacts WHERE deleted_at IS NULL", []);
  return Number(rows[0][0]);
}

async function importFixture() {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const sniff = sniffCsv(bytes);
  const { headers, delimiter } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
  return runImport({
    text: sniff.text,
    mapping: guessMapping(headers),
    delimiter,
    policy: "update",
  });
}

describe("the backup an import is undone with", () => {
  it("is taken before the import and named in the result", async () => {
    harness = await createHarness();

    const result = await importFixture();

    expect(result.preImportBackupPath).not.toBeNull();
    expect(result.preImportBackupPath).toContain("pre-import");
    expect(existsSync(result.preImportBackupPath as string)).toBe(true);
    expect(result.created).toBeGreaterThan(0);
  });

  /**
   * A disk with no room, or a workspace folder that has gone read-only. The
   * import must not proceed and must not half-proceed: the whole point of the
   * backup is that it exists before the first row is written.
   */
  it("stops the import when it cannot be taken, and writes nothing", async () => {
    harness = await createHarness();
    const before = await liveContacts();

    vi.spyOn(raw, "backup").mockRejectedValue({
      code: "BACKUP_FAILED",
      message: "No space left on the disk.",
    });

    await expect(importFixture()).rejects.toBeInstanceOf(BackupWriteError);
    await expect(importFixture()).rejects.toThrow("the import was not started");
    await expect(importFixture()).rejects.toThrow("No space left on the disk.");

    const after = await liveContacts();
    expect(after).toBe(before);
  });

  it("takes nothing on a dry run, because a dry run changes nothing", async () => {
    harness = await createHarness();
    const backup = vi.spyOn(raw, "backup");

    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const sniff = sniffCsv(bytes);
    const { headers, delimiter } = readHeaders(sniff.text, { delimiter: sniff.delimiter });
    const result = await runImport({
      text: sniff.text,
      mapping: guessMapping(headers),
      delimiter,
      policy: "update",
      dryRun: true,
    });

    expect(result.preImportBackupPath).toBeNull();
    expect(backup).not.toHaveBeenCalled();
  });
});
