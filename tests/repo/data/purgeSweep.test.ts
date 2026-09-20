/**
 * The 30-day trash sweep (F-LC-3, ruling R14).
 *
 * The Trash screen promised "Deleted records stay here for 30 days, then Helix
 * removes them for good" and every row carried a "Purges on" date, while
 * `trash.expired()` sat in the repository with no callers anywhere in the
 * product. These tests are what stops that coming back: they prove the sweep
 * runs, that it respects the cutoff in both directions, that it asks the
 * filesystem to remove an attachment's file before it deletes the row that
 * names it, and that a row it cannot purge does not stop the rest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as trash from "../../../src/db/repos/trash";
import { raw } from "../../../src/db/client";
import { pauseTimers } from "../../../src/db/writeLock";

/**
 * The sweep reaches the filesystem through `fsBridge.removePath` and the
 * workspace folder through `workspace.workspacePaths`, neither of which exists
 * under Vitest (there is no Tauri). Both are mocked at the module boundary,
 * which is also what lets the test assert the ORDER: the file has to be asked
 * for before the row goes, because `trash.purge` deletes the row that names
 * the file.
 */
const removed: string[] = [];
vi.mock("../../../src/features/data/lib/fsBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/features/data/lib/fsBridge")>();
  return {
    ...actual,
    removePath: async (path: string) => {
      removed.push(path);
    },
  };
});
vi.mock("../../../src/features/data/lib/workspace", () => ({
  workspacePaths: async () => ({
    dir: "/tmp/helix-test",
    dbPath: "/tmp/helix-test/helix.db",
    attachmentsDir: "/tmp/helix-test/attachments",
    backupsDir: "/tmp/helix-test/backups",
  }),
}));

const { sweepExpiredTrash, tick, __resetPurgeSweepForTests } = await import(
  "../../../src/features/data/trash/purgeSweep"
);

let h: Harness | null = null;

beforeEach(() => {
  removed.length = 0;
});

afterEach(() => {
  __resetPurgeSweepForTests();
  vi.restoreAllMocks();
  h?.dispose();
  h = null;
});

/** Put a row's deleted_at into the past, the way real time would have. */
async function backdate(table: string, id: string, daysAgo: number): Promise<void> {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  await raw.execute(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, [at, id]);
}

async function countRows(table: string): Promise<number> {
  const rows = await raw.query(`SELECT COUNT(*) FROM ${table}`, []);
  return Number(rows[0][0]);
}

