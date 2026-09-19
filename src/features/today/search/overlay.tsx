/**
 * Mounting the search dialog somewhere it can be opened from any screen.
 *
 * A FeatureModule can contribute routes, sidebar items, commands and an
 * `onBoot` hook — it cannot contribute an overlay, because the shell has no
 * slot for one and `src/app/Shell.tsx` belongs to the foundations agent. Search
 * has to work on /pipeline and /contacts, not only on Today, so the feature
 * mounts its own React root into a `<div>` appended to `document.body` from
 * `onBoot` (which the shell already runs once, after the first paint).
 *
 * This is the one genuinely awkward thing in the Today feature, and it is
 * awkward on purpose rather than by accident: the alternative was editing the
 * shell. Wave 3 left it alone — the shell now delegates Cmd/Ctrl+K to the
 * "search" command, which opens this dialog, so there is one search in the
 * product without the shell having to own the dialog. An `overlays?:
 * ReactNode[]` slot on FeatureModule would still be tidier.
 *
 * The root gets its own `QueryClientProvider` around the *same* shared
 * `queryClient`, so the cache, the query keys and `resetQueryCache()` on a
 * workspace switch all still apply. Routing uses wouter's standalone
 * `navigate`, which drives the same History API the shell's `<Router>`
 * subscribes to.
 */

import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/app/queryClient";
import { useShortcut } from "@/app/hooks";
import { SearchDialog } from "@/features/today/search/SearchDialog";

const OVERLAY_ID = "helix-today-overlay";

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
 * The key this overlay binds for itself. Cmd/Ctrl+K already reaches the dialog
 * through the shell, so this is only an alias, kept because it shipped and
 * because it still works on a screen where the shell is not mounted.
 */
export const SEARCH_SHORTCUT_ALIAS = "mod+/";

/** Fired on `window` to open the dialog from a palette command or a button. */
export const OPEN_SEARCH_EVENT = "helix:open-search";

/** Open the search dialog from anywhere, including outside React. */
export function openSearch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}

function SearchOverlay() {
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

let root: Root | null = null;

/**
 * Idempotent: `onBoot` must be safe to run again after a workspace switch, and
 * React 19's StrictMode runs effects twice in development.
 */
export function mountSearchOverlay(): void {
  if (typeof document === "undefined") return;
  if (root) return;

  let host = document.getElementById(OVERLAY_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = OVERLAY_ID;
    document.body.appendChild(host);
  }

  root = createRoot(host);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SearchOverlay />
      </QueryClientProvider>
    </StrictMode>,
  );
}

/** Only used by tests; the app never tears the overlay down. */
export function unmountSearchOverlay(): void {
  root?.unmount();
  root = null;
  document.getElementById(OVERLAY_ID)?.remove();
}
