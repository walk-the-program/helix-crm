import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import * as tasks from "../../src/db/repos/tasks";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("tasks: create", () => {
  it("derives due_on from due_at alone", async () => {
    h = await createHarness();
    const task = await tasks.create({
      title: "Call back",
      dueAt: "2024-03-15T18:30:00.000Z",
    });
    expect(task.dueAt).toBe("2024-03-15T18:30:00.000Z");
    expect(task.dueOn).not.toBeNull();
    // toLocalDateString derives from the local calendar day of that instant.
    const expectedDueOn = new Date("2024-03-15T18:30:00.000Z");
    const y = expectedDueOn.getFullYear();
    const m = String(expectedDueOn.getMonth() + 1).padStart(2, "0");
    const d = String(expectedDueOn.getDate()).padStart(2, "0");
    expect(task.dueOn).toBe(`${y}-${m}-${d}`);
  });

  it("keeps due_on and due_at null with neither given", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "No due date" });
    expect(task.dueOn).toBeNull();
    expect(task.dueAt).toBeNull();
  });
});

describe("tasks: complete / uncomplete", () => {
  it("sets and clears done_at", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "Finish this" });
    expect(task.doneAt).toBeNull();

    const completed = await tasks.complete(task.id, { at: "2024-05-01T00:00:00.000Z" });
    expect(completed.doneAt).toBe("2024-05-01T00:00:00.000Z");

    const uncompleted = await tasks.uncomplete(task.id);
    expect(uncompleted.doneAt).toBeNull();
  });
});

describe("tasks: snooze", () => {
  it("snooze('tomorrow') counts from today, not from the old due date", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "Overdue task", dueOn: "2020-01-01" });

    const snoozed = await tasks.snooze(task.id, "tomorrow", { from: "2024-06-10" });
    expect(snoozed.dueOn).toBe("2024-06-11");
    expect(snoozed.dueAt).toBeNull();
  });

  it("snooze('next-week') counts from today", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "Old task", dueOn: "2019-01-01" });

    const snoozed = await tasks.snooze(task.id, "next-week", { from: "2024-06-10" });
    expect(snoozed.dueOn).toBe("2024-06-17");
  });
});

describe("tasks: today buckets", () => {
  it("splits overdue / today / next 7 days by due_on", async () => {
    h = await createHarness();
    const reference = "2024-06-10";
    const overdue = await tasks.create({ title: "Overdue", dueOn: "2024-06-05" });
    const dueToday = await tasks.create({ title: "Today", dueOn: reference });
    const dueSoon = await tasks.create({ title: "Soon", dueOn: "2024-06-14" });
    const dueLater = await tasks.create({ title: "Later", dueOn: "2024-06-25" });
    const noDueDate = await tasks.create({ title: "No due date" });

    const buckets = await tasks.today(reference);
    expect(buckets.overdue.map((t) => t.id)).toEqual([overdue.id]);
    expect(buckets.today.map((t) => t.id)).toEqual([dueToday.id]);
    expect(buckets.next7.map((t) => t.id)).toEqual([dueSoon.id]);
    expect(buckets.overdue.map((t) => t.id)).not.toContain(noDueDate.id);
    expect(buckets.today.map((t) => t.id)).not.toContain(dueLater.id);
    expect(buckets.next7.map((t) => t.id)).not.toContain(dueLater.id);
  });

  it("excludes done tasks", async () => {
    h = await createHarness();
    const reference = "2024-06-10";
    const done = await tasks.create({ title: "Done already", dueOn: "2024-06-05" });
    await tasks.complete(done.id);

    const buckets = await tasks.today(reference);
    expect(buckets.overdue.map((t) => t.id)).not.toContain(done.id);
  });
});

describe("tasks: soft delete / restore / purge", () => {
  it("round trips", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "Removable" });
    await tasks.softDelete(task.id);
    expect((await tasks.get(task.id))?.deletedAt).not.toBeNull();

    await tasks.restore(task.id);
    expect((await tasks.get(task.id))?.deletedAt).toBeNull();

    await tasks.purge(task.id);
    expect(await tasks.get(task.id)).toBeNull();
  });
});
