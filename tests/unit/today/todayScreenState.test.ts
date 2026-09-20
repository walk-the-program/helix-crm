/**
 * Today's three-way branch (F-CS-1), pure and separate from the render.
 *
 * `todayIsUnstarted` (todayIsUnstarted.test.ts) decides whether the real
 * panels have anything to report, and that rule is untouched. This is the
 * second, independent fact — does the workspace hold a contact or a company
 * at all — and the combinator that turns the two into one of three screens.
 *
 * The CPO audit (F-LA-6) found that one contact used to blank Today to six
 * empty panels; F-CS-1 found the other half of the same problem, that an
 * import of fifty-two contacts left the *original* first-run screen up,
 * telling an owner who just did what the product asked to do it again. Both
 * are the same bug — Today lying about what state the workspace is in — so
 * one row and fifty-two rows land on the same "records" screen here.
 */
import { describe, expect, it } from "vitest";
import { todayScreenState } from "../../../src/features/today/lib/useToday";

describe("todayScreenState", () => {
  it("is empty when nothing has started and no record exists", () => {
    expect(todayScreenState({ unstarted: true, hasRecords: false })).toBe("empty");
  });

  it("is records once a contact or company exists, even with nothing due yet", () => {
    expect(todayScreenState({ unstarted: true, hasRecords: true })).toBe("records");
  });

  it("is active once a task, open deal, activity, document or reminder exists", () => {
    expect(todayScreenState({ unstarted: false, hasRecords: false })).toBe("active");
  });

  it("is active even when the workspace also holds records", () => {
    // The real panels win once there is something for them to report,
    // regardless of how many contacts or companies sit alongside it.
    expect(todayScreenState({ unstarted: false, hasRecords: true })).toBe("active");
  });
});
