/**
 * The Today feature module.
 *
 * Owns: the Today screen at "/" and "/today", instant search, the saved-views
 * library, the one-tap action helpers and the gone-quiet rule.
 *
 * Two seams wave 3 closed, both now in docs/CONTRACTS.md:
 *
 * 1. `commands[].shortcut` is still a label rather than a binding, but the
 *    shell binds Cmd/Ctrl+K to whatever command is registered with the id
 *    "search" — this one. The palette moved to Cmd/Ctrl+Shift+K. The overlay
 *    keeps Cmd/Ctrl+/ as an alias.
 * 2. `navProvider` lets a feature contribute sidebar items that only exist
 *    after a database read, so pinned saved views are a real "Views" group in
 *    the sidebar (order 15) instead of a strip on Today.
 */

import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { Sun } from "@/ui/icons";
import { TodayScreen } from "@/features/today/TodayScreen";
import {
  mountSearchOverlay,
  openSearch,
  SEARCH_SHORTCUT,
} from "@/features/today/search/overlay";
import { usePinnedViewsNav } from "@/features/today/views/pinnedNav";

export const feature: FeatureModule = {
  id: "today",
  routes: [
    { path: "/", element: <TodayScreen /> },
    { path: "/today", element: <TodayScreen /> },
  ],
  nav: [{ label: "Today", to: "/", icon: Sun, order: NAV_ORDER.today }],
  /** The sidebar's "Views" group: every pinned saved view, live. */
  navProvider: usePinnedViewsNav,
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
