/**
 * The always-mounted half of the settings feature.
 *
 * Two jobs the shell cannot do for a feature:
 *   1. bind the keys. The shell binds mod+k and nothing else - a command's
 *      `shortcut` is drawn in the palette but never registered - so a feature
 *      that promises mod+, has to listen for it itself.
 *   2. hold the dialogs that open from anywhere: the shortcuts sheet (on "?")
 *      and the workspace picker (from the palette).
 *
 * Mounted from the feature's onBoot hook through mountOverlay.
 */
import { useEffect, useSyncExternalStore } from "react";
import { navigate } from "wouter/use-browser-location";
import { useShortcut } from "@/app/hooks";
import { setTheme, readRegistry } from "@/app/appSettings";
import { createOpener } from "@/features/settings/lib/overlayHost";
import { ShortcutsSheet } from "@/features/settings/components/ShortcutsSheet";
import { WorkspacePicker } from "@/features/settings/components/WorkspacePicker";

export const shortcutsSheet = createOpener();
export const workspacePicker = createOpener();

/** The palette's "Switch theme" command, so light/dark is reachable by keyboard. */
export async function toggleTheme(): Promise<void> {
  const registry = await readRegistry();
  const next =
    registry.theme === "dark"
      ? "light"
      : registry.theme === "light"
        ? "dark"
        : // "auto" flips to the opposite of whatever it is resolving to now.
          document.documentElement.getAttribute("data-theme") === "dark"
          ? "light"
          : "dark";
  await setTheme(next);
}

function useOpener(opener: ReturnType<typeof createOpener>): boolean {
  return useSyncExternalStore(opener.subscribe, opener.isOpen, opener.isOpen);
}

export function SettingsHost() {
  const sheetOpen = useOpener(shortcutsSheet);
  const pickerOpen = useOpener(workspacePicker);

  useShortcut("mod+,", () => navigate("/settings"));

  // "?" is shift+/ on a US keyboard and its own key elsewhere, so it is matched
  // on event.key rather than through the mod+ parser. Never while typing.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "?") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
      event.preventDefault();
      shortcutsSheet.open();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <ShortcutsSheet open={sheetOpen} onOpenChange={shortcutsSheet.setOpen} />
      <WorkspacePicker open={pickerOpen} onOpenChange={workspacePicker.setOpen} />
    </>
  );
}
