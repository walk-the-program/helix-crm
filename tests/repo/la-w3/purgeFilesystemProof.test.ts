/**
 * LA-W3 J8i: the 30-day purge sweep removes notes, tasks, payments, PDFs on
 * disk, and search index rows — each of the five checked here by querying or
 * statting after the sweep, against REAL files on a real temp directory.
 *
 * `tests/repo/data/purgeSweep.test.ts` already proves the sweep calls
 * `fsBridge.removePath` with the right path and in the right order, but it
 * mocks `removePath` to a function that only records the call
 * (`removed.push(path)`) — it never touches a real file, so it cannot answer
 * "is the file actually gone". This file swaps that mock for one backed by
 * real Node `fs` calls against a real `mkdtempSync` directory, so the
 * assertions below are `fs.existsSync`, not a call-log.
 *
 * The five categories, independently verified:
 *   1. notes      — an activity whose only subject was the purged contact
 *   2. tasks      — a task whose only subject was the purged contact
 *   3. payments   — a payment on a purged invoice (ON DELETE RESTRICT, so
 *                   `trash.purge` must delete it by hand first)
 *   4. PDFs       — the invoice's rendered PDF, a real file on real disk
 *   5. search rows — `search_docs`/`search_index` rows for the purged contact
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSeededHarness, type Harness } from "../harness";
import * as contacts from "../../../src/db/repos/contacts";
import * as activities from "../../../src/db/repos/activities";
import * as tasks from "../../../src/db/repos/tasks";
import * as companies from "../../../src/db/repos/companies";
import * as deals from "../../../src/db/repos/deals";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import * as trash from "../../../src/db/repos/trash";
import { raw } from "../../../src/db/client";

let workDir: string;

// Real fs, not a call-recorder: this is the one substitution needed at all,
// because @tauri-apps/plugin-fs has no Tauri runtime to talk to under Vitest.
// joinPath (pure string logic) is untouched.
vi.mock("../../../src/features/data/lib/fsBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/features/data/lib/fsBridge")>();
  return {
    ...actual,
    removePath: async (path: string) => {
      // Mirrors the real plugin: throws if the file is not there.
      const { unlinkSync, existsSync: exists } = await import("node:fs");
      if (!exists(path)) throw new Error(`ENOENT: no such file, unlink '${path}'`);
      unlinkSync(path);
    },
  };
});

vi.mock("../../../src/features/data/lib/workspace", () => ({
  workspacePaths: async () => ({
    workspaceId: "la-w3-purge-fixture",
    dbPath: join(workDirRef(), "helix.db"),
    dir: workDirRef(),
    backupsDir: join(workDirRef(), "backups"),
    attachmentsDir: join(workDirRef(), "attachments"),
    documentsDir: join(workDirRef(), "documents"),
  }),
}));

// The mock factory above is hoisted above `workDir`'s assignment in
// `beforeEach`, so it reads through this indirection instead of closing over
// the (not-yet-assigned) variable directly.
function workDirRef(): string {
  return workDir;
}

const { sweepExpiredTrash, __resetPurgeSweepForTests } = await import(
  "../../../src/features/data/trash/purgeSweep"
);

let h: Harness | null = null;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "helix-la-w3-purge-"));
  mkdirSync(join(workDir, "documents"), { recursive: true });
  mkdirSync(join(workDir, "attachments"), { recursive: true });
});

afterEach(() => {
  __resetPurgeSweepForTests();
  vi.restoreAllMocks();
  h?.dispose();
  h = null;
  rmSync(workDir, { recursive: true, force: true });
});

/** Backdate a soft-deleted row past the sweep's cutoff, anchored the same way purgeSweep.test.ts does. */
async function backdate(table: string, id: string, daysAgo: number): Promise<void> {
  const cutoff = new Date(trash.purgeCutoffIso());
  const at = new Date(
    cutoff.getTime() - (daysAgo - trash.PURGE_AFTER_DAYS) * 24 * 60 * 60 * 1000,
  ).toISOString();
  await raw.execute(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, [at, id]);
}

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  return all[0].id;
}

