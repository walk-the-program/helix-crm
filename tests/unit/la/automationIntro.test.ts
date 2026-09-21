/**
 * F-CS-R-7, closed by LR-LA.
 *
 * Two of the three automation rules ship switched on, so the first owner to
 * meet one is an owner who found a task on Today that he is certain he did not
 * write. The timeline line beside it already said who wrote it and why; it did
 * not say where to stop it, which is the only question he actually has at that
 * moment. The CS recheck raised this and left it open; LR-LA-W1 reconfirmed it
 * open at `a8d18c1`.
 *
 * This is a small test for a small string, and it exists because the string is
 * load-bearing in two places at once: the timeline line the rule writes, and
 * the Help section that promises the product explains itself. Those two drifted
 * apart once already this round (F-LA-2), so they are pinned to each other
 * here rather than left to agree by habit.
 */
import { describe, expect, it } from "vitest";
import { FOLLOW_UP_INTRO } from "@/db/repos/automations";
import { HELP_SECTIONS } from "@/features/help/lib/content";

describe("the line an automation writes on a customer's timeline", () => {
  it("names the screen the owner turns the rule off on", () => {
    expect(FOLLOW_UP_INTRO).toContain("Settings");
    expect(FOLLOW_UP_INTRO).toContain("Automations");
  });

  it("still opens by naming Helix, so it reads as the app's doing and not the owner's", () => {
    expect(FOLLOW_UP_INTRO.startsWith("Helix ")).toBe(true);
  });

  it("stays one clause: a timeline is scanned, not read", () => {
    // The line this opens goes on to carry the task title, when it is due and
    // why it fired. An intro that runs to a second sentence pushes all three
    // off the end of a row.
    const sentences = FOLLOW_UP_INTRO.split(/[.?!]\s/).filter((s) => s.trim().length > 0);
    expect(sentences).toHaveLength(1);
  });

  it("sends the owner to the same screen Help sends him to", () => {
    const followUps = HELP_SECTIONS.find((s) => s.id === "follow-ups");
    expect(followUps, "the follow-ups Help section is gone").toBeDefined();
    const text = followUps!.paragraphs.join(" ");
    expect(text).toContain("Settings");
    expect(text).toContain("Automations");
  });
});
