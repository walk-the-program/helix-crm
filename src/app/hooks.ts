/**
 * Shell-level hooks: the write lock's state, the app's appearance, and the
 * open workspace. Features use these instead of reaching into src/db.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getWriteStateSnapshot,
  subscribeTimers,
  subscribeWriteState,
  timersPaused,
} from "@/db/writeLock";
import {
  applyAppearance,
  readRegistry,
  setDensity as persistDensity,
  setTheme as persistTheme,
  type Density,
  type HelixRegistry,
  type Theme,
} from "@/app/appSettings";

/** "Saved, queued behind the import" comes from here. */
export function useWriteState(): {
  busy: boolean;
  label: string | null;
  queued: number;
} {
  return useSyncExternalStore(
    subscribeWriteState,
    getWriteStateSnapshot,
    getWriteStateSnapshot,
  );
}

/** True while the background timers are paused by a long write. */
export function useTimersPaused(): boolean {
  return useSyncExternalStore(subscribeTimers, timersPaused, timersPaused);
}

export type Appearance = {
  theme: Theme;
  density: Density;
  setTheme: (theme: Theme) => Promise<void>;
  setDensity: (density: Density) => Promise<void>;
};

/** Theme and density, read from helix.json and written back on change. */
export function useAppearance(initial?: HelixRegistry): Appearance {
  const [theme, setThemeState] = useState<Theme>(initial?.theme ?? "auto");
  const [density, setDensityState] = useState<Density>(
    initial?.density ?? "comfortable",
  );

  useEffect(() => {
    let cancelled = false;
    if (!initial) {
      void readRegistry().then((registry) => {
        if (cancelled) return;
        setThemeState(registry.theme);
        setDensityState(registry.density);
        applyAppearance(registry.theme, registry.density);
      });
    } else {
      applyAppearance(initial.theme, initial.density);
    }
    return () => {
      cancelled = true;
    };
  }, [initial]);

  // "auto" follows the OS while the app is open.
  useEffect(() => {
    if (theme !== "auto" || typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance("auto", density);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme, density]);

  const setTheme = useCallback(async (next: Theme) => {
    setThemeState(next);
    await persistTheme(next);
  }, []);

  const setDensity = useCallback(async (next: Density) => {
    setDensityState(next);
    await persistDensity(next);
  }, []);

  return { theme, density, setTheme, setDensity };
}

/** Cmd on macOS, Ctrl everywhere else. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || navigator.userAgent);
}

/**
 * Register a "mod+k" style shortcut for as long as the component is mounted.
 * Typing in an input never triggers one, except for Escape.
 */
export function useShortcut(
  shortcut: string | undefined,
  run: () => void,
): void {
  useEffect(() => {
    if (!shortcut) return;
    const parts = shortcut.toLowerCase().split("+");
    const key = parts[parts.length - 1];
    const wantsMod = parts.includes("mod");
    const wantsShift = parts.includes("shift");
    const wantsAlt = parts.includes("alt");

    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing && key !== "escape") return;

      const mod = isMac() ? event.metaKey : event.ctrlKey;
      if (wantsMod !== mod) return;
      if (wantsShift !== event.shiftKey) return;
      if (wantsAlt !== event.altKey) return;
      if (event.key.toLowerCase() !== key) return;

      event.preventDefault();
      run();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcut, run]);
}
