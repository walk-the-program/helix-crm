/**
 * The first run, end to end.
 *
 * What this proves: a brand-new workspace opens on setup rather than on an empty
 * shell; the three screens write a real pipeline in the trade's own words; the
 * sample set fills Today; and "Remove sample data" takes every row of it back
 * out and leaves Today empty again.
 *
 * `test.use({ onboarding: "show" })` is what lets the gate fire. Every other
 * spec in this folder starts from an empty workspace and expects the shell, so
 * the harness defaults to "already skipped" (see tests/e2e-mac/fixtures.ts).
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4196 E2E_OUT=dist-onb npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/onboarding.e2e.ts
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/onboarding/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });

const LANDSCAPING_STAGES = [
  "New lead",
  "Walked the property",
  "Estimate sent",
  "Scheduled",
  "Work done",
  "Paid",
  "Lost",
];

/** Light and dark, at the width docs/DESIGN.md's review pass asks for. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    // Buttons and tiles carry `transition-colors`, so a capture taken the
    // instant the attribute flips catches them mid-fade.
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SCREENS}${name}-${theme}.png`, fullPage: true });
  }
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });
  await page.waitForTimeout(150);
}

function count(helix: HelixHarness, table: string): number {
  return Number(helix.bridge.query(`SELECT count(*) FROM ${table}`, [])[0][0]);
}

test.describe("first run", () => {
  test.use({ onboarding: "show" });

  test("sets up a landscaping business, loads the example, and takes it out again", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    /* -- screen 1 -------------------------------------------------------- */

    await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toBeVisible();
    // The shell is not behind it: no sidebar until setup is done or skipped.
    await expect(page.getByRole("navigation")).toHaveCount(0);

    const name = page.getByLabel("What is the business called?");
    await expect(name).toBeVisible();
    await name.fill("Alpine Ridge Landscape");
    await page.getByLabel("Your name").fill("Dave Tracy");
    await page.getByLabel("Your email").fill("dave@alpineridge.example");
    await page.getByLabel("Your phone").fill("(801) 555-0134");
    await page.getByRole("button", { name: "Landscaping", exact: true }).click();

    await shoot(page, "screen-1-business");

    await page.getByRole("button", { name: "Continue" }).click();

    /* -- screen 2 -------------------------------------------------------- */

    await expect(
      page.getByRole("heading", { name: "How you'll track work", level: 1 }),
    ).toBeVisible();

    // The preset arrives in the trade's words, editable, with quiet days on it.
    const stageNames = page.getByRole("textbox", { name: "Stage name" });
    await expect(stageNames).toHaveCount(LANDSCAPING_STAGES.length);
    for (const [index, stage] of LANDSCAPING_STAGES.entries()) {
      await expect(stageNames.nth(index)).toHaveValue(stage);
    }
    // Jobs, because landscaping sells work a crew turns up and does.
    await expect(page.getByRole("button", { name: "Jobs", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await shoot(page, "screen-2-tracking");

    await page.getByRole("button", { name: "Use this setup" }).click();

    /* -- screen 3 -------------------------------------------------------- */

    await expect(
      page.getByRole("heading", { name: "Bring your customers in", level: 1 }),
    ).toBeVisible();
    await shoot(page, "screen-3-customers");

    // The pipeline is already written by this point: the apply is one
    // transaction, and screen 3 only decides what goes into it.
    const stageRows = helix.bridge.query(
      "SELECT name FROM stages WHERE deleted_at IS NULL ORDER BY position",
      [],
    );
    expect(stageRows.map((r) => String(r[0]))).toEqual(LANDSCAPING_STAGES);
    expect(count(helix, "custom_fields")).toBe(3);

    await page.getByRole("button", { name: /Show me an example/ }).click();

    /* -- Today, full of a week's work ------------------------------------ */

    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    const sidebar = page.getByRole("navigation");
    await expect(sidebar).toBeVisible();
    await expect(page.locator('[data-today-section="due-now"]')).toBeVisible();
    // One of the two overdue tasks the landscaping example ships with.
    await expect(
      page.getByText("Call Marla before the Tuesday board meeting").first(),
    ).toBeVisible();

    expect(count(helix, "contacts")).toBe(16);
    expect(count(helix, "companies")).toBe(8);
    expect(count(helix, "deals")).toBe(10);
    expect(count(helix, "tasks")).toBe(8);

    /* -- the product now speaks landscaping ------------------------------ */

    await sidebar.getByRole("link", { name: "Pipeline" }).click();
    // The pipeline screen takes its title from the vocabulary the preset wrote.
    await expect(page.getByRole("heading", { name: "Jobs", exact: true, level: 1 })).toBeVisible();
    for (const stage of ["New lead", "Estimate sent", "Paid"]) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }

    /* -- and the example comes back out ---------------------------------- */

    // Through the command, because the button belongs to Settings' Workspace
    // section and Today's first-run card, and neither is on screen with a
    // workspace this full.
    await page.keyboard.press("Meta+Shift+K");
    await page.getByPlaceholder("Search, or type a command").fill("Remove sample data");
    await page.getByRole("option", { name: "Remove sample data" }).first().click();

    await expect(
      page.getByRole("heading", { name: "Remove the sample data?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Remove it" }).click();

    await sidebar.getByRole("link", { name: "Today" }).click();
    await expect(page.getByRole("heading", { name: /Nothing here yet/ })).toBeVisible();

    for (const table of ["contacts", "companies", "deals", "activities", "tasks", "tags"]) {
      expect(count(helix, table), `${table} should be empty again`).toBe(0);
    }
    // The setup itself survived: only the example went.
    expect(count(helix, "stages")).toBe(LANDSCAPING_STAGES.length);
    expect(count(helix, "custom_fields")).toBe(3);

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("skipping goes to Today and setup does not come back on reload", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();

    const skipped = helix.bridge.query(
      "SELECT value_json FROM settings WHERE key = 'onboarding.skippedAt'",
      [],
    );
    expect(skipped).toHaveLength(1);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toHaveCount(0);

    // And it is still reachable on purpose.
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
});
