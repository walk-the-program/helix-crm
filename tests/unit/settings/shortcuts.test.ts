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
  PALETTE_GROUP,
  SHELL_GROUP,
  SHELL_SHORTCUTS,
} from "../../../src/features/settings/lib/shortcuts";
import { allCommands } from "../../../src/app/registry";

function command(
  id: string,
  label: string,
  group?: string,
  shortcut?: string,
  aliases?: string[],
): FeatureCommand {
  return { id, label, group, shortcut, aliases, run: () => undefined };
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
      command("t", "Go to today", "Today", "mod+1"),
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

  it("lists a group's keys alphabetically", () => {
    const groups = groupShortcuts([
      command("n", "New contact", "Records", "mod+n"),
      command("d", "Duplicate", "Records", "mod+d"),
    ]);
    const records = groups.find((g) => g.name === "Records");
    expect(records?.rows.map((r) => r.label)).toEqual(["Duplicate", "New contact"]);
  });

  /*
   * R17. A keyless command used to sit in its feature's group with an em dash
   * where the key should be — twelve of the sheet's twenty-six rows, which
   * read as broken rather than as "this one has no key". It keeps its place on
   * the page, in a list that says where to find it instead.
   */
  it("moves the keyless commands to their own group, alphabetically, last", () => {
    const groups = groupShortcuts([
      command("c", "Zip it", "Records"),
      command("a", "Archive", "Records"),
      command("n", "New contact", "Records", "mod+n"),
    ]);
    const records = groups.find((g) => g.name === "Records");
    expect(records?.rows.map((r) => r.label)).toEqual(["New contact"]);

    const palette = groups.find((g) => g.name === PALETTE_GROUP);
    expect(palette?.rows.map((r) => r.label)).toEqual(["Archive", "Zip it"]);
    expect(groups.at(-1)?.name).toBe(PALETTE_GROUP);
  });

  it("keeps a keyless command rather than dropping it", () => {
    const groups = groupShortcuts([command("t", "Empty the trash", "Records")]);
    const palette = groups.find((g) => g.name === PALETTE_GROUP);
    expect(palette?.rows).toEqual([
      { id: "t", label: "Empty the trash", shortcut: null, alias: undefined },
    ]);
  });

  /*
   * R17's other half: the sheet listed ⌘K twice, as the shell's "Search
   * everything" and as Today's real "Search records" command, and "?" twice
   * the same way. A real binding outranks a hard-coded row.
   */
  it("drops a shell row whose key a real command already documents", () => {
    const groups = groupShortcuts(
      [command("search", "Search records", "Today", "mod+k")],
      [
        { id: "shell-search", label: "Search everything", shortcut: "mod+k" },
        { id: "shell-escape", label: "Close a dialog", shortcut: "escape" },
      ],
    );
    const shell = groups.find((g) => g.name === SHELL_GROUP);
    expect(shell?.rows.map((r) => r.label)).toEqual(["Close a dialog"]);
    expect(groups.find((g) => g.name === "Today")?.rows[0].label).toBe("Search records");
    expect(duplicateShortcuts(groups)).toEqual([]);
  });

  it("prints a command's second key beside its first", () => {
    // mod+/ really opens the search dialog and appeared nowhere on the sheet
    // while it was bound by a listener the shell could not see.
    const groups = groupShortcuts([
      command("search", "Search records", "Today", "mod+k", ["mod+/"]),
    ]);
    const row = groups.find((g) => g.name === "Today")?.rows[0];
    expect(row?.shortcut).toBe("mod+k");
    expect(row?.alias).toBe("mod+/");
  });

  it("really is the search command that carries the alias, not a table here", () => {
    // Read from the registry, so moving or renaming the alias breaks this
    // rather than quietly leaving the sheet printing a key nothing binds.
    const search = allCommands().find((c) => c.id === "search");
    expect(search?.aliases).toContain("mod+/");
  });

  it("counts a duplicate between a shell row and a command, which it used to skip", () => {
    const groups = groupShortcuts(
      [command("x", "Something else", "Records", "escape")],
      [{ id: "shell-escape", label: "Close a dialog", shortcut: "escape" }],
    );
    // The shell row is dropped as the duplicate it is, so nothing is reported
    // — but the mechanism that finds it no longer refuses to look at the shell.
    expect(groups.find((g) => g.name === SHELL_GROUP)).toBeUndefined();
    expect(
      duplicateShortcuts([
        { name: SHELL_GROUP, rows: [{ id: "s", label: "A", shortcut: "mod+k" }] },
        { name: "Today", rows: [{ id: "t", label: "B", shortcut: "mod+k" }] },
      ]),
    ).toEqual(["mod+k"]);
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
