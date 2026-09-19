/**
 * The Today feature module.
 *
 * Owns: the Today screen at "/" and "/today", instant search, the saved-views
 * library, the one-tap action helpers and the gone-quiet rule.
 *
 * Two things worth knowing before reading further, both written up properly in
 * docs/STATUS.md under "Contract changes needed":
 *
 * 1. `commands[].shortcut` is a label, not a binding. Only the shell binds keys
 *    (Shell.tsx calls `useShortcut("mod+k")` for the palette), so a feature's
 *    shortcut string is shown next to the command and nothing more. Search
 *    therefore binds its own key from the overlay it mounts, on Cmd/Ctrl+/,
 *    because Cmd/Ctrl+K already belongs to the palette.
 * 2. `nav` is a static array, read once when the shell mounts and before any
 *    row exists. Pinned saved views cannot be sidebar items until a feature can
 *    contribute nav items asynchronously, so they surface as a strip at the top
 *    of Today instead. Sidebar order 15 is reserved for them.
 */

import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { Sun } from "lucide-react";
import { TodayScreen } from "@/features/today/TodayScreen";
import {
  mountSearchOverlay,
  openSearch,
  SEARCH_SHORTCUT,
} from "@/features/today/search/overlay";

export const feature: FeatureModule = {
  id: "today",
  routes: [
    { path: "/", element: <TodayScreen /> },
    { path: "/today", element: <TodayScreen /> },
  ],
  nav: [{ label: "Today", to: "/", icon: Sun, order: NAV_ORDER.today }],
  commands: [
    {
      id: "search",
      label: "Search records",
      shortcut: SEARCH_SHORTCUT,
      group: "Find",
      keywords: ["find", "contact", "company", "deal", "note", "lookup"],
      run: openSearch,
    },
  ],
  /** Mounts the search overlay. Idempotent, as the contract requires. */
  onBoot: async () => {
    mountSearchOverlay();
  },
};

export default feature;
