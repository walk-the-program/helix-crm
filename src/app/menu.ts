/**
 * The macOS menu bar, on this side of the bridge.
 *
 * `src-tauri/src/menu.rs` builds the real menu. Everything in it that is not
 * the operating system's own (Cut, Copy, Paste, Quit, Minimise, …) carries an
 * id that means something here: a command id from `src/app/registry.ts`, or a
 * `nav:` route. Clicking one emits a single `menu` event carrying that id, and
 * this module runs it. Adding a menu item therefore needs no change here, and
 * a menu item and a palette entry can never drift apart, because they are the
 * same command.
 *
 * Undo and Redo take the long way round on purpose. On macOS a menu
 * accelerator is claimed by AppKit before the web view ever sees the keystroke,
 * so a Cmd+Z in a text field would never reach WKWebView's own undo — which is
 * why the two items are ours rather than the predefined ones and why the
 * handler below hands the keystroke straight back to the focused field. The
 * shell's ordinary shortcut binder gets the same result on the other route by
 * suppressing every shortcut while the owner is typing (docs/CONTRACTS.md,
 * "The keys the shell binds").
 */
import { navigate } from "wouter/use-browser-location";
import { findCommand } from "@/app/registry";
import { isTauri } from "@/app/appSettings";
import { isTypingTarget } from "@/app/shortcuts";

/** Must match `MENU_EVENT` in src-tauri/src/menu.rs. */
export const MENU_EVENT = "menu";

/** The prefix a menu item uses to mean "go to this route". */
const NAV_PREFIX = "nav:";

/**
 * True when the keystroke belongs to whatever the owner is typing in rather
 * than to the application. Exported so the test can drive it directly.
 */
export function editableHasFocus(doc: Document = document): boolean {
  return isTypingTarget(doc.activeElement);
}

/**
 * Run one menu id.
 *
 * Returns the id it could not place, or null when it handled the click, so the
 * caller can log a menu item that has lost its command instead of the click
 * disappearing without a trace.
 */
export function runMenuId(id: string): string | null {
  if (id.startsWith(NAV_PREFIX)) {
    navigate(id.slice(NAV_PREFIX.length));
    return null;
  }

  // A text field's own undo. `execCommand` is the only way to reach WebKit's
  // per-field undo stack from script, and it is exactly what the menu item
  // would have done had it been the predefined one.
  if ((id === "undo" || id === "redo") && editableHasFocus()) {
    document.execCommand(id);
    return null;
  }

  const command = findCommand(id);
  if (!command) return id;
  void command.run();
  return null;
}

/**
 * Listen for the menu for as long as the app is running.
 *
 * Returns a function that stops listening, which nothing calls today — the
 * listener lives as long as the window does — but which keeps the module
 * testable and keeps a future second window honest.
 *
 * Outside Tauri (the e2e harness, a browser during design review) there is no
 * menu and no event source, so this is a no-op rather than a failed import:
 * `@tauri-apps/api/event` is loaded lazily for exactly that reason.
 */
export function installMenuBridge(): () => void {
  if (!isTauri()) return () => {};

  let stop: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string>(MENU_EVENT, (event) => {
      const missing = runMenuId(event.payload);
      if (missing !== null) {
        console.warn(`Menu item "${missing}" has no command.`);
      }
    });
    if (cancelled) unlisten();
    else stop = unlisten;
  })();

  return () => {
    cancelled = true;
    stop?.();
    stop = null;
  };
}
