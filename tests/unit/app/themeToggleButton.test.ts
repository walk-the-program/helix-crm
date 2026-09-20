// @vitest-environment jsdom
/**
 * The toolbar's appearance button.
 *
 * ROUND 3, criterion 6: it is a TOGGLE, Light <-> Dark, one press each way.
 * It used to cycle Auto -> Light -> Dark -> Auto, which meant that from a Mac
 * on dark with Helix on Auto, going light took two presses. Auto now lives in
 * Settings > Appearance only.
 *
 * Its accessible name says what pressing it will DO; its tooltip says what the
 * appearance IS right now, resolved against the OS when Helix is on Auto, and
 * the two never repeat each other.
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
  it("Auto: the first press goes to the opposite of what is on screen", () => {
    // jsdom has no matchMedia, so "auto" resolves to "light" here — and the
    // button therefore offers dark, which is the whole point of the change:
    // from Auto the press does what the eye expects, not what the enum says.
    const { actionLabel, stateLabel, resolved, target } = themeButtonLabels("auto");
    expect(resolved).toBe("light");
    expect(target).toBe("dark");
    expect(actionLabel).toBe("Switch to dark");
    expect(stateLabel).toBe("Auto (light)");
  });

  it("Light: names Dark as the destination and states Light", () => {
    const { actionLabel, stateLabel, resolved, target } = themeButtonLabels("light");
    expect(resolved).toBe("light");
    expect(target).toBe("dark");
    expect(actionLabel).toBe("Switch to dark");
    expect(stateLabel).toBe("Light");
  });

  it("Dark: names Light as the destination and states Dark", () => {
    const { actionLabel, stateLabel, resolved, target } = themeButtonLabels("dark");
    expect(resolved).toBe("dark");
    expect(target).toBe("light");
    expect(actionLabel).toBe("Switch to light");
    expect(stateLabel).toBe("Dark");
  });

  it("never offers Auto: pressing it repeatedly flips Light <-> Dark and nothing else", () => {
    let theme: Theme = "auto";
    const pressed: Theme[] = [];
    for (let i = 0; i < 4; i++) {
      theme = themeButtonLabels(theme).target;
      pressed.push(theme);
    }
    // From Auto (resolving light) the first press is dark, and from then on it
    // is a plain two-state flip. Auto never comes back round: it is a setting,
    // not a stop on a carousel.
    expect(pressed).toEqual<Theme[]>(["dark", "light", "dark", "light"]);
    expect(pressed).not.toContain("auto");
  });

  it("never states the same thing it names as the action, in any state", () => {
    for (const theme of ["auto", "light", "dark"] as const) {
      const { actionLabel, stateLabel } = themeButtonLabels(theme);
      expect(actionLabel).not.toBe(stateLabel);
    }
  });
});
