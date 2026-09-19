/**
 * STUB. The today feature agent replaces this file.
 * Owns: Today screen, search palette, saved views, one-tap actions, gone-quiet.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { EmptyState, PageHeader } from "@/ui";
import { Sun } from "lucide-react";

function TodayScreen() {
  return (
    <div>
      <PageHeader title="Today" subtitle="What needs you first." />
      <EmptyState
        title="Today is not built yet"
        description="Due now, new leads, gone quiet and recent activity land here."
      />
    </div>
  );
}

export const feature: FeatureModule = {
  id: "today",
  routes: [
    { path: "/", element: <TodayScreen /> },
    { path: "/today", element: <TodayScreen /> },
  ],
  nav: [{ label: "Today", to: "/", icon: Sun, order: NAV_ORDER.today }],
};

export default feature;
