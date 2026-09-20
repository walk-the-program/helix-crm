/**
 * The theme toggle.
 *
 * Every surface that changes appearance — the toolbar button, the View menu's
 * "Toggle theme" and the command palette — moves through `nextTheme`, so they
 * cannot disagree.
 *
 * ROUND 3, criterion 6 replaced the Auto → Light → Dark → Auto cycle with a
 * two-state toggle. The cycle satisfied the HIG review's finding 5 ("Auto is
 * always one press away") at a cost Walker found immediately: on a Mac set to
 * dark with Helix on Auto, turning the app light took two presses. Auto is now
 * a named choice in Settings > Appearance instead of a stop on the carousel.
 *
 * jsdom has no matchMedia, so `resolveTheme("auto")` is "light" throughout.
 */
import { describe, expect, it } from "vitest";
import { nextTheme, type Theme } from "@/app/appSettings";

describe("nextTheme", () => {
  it("flips Light and Dark, one press each way", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });

  it("from Auto, goes to the opposite of what is actually on screen", () => {
    // Auto resolves to light here, so the press has to offer dark. Offering
    // "light" from an app that is already light is the bug this replaced.
    expect(nextTheme("auto")).toBe("dark");
  });

  it("never returns Auto: it is a setting, not a stop on the toggle", () => {
    for (const start of ["auto", "light", "dark"] as Theme[]) {
      let theme = start;
      for (let press = 0; press < 6; press += 1) {
        theme = nextTheme(theme);
        expect(theme).not.toBe("auto");
      }
    }
  });

  it("is an involution once it has left Auto: two presses come back", () => {
    for (const start of ["light", "dark"] as Theme[]) {
      expect(nextTheme(nextTheme(start))).toBe(start);
    }
  });
});
