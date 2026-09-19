/**
 * The shortcuts sheet's grouping. Pure data, so no DOM: the sheet only renders
 * what this returns.
 */
import { describe, expect, it } from "vitest";
import type { FeatureCommand } from "../../../src/app/feature";
import {
  duplicateShortcuts,
  groupShortcuts,
  OTHER_GROUP,
  SHELL_GROUP,
  SHELL_SHORTCUTS,
} from "../../../src/features/settings/lib/shortcuts";

function command(
  id: string,
  label: string,
  group?: string,
  shortcut?: string,
): FeatureCommand {
  return { id, label, group, shortcut, run: () => undefined };
}

describe("groupShortcuts", () => {
  it("puts the shell's own keys first, under one heading", () => {
    const groups = groupShortcuts([command("a", "Quick add", "Records", "mod+n")]);
    expect(groups[0].name).toBe(SHELL_GROUP);
    expect(groups[0].rows).toEqual(SHELL_SHORTCUTS);
  });

  it("orders the feature groups the way the sidebar does", () => {
    const groups = groupShortcuts([
      command("s", "Open settings", "Settings", "mod+,"),
      command("r", "Quick add", "Records", "mod+n"),
      command("a", "Paste to record", "AI", "mod+shift+v"),
      command("t", "Go to today", "Today"),
    ]);
    expect(groups.map((g) => g.name)).toEqual([
      SHELL_GROUP,
      "Records",
      "Today",
      "AI",
      "Settings",
    ]);
  });

  it("puts a group nobody declared after the known ones, and 'Other' last", () => {
    const groups = groupShortcuts([
      command("x", "Something", "Zebra", "mod+z"),
      command("y", "Ungrouped thing", undefined, "mod+y"),
      command("s", "Open settings", "Settings", "mod+,"),
    ]);
    expect(groups.map((g) => g.name)).toEqual([
      SHELL_GROUP,
      "Settings",
      "Zebra",
      OTHER_GROUP,
    ]);
  });

  it("lists the commands with a key before the ones without, each alphabetical", () => {
    const groups = groupShortcuts([
      command("c", "Zip it", "Records"),
      command("a", "Archive", "Records"),
      command("n", "New contact", "Records", "mod+n"),
      command("d", "Duplicate", "Records", "mod+d"),
    ]);
    const records = groups.find((g) => g.name === "Records");
    expect(records?.rows.map((r) => r.label)).toEqual([
      "Duplicate",
      "New contact",
      "Archive",
      "Zip it",
    ]);
  });

  it("keeps a command with no shortcut, with a null key rather than dropping it", () => {
    const groups = groupShortcuts([command("t", "Empty the trash", "Records")]);
    const records = groups.find((g) => g.name === "Records");
    expect(records?.rows).toEqual([
      { id: "t", label: "Empty the trash", shortcut: null },
    ]);
  });

  it("renders the shell's keys even when no feature has any commands", () => {
    const groups = groupShortcuts([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.length).toBeGreaterThan(0);
  });

  it("carries the command id through, so the sheet can key its rows", () => {
    const groups = groupShortcuts([command("ai-paste", "Paste", "AI", "mod+shift+v")]);
    const ai = groups.find((g) => g.name === "AI");
    expect(ai?.rows[0].id).toBe("ai-paste");
  });
});

describe("duplicateShortcuts", () => {
  it("finds two features that claimed the same key", () => {
    const groups = groupShortcuts([
      command("a", "One", "Records", "mod+j"),
      command("b", "Two", "Today", "mod+j"),
      command("c", "Three", "AI", "mod+k"),
    ]);
    expect(duplicateShortcuts(groups)).toEqual(["mod+j"]);
  });

  it("says nothing when every key is its own", () => {
    const groups = groupShortcuts([
      command("a", "One", "Records", "mod+n"),
      command("b", "Two", "Today", "mod+t"),
    ]);
    expect(duplicateShortcuts(groups)).toEqual([]);
  });

  it("ignores the shell's own rows, which repeat mod+k on purpose", () => {
    const groups = groupShortcuts([]);
    expect(duplicateShortcuts(groups)).toEqual([]);
  });
});
