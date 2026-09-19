import { describe, it, expect } from "vitest";
import {
  groupIdFor,
  groupTasks,
  dueLabel,
  dueFromForm,
  timeFromDueAt,
  type GroupableTask,
} from "@/features/records/lib/taskGroups";

const REFERENCE = "2026-06-15";
const NOW = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15 noon local, matches REFERENCE

function task(overrides: Partial<GroupableTask> = {}): GroupableTask {
  return {
    id: "t1",
    dueOn: null,
    dueAt: null,
    doneAt: null,
    ...overrides,
  };
}

describe("groupIdFor / groupTasks - bucket boundaries", () => {
  it("a task due yesterday is overdue", () => {
    expect(groupIdFor(task({ dueOn: "2026-06-14" }), REFERENCE, NOW)).toBe("overdue");
  });

  it("a task due today is Today", () => {
    expect(groupIdFor(task({ dueOn: "2026-06-15" }), REFERENCE, NOW)).toBe("today");
  });

  it("a task due in exactly 7 days is Next 7 days", () => {
    expect(groupIdFor(task({ dueOn: "2026-06-22" }), REFERENCE, NOW)).toBe("next7");
  });

  it("a task due in 8 days is Later", () => {
    expect(groupIdFor(task({ dueOn: "2026-06-23" }), REFERENCE, NOW)).toBe("later");
  });

  it("a task with no due date is Later", () => {
    expect(groupIdFor(task({ dueOn: null }), REFERENCE, NOW)).toBe("later");
  });

  it("a done task is Done regardless of date, past", () => {
    expect(
      groupIdFor(task({ dueOn: "2026-01-01", doneAt: "2026-01-02T00:00:00.000Z" }), REFERENCE, NOW),
    ).toBe("done");
  });

  it("a done task is Done regardless of date, future", () => {
    expect(
      groupIdFor(task({ dueOn: "2026-12-31", doneAt: "2026-06-01T00:00:00.000Z" }), REFERENCE, NOW),
    ).toBe("done");
  });

  it("a done task with no due date at all is still Done", () => {
    expect(groupIdFor(task({ dueOn: null, doneAt: "2026-06-01T00:00:00.000Z" }), REFERENCE, NOW)).toBe(
      "done",
    );
  });

  it("a dueAt earlier today makes it overdue even though dueOn === today", () => {
    const earlierToday = new Date(2026, 5, 15, 6, 0, 0).toISOString();
    expect(
      groupIdFor(task({ dueOn: "2026-06-15", dueAt: earlierToday }), REFERENCE, NOW),
    ).toBe("overdue");
  });

  it("a dueAt later today keeps it in Today, not overdue", () => {
    const laterToday = new Date(2026, 5, 15, 18, 0, 0).toISOString();
    expect(groupIdFor(task({ dueOn: "2026-06-15", dueAt: laterToday }), REFERENCE, NOW)).toBe(
      "today",
    );
  });
});

describe("groupTasks - within-group ordering", () => {
  it("orders timed tasks before all-day tasks on the same date", () => {
    const allDay = task({ id: "all-day", dueOn: "2026-06-16", dueAt: null });
    const timed = task({
      id: "timed",
      dueOn: "2026-06-16",
      dueAt: new Date(2026, 5, 16, 9, 0, 0).toISOString(),
    });

    const groups = groupTasks([allDay, timed], REFERENCE, NOW);
    const next7 = groups.find((g) => g.id === "next7");
    expect(next7?.tasks.map((t) => t.id)).toEqual(["timed", "all-day"]);
  });

  it("orders soonest due date first within an open bucket", () => {
    const later = task({ id: "later-day", dueOn: "2026-06-18" });
    const sooner = task({ id: "sooner-day", dueOn: "2026-06-16" });

    const groups = groupTasks([later, sooner], REFERENCE, NOW);
    const next7 = groups.find((g) => g.id === "next7");
    expect(next7?.tasks.map((t) => t.id)).toEqual(["sooner-day", "later-day"]);
  });

  it("orders Done newest-completed first", () => {
    const older = task({ id: "older", doneAt: "2026-06-10T00:00:00.000Z" });
    const newer = task({ id: "newer", doneAt: "2026-06-12T00:00:00.000Z" });

    const groups = groupTasks([older, newer], REFERENCE, NOW);
    const done = groups.find((g) => g.id === "done");
    expect(done?.tasks.map((t) => t.id)).toEqual(["newer", "older"]);
  });

  it("returns every group in screen order, even when empty", () => {
    const groups = groupTasks([], REFERENCE, NOW);
    expect(groups.map((g) => g.id)).toEqual(["overdue", "today", "next7", "later", "done"]);
  });
});

describe("dueLabel", () => {
  it("labels a task due today as 'Today'", () => {
    expect(dueLabel(task({ dueOn: "2026-06-15" }), REFERENCE, "en-US")).toBe("Today");
  });

  it("labels a task due tomorrow as 'Tomorrow'", () => {
    expect(dueLabel(task({ dueOn: "2026-06-16" }), REFERENCE, "en-US")).toBe("Tomorrow");
  });

  it("labels a far date with a formatted day", () => {
    const label = dueLabel(task({ dueOn: "2026-07-04" }), REFERENCE, "en-US");
    expect(label).toContain("Jul");
    expect(label).toContain("4");
  });

  it("appends the time when dueAt is set", () => {
    const dueAt = new Date(2026, 5, 15, 14, 30, 0).toISOString();
    const label = dueLabel(task({ dueOn: "2026-06-15", dueAt }), REFERENCE, "en-US");
    expect(label.startsWith("Today at ")).toBe(true);
    expect(label).toMatch(/2:30/);
  });

  it("returns 'No due date' when dueOn is null", () => {
    expect(dueLabel(task({ dueOn: null }), REFERENCE, "en-US")).toBe("No due date");
  });
});

describe("dueFromForm / timeFromDueAt round-tripping", () => {
  it("round-trips a date and time", () => {
    const { dueOn, dueAt } = dueFromForm("2026-06-15", "14:30");
    expect(dueOn).toBe("2026-06-15");
    expect(dueAt).not.toBeNull();
    expect(timeFromDueAt(dueAt)).toBe("14:30");
  });

  it("round-trips a date with no time", () => {
    const { dueOn, dueAt } = dueFromForm("2026-06-15", "");
    expect(dueOn).toBe("2026-06-15");
    expect(dueAt).toBeNull();
    expect(timeFromDueAt(dueAt)).toBe("");
  });

  it("clears both when the date is empty, even if a time is given", () => {
    const { dueOn, dueAt } = dueFromForm("", "14:30");
    expect(dueOn).toBeNull();
    expect(dueAt).toBeNull();
  });

  it("clears both when both date and time are empty", () => {
    const { dueOn, dueAt } = dueFromForm("", "");
    expect(dueOn).toBeNull();
    expect(dueAt).toBeNull();
  });

  it("timeFromDueAt returns '' for null", () => {
    expect(timeFromDueAt(null)).toBe("");
  });
});
