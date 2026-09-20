/**
 * 0007_visits: the three columns a visit needs, and the promise that nothing
 * written before them changes.
 *
 * Cross-lead contract 1 (docs/rounds/launch-returns/px-common.md): Lead C's
 * automations create ordinary tasks and tell them apart by `source`, so the
 * column has to exist, default to "user" for every row that predates it, and
 * cost the existing `tasks.create({ title })` caller nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, diskMigrationSource, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import { migrate, orderMigrations } from "../../../src/db/migrator";
import * as tasks from "../../../src/db/repos/tasks";
import { ValidationError } from "../../../src/db/errors";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("tasks: the visit columns", () => {
  it("defaults source to user and leaves place and duration empty", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "Ring the supplier" });
    expect(task.source).toBe("user");
    expect(task.place).toBeNull();
    expect(task.durationMinutes).toBeNull();
  });

  it("stores a visit: an automation flag, a place and a duration", async () => {
    h = await createHarness();
    const task = await tasks.create({
      title: "Site visit",
      dueAt: "2026-09-24T09:00:00.000Z",
      place: "12 Mill Lane, Bristol",
      durationMinutes: 90,
      source: "automation",
    });
    expect(task.source).toBe("automation");
    expect(task.place).toBe("12 Mill Lane, Bristol");
    expect(task.durationMinutes).toBe(90);

    const read = await tasks.getOrThrow(task.id);
    expect(read.place).toBe("12 Mill Lane, Bristol");
    expect(read.durationMinutes).toBe(90);
  });

  it("treats a whitespace-only place as no place", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "Visit", place: "   " });
    expect(task.place).toBeNull();
  });

  it("updates and clears the new fields", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "Visit", place: "Yard" });
    const withTime = await tasks.update(task.id, {
      place: "9 Bridge Street",
      durationMinutes: 60,
    });
    expect(withTime.place).toBe("9 Bridge Street");
    expect(withTime.durationMinutes).toBe(60);

    const cleared = await tasks.update(task.id, {
      place: null,
      durationMinutes: null,
    });
    expect(cleared.place).toBeNull();
    expect(cleared.durationMinutes).toBeNull();
    // Untouched fields stay untouched.
    expect(cleared.title).toBe("Visit");
    expect(cleared.source).toBe("user");
  });

  it("refuses a duration that is not a sane number of minutes", async () => {
    h = await createHarness();
    await expect(
      tasks.create({ title: "Visit", durationMinutes: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      tasks.create({ title: "Visit", durationMinutes: -30 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      tasks.create({ title: "Visit", durationMinutes: 45.5 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      tasks.create({ title: "Visit", durationMinutes: 24 * 60 + 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("filters by source and by whether there is a time", async () => {
    h = await createHarness();
    await tasks.create({ title: "Typed by the owner", dueOn: "2026-09-24" });
    await tasks.create({
      title: "Written by a rule",
      dueOn: "2026-09-24",
      source: "automation",
    });
    await tasks.create({
      title: "A visit at ten",
      dueAt: "2026-09-24T09:00:00.000Z",
    });

    const automation = await tasks.list({ source: "automation" });
    expect(automation.rows.map((t) => t.title)).toEqual(["Written by a rule"]);
    const byUser = await tasks.list({ source: "user" });
    expect(byUser.total).toBe(2);
    const timed = await tasks.list({ timedOnly: true });
    expect(timed.rows.map((t) => t.title)).toEqual(["A visit at ten"]);
  });
});

describe("0007_visits on a populated workspace", () => {
  it("backfills every existing task with source 'user'", async () => {
    // Migrate to 0005 only, write tasks the way a shipped build would have,
    // then let 0007 land on top of them.
    const all = orderMigrations(await diskMigrationSource.list());
    const before0007 = all.filter((f) => f.tag !== "0007_visits");
    h = await createHarnessAt(before0007);

    const columnsBefore = await columnNames();
    expect(columnsBefore).not.toContain("source");

    await raw.execute(
      `INSERT INTO tasks (id, title, due_on, due_at, done_at, contact_id, company_id,
                          deal_id, created_at, updated_at, deleted_at)
       VALUES ('t-old-1', 'Chase the Hall Lane quote', '2026-09-01', NULL, NULL, NULL,
               NULL, NULL, '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z', NULL)`,
      [],
    );
    await raw.execute(
      `INSERT INTO tasks (id, title, due_on, due_at, done_at, contact_id, company_id,
                          deal_id, created_at, updated_at, deleted_at)
       VALUES ('t-old-2', 'Old done task', '2026-08-01', NULL, '2026-08-02T08:00:00.000Z',
               NULL, NULL, NULL, '2026-08-01T08:00:00.000Z', '2026-08-02T08:00:00.000Z', NULL)`,
      [],
    );

    const result = await migrate({ source: diskMigrationSource, backup: false });
    expect(result.applied).toEqual(["0007_visits"]);

    const columnsAfter = await columnNames();
    expect(columnsAfter).toEqual(
      expect.arrayContaining(["source", "place", "duration_minutes"]),
    );

    const old = await tasks.getOrThrow("t-old-1");
    expect(old.source).toBe("user");
    expect(old.place).toBeNull();
    expect(old.durationMinutes).toBeNull();
    expect(old.title).toBe("Chase the Hall Lane quote");

    const done = await tasks.getOrThrow("t-old-2");
    expect(done.source).toBe("user");
    expect(done.doneAt).toBe("2026-08-02T08:00:00.000Z");

    // And a brand new row on the migrated database behaves the same way.
    const fresh = await tasks.create({ title: "After the upgrade" });
    expect(fresh.source).toBe("user");
  });
});

async function columnNames(): Promise<string[]> {
  const rows = await raw.query("PRAGMA table_info(tasks)", []);
  return rows.map((r) => String(r[1]));
}

/** A harness whose migrations stop at a given subset. */
async function createHarnessAt(
  files: { idx: number; tag: string; sql: string }[],
): Promise<Harness> {
  const { createTestDriver } = await import("../driver");
  const { setDriver } = await import("../../../src/db/client");
  const { __resetWriteLockForTests } = await import("../../../src/db/writeLock");
  __resetWriteLockForTests();
  const driver = createTestDriver(":memory:");
  setDriver(driver);
  await migrate({ source: { async list() { return files; } }, backup: false });
  return {
    driver,
    dispose: () => {
      __resetWriteLockForTests();
      driver.dispose();
    },
  };
}
