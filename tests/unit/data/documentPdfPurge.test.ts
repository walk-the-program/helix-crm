/**
 * A purged quote or invoice's own generated PDF (SEC audit, launch round
 * 2026-09-20, finding under acceptance A1).
 *
 * `documents` rows purge like any other trashed record, but the PDF
 * `src/features/invoices/lib/pdfFile.ts` rendered is a separate file the row
 * only points at (`pdf_path`), and nothing removed it - the same shape of gap
 * the attachment-file cleanup in `purgeSweep.ts` already closes for
 * `attachments`. This proves the fix: the file inside this workspace's own
 * `documents/` folder is removed before the row goes, and a PDF the owner
 * chose to save somewhere else through the save dialog is left alone, because
 * that path was never this sweep's to touch.
 *
 * Same harness-and-mock shape as `tests/repo/data/purgeSweep.test.ts`: no
 * Tauri runtime exists under Vitest, so the filesystem and the workspace path
 * lookup are mocked at the module boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeededHarness, type Harness } from "../../repo/harness";
import { raw } from "@/db/client";

const removed: string[] = [];
vi.mock("@/features/data/lib/fsBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/data/lib/fsBridge")>();
  return {
    ...actual,
    removePath: async (path: string) => {
      removed.push(path);
    },
  };
});
vi.mock("@/features/data/lib/workspace", () => ({
  workspacePaths: async () => ({
    workspaceId: "w1",
    dbPath: "/tmp/helix-test/helix.db",
    dir: "/tmp/helix-test",
    attachmentsDir: "/tmp/helix-test/attachments",
    backupsDir: "/tmp/helix-test/backups",
    documentsDir: "/tmp/helix-test/documents",
  }),
}));

const { sweepExpiredTrash } = await import("@/features/data/trash/purgeSweep");

let h: Harness | null = null;

beforeEach(() => {
  removed.length = 0;
});

afterEach(() => {
  h?.dispose();
  h = null;
});

async function insertDocument(
  id: string,
  number: string,
  pdfPath: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await raw.execute(
    `INSERT INTO documents (id, kind, number, pdf_path, created_at, updated_at)
     VALUES (?, 'invoice', ?, ?, ?, ?)`,
    [id, number, pdfPath, now, now],
  );
}

async function backdate(id: string, daysAgo: number): Promise<void> {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  await raw.execute(`UPDATE documents SET deleted_at = ? WHERE id = ?`, [at, id]);
}

async function documentExists(id: string): Promise<boolean> {
  const rows = await raw.query(`SELECT count(*) FROM documents WHERE id = ?`, [id]);
  return Number(rows[0][0]) > 0;
}

describe("purging a document removes its own PDF, when it is ours", () => {
  it("removes the PDF inside this workspace's documents/ folder", async () => {
    h = await createSeededHarness();
    await insertDocument("doc-1", "INV-0001", "/tmp/helix-test/documents/INV-0001.pdf");
    await backdate("doc-1", 45);

    const result = await sweepExpiredTrash();

    expect(result.purged).toBe(1);
    expect(result.filesRemoved).toBe(1);
    expect(removed).toEqual(["/tmp/helix-test/documents/INV-0001.pdf"]);
    expect(await documentExists("doc-1")).toBe(false);
  });

  it("leaves a PDF the owner saved somewhere else untouched", async () => {
    h = await createSeededHarness();
    await insertDocument("doc-2", "INV-0002", "/Users/owner/Desktop/INV-0002.pdf");
    await backdate("doc-2", 45);

    const result = await sweepExpiredTrash();

    expect(result.purged).toBe(1);
    // The row still goes; the file outside the workspace does not, because it
    // is not this sweep's to delete.
    expect(removed).toEqual([]);
    expect(await documentExists("doc-2")).toBe(false);
  });

  it("purges a document with no PDF yet exactly like before", async () => {
    h = await createSeededHarness();
    await insertDocument("doc-3", "INV-0003", null);
    await backdate("doc-3", 45);

    const result = await sweepExpiredTrash();

    expect(result.purged).toBe(1);
    expect(result.filesRemoved).toBe(0);
    expect(removed).toEqual([]);
  });
});
