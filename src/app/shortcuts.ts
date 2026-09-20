/**
 * The keyboard. One handler in the shell binds every registered command.
 *
 * Before this module a `FeatureCommand.shortcut` was a label: the palette drew
 * it and nothing pressed it, so each feature that promised a key mounted its own
 * React root from `onBoot` purely to add a `keydown` listener (Today's search
 * overlay, records' quick add, the settings host, the AI host). The shell now
 * binds `allCommands()` centrally and those hosts are redundant as bindings —
 * see docs/CONTRACTS.md, "The keys the shell binds".
 *
 * Everything here except `useCommandShortcuts` is pure and has no runtime
 * import beyond React, so the binder is unit-testable without a DOM and without
 * pulling the feature registry (and therefore every feature) into the test.
 *
 * The rules, in one place:
 *
 *   - `mod` is Cmd on macOS and Ctrl everywhere else, and the *other* platform's
 *     modifier must not be held: Ctrl+Cmd+K is not Cmd+K.
 *   - Shift and Alt must match exactly. A chord says what it needs.
 *   - A bare key ("?", "g") matches on `event.key` and says nothing about Shift,
 *     because the browser has already applied it: "?" is Shift+/ on a US
 *     keyboard and its own key elsewhere.
 *   - Typing in an input, a textarea, a select or a contenteditable suppresses
 *     every shortcut. A command that genuinely needs its key inside a field
 *     opts in with `whileTyping: true`; a bare key never does, because a bare
 *     key is what the owner is typing.
 */
import { useEffect, useRef } from "react";
import type { FeatureCommand } from "@/app/feature";

/** Cmd on macOS, Ctrl everywhere else. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || navigator.userAgent);
}

/** A parsed shortcut: the one key it ends in, and the modifiers it declares. */
export type Chord = {
  /** The final key, lower-cased ("k", ",", "?", "escape"). */
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** True when no modifier was declared at all — a bare "?" or "g". */
  bare: boolean;
};

/**
 * Parse a "mod+shift+k" string. Returns null for anything unbindable, in which
 * case the palette still prints the label and no key is registered — a bad
 * string must not throw during a keypress.
 *
 * Only `mod`, `shift` and `alt` are modifier names. "ctrl+k" and "cmd+k" are
 * deliberately *not* accepted: the contract's spelling is `mod`, and a literal
 * `ctrl` would mean the wrong physical key on one of the two platforms.
 */
export function parseShortcut(shortcut: string | undefined): Chord | null {
  if (!shortcut) return null;
  const parts = shortcut
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (key === "mod" || key === "shift" || key === "alt") return null;
  if (!mods.every((mod) => mod === "mod" || mod === "shift" || mod === "alt")) {
    return null;
  }

  return {
    key,
    mod: mods.includes("mod"),
    shift: mods.includes("shift"),
    alt: mods.includes("alt"),
    bare: mods.length === 0,
  };
}

/** A canonical spelling, so two strings for the same chord compare equal. */
export function normaliseShortcut(shortcut: string | undefined): string | null {
  const chord = parseShortcut(shortcut);
  if (!chord) return null;
  return [chord.mod ? "mod" : "", chord.shift ? "shift" : "", chord.alt ? "alt" : "", chord.key]
    .filter(Boolean)
    .join("+");
}

/** The part of a KeyboardEvent a chord is matched against. */
export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export function matchesChord(chord: Chord, event: KeyLike, mac: boolean): boolean {
  if (chord.bare) {
    // Nothing held: a bare key with a modifier down is a different gesture.
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    return event.key.toLowerCase() === chord.key;
  }

  const mod = mac ? event.metaKey : event.ctrlKey;
  const otherPlatformMod = mac ? event.ctrlKey : event.metaKey;
  if (chord.mod !== mod) return false;
  if (otherPlatformMod) return false;
  if (chord.shift !== event.shiftKey) return false;
  if (chord.alt !== event.altKey) return false;
  return event.key.toLowerCase() === chord.key;
}

/**
 * True when the owner is typing. Duck-typed rather than `instanceof
 * HTMLElement` so the guard can be tested without a DOM, and so it still works
 * on a target from another document (a portal in an iframe).
 */
export function isTypingTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return element.isContentEditable === true;
}

/**
 * Events no shortcut ever answers: a key held down (a repeat would reopen the
 * dialog it just opened), a keystroke being composed by an IME, and anything
 * another handler has already claimed.
 */
export function shouldSkipEvent(event: {
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}): boolean {
  return event.repeat === true || event.isComposing === true || event.defaultPrevented === true;
}

/**
 * The first command whose shortcut this keystroke is, or null.
 *
 * Registry order decides a tie, which is also the order the palette lists them
 * in, so two features claiming one key is visible rather than random.
 */
export function pickCommand(
  commands: readonly FeatureCommand[],
  event: KeyLike,
  context: { mac: boolean; typing: boolean; reserved?: readonly string[] },
): FeatureCommand | null {
  const reserved = new Set(
    (context.reserved ?? [])
      .map((shortcut) => normaliseShortcut(shortcut))
      .filter((shortcut): shortcut is string => shortcut !== null),
  );

  for (const command of commands) {
    // A command's own key, then any alias it declares: an alias is a real
    // binding on the same terms, not a label (see FeatureCommand.aliases).
    for (const key of [command.shortcut, ...(command.aliases ?? [])]) {
      const chord = parseShortcut(key);
      if (!chord) continue;

      // Keys the shell binds itself (search, the palette) win: it has to
      // answer them even when no feature registered the matching command.
      const canonical = normaliseShortcut(key);
      if (canonical !== null && reserved.has(canonical)) continue;

      // The typing rules apply to an alias exactly as they do to the first
      // key: a bare alias never fires mid-sentence either.
      if (context.typing && (chord.bare || command.whileTyping !== true)) continue;
      if (!matchesChord(chord, event, context.mac)) continue;
      return command;
    }
  }
  return null;
}

export type CommandShortcutOptions = {
  /**
   * Shortcuts the shell binds for itself, which the generic binder must leave
   * alone so the key is not handled twice.
   */
  reserved?: readonly string[];
  /** Tests only: force the platform instead of sniffing the navigator. */
  mac?: boolean;
};

/**
 * Bind every command's shortcut for as long as the shell is mounted.
 *
 * One `keydown` listener on `window`, installed once. The command list is read
 * through a ref, so a re-render never re-registers the listener and a command
 * added to the registry is picked up on the next keypress.
 *
 * On a match the handler calls `preventDefault`, `stopPropagation` **and**
 * `stopImmediatePropagation`. The last one is the one that matters: the
 * features' own overlay hosts still listen on `window` too, and only
 * `stopImmediatePropagation` stops another listener on the same target. They
 * register later than this one (a feature's `onBoot` runs after the shell's
 * first paint), so the shell wins and the command runs exactly once. Features
 * should now drop those bindings — see docs/CONTRACTS.md.
 */
export function useCommandShortcuts(
  commands: readonly FeatureCommand[],
  options: CommandShortcutOptions = {},
): void {
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  const { mac, reserved } = options;
  // A stable dependency: the array identity changes on every render, its
  // contents do not.
  const reservedKey = (reserved ?? []).join("|");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handler = (event: KeyboardEvent) => {
      if (shouldSkipEvent(event)) return;
      const command = pickCommand(commandsRef.current, event, {
        mac: mac ?? isMac(),
        typing: isTypingTarget(event.target),
        reserved: reservedKey.length > 0 ? reservedKey.split("|") : [],
      });
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void command.run();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mac, reservedKey]);
}
