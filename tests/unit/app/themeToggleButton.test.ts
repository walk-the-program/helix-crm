// @vitest-environment jsdom
/**
 * The toolbar's appearance button (HIG review finding 5, top-ten item 3):
 * its accessible name has to say what pressing it will DO — the next stop
 * in `nextTheme`'s Auto -> Light -> Dark -> Auto cycle — and its tooltip has
 * to say what the appearance IS right now, resolved against the OS when
 * Helix is on Auto, without the two repeating each other.
 *
 * `themeButtonLabels` is the pure function Shell.tsx renders the toolbar
 * button from; this exercises it directly rather than through Radix's hover
 * tooltip, which jsdom cannot usefully simulate.
 *
 * `@/app/Shell` pulls in `@/app/registry`, which loads every feature area
 * (all six are being edited concurrently by other agents). The registry is
 * mocked below exactly as tests/unit/app/shellFooter.test.ts does it, since
 * this test never renders the shell and does not need the real one. jsdom
 * has no `matchMedia`, so `resolveTheme`'s system-preference read is always
 * "false" here, which is what makes "auto" resolve to "light" below.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/registry", () => ({
  allRoutes: () => [],
  allNavItems: () => [],
  allNavProviders: () => [],
  allCommands: () => [],
  allOverlays: () => [],
  findCommand: () => null,
}));

import { themeButtonLabels } from "@/app/Shell";
import type { Theme } from "@/app/appSettings";

describe("themeButtonLabels", () => {
  it("Auto: names Light as the destination and states Auto plus the resolved appearance", () => {
    const { actionLabel, stateLabel, resolved } = themeButtonLabels("auto");
    expect(resolved).toBe("light"); // jsdom has no matchMedia, so "auto" resolves to "light".
    expect(actionLabel).toBe("Switch to light");
    expect(stateLabel).toBe("Auto (light)");
  });

  it("Light: names Dark as the destination and states Light", () => {
    const { actionLabel, stateLabel, resolved } = themeButtonLabels("light");
    expect(resolved).toBe("light");
    expect(actionLabel).toBe("Switch to dark");
    expect(stateLabel).toBe("Light");
  });

  it("Dark: names Auto as the destination and states Dark", () => {
    const { actionLabel, stateLabel, resolved } = themeButtonLabels("dark");
    expect(resolved).toBe("dark");
    expect(actionLabel).toBe("Switch to auto");
    expect(stateLabel).toBe("Dark");
  });

  it("cycles Auto -> Light -> Dark -> Auto, ending back at Auto, one press at a time", () => {
    let theme: Theme = "auto";
    const seen: Theme[] = [theme];
    for (let i = 0; i < 3; i++) {
      const { actionLabel } = themeButtonLabels(theme);
      theme =
        actionLabel === "Switch to light" ? "light" : actionLabel === "Switch to dark" ? "dark" : "auto";
      seen.push(theme);
    }
    expect(seen).toEqual<Theme[]>(["auto", "light", "dark", "auto"]);
  });

  it("never states the same thing it names as the action, at any point in the cycle", () => {
    for (const theme of ["auto", "light", "dark"] as const) {
      const { actionLabel, stateLabel } = themeButtonLabels(theme);
      expect(actionLabel).not.toBe(stateLabel);
    }
  });
});
