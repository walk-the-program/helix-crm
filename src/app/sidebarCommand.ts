/**
 * "Toggle sidebar" as a palette command (round 3, criterion 7).
 *
 * The sidebar's collapsed state lives in the shell's own React state, and the
 * command palette is built from the registry, which is a module-level list
 * assembled before anything renders. A command therefore cannot close over the
 * setter — the same problem the search dialog has, solved the same way: the
 * command dispatches a window event and the shell, which does have the state,
 * listens for it. `src/app/CommandPalette.tsx` does exactly this with
 * `OPEN_PALETTE_EVENT`.
 *
 * It lives beside `undoCommands` in `registry.ts`'s `appCommands`, not inside
 * a feature: the sidebar belongs to the shell, and a feature that owned this
 * command would be claiming a piece of chrome it does not render.
 *
 * The key is mod+\ — the same one Xcode, VS Code and Notes use — and it is
 * listed in the shell's own reserved shortcuts so the generic command binder
 * leaves it alone and a single press does not toggle twice.
 */
import type { FeatureCommand } from "@/app/feature";

export const TOGGLE_SIDEBAR_EVENT = "helix:toggle-sidebar";

export const TOGGLE_SIDEBAR_SHORTCUT = "mod+\\";

export function requestToggleSidebar(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOGGLE_SIDEBAR_EVENT));
}

export const sidebarCommands: FeatureCommand[] = [
  {
    id: "toggle-sidebar",
    label: "Hide or show the sidebar",
    shortcut: TOGGLE_SIDEBAR_SHORTCUT,
    group: "View",
    keywords: ["sidebar", "collapse", "expand", "hide", "show", "nav", "room"],
    run: () => requestToggleSidebar(),
  },
];
