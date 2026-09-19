/**
 * The settings feature, end to end: the index, vocabulary, appearance, tags,
 * custom fields, diagnostics, workspaces (create/switch/archive) and the "?"
 * shortcuts sheet.
 *
 * What this proves: every settings screen renders under the e2e stubs, its
 * writes land in helix.json or the workspace database (checked through the
 * harness bridge, not just re-reading the same UI), and switching workspaces
 * actually swaps the open SQLite file.
 *
 * What it cannot prove: anything that is Rust - the real keychain (secret_*
 * calls are only recorded, never actually stored anywhere), the real file
 * copy, or window behaviour. Those belong to tests/e2e-win and the manual
 * checklist.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4189 E2E_OUT=dist-sweep-settings npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/settings.e2e.ts
 */
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, type HelixHarness } from "../fixtures";
import { SETTINGS_SECTIONS } from "../../../src/features/settings/lib/sections";

const SCREENS_DIR = fileURLToPath(new URL("../.cache/screens/sweep-settings/", import.meta.url));

const APP_VERSION = (
  JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

/* -------------------------------------------------------------------------- */
/* Shapes read back out of the e2e shim's in-memory state                     */
/* -------------------------------------------------------------------------- */

type E2EState = {
  files: Record<string, string>;
  calls: { cmd: string; args: unknown }[];
};

type WorkspaceEntryLike = {
  id: string;
  name: string;
  path: string;
  archived: boolean;
};

type HelixRegistryLike = {
  workspaces: WorkspaceEntryLike[];
  lastOpened: string | null;
  theme: string;
  density: string;
};

type DbInfoLike = {
  path: string;
  sizeBytes: number;
  fts5: boolean;
  sqliteVersion: string;
};

/* -------------------------------------------------------------------------- */
/* Navigation helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A deep `page.goto("/settings/...")` 404s: `vite preview` does not fall back
 * to index.html for a path it never built, so every test boots at "/" and
 * clicks through the app the way a person would. That also means each screen
 * is reached exactly the way the sidebar and the settings index reach it.
 */
async function bootApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-overview")).toBeVisible();
}

function sectionLink(page: Page, sectionId: string) {
  return page.locator(`[data-testid="settings-section-link"][data-section="${sectionId}"]`);
}

/** The section list that sits beside every settings screen. */
function navLink(page: Page, sectionId: string) {
  return page.locator(`[data-testid="settings-nav-link"][data-section="${sectionId}"]`);
}

/** From the settings index, open one of this feature's own sections. */
async function openSection(page: Page, sectionId: string): Promise<void> {
  await openSettings(page);
  await sectionLink(page, sectionId).click();
}

/* -------------------------------------------------------------------------- */
/* Reading the e2e shim's state from the page                                 */
/* -------------------------------------------------------------------------- */

async function e2eCalls(page: Page): Promise<{ cmd: string; args: unknown }[]> {
  return page.evaluate(() => (window as unknown as { __helixE2E: E2EState }).__helixE2E.calls);
}

/**
 * helix.json as the app itself wrote it through the fs shim - not the copy
 * fixtures.ts seeded. This is the file the next launch reads, so anything that
 * has to survive a restart (the theme, the workspace list) is checked here.
 */
async function readRegistryFile(page: Page): Promise<HelixRegistryLike> {
  const files = await page.evaluate(
    () => (window as unknown as { __helixE2E: E2EState }).__helixE2E.files,
  );
  const key = Object.keys(files).find((k) => k.endsWith("helix.json"));
  if (!key) throw new Error("helix.json is not in the e2e fs shim yet.");
  return JSON.parse(files[key]) as HelixRegistryLike;
}

/* -------------------------------------------------------------------------- */
/* Workspace helpers shared by the create and archive tests                   */
/* -------------------------------------------------------------------------- */

/**
 * Opens the workspace dialog, creates one, waits for the switch to land, and
 * returns the new workspace's id.
 *
 * The id is read back from the open database's path through the bridge, which
 * is the same better-sqlite3 handle the app itself drives - the most direct
 * proof available that the switch reached the file and not just the UI.
 */
