/**
 * A rule that creates a task while an import holds the write lock must QUEUE,
 * never join (LR-OPS-RECHECK, F-OPS-R-3; the fix is F-OPS-12).
 *
 * `withTransaction` used to carry a shortcut: if a transaction was already
 * open, run inside it. `txDepth` is a module-level counter, so that shortcut
 * could not tell a genuinely nested call from an unrelated writer that turned
 * up while an import held the lock. The unrelated writer skipped the lock,
 * wrote into the import's transaction, and lost its work when the import
 * rolled back, with nothing shown to the owner.
 *
 * Product expansion made that hypothetical concrete. Automations create
 * ordinary tasks, and the sweep that creates them opens its own transaction -
 * so "an automation fires while a 100k-row import is running" is now a real
 * sequence rather than a thought experiment. This file holds the two halves of
 * the property at the level the owner would feel it:
 *
 *   1. the second writer does not start until the first is finished;
 *   2. its rows survive the first one rolling back.
 *
 * (2) is the sharp one. Before the fix it failed: the task disappeared with
 * the import's rollback.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import { __resetWriteLockForTests, withTransaction } from "../../../src/db/writeLock";
import * as tasks from "../../../src/db/repos/tasks";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
  __resetWriteLockForTests();
});

async function taskTitles(): Promise<string[]> {
  const rows = await raw.query(
    `SELECT title FROM tasks WHERE deleted_at IS NULL ORDER BY title`,
    [],
  );
  return rows.map((r) => String(r[0]));
}

describe("a task created while an import holds the write lock", () => {
  it("waits for the import, and survives the import rolling back", async () => {
    h = await createSeededHarness();
    const order: string[] = [];

    // The import: a transaction that writes, then fails. `release` lets the
    // test hold it open while the second writer tries to get in.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const importRun = withTransaction(async () => {
      order.push("import-start");
      await raw.execute(`INSERT INTO sources (id, name) VALUES (?, ?)`, [
        "import-source",
        "From the import",
      ]);
      await held;
      order.push("import-throw");
      throw new Error("the CSV had a bad row on line 40,000");
    }, "Importing a CSV").catch((err: unknown) => err);

    // Let the import actually take the lock before the rule turns up.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["import-start"]);

    const automation = (async () => {
      const created = await tasks.create({
        title: "Call Dale about their request",
        source: "automation",
      });
      order.push("automation-done");
      return created;
    })();

    // Three turns of the microtask queue is more than enough for an
    // unqueued writer to have got in and written.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order, "the rule has not written yet").toEqual(["import-start"]);

    release();
    const importError = await importRun;
    expect(importError).toBeInstanceOf(Error);
    await automation;

    expect(order).toEqual(["import-start", "import-throw", "automation-done"]);

    // The import rolled back: its row is gone.
    const sources = await raw.query(`SELECT count(*) FROM sources WHERE id = ?`, [
      "import-source",
    ]);
    expect(Number(sources[0][0]), "the failed import left nothing behind").toBe(0);

    // And the automation's task is still there. If the rule had joined the
    // import's transaction instead of queueing behind it, this is the
    // assertion that would fail, silently, in production.
    expect(await taskTitles()).toEqual(["Call Dale about their request"]);
  });

  /**
   * What a genuinely nested call does now is NOT asserted here, deliberately.
   * `withTransaction`'s own comment says such a caller "fails loudly at
   * raw.begin() (TX_STATE from the pipe)". It does not: the inner call never
   * reaches `raw.begin()`, because `acquire()` on a lock that is not reentrant
   * never resolves. It deadlocks, and the only thing that says so is the
   * ten-second "has waited 10s behind another write" warning in the console.
   *
   * That is arguably the right trade - no caller nests, the repository rule
   * forbids it, and a deadlock behind a visible "queued" state is at least not
   * silent corruption - but it is not what the comment claims, and pinning a
   * deadlock costs ten seconds of suite time to prove. Recorded as F-OPS-R-4
   * in `docs/rounds/launch-returns/ops.md` instead; `src/db/writeLock.ts` is
   * not this pass's to edit.
   */
});
