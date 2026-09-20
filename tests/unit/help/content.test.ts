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

const EXPECTED_ORDER: { id: string; title: string }[] = [
  { id: "customers-in", title: "Getting your customers in" },
  { id: "lead-to-won", title: "Working a job from lead to won" },
  { id: "today", title: "Today and follow-ups" },
  { id: "website-leads", title: "Your website's leads" },
  { id: "backups", title: "Backups and where your data lives" },
  { id: "shortcuts", title: "Keyboard shortcuts" },
];

function allSections(): HelpSection[] {
  return [...HELP_SECTIONS, HELP_TROUBLE];
}

describe("HELP_SECTIONS", () => {
  it("has exactly six sections, in the expected order, with the expected ids and titles", () => {
    expect(HELP_SECTIONS).toHaveLength(6);
    HELP_SECTIONS.forEach((section, i) => {
      expect(section.id).toBe(EXPECTED_ORDER[i].id);
      expect(section.title).toBe(EXPECTED_ORDER[i].title);
    });
  });

  it("has a trouble section with id 'trouble' and the expected title", () => {
    expect(HELP_TROUBLE.id).toBe("trouble");
    expect(HELP_TROUBLE.title).toBe("Something's wrong?");
  });

  it.each(allSections().map((s) => [s.id, s] as const))(
    "%s: has 3 to 6 sentences and every paragraph is non-empty",
    (_id, section) => {
      for (const paragraph of section.paragraphs) {
        expect(paragraph.trim().length).toBeGreaterThan(0);
      }
      const count = sentenceCount(section.paragraphs);
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(6);
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
});
