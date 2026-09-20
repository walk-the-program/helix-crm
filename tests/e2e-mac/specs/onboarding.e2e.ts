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

// Round 3 criterion 17 (docs/rounds/2026-09-20-round-3.md): equal trade tiles,
// no sources step, and public website wording. Screenshots for these go
// beside the design review's own files rather than into the e2e cache, the
// same way tests/e2e-mac/specs/hig.e2e.ts writes into design/hig/.
const ROUND3_SHOTS = fileURLToPath(new URL("../../../design/round3/", import.meta.url));
mkdirSync(ROUND3_SHOTS, { recursive: true });

const LANDSCAPING_STAGES = [
  "New lead",
  "Walked the property",
  "Estimate sent",
  "Scheduled",
  "Work done",
  "Paid",
  "Lost",
];

/**
 * Flip the theme and wait for it to finish arriving.
 *
 * Buttons and tiles in src/ui carry `transition-colors`, so the frame right
 * after `data-theme` changes is the OLD colour: a capture taken in the same
 * tick photographs the light theme wearing a dark label. Wait for the canvas
 * to actually change, then give the slowest transition room to land.
 */
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

/** Light and dark, at the width docs/DESIGN.md's review pass asks for. */
async function shoot(page: Page, name: string, dir: string = SCREENS): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await settleTheme(page, theme);
    await page.screenshot({ path: `${dir}${name}-${theme}.png`, fullPage: true });
  }
  await settleTheme(page, "light");
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

    // The sidebar row itself now follows the vocabulary the preset wrote: a
    // landscaping workspace calls the work jobs, in the sidebar and on the
    // screen. There is no "Pipeline" row left to click.
    await expect(sidebar.getByRole("link", { name: "Pipeline" })).toHaveCount(0);
    await sidebar.getByRole("link", { name: "Jobs" }).click();
    await expect(page.getByRole("heading", { name: "Jobs", exact: true, level: 1 })).toBeVisible();
    for (const stage of ["New lead", "Estimate sent", "Paid"]) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }

    // F-CS-6: a board card names the customer, the value and the next step
    // and nothing else, so a made-up job looks exactly like a real one. The
    // board itself has to say which is which while the example set is in.
    await expect(page.getByTestId("sample-data-note")).toBeVisible();

    /* -- and the example comes back out ---------------------------------- */

    // Through the command palette. Settings' Workspace section and Today both
    // carry the button as well, but the command is the one path that works from
    // any screen, which is what makes it worth asserting here.
    await page.keyboard.press("Meta+Shift+K");
    await page.getByPlaceholder("Search, or type a command").fill("Remove sample data");
    await page.getByRole("option", { name: "Remove sample data" }).first().click();

    await expect(
      page.getByRole("heading", { name: "Remove the sample data?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Remove it" }).click();

    // ...and the board stops saying it, because there is nothing left to warn
    // about. A marker that outlives the thing it marks is its own bug.
    await expect(page.getByTestId("sample-data-note")).toHaveCount(0);

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

  test("trade tiles are equal height, the sources step is gone, and the website wording is public", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.setViewportSize({ width: 1280, height: 900 });

    /* -- screen 1: every trade tile is the same height, hint or no hint ---- */

    const tradeGroup = page.getByRole("group", { name: "What kind of work" });
    const tiles = tradeGroup.getByRole("button");
    await expect(tiles).toHaveCount(10);

    for (const theme of ["light", "dark"] as const) {
      await settleTheme(page, theme);
      const heights = await tiles.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      );
      expect(heights).toHaveLength(10);
      const [first, ...rest] = heights;
      for (const height of rest) {
        expect(Math.abs(height - first)).toBeLessThanOrEqual(1);
      }
    }
    await settleTheme(page, "light");

    await page.getByLabel("What is the business called?").fill("Alpine Ridge Landscape");
    await page.getByRole("button", { name: "Landscaping", exact: true }).click();
    await shoot(page, "onboarding-1", ROUND3_SHOTS);

    await page.getByRole("button", { name: "Continue" }).click();

    /* -- screen 2: no "Where the work comes from", no "Add a source" ------- */

    await expect(
      page.getByRole("heading", { name: "How you'll track work", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Where the work comes from")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add a source" })).toHaveCount(0);
    // The rest of the screen is still here: stages, vocabulary, custom fields.
    await expect(page.getByRole("button", { name: "Add a stage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a detail" })).toBeVisible();

    await shoot(page, "onboarding-2", ROUND3_SHOTS);

    await page.getByRole("button", { name: "Use this setup" }).click();

    /* -- the preset's sources were still written, silently ----------------- */

    await expect(
      page.getByRole("heading", { name: "Bring your customers in", level: 1 }),
    ).toBeVisible();
    const sourceCount = Number(
      helix.bridge.query("SELECT count(*) FROM sources", [])[0][0],
    );
    expect(sourceCount).toBe(4); // landscaping.ts ships Website, Referral, Drive-by, Repeat customer.

    /* -- screen 3: the website card speaks to any owner, not just ClearPath */

    await expect(
      page.getByText(
        "Leads from your website land here on their own. ClearPath sites work straight away; Help covers any other site.",
      ),
    ).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  /*
   * F-LC-19, the hypothesis the audit could not settle.
   *
   * `OnboardingFlow` resolves the stored profile and the workspace's existing
   * name asynchronously and then calls `setDraft` wholesale. If the step-1
   * form is on screen before that lands, an owner who starts typing
   * immediately could have his business name replaced by the default. Three
   * runs of the audit spec stalled with the prefilled name still in the box,
   * which is a symptom, not a proof — so this types into the field the instant
   * it exists and checks the typing survives.
   */
  test("typing the business name immediately is not overwritten by the prefill", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    // No settle, no networkidle: the point is to race the prefill.
    const field = page.getByLabel("What is the business called?");
    await field.waitFor({ state: "visible" });
    await field.fill("Alpine Ridge Landscape");

    // Long enough for any late setDraft to land on top of the typing.
    await page.waitForTimeout(1_500);
    await expect(
      field,
      "the async prefill overwrote what the owner had already typed",
    ).toHaveValue("Alpine Ridge Landscape");

    // And it is what gets saved, not the default it started from.
    await page.getByRole("button", { name: "Landscaping", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", { name: "How you'll track work", level: 1 }),
    ).toBeVisible();

    const stored = helix.bridge.query(
      "SELECT value_json FROM settings WHERE key = 'workspaceName'",
      [],
    );
    expect(String(stored[0]?.[0] ?? "")).toContain("Alpine Ridge Landscape");

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

    // LR-6: skipping setup is still a fresh workspace, and the recovery-key
    // card does not care which of the two ways out of onboarding got here.
    await expect(page.getByRole("heading", { name: "Save your recovery key" })).toBeVisible();

    const skipped = helix.bridge.query(
      "SELECT value_json FROM settings WHERE key = 'onboarding.skippedAt'",
      [],
    );
    expect(skipped).toHaveLength(1);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toHaveCount(0);
    // Still unconfirmed, so it survives the reload too.
    await expect(page.getByRole("heading", { name: "Save your recovery key" })).toBeVisible();

    // And it is still reachable on purpose.
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  /**
   * LR-6 (F-OPS-1's second half): a fresh workspace cannot reach a steady
   * state without the owner having seen the recovery key and confirmed they
   * kept it. `RecoveryKeyPanel` in Settings > Backups is not enough on its
   * own — a client may never open Settings — so this proves the card on
   * Today itself: not in the DOM before it is asked for, the confirm control
   * gated on an actual reveal-and-keep, one primary block while it is
   * showing, and gone for good — through a reload — once confirmed.
   */
  test("the recovery-key card owns Today until the key is revealed and kept, then never returns", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toBeVisible();
    await page.getByLabel("What is the business called?").fill("Alpine Ridge Landscape");
    await page.getByRole("button", { name: "Landscaping", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", { name: "How you'll track work", level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Use this setup" }).click();
    await expect(
      page.getByRole("heading", { name: "Bring your customers in", level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start empty" }).click();

    /* -- a completed setup, a still-empty workspace, and the card on top -- */

    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Save your recovery key" })).toBeVisible();
    // FirstRun is still underneath it - completing setup with "Start empty"
    // leaves the workspace with no rows at all.
    await expect(page.getByRole("heading", { name: /Nothing here yet/ })).toBeVisible();

    // Not in the DOM before it is asked for.
    await expect(page.getByTestId("recovery-key")).toHaveCount(0);

    // The card owns the screen's one primary block while it is showing, so
    // "Import a CSV" reads as the secondary (white) treatment underneath it.
    const importLink = page.getByRole("link", { name: "Import a CSV" });
    // The secondary treatment carries the hairline border the primary one
    // never does; checked by class rather than a computed colour so it does
    // not depend on which theme this run happens to be in.
    await expect(importLink).toHaveClass(/border-\[var\(--color-border-strong\)\]/);

    const confirm = page.getByRole("button", { name: "I have saved it" });
    await expect(confirm).toHaveCount(0);

    await page.getByRole("button", { name: "Show recovery key" }).click();
    const keyEl = page.getByTestId("recovery-key");
    await expect(keyEl).toBeVisible();
    await expect(keyEl).not.toHaveText("");

    // Revealed, but nothing kept yet: still disabled.
    await expect(confirm).toBeDisabled();

    // "Save to a file" through the same stubbed dialog backups.e2e.ts uses.
    await page.evaluate((path) => {
      const state = (
        window as unknown as { __helixE2E: { dialogQueue: (string | null)[] } }
      ).__helixE2E;
      state.dialogQueue.push(path);
    }, "/e2e/recovery/alpine-ridge-key.txt");
    await page.getByRole("button", { name: "Save to a file" }).click();
    await expect(page.getByText("Recovery key saved.")).toBeVisible();

    await expect(confirm).toBeEnabled();
    await confirm.click();

    /* -- gone for good, even across a reload ------------------------------ */

    await expect(page.getByRole("heading", { name: "Save your recovery key" })).toHaveCount(0);
    // The card is gone, so "Import a CSV" is the screen's one primary block
    // again: the accent fill, no hairline border.
    await expect(importLink).toHaveClass(/bg-\[var\(--color-accent\)\]/);
    await expect(importLink).not.toHaveClass(/border-\[var\(--color-border-strong\)\]/);

    const confirmedRow = helix.bridge.query(
      "SELECT value_json FROM settings WHERE key = 'recoveryKey.confirmedAt'",
      [],
    );
    expect(confirmedRow).toHaveLength(1);
    expect(JSON.parse(String(confirmedRow[0][0]))).not.toBeNull();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Save your recovery key" })).toHaveCount(0);

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
});

test.describe("the public website endpoint, documented", () => {
  // Default fixtures skip onboarding, so this goes straight to the shell.

  // `helix` binds the database bridge and pre-seeds helix.json before the app
  // boots (see tests/e2e-mac/specs/hig.e2e.ts's own note on this fixture);
  // leave it out of the signature and the app has nowhere to read from and
  // never renders.
  test("Help explains the endpoint a non-ClearPath site answers", async ({ page, helix }) => {
    expect(helix.dbPath).toContain("helix.db");
    await page.goto("/help");
    await expect(
      page.getByRole("heading", { name: "Connecting a site Helix didn't build" }),
    ).toBeVisible();
    await expect(
      page.getByText("GET /api/crm/leads", { exact: false }),
    ).toBeVisible();
  });
});
