/**
 * Pinned saved views, as a sidebar group.
 *
 * DESIGN.md asks for a "Views" group in the sidebar and PLAN item 13 asks for
 * pinned views in it. Until wave 3 neither was possible: `FeatureModule.nav`
 * is a static array the shell flattens once when it mounts, before anything
 * has been read, so the views surfaced as a strip at the top of Today instead.
 *
 * `FeatureModule.navProvider` is the slot that replaced the strip. The shell
 * calls this on every render, so `usePinnedViews`'s subscription to
 * `qk.savedViews()` is what keeps the group live: pin a view on /contacts and
 * it appears in the sidebar without a reload.
 *
 * An empty result contributes no group at all, so an owner who has pinned
 * nothing sees no empty heading.
 */
import { Bookmark } from "lucide-react";
import type { FeatureNavSection } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { usePinnedViews, viewRoute } from "@/features/today/views/useSavedViews";

export function usePinnedViewsNav(): FeatureNavSection[] {
  const { views } = usePinnedViews();
  if (views.length === 0) return [];

  return [
    {
      label: "Views",
      order: NAV_ORDER.views,
      items: views.map((view) => ({
        label: view.name,
        to: viewRoute(view),
        icon: Bookmark,
        order: NAV_ORDER.views,
      })),
    },
  ];
}
