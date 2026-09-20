import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
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

  // F-LA-15: snooze used to write dueAt: null unconditionally, silently
  // turning a timed task into an all-day one.
  it("keeps a due_at's wall-clock time when snoozing to tomorrow", async () => {
    h = await createHarness();
    const task = await tasks.create({
      title: "Morning call",
      dueOn: "2024-06-10",
      dueAt: "2024-06-10T09:00:00.000Z",
    });
    const beforeHour = new Date(task.dueAt as string).getHours();
    const beforeMinute = new Date(task.dueAt as string).getMinutes();

    const snoozed = await tasks.snooze(task.id, "tomorrow", { from: "2024-06-10" });
    expect(snoozed.dueOn).toBe("2024-06-11");
    expect(snoozed.dueAt).not.toBeNull();
    const shifted = new Date(snoozed.dueAt as string);
    expect(shifted.getHours()).toBe(beforeHour);
    expect(shifted.getMinutes()).toBe(beforeMinute);
    expect(shifted.getFullYear()).toBe(2024);
    expect(shifted.getMonth()).toBe(5); // June, 0-indexed
    expect(shifted.getDate()).toBe(11);
  });

  it("leaves an all-day task (no due_at) all-day after a snooze", async () => {
    h = await createHarness();
    const task = await tasks.create({ title: "All day", dueOn: "2024-06-10" });
    expect(task.dueAt).toBeNull();

    const snoozed = await tasks.snooze(task.id, "tomorrow", { from: "2024-06-10" });
    expect(snoozed.dueOn).toBe("2024-06-11");
    expect(snoozed.dueAt).toBeNull();
  });

  it("keeps the wall-clock time across 'next week' too, even when overdue", async () => {
    h = await createHarness();
    const task = await tasks.create({
      title: "Overdue call",
      dueOn: "2024-05-01",
      dueAt: "2024-05-01T09:00:00.000Z",
    });
    const beforeHour = new Date(task.dueAt as string).getHours();
    const beforeMinute = new Date(task.dueAt as string).getMinutes();

    const snoozed = await tasks.snooze(task.id, "next-week", { from: "2024-06-10" });
    expect(snoozed.dueOn).toBe("2024-06-17");
    expect(snoozed.dueAt).not.toBeNull();
    const shifted = new Date(snoozed.dueAt as string);
    expect(shifted.getHours()).toBe(beforeHour);
    expect(shifted.getMinutes()).toBe(beforeMinute);
    expect(shifted.getFullYear()).toBe(2024);
    expect(shifted.getMonth()).toBe(5);
    expect(shifted.getDate()).toBe(17);
  });

  it("undo (before/after) restores both due_on and due_at", async () => {
    h = await createHarness();
    const task = await tasks.create({
      title: "Morning call",
      dueOn: "2024-06-10",
      dueAt: "2024-06-10T09:00:00.000Z",
    });
    await tasks.snooze(task.id, "tomorrow", { from: "2024-06-10" });

    const rows = await raw.query(
      `SELECT cl.before_json AS cl_before, cl.after_json AS cl_after FROM change_log cl
       WHERE cl.entity_type = 'task' AND cl.entity_id = ? AND cl.op = 'update'
       ORDER BY cl.at DESC LIMIT 1`,
      [task.id],
    );
    expect(rows.length).toBe(1);
    const before = JSON.parse(String(rows[0][0])) as { dueOn: string | null; dueAt: string | null };
    const after = JSON.parse(String(rows[0][1])) as { dueOn: string | null; dueAt: string | null };
    expect(before.dueOn).toBe("2024-06-10");
    expect(before.dueAt).toBe("2024-06-10T09:00:00.000Z");
    expect(after.dueOn).toBe("2024-06-11");
    expect(after.dueAt).not.toBeNull();
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

// F-LA-8: `today()` used to partition on due_on alone, so a task due today at
// 09:00 read as "Today" here while every other screen (isOverdue, from
// src/lib/dates.ts) called the same task overdue once 09:00 had passed. These
// pass an explicit `now` so the bucket agrees with the rest of the product.
describe("tasks: today buckets follow the documented overdue rule (due_at, not just due_on)", () => {
  it("a task due today at 09:00, viewed at 14:00, is overdue - not today", async () => {
    h = await createHarness();
    const reference = "2024-06-10";
    const task = await tasks.create({
      title: "Morning call",
      dueOn: reference,
      dueAt: `${reference}T09:00:00.000Z`,
    });

    const buckets = await tasks.today(reference, new Date(`${reference}T14:00:00.000Z`));
    expect(buckets.overdue.map((t) => t.id)).toEqual([task.id]);
    expect(buckets.today.map((t) => t.id)).not.toContain(task.id);
    expect(buckets.next7.map((t) => t.id)).not.toContain(task.id);
  });

  it("the same task, viewed at 08:00 before its due_at, is today - not overdue", async () => {
    h = await createHarness();
    const reference = "2024-06-10";
    const task = await tasks.create({
      title: "Morning call",
      dueOn: reference,
      dueAt: `${reference}T09:00:00.000Z`,
    });

    const buckets = await tasks.today(reference, new Date(`${reference}T08:00:00.000Z`));
    expect(buckets.today.map((t) => t.id)).toEqual([task.id]);
    expect(buckets.overdue.map((t) => t.id)).not.toContain(task.id);
  });

  it("a task due today with no due_at is never overdue today, any time of day", async () => {
    h = await createHarness();
    const reference = "2024-06-10";
    const task = await tasks.create({ title: "All day", dueOn: reference });

    const buckets = await tasks.today(reference, new Date(`${reference}T23:30:00.000Z`));
    expect(buckets.today.map((t) => t.id)).toEqual([task.id]);
    expect(buckets.overdue.map((t) => t.id)).not.toContain(task.id);
  });

  it("a task due yesterday is overdue with or without a due_at", async () => {
    h = await createHarness();
    const reference = "2024-06-10";
    const allDay = await tasks.create({ title: "Yesterday, all day", dueOn: "2024-06-09" });
    const timed = await tasks.create({
      title: "Yesterday, timed",
      dueOn: "2024-06-09",
      dueAt: "2024-06-09T09:00:00.000Z",
    });

    const buckets = await tasks.today(reference, new Date(`${reference}T08:00:00.000Z`));
    const overdueIds = buckets.overdue.map((t) => t.id).sort();
    expect(overdueIds).toEqual([allDay.id, timed.id].sort());
  });

  it("a task due in three days lands in next7", async () => {
    h = await createHarness();
    const reference = "2024-06-10";
    const task = await tasks.create({ title: "Later this week", dueOn: "2024-06-13" });

    const buckets = await tasks.today(reference);
    expect(buckets.next7.map((t) => t.id)).toEqual([task.id]);
  });

  it("the three buckets stay disjoint and account for every task the query returns", async () => {
    h = await createHarness();
    const reference = "2024-06-10";
    const overdue = await tasks.create({ title: "Overdue", dueOn: "2024-06-05" });
    const dueTodayLate = await tasks.create({
      title: "Today, already due",
      dueOn: reference,
      dueAt: `${reference}T09:00:00.000Z`,
    });
    const dueTodayNoTime = await tasks.create({ title: "Today, all day", dueOn: reference });
    const dueSoon = await tasks.create({ title: "Soon", dueOn: "2024-06-13" });

    const buckets = await tasks.today(reference, new Date(`${reference}T14:00:00.000Z`));
    const seen = new Map<string, number>();
    for (const bucketRows of [buckets.overdue, buckets.today, buckets.next7]) {
      for (const t of bucketRows) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
    }
    for (const [, count] of seen) expect(count).toBe(1);
    expect(seen.get(overdue.id)).toBe(1);
    expect(buckets.overdue.map((t) => t.id)).toContain(dueTodayLate.id);
    expect(buckets.today.map((t) => t.id)).toContain(dueTodayNoTime.id);
    expect(buckets.next7.map((t) => t.id)).toContain(dueSoon.id);
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