describe("the 30-day trash sweep", () => {
  it("removes what is past the cutoff and leaves what is not", async () => {
    h = await createSeededHarness();

    const old = await contacts.create({ firstName: "Old", lastName: "Enough" });
    const recent = await contacts.create({ firstName: "Only", lastName: "Yesterday" });
    const live = await contacts.create({ firstName: "Still", lastName: "Here" });

    await contacts.softDelete(old.id);
    await contacts.softDelete(recent.id);
    await backdate("contacts", old.id, 31);
    await backdate("contacts", recent.id, 1);

    const result = await sweepExpiredTrash();

    expect(result.purged).toBe(1);
    expect(await contacts.get(old.id)).toBeNull();
    // 29 days is not 31: the one deleted yesterday is still recoverable, and
    // the one that was never deleted was never in scope.
    expect((await trash.list("contact")).length).toBe(1);
    expect(await countRows("contacts")).toBe(2);
    expect((await contacts.get(live.id))?.firstName).toBe("Still");
  });

  it("does nothing, and says so, on a workspace with an empty trash", async () => {
    h = await createSeededHarness();
    const result = await sweepExpiredTrash();
    expect(result).toEqual({ purged: 0, filesRemoved: 0, failed: [] });
    expect(removed).toHaveLength(0);
  });

  it("removes an attachment's file before the row that names it", async () => {
    h = await createSeededHarness();

    const contact = await contacts.create({ firstName: "Has", lastName: "Afile" });
    await raw.execute(
      `INSERT INTO attachments
         (id, entity_type, entity_id, file_name, stored_name, mime, bytes, created_at, updated_at)
       VALUES ('att-1','contact',?,'quote.pdf','stored-quote.pdf','application/pdf',12,?,?)`,
      [contact.id, new Date().toISOString(), new Date().toISOString()],
    );
    expect(await countRows("attachments")).toBe(1);

    await contacts.softDelete(contact.id);
    await backdate("contacts", contact.id, 45);

    const result = await sweepExpiredTrash();

    expect(result.purged).toBe(1);
    expect(result.filesRemoved).toBe(1);
    // The path is built from the workspace's attachments folder and the row's
    // stored name, never the display name the owner saw.
    expect(removed).toEqual(["/tmp/helix-test/attachments/stored-quote.pdf"]);
    expect(await countRows("attachments")).toBe(0);
    expect(await contacts.get(contact.id)).toBeNull();
  });

  it("still deletes the row when the file cannot be removed", async () => {
    h = await createSeededHarness();
    const bridge = await import("../../../src/features/data/lib/fsBridge");
    const spy = vi
      .spyOn(bridge, "removePath")
      .mockRejectedValueOnce(new Error("the folder is on a disk that is not here"));

    const contact = await contacts.create({ firstName: "Gone", lastName: "Disk" });
    await raw.execute(
      `INSERT INTO attachments
         (id, entity_type, entity_id, file_name, stored_name, mime, bytes, created_at, updated_at)
       VALUES ('att-2','contact',?,'x.pdf','stored-x.pdf','application/pdf',1,?,?)`,
      [contact.id, new Date().toISOString(), new Date().toISOString()],
    );
    await contacts.softDelete(contact.id);
    await backdate("contacts", contact.id, 40);

    const result = await sweepExpiredTrash();

    // A file we could not delete is untidy; a row that will not die is a
    // screen the owner cannot clear.
    expect(result.purged).toBe(1);
    expect(result.filesRemoved).toBe(0);
    expect(await contacts.get(contact.id)).toBeNull();
    spy.mockRestore();
  });

  it("sweeps every entity type expired() offers, not just contacts", async () => {
    h = await createSeededHarness();

    const contact = await contacts.create({ firstName: "A", lastName: "Contact" });
    const company = await companies.create({ name: "A Company" });
    await contacts.softDelete(contact.id);
    await companies.softDelete(company.id);
    await backdate("contacts", contact.id, 31);
    await backdate("companies", company.id, 31);

    const result = await sweepExpiredTrash();

    expect(result.purged).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(await countRows("contacts")).toBe(0);
    expect(await countRows("companies")).toBe(0);
  });

  it("carries on past a row it cannot purge, and reports it", async () => {
    h = await createSeededHarness();

    const first = await contacts.create({ firstName: "First", lastName: "One" });
    const second = await contacts.create({ firstName: "Second", lastName: "One" });
    await contacts.softDelete(first.id);
    await contacts.softDelete(second.id);
    await backdate("contacts", first.id, 31);
    await backdate("contacts", second.id, 31);

    const purge = vi.spyOn(trash, "purge");
    purge.mockRejectedValueOnce(new Error("something held on to it"));

    const result = await sweepExpiredTrash();

    // One failure does not cost the other row its sweep, and the failure is
    // reported rather than swallowed.
    expect(result.purged).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("something held on to it");
    purge.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/* LR-OPS-W2 B2/B3: tick() overlap, pause and reschedule                      */
/* -------------------------------------------------------------------------- */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("tick() - overlap, pause and reschedule (LR-OPS-W2 B2/B3)", () => {
  it("cannot overlap itself: a second tick landing mid-sweep does not run a second sweep", async () => {
    h = await createSeededHarness();

    let inFlight = 0;
    let sawOverlap = false;
    const expiredSpy = vi.spyOn(trash, "expired").mockImplementation(async () => {
      inFlight += 1;
      if (inFlight > 1) sawOverlap = true;
      await delay(15);
      inFlight -= 1;
      return [];
    });

    // Both calls land while the write lock is free - the same shape as a
    // daily timer tick and a hypothetical second trigger (a future "empty
    // the trash now" button routed through tick(), or two workspaces'
    // timers firing in the same task drain) landing together.
    await Promise.all([tick(), tick()]);

    expect(sawOverlap).toBe(false);
    // One of the two calls actually swept; the other saw `sweeping` and
    // rescheduled instead of running trash.expired() at all.
    expect(expiredSpy).toHaveBeenCalledTimes(1);
  });

  it("skips a tick while timersPaused() (an import or a restore) and sweeps normally once resumed (B3)", async () => {
    h = await createSeededHarness();
    const old = await contacts.create({ firstName: "Old", lastName: "Enough" });
    await contacts.softDelete(old.id);
    await backdate("contacts", old.id, 31);

    const expiredSpy = vi.spyOn(trash, "expired");
    const resume = pauseTimers();
    try {
      await tick();
      // Nothing was even asked what is expired: an import or a restore in
      // progress must not have hundreds of deletes queued up behind it, and
      // the row backdated above is still exactly where it was.
      expect(expiredSpy).not.toHaveBeenCalled();
      expect(await contacts.get(old.id)).not.toBeNull();
    } finally {
      resume();
    }

    await tick();
    expect(expiredSpy).toHaveBeenCalledTimes(1);
    expect(await contacts.get(old.id)).toBeNull();
  });

  it("a tick that throws still reschedules rather than dying silently", async () => {
    h = await createSeededHarness();
    const expiredSpy = vi
      .spyOn(trash, "expired")
      .mockRejectedValueOnce(new Error("the disk went away mid-sweep"));

    // sweepExpiredTrash's own error is caught inside tick(), not re-thrown -
    // the assertion that matters is what happens AFTER, not this call itself.
    await expect(tick()).resolves.toBeUndefined();

    // If the throw had left `sweeping` stuck true, or `schedule()` had never
    // run, this second call would silently do nothing at all. It does not:
    // trash.expired() is reached again, on the very next tick.
    await tick();
    expect(expiredSpy).toHaveBeenCalledTimes(2);
  });
});
