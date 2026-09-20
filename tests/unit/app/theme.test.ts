/**
 * The theme cycle.
 *
 * Every surface that changes appearance — the toolbar button, the View menu's
 * "Toggle theme" and the command palette — moves through `nextTheme`, so they
 * cannot disagree. The property that matters is the one the HIG review named
 * (finding 5): Auto is always one press away, so pressing the button on a Mac
 * set to dark can never strand the owner on a fixed theme.
 */
import { describe, expect, it } from "vitest";
import { nextTheme, type Theme } from "@/app/appSettings";

describe("nextTheme", () => {
  it("cycles Auto to Light to Dark and back to Auto", () => {
    expect(nextTheme("auto")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("auto");
  });

  it("returns to Auto within three presses from anywhere", () => {
    for (const start of ["auto", "light", "dark"] as Theme[]) {
      let theme = start;
      let presses = 0;
      do {
        theme = nextTheme(theme);
        presses += 1;
      } while (theme !== "auto" && presses < 10);
      expect(theme).toBe("auto");
      expect(presses).toBeLessThanOrEqual(3);
    }
  });
});
