// @vitest-environment jsdom
/**
 * `Kbd` draws the glyph a Mac owner reads on every menu in the OS — and a
 * screen reader reads "⌘" as nothing useful at all. So the chord is spelled
 * out as words for the accessibility tree and the glyphs are hidden from it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Kbd } from "@/ui";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function onMac(mac: boolean) {
  vi.stubGlobal("navigator", {
    platform: mac ? "MacIntel" : "Win32",
    userAgent: mac ? "Mac OS X" : "Windows NT",
  });
}

describe("Kbd", () => {
  beforeEach(() => onMac(true));

  it("spells the chord out for a screen reader", () => {
    render(<Kbd keys="mod+k" />);
    expect(screen.getByLabelText("Command K")).toBeTruthy();
  });

  it("still draws the glyphs, and hides them from the accessibility tree", () => {
    const { container } = render(<Kbd keys="mod+shift+k" />);
    const kbd = container.querySelector("kbd") as HTMLElement;
    expect(kbd.getAttribute("aria-label")).toBe("Command Shift K");
    const glyphs = kbd.querySelector("span") as HTMLElement;
    expect(glyphs.textContent).toBe("⌘⇧K");
    expect(glyphs.getAttribute("aria-hidden")).toBe("true");
  });

  it("says Control off a Mac, where the glyph is already a word", () => {
    onMac(false);
    const { container } = render(<Kbd keys="mod+k" />);
    const kbd = container.querySelector("kbd") as HTMLElement;
    expect(kbd.getAttribute("aria-label")).toBe("Control K");
    expect(kbd.textContent).toBe("Ctrl+K");
  });

  it("names a bare key and a named key", () => {
    render(<Kbd keys="escape" />);
    expect(screen.getByLabelText("Escape")).toBeTruthy();
  });
});
