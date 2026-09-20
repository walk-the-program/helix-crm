/**
 * The always-mounted half of the settings feature: the two dialogs that open
 * from anywhere, the shortcuts sheet and the workspace picker.
 *
 * It used to bind keys as well - mod+, for settings and a hand-rolled "?"
 * listener for the sheet - because a `FeatureCommand.shortcut` was a label the
 * palette drew and nothing pressed. The shell binds every registered command
 * centrally now, including a bare key, so both bindings are gone and the two
 * commands in ../index.tsx are the whole story. See `src/app/shortcuts.ts`.
 *
 * Rendered by the shell through the feature's `overlays` slot, inside the app's
 * providers, on every screen.
 */
import { useSyncExternalStore } from "react";
import { nextTheme, setTheme, readRegistry } from "@/app/appSettings";
import { createOpener } from "@/features/settings/lib/opener";
import { ShortcutsSheet } from "@/features/settings/components/ShortcutsSheet";
import { WorkspacePicker } from "@/features/settings/components/WorkspacePicker";

export const shortcutsSheet = createOpener();
export const workspacePicker = createOpener();

/**
 * The palette's and the View menu's theme command, so appearance is reachable
 * by keyboard. It cycles Auto → Light → Dark → Auto through the shared
 * `nextTheme`, the same way the toolbar button does: the old two-state flip
 * pinned an owner on Auto to a fixed theme with no way back
 * (design/apple-hig-review.md, finding 5).
 */
export async function toggleTheme(): Promise<void> {
  const registry = await readRegistry();
  await setTheme(nextTheme(registry.theme));
}

function useOpener(opener: ReturnType<typeof createOpener>): boolean {
  return useSyncExternalStore(opener.subscribe, opener.isOpen, opener.isOpen);
}

export function SettingsHost() {
  const sheetOpen = useOpener(shortcutsSheet);
  const pickerOpen = useOpener(workspacePicker);

  return (
    <>
      <ShortcutsSheet open={sheetOpen} onOpenChange={shortcutsSheet.setOpen} />
      <WorkspacePicker open={pickerOpen} onOpenChange={workspacePicker.setOpen} />
    </>
  );
}
