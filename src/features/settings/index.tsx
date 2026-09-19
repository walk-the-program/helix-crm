/**
 * STUB. The settings feature agent replaces this file.
 * Owns: settings screens, workspaces, diagnostics.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { EmptyState, PageHeader } from "@/ui";
import { Settings as SettingsIcon } from "lucide-react";

function SettingsScreen() {
  return (
    <div>
      <PageHeader title="Settings" />
      <EmptyState
        title="Settings are not built yet"
        description="Vocabulary, stages, tags, currency, backups, the site connection and AI land here."
      />
    </div>
  );
}

export const feature: FeatureModule = {
  id: "settings",
  routes: [
    { path: "/settings", element: <SettingsScreen /> },
    { path: "/settings/:section", element: <SettingsScreen /> },
  ],
  nav: [{ label: "Settings", to: "/settings", icon: SettingsIcon, order: NAV_ORDER.settings }],
};

export default feature;
