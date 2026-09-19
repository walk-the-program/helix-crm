/**
 * `src/app/shortcuts.ts` is pure for everything except `useCommandShortcuts`
 * (see that file's own header comment), so this file runs in vitest's default
 * `node` environment — no jsdom pragma, no DOM.
 */
import { describe, expect, it } from "vitest";
import type { FeatureCommand } from "@/app/feature";
import {
  isTypingTarget,
  matchesChord,
  normaliseShortcut,
  parseShortcut,
  pickCommand,
  shouldSkipEvent,
  type Chord,
  type KeyLike,
} from "@/app/shortcuts";

function key(overrides: Partial<KeyLike>): KeyLike {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("parseShortcut", () => {
  it("parses a plain mod chord", () => {
    expect(parseShortcut("mod+n")).toEqual<Chord>({
      key: "n",
      mod: true,
      shift: false,
      alt: false,
      bare: false,
    });
  });

  it("parses a mod+shift chord", () => {
    expect(parseShortcut("mod+shift+k")).toEqual<Chord>({
      key: "k",
      mod: true,
      shift: true,
      alt: false,
      bare: false,
    });
  });

  it("parses a punctuation key", () => {
    expect(parseShortcut("mod+,")).toEqual<Chord>({
      key: ",",
      mod: true,
      shift: false,
      alt: false,
      bare: false,
    });
  });

  it("parses a bare key as bare", () => {
    expect(parseShortcut("?")).toEqual<Chord>({
      key: "?",
      mod: false,
      shift: false,
      alt: false,
      bare: true,
    });
  });

  it("parses a bare word key", () => {
    expect(parseShortcut("escape")).toEqual<Chord>({
      key: "escape",
      mod: false,
      shift: false,
      alt: false,
      bare: true,
    });
  });

  it("tolerates whitespace and mixed case", () => {
    expect(parseShortcut("  Mod + Shift + K  ")).toEqual<Chord>({
      key: "k",
      mod: true,
      shift: true,
      alt: false,
      bare: false,
    });
  });

  it("returns null for undefined", () => {
    expect(parseShortcut(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseShortcut("")).toBeNull();
  });

  it("returns null for a bare modifier name with nothing to hold down", () => {
    expect(parseShortcut("mod")).toBeNull();
  });

  it("returns null for a trailing separator with no key", () => {
    expect(parseShortcut("mod+")).toBeNull();
  });

  it("returns null for ctrl, an unbindable modifier name", () => {
    expect(parseShortcut("ctrl+k")).toBeNull();
  });

  it("returns null for cmd, an unbindable modifier name", () => {
    expect(parseShortcut("cmd+k")).toBeNull();
  });
});

describe("normaliseShortcut", () => {
  it("normalises two spellings of the same chord equal", () => {
    expect(normaliseShortcut("shift+mod+K")).toBe(normaliseShortcut("mod+shift+k"));
    expect(normaliseShortcut("shift+mod+K")).toBe("mod+shift+k");
  });

  it("returns null for an unbindable string", () => {
    expect(normaliseShortcut("ctrl+k")).toBeNull();
    expect(normaliseShortcut(undefined)).toBeNull();
  });
});

describe("matchesChord - mod detection", () => {
  const chord = parseShortcut("mod+k")!;

  it("matches metaKey and not ctrlKey when mac is true", () => {
    expect(matchesChord(chord, key({ key: "k", metaKey: true }), true)).toBe(true);
    expect(matchesChord(chord, key({ key: "k", ctrlKey: true }), true)).toBe(false);
  });

  it("matches ctrlKey and not metaKey when mac is false", () => {
    expect(matchesChord(chord, key({ key: "k", ctrlKey: true }), false)).toBe(true);
    expect(matchesChord(chord, key({ key: "k", metaKey: true }), false)).toBe(false);
  });

  it("does not match when the other platform's modifier is also held, on either platform", () => {
    const both = key({ key: "k", metaKey: true, ctrlKey: true });
    expect(matchesChord(chord, both, true)).toBe(false);
    expect(matchesChord(chord, both, false)).toBe(false);
  });

  it("requires shift to match exactly", () => {
    const withShift = parseShortcut("mod+shift+k")!;
    const withoutShift = parseShortcut("mod+k")!;
    const eventNoShift = key({ key: "k", metaKey: true });
    const eventWithShift = key({ key: "k", metaKey: true, shiftKey: true });

    expect(matchesChord(withShift, eventNoShift, true)).toBe(false);
    expect(matchesChord(withoutShift, eventWithShift, true)).toBe(false);
    expect(matchesChord(withShift, eventWithShift, true)).toBe(true);
    expect(matchesChord(withoutShift, eventNoShift, true)).toBe(true);
  });

  it("requires alt to match exactly", () => {
    const withAlt = parseShortcut("mod+alt+k")!;
    const withoutAlt = parseShortcut("mod+k")!;
    const eventNoAlt = key({ key: "k", metaKey: true });
    const eventWithAlt = key({ key: "k", metaKey: true, altKey: true });

    expect(matchesChord(withAlt, eventNoAlt, true)).toBe(false);
    expect(matchesChord(withoutAlt, eventWithAlt, true)).toBe(false);
    expect(matchesChord(withAlt, eventWithAlt, true)).toBe(true);
    expect(matchesChord(withoutAlt, eventNoAlt, true)).toBe(true);
  });
});

describe("matchesChord - bare key", () => {
  const chord = parseShortcut("?")!;

  it("matches on event.key regardless of shiftKey", () => {
    expect(matchesChord(chord, key({ key: "?", shiftKey: true }), true)).toBe(true);
    expect(matchesChord(chord, key({ key: "?", shiftKey: false }), true)).toBe(true);
  });

  it("does not match when meta, ctrl or alt is held", () => {
    expect(matchesChord(chord, key({ key: "?", metaKey: true }), true)).toBe(false);
    expect(matchesChord(chord, key({ key: "?", ctrlKey: true }), true)).toBe(false);
    expect(matchesChord(chord, key({ key: "?", altKey: true }), true)).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("is true for elements shaped like INPUT, TEXTAREA or SELECT", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("is true for isContentEditable", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for a DIV", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
  });

  it("is false for null, undefined, and a non-object", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget("input")).toBe(false);
    expect(isTypingTarget(42)).toBe(false);
  });
});

describe("shouldSkipEvent", () => {
  it("is true for a repeat", () => {
    expect(shouldSkipEvent({ repeat: true })).toBe(true);
  });

  it("is true while composing", () => {
    expect(shouldSkipEvent({ isComposing: true })).toBe(true);
  });

  it("is true when another handler already claimed the event", () => {
    expect(shouldSkipEvent({ defaultPrevented: true })).toBe(true);
  });

  it("is false for a plain event", () => {
    expect(shouldSkipEvent({ repeat: false, isComposing: false, defaultPrevented: false })).toBe(
      false,
    );
    expect(shouldSkipEvent({})).toBe(false);
  });
});

describe("pickCommand", () => {
  function command(overrides: Partial<FeatureCommand> & { id: string }): FeatureCommand {
    return {
      label: overrides.id,
      run: () => {},
      ...overrides,
    };
  }

  it("picks the matching command out of a list", () => {
    const calls: string[] = [];
    const a = command({ id: "a", shortcut: "mod+a", run: () => { calls.push("a"); } });
    const b = command({ id: "b", shortcut: "mod+b", run: () => { calls.push("b"); } });
    const found = pickCommand([a, b], key({ key: "b", metaKey: true }), {
      mac: true,
      typing: false,
    });
    expect(found).toBe(b);
  });

  it("returns null while typing for an ordinary command", () => {
    const a = command({ id: "a", shortcut: "mod+a" });
    const found = pickCommand([a], key({ key: "a", metaKey: true }), {
      mac: true,
      typing: true,
    });
    expect(found).toBeNull();
  });

  it("returns the command while typing when it declares whileTyping", () => {
    const a = command({ id: "a", shortcut: "mod+a", whileTyping: true });
    const found = pickCommand([a], key({ key: "a", metaKey: true }), {
      mac: true,
      typing: true,
    });
    expect(found).toBe(a);
  });

  it("never returns a bare-key command while typing, even with whileTyping", () => {
    const a = command({ id: "a", shortcut: "?", whileTyping: true });
    const found = pickCommand([a], key({ key: "?" }), {
      mac: true,
      typing: true,
    });
    expect(found).toBeNull();
  });

  it("picks a bare-key command when not typing", () => {
    const a = command({ id: "a", shortcut: "?" });
    const found = pickCommand([a], key({ key: "?" }), {
      mac: true,
      typing: false,
    });
    expect(found).toBe(a);
  });

  it("skips a command whose shortcut is reserved", () => {
    const a = command({ id: "a", shortcut: "mod+k" });
    const found = pickCommand([a], key({ key: "k", metaKey: true }), {
      mac: true,
      typing: false,
      reserved: ["mod+k"],
    });
    expect(found).toBeNull();
  });

  it("compares a reserved entry normalised, not literally", () => {
    const a = command({ id: "a", shortcut: "mod+k" });
    const found = pickCommand([a], key({ key: "k", metaKey: true }), {
      mac: true,
      typing: false,
      reserved: [" Mod + K "],
    });
    expect(found).toBeNull();
  });

  it("skips a command with no shortcut, or an unparseable one", () => {
    const noShortcut = command({ id: "a" });
    const badShortcut = command({ id: "b", shortcut: "ctrl+k" });
    const found = pickCommand([noShortcut, badShortcut], key({ key: "k", metaKey: true }), {
      mac: true,
      typing: false,
    });
    expect(found).toBeNull();
  });

  it("breaks a tie on registry order: the first matching command wins", () => {
    const first = command({ id: "first", shortcut: "mod+k" });
    const second = command({ id: "second", shortcut: "mod+k" });
    const found = pickCommand([first, second], key({ key: "k", metaKey: true }), {
      mac: true,
      typing: false,
    });
    expect(found).toBe(first);
  });
});
