/**
 * The first-run gate: which workspaces still get the three starter cards
 * instead of Today's panels.
 *
 * This predicate decides whether an owner sees "Nothing here yet" or the real
 * screen, and it has been wrong in both directions. It used to be
 * "does this workspace hold any row at all", so saving one contact swapped the
 * starter cards for six empty panels (CPO audit, F-LA-6). Its replacement
 * counted tasks, open deals and activities only, which hid the Unpaid invoices
 * section from an owner whose one outstanding item was an overdue invoice — he
 * was owed money and Today told him there was nothing here.
 *
 * So the rule under test is: every Today section is represented, and ANY one
 * of them having something means the workspace has started. A test per section
 * is the point, not redundancy — adding a section to Today without adding its
 * count here is exactly the bug that keeps happening.
 */
import { describe, expect, it } from "vitest";
import {
  todayIsUnstarted,
  type TodayActivityCounts,
} from "../../../src/features/today/lib/useToday";

const NOTHING: TodayActivityCounts = {
  tasks: 0,
  openDeals: 0,
  activities: 0,
  documents: 0,
  reminders: 0,
};

describe("todayIsUnstarted", () => {
  it("is true only when every section is empty", () => {
    expect(todayIsUnstarted(NOTHING)).toBe(true);
  });

  it.each([
    ["a task", "tasks"],
    ["an open deal", "openDeals"],
    ["a logged activity", "activities"],
    ["a quote or invoice", "documents"],
    ["a recurring reminder", "reminders"],
  ] as const)("is false once there is %s", (_label, key) => {
    expect(todayIsUnstarted({ ...NOTHING, [key]: 1 })).toBe(false);
  });

  it("stays true for a workspace of contacts and nothing else", () => {
    // Contacts are deliberately NOT a term: a list of people with no work
    // against them puts nothing on Today, and that owner still needs the
    // starter cards telling him what to do next.
    expect(todayIsUnstarted(NOTHING)).toBe(true);
  });

  it("is false for the overdue-invoice-only workspace that regressed", () => {
    expect(todayIsUnstarted({ ...NOTHING, documents: 1 })).toBe(false);
  });

  it("does not care how much of each there is", () => {
    expect(
      todayIsUnstarted({
        tasks: 12,
        openDeals: 4,
        activities: 200,
        documents: 9,
        reminders: 3,
      }),
    ).toBe(false);
  });
});
