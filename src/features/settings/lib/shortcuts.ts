/**
 * The shortcuts sheet's data.
 *
 * Every command in the feature registry, plus the shortcuts the shell itself
 * owns (which are not commands and therefore are not in the registry), grouped
 * for display. Pure: the sheet renders whatever this returns, and the unit test
 * checks the grouping without a DOM.
 */
import type { FeatureCommand } from "@/app/feature";
import { PALETTE_SHORTCUT } from "@/app/CommandPalette";

export type ShortcutRow = {
  id: string;
  label: string;
  /** "mod+k" style, or null for a command with no key of its own. */
  shortcut: string | null;
};

export type ShortcutGroup = {
  name: string;
  rows: ShortcutRow[];
};

/**
 * Bound by the shell, not by any feature, so they can never appear in
 * `allCommands()`. Listing them is the whole point of the sheet: the owner
 * wants one page with every key on it.
 */
export const SHELL_SHORTCUTS: ShortcutRow[] = [
  { id: "shell-search", label: "Search everything", shortcut: "mod+k" },
  // Read from the shell rather than restated: the palette moved to
  // mod+shift+k once search took mod+k, and a sheet that lies about a key is
  // worse than no sheet.
  { id: "shell-palette", label: "Command palette", shortcut: PALETTE_SHORTCUT },
  { id: "shell-shortcuts", label: "This list of shortcuts", shortcut: "?" },
  { id: "shell-escape", label: "Close a dialog, or go back to Today", shortcut: "escape" },
  { id: "shell-enter", label: "Open the selected row", shortcut: "enter" },
];

export const SHELL_GROUP = "The app";
export const OTHER_GROUP = "Other";

/**
 * Group order is fixed so the sheet does not reshuffle when a feature adds a
 * command: named groups in this order first, then any group a feature invents,
 * alphabetically, then the ungrouped ones.
 */
export const GROUP_ORDER = [
  SHELL_GROUP,
  "Records",
  "Today",
  "Pipeline",
  "Data",
  "Leads",
  "AI",
  "Settings",
];

function rank(name: string): number {
  const index = GROUP_ORDER.indexOf(name);
  if (index >= 0) return index;
  return name === OTHER_GROUP ? GROUP_ORDER.length + 1 : GROUP_ORDER.length;
}

/**
 * Commands with a shortcut come first inside a group, then the rest, each half
 * alphabetical - the owner scanning for a key should not have to read past the
 * commands that have none.
 */
function byShortcutThenLabel(a: ShortcutRow, b: ShortcutRow): number {
  const aHas = a.shortcut ? 0 : 1;
  const bHas = b.shortcut ? 0 : 1;
  if (aHas !== bHas) return aHas - bHas;
  return a.label.localeCompare(b.label);
}

export function groupShortcuts(
  commands: FeatureCommand[],
  shell: ShortcutRow[] = SHELL_SHORTCUTS,
): ShortcutGroup[] {
  const groups = new Map<string, ShortcutRow[]>();
  if (shell.length > 0) groups.set(SHELL_GROUP, [...shell]);

  for (const command of commands) {
    const name = command.group?.trim() || OTHER_GROUP;
    const rows = groups.get(name) ?? [];
    rows.push({
      id: command.id,
      label: command.label,
      shortcut: command.shortcut ?? null,
    });
    groups.set(name, rows);
  }

  return [...groups.entries()]
    .map(([name, rows]) => ({
      name,
      rows: name === SHELL_GROUP ? rows : [...rows].sort(byShortcutThenLabel),
    }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/** Every shortcut string in use, so a duplicate is visible in one glance. */
export function duplicateShortcuts(groups: ShortcutGroup[]): string[] {
  const seen = new Map<string, number>();
  for (const group of groups) {
    if (group.name === SHELL_GROUP) continue;
    for (const row of group.rows) {
      if (!row.shortcut) continue;
      seen.set(row.shortcut, (seen.get(row.shortcut) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key);
}
