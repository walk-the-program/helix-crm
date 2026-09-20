/**
 * The shortcuts sheet's data.
 *
 * Every command in the feature registry, plus the few keys the shell itself
 * owns (which are not commands and therefore cannot be in the registry),
 * grouped for display. Pure: the sheet renders whatever this returns, and the
 * unit test checks the grouping without a DOM.
 *
 * Three things the CPO walk found wrong here, and what this file now does
 * about them (F-LC-7, ruling R17). The one page that documents the keys was
 * wrong in three directions at once, which is worse than not having it.
 *
 * 1. **A key was listed twice under two names.** The shell list hard-coded
 *    "Search everything — mod+k" while the Today feature registers a real
 *    `search` command on the same key, and "This list of shortcuts — ?" beside
 *    the real `show-shortcuts` command. `duplicateShortcuts` could not catch
 *    either, because it skips the shell group. The shell list is now filtered
 *    against the commands: where a real binding exists, the command's own row
 *    wins and the hard-coded one is dropped, so a key appears exactly once.
 * 2. **A real, working binding was missing.** `mod+/` opens the search dialog
 *    (`SEARCH_SHORTCUT_ALIAS`, bound outside the command system) and appeared
 *    nowhere. Aliases are declared below and printed beside the command they
 *    belong to.
 * 3. **Twelve of twenty-six rows showed an em dash** for the key — commands
 *    with no shortcut, listed on a keyboard-shortcuts screen, where they read
 *    as broken rather than as "no key". They move to their own group, which
 *    says where to find them instead.
 */
import type { FeatureCommand } from "@/app/feature";
import { PALETTE_SHORTCUT } from "@/app/CommandPalette";
import { SEARCH_SHORTCUT_ALIAS } from "@/features/today/search/overlay";

export type ShortcutRow = {
  id: string;
  label: string;
  /** "mod+k" style, or null for a command with no key of its own. */
  shortcut: string | null;
  /**
   * A second key that does the same thing, bound outside the command system.
   * Printed beside the first, because a sheet that omits a working key is the
   * same defect as one that invents a key that does not work.
   */
  alias?: string;
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
  // Read from the shell rather than restated: the palette moved to
  // mod+shift+k once search took mod+k, and a sheet that lies about a key is
  // worse than no sheet.
  { id: "shell-palette", label: "Command palette", shortcut: PALETTE_SHORTCUT },
  { id: "shell-escape", label: "Close a dialog, or go back to Today", shortcut: "escape" },
  { id: "shell-enter", label: "Open the selected row", shortcut: "enter" },
  // "Search everything" and "This list of shortcuts" used to sit here as well.
  // They are gone because the Today and Settings features register real
  // commands on those exact keys, and two rows for one key is how the sheet
  // came to disagree with itself.
];

/**
 * A second key for a command, bound by the feature rather than by the shell's
 * generic binder, so `FeatureCommand.shortcut` cannot carry it.
 *
 * `mod+/` is a real binding: `src/features/today/search/overlay.tsx` calls
 * `useShortcut(SEARCH_SHORTCUT_ALIAS, show)`. It is imported rather than
 * retyped so the sheet cannot drift from the key the app actually answers to.
 */
export const COMMAND_ALIASES: Record<string, string> = {
  search: SEARCH_SHORTCUT_ALIAS,
};

export const SHELL_GROUP = "The app";
export const OTHER_GROUP = "Other";

/**
 * Where the keyless commands go.
 *
 * Not a key group: its rows have no key, and the name is the answer to the
 * question the owner is asking when he finds them on this page.
 */
export const PALETTE_GROUP = "From the command palette";

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
  // The keyless list goes last of all: it is the "and these have no key"
  // afterword, below every group that does have one.
  if (name === PALETTE_GROUP) return GROUP_ORDER.length + 2;
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

  /* The commands first, because a real binding outranks a hard-coded row. */
  const claimed = new Set<string>();
  const keyless: ShortcutRow[] = [];

  for (const command of commands) {
    const row: ShortcutRow = {
      id: command.id,
      label: command.label,
      shortcut: command.shortcut ?? null,
      alias: COMMAND_ALIASES[command.id],
    };
    if (row.shortcut === null) {
      // No key: it belongs on the "where to find it" list, not in a table of
      // keys with an em dash where the key should be.
      keyless.push(row);
      continue;
    }
    claimed.add(row.shortcut);
    if (row.alias) claimed.add(row.alias);
    const name = command.group?.trim() || OTHER_GROUP;
    const rows = groups.get(name) ?? [];
    rows.push(row);
    groups.set(name, rows);
  }

  /* Then the shell's own keys, minus any a command already documents. */
  const shellRows = shell.filter((row) => row.shortcut === null || !claimed.has(row.shortcut));
  if (shellRows.length > 0) groups.set(SHELL_GROUP, shellRows);

  if (keyless.length > 0) {
    groups.set(PALETTE_GROUP, [...keyless].sort((a, b) => a.label.localeCompare(b.label)));
  }

  return [...groups.entries()]
    .map(([name, rows]) => ({
      name,
      rows:
        name === SHELL_GROUP || name === PALETTE_GROUP ? rows : [...rows].sort(byShortcutThenLabel),
    }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/**
 * Every shortcut string in use more than once.
 *
 * It no longer skips the shell group. Skipping it is exactly how ⌘K came to be
 * listed twice under two different names and nothing noticed: the duplicate
 * was between a shell row and a command, which was the one pair this function
 * refused to look at.
 */
export function duplicateShortcuts(groups: ShortcutGroup[]): string[] {
  const seen = new Map<string, number>();
  for (const group of groups) {
    for (const row of group.rows) {
      for (const key of [row.shortcut, row.alias]) {
        if (!key) continue;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key);
}
