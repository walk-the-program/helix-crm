/**
 * The settings feature: the index, the workspace-level screens, the workspace
 * list (E7) and Diagnostics.
 *
 * Routes registered here are only the ones this feature owns. Three settings
 * rows point at screens other features own and are linked, never registered:
 * "/pipeline" (stage management, records), "/settings/site" (leads) and
 * "/backups" and "/trash" (data and records). See lib/sections.ts.
 *
 * "/settings/ai" belongs to the AI feature and is registered there, so the AI
 * module can be read - and reviewed - as one folder.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { Settings as SettingsIcon } from "lucide-react";
import { navigate } from "wouter/use-browser-location";
import { mountOverlay } from "@/features/settings/lib/overlayHost";
import { OverviewScreen } from "@/features/settings/components/OverviewScreen";
import { WorkspaceScreen } from "@/features/settings/components/WorkspaceScreen";
import { VocabularyScreen } from "@/features/settings/components/VocabularyScreen";
import { TagsScreen } from "@/features/settings/components/TagsScreen";
import { FieldsScreen } from "@/features/settings/components/FieldsScreen";
import { AppearanceScreen } from "@/features/settings/components/AppearanceScreen";
import { ShortcutsScreen } from "@/features/settings/components/ShortcutsSheet";
import { WorkspacesScreen } from "@/features/settings/components/WorkspacesScreen";
import { DiagnosticsScreen } from "@/features/settings/components/DiagnosticsScreen";
import {
  SettingsHost,
  shortcutsSheet,
  toggleTheme,
  workspacePicker,
} from "@/features/settings/components/SettingsHost";

export const feature: FeatureModule = {
  id: "settings",
  routes: [
    { path: "/settings", element: <OverviewScreen /> },
    { path: "/settings/workspace", element: <WorkspaceScreen /> },
    { path: "/settings/vocabulary", element: <VocabularyScreen /> },
    { path: "/settings/tags", element: <TagsScreen /> },
    { path: "/settings/fields", element: <FieldsScreen /> },
    { path: "/settings/appearance", element: <AppearanceScreen /> },
    { path: "/settings/shortcuts", element: <ShortcutsScreen /> },
    { path: "/settings/workspaces", element: <WorkspacesScreen /> },
    { path: "/settings/diagnostics", element: <DiagnosticsScreen /> },
  ],
  nav: [
    {
      label: "Settings",
      to: "/settings",
      icon: SettingsIcon,
      order: NAV_ORDER.settings,
    },
  ],
  commands: [
    {
      id: "open-settings",
      label: "Open settings",
      shortcut: "mod+,",
      group: "Settings",
      keywords: ["preferences", "options", "configuration"],
      run: () => navigate("/settings"),
    },
    {
      id: "toggle-theme",
      label: "Switch between light and dark",
      group: "Settings",
      keywords: ["theme", "dark mode", "light mode", "appearance"],
      run: () => toggleTheme(),
    },
    {
      id: "switch-workspace",
      label: "Switch workspace",
      group: "Settings",
      keywords: ["business", "second business", "change file"],
      run: () => workspacePicker.open(),
    },
    {
      id: "show-shortcuts",
      label: "Keyboard shortcuts",
      shortcut: "?",
      group: "Settings",
      keywords: ["keys", "hotkeys", "help"],
      run: () => shortcutsSheet.open(),
    },
  ],
  onBoot: async () => {
    // The shortcuts sheet, the workspace picker and the mod+, binding have to
    // exist on every screen, and the shell has no slot for them. Idempotent.
    mountOverlay("settings", <SettingsHost />);
  },
};

export default feature;
