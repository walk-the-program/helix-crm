/**
 * The settings feature: the index, the workspace-level screens, the workspace
 * list (E7) and Diagnostics.
 *
 * Two screens other features build are mounted here, under "/settings", because
 * that is where the owner goes looking for them: the website connection (the
 * leads feature's own screen) and backups (the data feature's). The feature that
 * owns the screen still owns the screen; this file only decides that it appears
 * inside Settings, so the section list and the index can reach it.
 *
 * Two rows still point elsewhere and are linked, never registered: "/pipeline"
 * (stage management, records) and "/trash" (records). See lib/sections.ts.
 *
 * "/settings/ai" belongs to the AI feature and is registered there, so the AI
 * module can be read - and reviewed - as one folder.
 */
import type { FeatureModule } from "@/app/feature";
import { NAV_ORDER } from "@/app/feature";
import { Settings as SettingsIcon } from "@/ui/icons";
import { navigate } from "wouter/use-browser-location";
import { SiteConnectionScreen } from "@/features/leads";
import { BackupsScreen } from "@/features/data";
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
import { SettingsMount } from "@/features/settings/components/SettingsLayout";
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
    // Other features' screens, mounted under Settings inside the same frame, so
    // following the section list into one of them does not lose the section
    // list. NOTE: the leads feature also registers "/settings/site" itself and
    // sits earlier in the registry, so wouter's Switch matches its bare
    // registration first and the website connection renders without the
    // section list until leads drops that route. Backups has no such duplicate
    // and gets the frame today.
    {
      path: "/settings/site",
      element: (
        <SettingsMount>
          <SiteConnectionScreen />
        </SettingsMount>
      ),
    },
    {
      path: "/settings/backups",
      element: (
        <SettingsMount>
          <BackupsScreen />
        </SettingsMount>
      ),
    },
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