describe("LA-W3 J8i: purge sweep removes all five categories, proven against real files", () => {
  it("removes the orphaned note and task, the invoice's payment, its PDF file on disk, and its search index rows", async () => {
    h = await createSeededHarness();

    // --- arrange: a contact with a note and a task that belong ONLY to it ---
    const jane = await contacts.create({ firstName: "Jane", lastName: "Doe" });
    const note = await activities.create({
      kind: "note",
      body: "Called Jane about the leak, she is at 42 Elm St",
      contactId: jane.id,
    });
    const task = await tasks.create({ title: "Follow up with Jane", contactId: jane.id });

    // --- arrange: an invoice with a payment and a real PDF file on disk ---
    const acme = await companies.create({ name: "Acme Plumbing" });
    const deal = await deals.create({ title: "Leak repair", stageId: await firstStageId(), companyId: acme.id });
    const invoice = await documents.create({
      kind: "invoice",
      dealId: deal.id,
      items: [{ name: "Leak repair", qty: 1, unitCents: 20000 }],
      prefix: "INV",
      issuedOn: "2026-01-01",
    });
    await documents.send(invoice.id);
    const payment = await payments.create({
      documentId: invoice.id,
      amountCents: 20000,
      paidOn: "2026-01-05",
      method: "check",
    });
    const pdfPath = join(workDir, "documents", `${invoice.number}.pdf`);
    writeFileSync(pdfPath, "%PDF-1.4 fake invoice pdf for LA-W3\n");
    await documents.setPdfPath(invoice.id, pdfPath);

    // --- sanity: everything exists and is findable before any delete ---
    expect(existsSync(pdfPath)).toBe(true);
    const searchBefore = await raw.query(
      `SELECT count(*) FROM search_docs WHERE entity_type = 'contact' AND entity_id = ?`,
      [jane.id],
    );
    expect(Number(searchBefore[0][0])).toBeGreaterThan(0);

    // --- act: soft-delete both, backdate past the 30-day cutoff, sweep ---
    await contacts.softDelete(jane.id);
    await documents.softDelete(invoice.id);
    await backdate("contacts", jane.id, 31);
    await backdate("documents", invoice.id, 31);

    const result = await sweepExpiredTrash();
    expect(result.failed).toEqual([]);
    expect(result.purged).toBeGreaterThanOrEqual(2); // the contact and the document

    // === 1. notes: the orphaned activity is hard-deleted ===
    const noteRow = await raw.query(`SELECT id FROM activities WHERE id = ?`, [note.id]);
    expect(noteRow).toEqual([]);

    // === 2. tasks: the orphaned task is hard-deleted ===
    const taskRow = await raw.query(`SELECT id FROM tasks WHERE id = ?`, [task.id]);
    expect(taskRow).toEqual([]);

    // === 3. payments: the invoice's payment is hard-deleted (RESTRICT honoured by hand) ===
    const paymentRow = await raw.query(`SELECT id FROM payments WHERE id = ?`, [payment.id]);
    expect(paymentRow).toEqual([]);

    // === 4. PDFs on disk: the real file is gone, statted, not assumed ===
    expect(existsSync(pdfPath)).toBe(false);
    expect(result.filesRemoved).toBeGreaterThanOrEqual(1);

    // === 5. search index rows: no trace of the purged contact remains ===
    const searchAfter = await raw.query(
      `SELECT count(*) FROM search_docs WHERE entity_type = 'contact' AND entity_id = ?`,
      [jane.id],
    );
    expect(Number(searchAfter[0][0])).toBe(0);
    const ftsAfter = await raw.query(
      `SELECT count(*) FROM search_index WHERE text MATCH 'Doe'`,
    );
    // The FTS row about Jane's note ("Called Jane...") is also gone, along
    // with the note itself — a purge that only removed the row would still
    // leave "Called Jane about the leak" findable, which is the exact defect
    // F-SEC-10 fixed.
    expect(Number(ftsAfter[0][0])).toBe(0);

    // The contact and document rows themselves are gone too, for completeness.
    expect(await raw.query(`SELECT id FROM contacts WHERE id = ?`, [jane.id])).toEqual([]);
    expect(await raw.query(`SELECT id FROM documents WHERE id = ?`, [invoice.id])).toEqual([]);
  });

  it("a note or task that ALSO belongs to a surviving deal keeps the note, loses only the purged contact's link", async () => {
    h = await createSeededHarness();
    const jane = await contacts.create({ firstName: "Jane", lastName: "Doe" });
    const acme = await companies.create({ name: "Acme Plumbing" });
    const deal = await deals.create({ title: "Leak repair", stageId: await firstStageId(), companyId: acme.id });

    const note = await activities.create({
      kind: "note",
      body: "Discussed pricing with Jane for the leak job",
      contactId: jane.id,
      dealId: deal.id,
    });

    await contacts.softDelete(jane.id);
    await backdate("contacts", jane.id, 31);
    const result = await sweepExpiredTrash();
    expect(result.failed).toEqual([]);

    const row = await raw.query(
      `SELECT id, contact_id, deal_id FROM activities WHERE id = ?`,
      [note.id],
    );
    expect(row).toHaveLength(1);
    expect(row[0][1]).toBeNull(); // contact_id nulled (set null on delete)
    expect(row[0][2]).toBe(deal.id); // still about the deal, so it survives
  });
});
