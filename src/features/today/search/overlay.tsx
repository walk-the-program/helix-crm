/**
 * The search dialog, mounted so it can be opened from any screen.
 *
 * This used to be a second React root on a `<div>` appended to `document.body`,
 * started from the feature's `onBoot`, because a FeatureModule had no way to
 * contribute an overlay and `src/app/Shell.tsx` belonged to another agent. Both
 * of those are fixed: `FeatureModule.overlays` renders `SearchOverlay` inside
 * the shell's own providers on every screen, so there is one React tree, one
 * QueryClientProvider and nothing to keep idempotent.
 *
 * Search is opened three ways and they all land here: the shell binds
 * Cmd/Ctrl+K and runs the registered "search" command, the Today header's
 * button calls `openSearch()`, and the palette lists the same command. The
 * event is how a caller with no React context reaches this component.
 */

import { useCallback, useEffect, useState } from "react";
import { useShortcut } from "@/app/hooks";
import { SearchDialog } from "@/features/today/search/SearchDialog";

/**
 * The shortcut the dialog answers to.
 *
 * Since wave 3 there is one search key: the shell binds Cmd/Ctrl+K and runs
 * the registered "search" command, which is this dialog, and the command
 * palette moved to Cmd/Ctrl+Shift+K. This constant is the label the palette
 * and the Today header print next to "Search records".
 */
export const SEARCH_SHORTCUT = "mod+k";

/**
 * A second key that also opens search, and the one binding a feature still owns.
 *
 * Cmd/Ctrl+K reaches the dialog through the shell, so this is only an alias. It
 * is not a `FeatureCommand.shortcut` — the palette prints one key per command
 * and mod+k is the one worth printing — so the shell does not bind it and this
 * component does. It is a keybinding inside the shell's tree, not a second
 * React root: that is the difference from what this file used to be.
 */
export const SEARCH_SHORTCUT_ALIAS = "mod+/";

/** Fired on `window` to open the dialog from a palette command or a button. */
export const OPEN_SEARCH_EVENT = "helix:open-search";

/** Open the search dialog from anywhere, including outside React. */
export function openSearch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}

/** Rendered once per app by the shell, through the feature's `overlays` slot. */
export function SearchOverlay() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);

  useShortcut(SEARCH_SHORTCUT_ALIAS, show);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_SEARCH_EVENT, handler);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, handler);
  }, []);

  return <SearchDialog open={open} onOpenChange={setOpen} />;
}
