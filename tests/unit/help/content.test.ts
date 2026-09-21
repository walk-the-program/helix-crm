import { describe, expect, it } from "vitest";
import { HELP_SECTIONS, HELP_TROUBLE, ISSUES_URL, type HelpSection } from "@/features/help/lib/content";

const BANNED_WORDS = [
  "simply",
  "just ",
  "powerful",
  "seamless",
  "leverage",
  "robust",
  "unleash",
  "world-class",
];

/** Counts sentences the way the spec describes: split on end punctuation, drop empties. */
function sentenceCount(paragraphs: string[]): number {
  return paragraphs
    .join(" ")
    .split(/[.?!]\s|[.?!]$/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

/**
 * The whole Help screen, in the order it renders, with each section's
 * sentence budget.
 *
 * This list used to hold six ids while the screen actually showed ten: the
 * other four were exported separately and spliced in by HelpScreen, each one
 * added that way to get past a "toHaveLength(6)" assertion here. The rules
 * below - banned words, no emoji, a sentence budget - therefore never ran
 * over nearly half the copy on the screen, which is the opposite of what
 * pinning the array was for. Everything the screen shows is now in
 * HELP_SECTIONS and everything in it is checked (LR-CS-RECHECK, F-CS-R-2).
 *
 * `budget` is the maximum number of sentences that section may run to. The
 * default is 6, which is the length a topic section has to fit in to still be
 * scannable. A section above it carries its number here with the reason, so
 * the exception is a decision somebody made on purpose and can be argued
 * with, rather than something that crept in.
 */
const EXPECTED_ORDER: { id: string; title: string; budget?: number }[] = [
  { id: "getting-started", title: "Getting started" },
  // Two long-standing sections that each cover a whole screen's worth of work.
  { id: "customers-in", title: "Getting your customers in", budget: 9 },
  { id: "lead-to-won", title: "Working a job from lead to won", budget: 7 },
  // Quotes, invoices, payments and the statement: four documents' worth of
  // lifecycle, and the only place any of it is written down. Raised from 10
  // to 12 by LR-LA F-LA-2, which found the section still describing the
  // deleted MarkPaidDialog and silent about deposits, part payments, the
  // balance and the statement - the whole of what PX-A built. Three of the
  // four sentences added are the deposit case, which is the ordinary way a
  // trade gets paid and had no answer anywhere in the product's own help.
  { id: "quotes-invoices", title: "Quotes and invoices", budget: 12 },
  // Three rules, what they create, and the pipeline's own follow-up. Two of
  // the rules are ON by default, so this cannot be shortened by leaving one
  // of them unexplained.
  { id: "follow-ups", title: "Letting Helix chase the follow-up", budget: 9 },
  { id: "today", title: "Today and follow-ups", budget: 7 },
  // The week, booking a visit, what a visit actually is, and the .ics.
  { id: "schedule", title: "Your week, and booking a visit", budget: 11 },
  { id: "website-leads", title: "Your website's leads", budget: 7 },
  // A specification for somebody else's developer, not prose for the owner.
  { id: "website-leads-endpoint", title: "Connecting a site Helix didn't build", budget: 12 },
  { id: "backups", title: "Backups and where your data lives", budget: 9 },
  // A procedure with a destructive step in it; every sentence is a precaution.
  { id: "workspace-removal", title: "Removing a workspace for good", budget: 8 },
  { id: "shortcuts", title: "Keyboard shortcuts" },
];

const DEFAULT_BUDGET = 6;

function budgetFor(id: string): number {
  return EXPECTED_ORDER.find((e) => e.id === id)?.budget ?? DEFAULT_BUDGET;
}

function allSections(): HelpSection[] {
  return [...HELP_SECTIONS, HELP_TROUBLE];
}

describe("HELP_SECTIONS", () => {
  it("is the whole screen, in the expected order, with the expected ids and titles", () => {
    expect(HELP_SECTIONS).toHaveLength(EXPECTED_ORDER.length);
    HELP_SECTIONS.forEach((section, i) => {
      expect(section.id).toBe(EXPECTED_ORDER[i].id);
      expect(section.title).toBe(EXPECTED_ORDER[i].title);
    });
  });

  it("exports no section the screen does not render, and renders none it does not export", () => {
    // The failure this catches is the one the old six-item pin invited: a new
    // section added as its own export and spliced into the screen, invisible
    // to every rule in this file.
    const ids = new Set(HELP_SECTIONS.map((s) => s.id));
    expect(ids.size).toBe(HELP_SECTIONS.length);
    expect(ids.has(HELP_TROUBLE.id)).toBe(false);
  });

  it("has a trouble section with id 'trouble' and the expected title", () => {
    expect(HELP_TROUBLE.id).toBe("trouble");
    expect(HELP_TROUBLE.title).toBe("Something's wrong?");
  });

  it.each(allSections().map((s) => [s.id, s] as const))(
    "%s: stays inside its sentence budget and has no empty paragraph",
    (id, section) => {
      for (const paragraph of section.paragraphs) {
        expect(paragraph.trim().length).toBeGreaterThan(0);
      }
      const count = sentenceCount(section.paragraphs);
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count, `${id} runs to ${count} sentences`).toBeLessThanOrEqual(budgetFor(id));
    },
  );

  it("contains no emoji and no non-ASCII character anywhere in the copy", () => {
    const joined = allSections()
      .flatMap((s) => [s.title, ...s.paragraphs])
      .join("\n");
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(joined)).toBe(false);
  });

  it("contains no banned words and no exclamation marks", () => {
    const joined = allSections()
      .flatMap((s) => [s.title, ...s.paragraphs])
      .join("\n")
      .toLowerCase();
    for (const word of BANNED_WORDS) {
      expect(joined.includes(word)).toBe(false);
    }
    expect(joined.includes("!")).toBe(false);
  });

  it("has the expected issues URL, referenced in the trouble section's prose", () => {
    expect(ISSUES_URL).toBe("https://github.com/walk-the-program/helix-crm/issues");
    const troubleText = HELP_TROUBLE.paragraphs.join(" ");
    expect(troubleText.includes(ISSUES_URL)).toBe(true);
  });

  it("mentions Diagnostics in the trouble section", () => {
    const troubleText = HELP_TROUBLE.paragraphs.join(" ");
    expect(troubleText.includes("Diagnostics")).toBe(true);
  });

  it("says the app works offline in the backups section", () => {
    const backups = HELP_SECTIONS.find((s) => s.id === "backups");
    expect(backups).toBeDefined();
    const text = backups!.paragraphs.join(" ").toLowerCase();
    expect(text.includes("internet") || text.includes("offline")).toBe(true);
  });

  /**
   * LR-LA F-LA-2.
   *
   * This section went stale the moment PX-A replaced `MarkPaidDialog` with
   * payments as records, and nothing caught it: the rules above count
   * sentences and ban words, and none of them can tell that the copy is
   * describing a dialog that was deleted. The Help screen then spent the rest
   * of the round telling an owner to "press Mark paid and say when it came in,
   * how, and anything worth a note" - four fields behind a button that is now
   * one silent click - while the deposit, the part payment, the balance and
   * the statement had no answer anywhere in the product's own help.
   *
   * So this pins the copy to the buttons that actually exist. It is a coarse
   * test on purpose: it asserts the words a screen shows, which is the one
   * thing a reader of the copy and a reader of the screen can disagree about.
   */
  it("the quotes and invoices section names the payment controls that exist", () => {
    const section = HELP_SECTIONS.find((s) => s.id === "quotes-invoices");
    expect(section).toBeDefined();
    const text = section!.paragraphs.join(" ");

    // The four things PX-A shipped and the copy has to be able to answer.
    for (const label of ["Record payment", "Partially paid", "Statement", "Mark paid"]) {
      expect(text, `Help never mentions "${label}"`).toContain(label);
    }
    expect(text.toLowerCase(), "Help says nothing about a deposit").toContain("deposit");
    expect(text.toLowerCase(), "Help says nothing about the balance").toContain("balance");

    // And the specific false sentence that was there: Mark paid does not ask
    // for a date, a method or a note - `RecordPaymentDialog` does. If Mark
    // paid ever grows a dialog again this fails, which is the right moment to
    // rewrite the sentence rather than to discover it from a client.
    expect(
      /Mark paid[^.]*\b(say when|how it was paid|method|note)\b/i.test(text),
      "Help describes Mark paid as asking for details; it is one click",
    ).toBe(false);
  });
});
