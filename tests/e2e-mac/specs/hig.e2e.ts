/**
 * The macOS layout, photographed.
 *
 * Every other spec in this folder runs with `VITE_E2E` set, which used to make
 * `isMacOS()` return false unconditionally — so the whole shipped screenshot
 * set was an accurate record of the *web* layout and of nothing a Mac owner
 * ever sees. The one place where the traffic lights could land on the Helix
 * lockup was therefore the one place the suite could not photograph
 * (design/apple-hig-review.md, the note above finding 1).
 *
 * This spec is the way back in. It sets `window.__helixPlatform = "macos"`
 * before the app boots, which `isMacOS()` reads under `VITE_E2E` and nowhere
 * else, and then proves two things and photographs one:
 *
 *  - `data-platform="macos"` reaches <html>, so the stylesheet's rule applies.
 *  - the sidebar's brand slot really is padded out of the traffic lights' way,
 *    measured rather than assumed — the review found the attribute stamped and
 *    the CSS rule missing, and a passing attribute check would have hidden it.
 *  - the top of the sidebar, light and dark, into design/hig/ for a person to
 *    look at against the brand.
 *
 * It cannot prove the drag region: `data-tauri-drag-region` means nothing
 * without Tauri under the page, so all this can show is that the attribute is
 * on the two elements that carry it. The window actually moving is a manual
 * check and belongs on the checklist.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

const SHOTS = fileURLToPath(new URL("../../../design/hig/", import.meta.url));

/** The 38px `--titlebar-inset`, which is what the traffic lights need. */
const TITLEBAR_INSET = 38;

async function settleTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
  await page
    .waitForFunction(
      (previous) => getComputedStyle(document.body).backgroundColor !== previous,
      before,
      { timeout: 2_000 },
    )
    .catch(() => {
      // Already on that theme: nothing transitions and nothing is wrong.
    });
  await page.waitForTimeout(250);
}

test.describe("the macOS layout", () => {
  /**
   * `helix` is named in every signature below even where the body never
   * mentions it: Playwright builds a fixture only when a test asks for it, and
   * that fixture is what binds the database bridge and pre-seeds helix.json.
   * Leave it out and the app boots with nowhere to read from and renders
   * nothing at all.
   */
  test.beforeEach(async ({ page, helix }) => {
    expect(helix.dbPath).toContain("helix.db");
    // Before any of the app's own code runs, so `applyPlatform()` sees it.
    await page.addInitScript(() => {
      window.__helixPlatform = "macos";
    });
  });

  test("the traffic lights have their 38px and the lockup sits below them", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    await expect(page.locator("html")).toHaveAttribute("data-platform", "macos");

    const inset = page.locator("[data-titlebar-inset]");
    await expect(inset).toBeVisible();

    // Measured, not assumed. The review's finding was that the attribute was
    // stamped and the stylesheet rule that pays for it did not exist, so the
    // assertion has to be about computed pixels.
    const paddingTop = await inset.evaluate(
      (node) => Number.parseFloat(getComputedStyle(node).paddingTop),
    );
    expect(paddingTop).toBe(TITLEBAR_INSET);

    // And the mark itself starts below the button strip, which is the thing
    // the owner would actually see go wrong.
    const markTop = await page
      .getByRole("navigation")
      .locator("xpath=../*[@data-titlebar-inset]//*[local-name()='svg' or self::img]")
      .first()
      .evaluate((node) => node.getBoundingClientRect().top)
      .catch(() => null);
    if (markTop !== null) expect(markTop).toBeGreaterThanOrEqual(TITLEBAR_INSET - 1);
  });

  test("the chrome is still what the window is dragged by", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    // The two elements the shell marks: the sidebar's brand slot and the top
    // bar. Tauri is not under the page, so this is the attribute and not the
    // behaviour; the window actually moving is on the manual checklist.
    const regions = page.locator("[data-tauri-drag-region]");
    await expect(regions).toHaveCount(2);

    // A drag region is chrome, so nothing in it is selectable, whatever the
    // content rules say.
    for (const region of await regions.all()) {
      const userSelect = await region.evaluate(
        (node) => getComputedStyle(node).webkitUserSelect || getComputedStyle(node).userSelect,
      );
      expect(userSelect).toBe("none");
    }
  });

  test("screenshots: the top of the sidebar, light and dark", async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    for (const theme of ["light", "dark"] as const) {
      await settleTheme(page, theme);
      // The top-left corner at full scale: the traffic-light strip, the inset
      // and the lockup, which is the whole of what finding 1 was about.
      await page.screenshot({
        path: `${SHOTS}sidebar-macos-${theme}.png`,
        clip: { x: 0, y: 0, width: 420, height: 160 },
      });
    }
    await settleTheme(page, "light");
  });
});

test.describe("the plain layout", () => {
  test("is what every other spec still gets", async ({ page, helix }) => {
    expect(helix.dbPath).toContain("helix.db");
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    // No opt-in, no macOS layout: the harness default is unchanged, so the
    // rest of the screenshot set stays comparable with what came before.
    await expect(page.locator("html")).not.toHaveAttribute("data-platform", "macos");
    const paddingTop = await page
      .locator("[data-titlebar-inset]")
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingTop));
    expect(paddingTop).toBeLessThan(TITLEBAR_INSET);
  });
});