async function createAndSwitchToWorkspace(
  page: Page,
  helix: HelixHarness,
  name: string,
): Promise<string> {
  await page.getByTestId("workspace-new").click();
  await page.getByTestId("workspace-new-name").fill(name);
  await page.getByTestId("workspace-new-create").click();

  // Creating closes the dialog almost immediately; the slow part is the
  // switch (db_close, db_open, migrate, seed) that follows it.
  const row = page.locator(`[data-testid="workspace-row"][data-workspace-name="${name}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toHaveAttribute("data-workspace-open", "true", { timeout: 30_000 });

  const info = (await helix.bridge.call("info", [])) as DbInfoLike;
  const match = /\/workspaces\/([^/\\]+)[/\\]helix\.db$/.exec(info.path);
  if (!match) throw new Error(`could not read a workspace id out of "${info.path}"`);
  return match[1];
}

/* -------------------------------------------------------------------------- */
/* 1. The settings index                                                      */
/* -------------------------------------------------------------------------- */

test("the settings index lists every section, including the ones other features own", async ({
  page,
  // Requesting the fixture (even though this test never touches the bridge
  // directly) is what installs the e2e Tauri/db shim before the app boots -
  // without it the app tries the real Tauri APIs and fails to open its
  // database. Every test in this file must destructure `helix` for that
  // reason, whether or not it also uses helix.bridge/helix.dbPath.
  helix,
}) => {
  void helix;
  await bootApp(page);
  await openSettings(page);

  for (const section of SETTINGS_SECTIONS) {
    await expect(sectionLink(page, section.id), `missing a link for "${section.id}"`).toBeVisible();
  }

  // A couple of the external rows, checked by href, since they point at
  // screens this feature does not own and never will render.
  await expect(sectionLink(page, "stages")).toHaveAttribute("href", "/pipeline");
  await expect(sectionLink(page, "trash")).toHaveAttribute("href", "/trash");

  // Website connection and Backups are built by the leads and data features and
  // mounted under "/settings" by this one, so they are real settings routes
  // rather than a jump out of Settings.
  await expect(sectionLink(page, "site")).toHaveAttribute("href", "/settings/site");
  await expect(sectionLink(page, "backups")).toHaveAttribute("href", "/settings/backups");
});

/* -------------------------------------------------------------------------- */
/* 1b. The section list beside every screen                                   */
/* -------------------------------------------------------------------------- */

test("the section list reaches another section without going back to the index", async ({
  page,
  helix,
}) => {
  void helix; // requesting the fixture installs the e2e shim - see test 1's comment
  await bootApp(page);
  await openSection(page, "workspace");
  await expect(page.getByTestId("settings-workspace")).toBeVisible();

  // Every section is listed, including the two that live in another feature.
  const nav = page.getByTestId("settings-nav");
  await expect(nav).toBeVisible();
  for (const section of SETTINGS_SECTIONS) {
    await expect(navLink(page, section.id), `missing a nav row for "${section.id}"`).toBeVisible();
  }

  // The row for the screen you are on is the selected one, and nothing else is.
  await expect(navLink(page, "workspace").getByRole("link")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

  // And it navigates: appearance, then diagnostics, without touching the index.
  await navLink(page, "appearance").click();
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  await navLink(page, "diagnostics").click();
  await expect(page.getByTestId("settings-diagnostics")).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* 2. Vocabulary                                                              */
/* -------------------------------------------------------------------------- */

test("choosing the Jobs vocabulary updates the preview and is saved to the database", async ({
  page,
  helix,
}) => {
  await bootApp(page);
  await openSection(page, "vocabulary");
  await expect(page.getByTestId("settings-vocabulary")).toBeVisible();

  await page.getByTestId("vocabulary-option-jobs").click();

  const preview = page.getByTestId("vocabulary-preview");
  await expect(preview).toContainText("Jobs");
  await expect(preview).toContainText("New job");

  // NOTE: the sidebar's own "Pipeline" nav label (src/app/Shell.tsx, fed by
  // src/app/registry.ts) is owned by the records/pipeline feature and is not
  // wired to the vocabulary setting yet, so it stays "Pipeline" no matter what
  // is chosen here. That is a real gap, not something this test should paper
  // over - asserting the preview block and the persisted setting is the
  // honest version of "vocabulary changes the label" until that wiring lands.
  await expect.poll(() => {
    const rows = helix.bridge.call("query", [
      "SELECT value_json FROM settings WHERE key = 'vocabulary'",
      [],
    ]) as unknown[][];
    return rows[0]?.[0] ?? null;
  }).toContain("jobs");
});

/* -------------------------------------------------------------------------- */
/* 3. Theme and density                                                       */
/* -------------------------------------------------------------------------- */

test("theme and density set the html attributes and reach helix.json", async ({ page, helix }) => {
  void helix; // requesting the fixture installs the e2e shim - see test 1's comment
  await bootApp(page);
  await openSection(page, "appearance");
  await expect(page.getByTestId("settings-appearance")).toBeVisible();

  const html = page.locator("html");

  await page.getByTestId("theme-dark").click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.getByTestId("density-compact").click();
  await expect(html).toHaveAttribute("data-density", "compact");

  await page.getByTestId("theme-light").click();
  await expect(html).toHaveAttribute("data-theme", "light");

  // The choices reach helix.json itself, which is what the next launch reads.
  const registry = await readRegistryFile(page);
  expect(registry.theme).toBe("light");
  expect(registry.density).toBe("compact");

  // A reload cannot prove persistence in this harness and is not asked to:
  // the fs shim is an in-memory map rebuilt by addInitScript on every page
  // load, so it comes back holding fixtures.ts's seed rather than what the app
  // just wrote. What the reload does prove is that boot reads helix.json and
  // applies what it finds - here, the seeded light/comfortable.
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-density", "comfortable");
});

/* -------------------------------------------------------------------------- */
/* 4. Tags                                                                    */
/* -------------------------------------------------------------------------- */

test("creating a tag adds a row and is saved to the database", async ({ page, helix }) => {
  await bootApp(page);
  await openSection(page, "tags");
  await expect(page.getByTestId("settings-tags")).toBeVisible();

  const tagName = `E2E Tag ${Date.now()}`;
  // The inline create form became the screen's one dialog, so the primary button
  // opens it and the dialog's own button submits.
  await page.getByTestId("tag-add-open").click();
  await page.getByTestId("tag-name-input").fill(tagName);
  await page.getByTestId("tag-add").click();

  await expect(
    page.locator(`[data-testid="tag-row"][data-tag-name="${tagName}"]`),
  ).toBeVisible();

  await expect.poll(() => {
    const rows = helix.bridge.call("query", [
      "SELECT name FROM tags WHERE deleted_at IS NULL",
      [],
    ]) as unknown[][];
    return rows.map((r) => r[0]);
  }).toContain(tagName);
});

/* -------------------------------------------------------------------------- */
/* 5. Custom fields                                                           */
/* -------------------------------------------------------------------------- */

test("creating a custom field adds a row and is saved to the database", async ({
  page,
  helix,
}) => {
  await bootApp(page);
  await openSection(page, "fields");
  await expect(page.getByTestId("settings-fields")).toBeVisible();

  await page.getByTestId("field-add-open").click();
  const fieldName = `E2E Field ${Date.now()}`;
  await page.getByTestId("field-name-input").fill(fieldName);
  await page.getByTestId("field-create").click();

  await expect(
    page.locator(`[data-testid="field-row"][data-field-name="${fieldName}"]`),
  ).toBeVisible();

  await expect.poll(() => {
    const rows = helix.bridge.call("query", [
      "SELECT name FROM custom_fields WHERE deleted_at IS NULL",
      [],
    ]) as unknown[][];
    return rows.map((r) => r[0]);
  }).toContain(fieldName);
});

/* -------------------------------------------------------------------------- */
/* 6. Diagnostics                                                             */
/* -------------------------------------------------------------------------- */

test("diagnostics renders the version, database, FTS5 status and migration under the stubs", async ({
  page,
  helix,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await bootApp(page);
  await openSection(page, "diagnostics");
  const screen = page.getByTestId("settings-diagnostics");
  await expect(screen).toBeVisible();

  await expect(page.getByTestId("diagnostics-copy-log")).toBeVisible();
  await expect(page.getByTestId("diagnostics-reveal")).toBeVisible();

  // The diagnostics query is several async round trips (db info, appPaths,
  // the registry, the migration table, settings, the keychain probe). Wait
  // for the FTS5 badge - only rendered once the query resolves - rather than
  // reading a snapshot of whatever is on screen while it is still loading.
  await expect(page.getByText("Working", { exact: true })).toBeVisible();

  const text = await screen.innerText();
  expect(text, "app version").toContain(APP_VERSION);
  expect(text, "database path").toContain(helix.dbPath);
  expect(text, "a human-readable size").toMatch(/\d+(\.\d+)?\s?(bytes|KB|MB|GB)/);
  expect(text, "the FTS5 badge (the test build's SQLite always has it)").toContain("Working");
  expect(text, "a migration count").toMatch(/\(\d+ applied/);

  // Clicking "Copy log" reaches for the real filesystem, which the e2e stub
  // answers honestly with "not found" rather than a Tauri runtime - the point
  // of this assertion is only that the click does not crash the page.
  await page.getByTestId("diagnostics-copy-log").click();
  await expect(screen).toBeVisible();
  expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
});

/* -------------------------------------------------------------------------- */
/* 7. Create a second workspace and switch to it                              */
/* -------------------------------------------------------------------------- */

test("creating a second workspace switches the open database", async ({ page, helix }) => {
  test.setTimeout(90_000);

  await bootApp(page);
  await openSection(page, "workspaces");
  await expect(page.getByTestId("settings-workspaces")).toBeVisible();

  const secondName = `Second Business ${Date.now()}`;
  const secondId = await createAndSwitchToWorkspace(page, helix, secondName);

  // The bridge is the same object the app's own window.__helixDb calls run
  // through (see fixtures.ts DbBridge + exposeFunction), so once the app
  // switches, this instance is pointed at the new file too: real proof that
  // the database itself switched, not just the screen.
  const info = (await helix.bridge.call("info", [])) as DbInfoLike;
  expect(info.path).not.toBe(helix.dbPath);
  expect(info.path).toContain(secondId);
  expect(info.path).toMatch(/helix\.db$/);

  await expect(page.locator('[data-testid="workspace-row"]')).toHaveCount(2);

  // And helix.json - which is what the next launch reads, since a closed
  // workspace cannot be queried - lists both, with the new one open.
  const registry = await readRegistryFile(page);
  expect(registry.workspaces.map((w) => w.name)).toContain(secondName);
  expect(registry.lastOpened).toBe(secondId);
  const firstRow = page.locator(
    '[data-testid="workspace-row"][data-workspace-name="E2E Workspace"]',
  );
  await expect(firstRow).toHaveAttribute("data-workspace-open", "false");
});

/* -------------------------------------------------------------------------- */
/* 8. Archive the second workspace                                           */
/* -------------------------------------------------------------------------- */

test("archiving a workspace moves it to the Archived block and deletes its secrets", async ({
  page,
  helix,
}) => {
  test.setTimeout(90_000);

  await bootApp(page);
  await openSection(page, "workspaces");
  await expect(page.getByTestId("settings-workspaces")).toBeVisible();

  const firstName = "E2E Workspace"; // seeded by fixtures.ts
  const secondName = `Second Business ${Date.now()}`;
  const secondId = await createAndSwitchToWorkspace(page, helix, secondName);

  // Switch back to the first workspace so the second one is free to archive
  // (WorkspacesScreen refuses to archive the one that is open).
  const firstRow = page.locator(`[data-testid="workspace-row"][data-workspace-name="${firstName}"]`);
  await firstRow.getByTestId("workspace-switch").click();

  // The list the owner is looking at updates in place. It is worth asserting
  // rather than routing around: every db_open clears the whole query cache, so
  // a screen that only invalidated its query after a switch would sit here
  // showing the workspace he just left as the open one (which is what this
  // test caught). The fix is in WorkspacesScreen.refresh().
  await expect(firstRow).toHaveAttribute("data-workspace-open", "true", { timeout: 30_000 });
  await expect(
    page.locator(`[data-testid="workspace-row"][data-workspace-name="${secondName}"]`),
  ).toHaveAttribute("data-workspace-open", "false");

  const secondRow = page.locator(
    `[data-testid="workspace-row"][data-workspace-name="${secondName}"]`,
  );
  await secondRow.getByTestId("workspace-archive").click();
  await page.getByRole("button", { name: "Archive workspace", exact: true }).click();

  // It moves out of "Your workspaces" and into "Archived": the archived row
  // renders a "Restore to the list" button in place of "Switch"/"Archive".
  await expect(secondRow.getByTestId("workspace-unarchive")).toBeVisible({ timeout: 10_000 });

  // And helix.json says so, which is what the switcher reads on the next launch.
  const registryAfter = await readRegistryFile(page);
  expect(registryAfter.workspaces.find((w) => w.name === secondName)?.archived).toBe(true);
  expect(registryAfter.lastOpened).not.toBe(secondId);

  const calls = await e2eCalls(page);
  const deletedKinds = calls
    .filter(
      (c): c is { cmd: string; args: { workspaceId: string; kind: string } } =>
        c.cmd === "secret_delete" &&
        typeof c.args === "object" &&
        c.args !== null &&
        (c.args as { workspaceId?: unknown }).workspaceId === secondId,
    )
    .map((c) => c.args.kind);
  expect(deletedKinds.sort()).toEqual(["anthropic", "site"]);
});

/* -------------------------------------------------------------------------- */
/* 9. "?" opens the shortcuts sheet from anywhere                             */
/* -------------------------------------------------------------------------- */

test('pressing "?" opens the shortcuts sheet, and Escape closes it', async ({ page, helix }) => {
  void helix; // requesting the fixture installs the e2e shim - see test 1's comment
  await bootApp(page);

  // Move focus off of anything that would swallow the keypress as text.
  await page.getByRole("heading", { name: "Today", exact: true, level: 1 }).click();
  await page.keyboard.press("?");

  const sheet = page.getByTestId("shortcuts-sheet");
  await expect(sheet).toBeVisible();
  const rows = sheet.getByTestId("shortcut-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(1);

  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* 10. Screenshots, both themes, every settings screen and overlay            */
/* -------------------------------------------------------------------------- */

test("captures every settings screen in both themes", async ({ page, helix }) => {
  void helix; // requesting the fixture installs the e2e shim - see test 1's comment
  test.setTimeout(180_000);
  mkdirSync(SCREENS_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  await bootApp(page);

  /**
   * A screen is captured full page; an overlay is captured at the viewport,
   * because a dialog is `position: fixed` and a full-page capture of one puts
   * it somewhere that is not where a person sees it.
   */
  async function shoot(name: string, fullPage = true): Promise<void> {
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.screenshot({ path: `${SCREENS_DIR}${name}-${theme}.png`, fullPage });
    }
    // Leave it as the app found it before moving on.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  }

  // Every route reachable from the index, including the two screens other
  // features build and this one mounts ("site", "backups").
  const routes: { section: string; sectionId: string | null }[] = [
    { section: "overview", sectionId: null },
    { section: "workspace", sectionId: "workspace" },
    { section: "vocabulary", sectionId: "vocabulary" },
    { section: "tags", sectionId: "tags" },
    { section: "fields", sectionId: "fields" },
    { section: "appearance", sectionId: "appearance" },
    { section: "shortcuts", sectionId: "shortcuts" },
    { section: "workspaces", sectionId: "workspaces" },
    { section: "diagnostics", sectionId: "diagnostics" },
    { section: "site", sectionId: "site" },
    { section: "backups", sectionId: "backups" },
  ];

  for (const route of routes) {
    if (route.sectionId) {
      await openSection(page, route.sectionId);
    } else {
      await openSettings(page);
    }

    // Wait for the screen's own content, not just its frame: Workspace,
    // Workspaces, AI, Diagnostics, Backups and the site connection each read
    // something asynchronously and show a "Reading…" line first, and a capture
    // of that line tells us nothing about the design.
    await expect(
      page.locator('p[role="status"]').filter({ hasText: /^Reading/ }),
    ).toHaveCount(0);

    await shoot(route.section);
  }

  // The two overlays. The shortcuts sheet is on "?" from anywhere; the
  // workspace switcher is a palette command, which is the only handle on it
  // until the sidebar footer opens it (docs/STATUS.md).
  await openSettings(page);
  await page.getByRole("heading", { name: "Settings", exact: true, level: 1 }).click();
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcuts-sheet")).toBeVisible();
  await shoot("shortcuts-sheet", false);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts-sheet")).not.toBeVisible();

  await page.keyboard.press("Meta+Shift+k");
  const switchCommand = page.locator("[cmdk-item]", { hasText: "Switch workspace" });
  await expect(switchCommand).toBeVisible();
  await switchCommand.click();
  await expect(page.getByTestId("workspace-picker")).toBeVisible();
  await shoot("workspace-switcher", false);
  await page.keyboard.press("Escape");
});
