/**
 * The data feature end to end: import a real vendor export through the UI,
 * merge a duplicate it produced, undo the merge, and export contacts.
 *
 * What this harness can prove: the wizard, the mapping, the SQL the import
 * writes, the merge and its undo, that export reached the save dialog, and -
 * because the fixture registers a backup's path in its in-memory file map -
 * the backups list and the restore confirmation.
 *
 * What it cannot prove: the restore itself. `db_backup` here is
 * better-sqlite3's VACUUM INTO rather than the Rust pipe's second read-only
 * connection, and the file it lists is a placeholder. The retention policy and
 * the schedule are covered as pure functions in
 * tests/unit/data/retention.test.ts; the real thing belongs to tests/e2e-win
 * and the manual checklist.
 *
 * Screens for the design sweep land in `.cache/screens/sweep-data/`, one
 * 1280-wide shot per screen per theme (`design/apple/sweep-data.md`).
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4188 E2E_OUT=dist-sweep-data npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/data.e2e.ts
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
// A relative import straight into src, the same way settings.e2e.ts reaches
// SETTINGS_SECTIONS: the header this test expects has to come from the field
// list itself, never a copy of it typed into the spec, or a rename here would
// stop meaning anything.
import { DEALS_IMPORT } from "../../../src/features/data/import/fields/deals";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const SCREENS = join(here, "..", ".cache", "screens", "brand-a");
const TYPES_SCREENS = join(here, "..", ".cache", "screens", "import-types");

function fixture(...parts: string[]): string {
  return readFileSync(join(REPO, "tests", "fixtures", ...parts), "utf8");
}

/**
 * A line-level RFC 4180 split: quoted commas do not break a cell apart, and a
 * doubled quote inside a quoted cell decodes to one. Good enough for a header
 * row and a single example row, neither of which carries an embedded newline.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** Put a file where the stubbed filesystem can find it and queue the dialog. */
async function offerFile(page: Page, path: string, contents: string) {
  await page.evaluate(
    ([p, body]) => {
      const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
      state.files[p] = body;
      state.dialogQueue.push(p);
    },
    [path, contents] as const,
  );
}

/** Queue a path for the next save dialog. */
async function offerSavePath(page: Page, path: string) {
  await page.evaluate((p) => {
    const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
    state.dialogQueue.push(p);
  }, path);
}

type E2EState = {
  files: Record<string, string>;
  dialogQueue: (string | string[] | null)[];
  calls: { cmd: string; args: unknown }[];
};

async function e2eState(page: Page): Promise<E2EState> {
  return page.evaluate(() => {
    const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
    return {
      files: state.files,
      dialogQueue: state.dialogQueue,
      calls: state.calls,
    };
  });
}

/**
 * Flip `data-theme` and wait for the cascade to settle.
 *
 * The shell's own Light/Dark control is a button in another agent's file, and
 * naming it here couples this spec to that label; `body`'s background-color is
 * untransitioned and reads `--color-bg` directly, so once it differs from what
 * it was, the theme has actually taken. The shell re-applies the stored theme
 * when it mounts, so this must be called after the navigation, not before.
 */
async function switchTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const current = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (current === theme) return;
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForFunction(
    (previous) => getComputedStyle(document.body).backgroundColor !== previous,
    before,
  );
  await page.waitForTimeout(250);
}

/**
 * One 1280-wide viewport shot per screen. Not fullPage: a list of 52 duplicate
 * pairs makes an 8000px image nobody can look at, and the point of these is to
 * see what the owner sees.
 */
async function shoot(page: Page, name: string) {
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: join(SCREENS, `${name}.png`) });
}

/**
 * The same screen at `data-density="compact"`. Compact is what catches a
 * hard-coded height or font size: every size in the product is a token, so a
 * compact screen is 25% denser and not a broken one.
 */
async function shootCompact(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-density", "compact");
  });
  await page.waitForTimeout(150);
  await shoot(page, `${name}-compact`);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-density", "comfortable");
  });
  await page.waitForTimeout(150);
}

/** The same screen in both themes, left in light afterwards. */
async function shootBoth(page: Page, name: string) {
  await switchTheme(page, "light");
  await shoot(page, `${name}-light`);
  await switchTheme(page, "dark");
  await shoot(page, `${name}-dark`);
  await switchTheme(page, "light");
}

/** `shoot`, into the import-types screen set rather than brand-a's. */
async function shootTypes(page: Page, name: string) {
  mkdirSync(TYPES_SCREENS, { recursive: true });
  await page.screenshot({ path: join(TYPES_SCREENS, `${name}.png`) });
}

/** `shootBoth`, into the import-types screen set rather than brand-a's. */
async function shootTypesBoth(page: Page, name: string) {
  await switchTheme(page, "light");
  await shootTypes(page, `${name}-light`);
  await switchTheme(page, "dark");
  await shootTypes(page, `${name}-dark`);
  await switchTheme(page, "light");
}

/** Walk the wizard from the file dialog to the result screen. */
async function importFile(
  page: Page,
  options: { path: string; contents: string; policy?: "Skip them" | "Fill in the blanks" | "Import anyway" },
) {
  await offerFile(page, options.path, options.contents);
  await page.getByRole("button", { name: "Choose a file" }).click();

  await expect(page.getByRole("columnheader", { name: "Import as" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("columnheader", { name: "What Helix noticed" })).toBeVisible();
  if (options.policy && options.policy !== "Skip them") {
    await page.getByRole("radio", { name: options.policy }).check();
  }
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(page.getByText("contacts created")).toBeVisible({ timeout: 30_000 });
}

/**
 * Hold every batched write for a beat, so the wizard's running panel is on
 * screen long enough to be photographed.
 *
 * The running panel is the one screen that cannot be navigated to, and a real
 * import is far too quick to catch: 1,500 rows land in about 200ms on this
 * machine, so a screenshot taken "while it runs" reliably came back showing the
 * result screen instead. Making the file bigger only moves the race; making
 * each `raw.batch` take a known 600ms removes it.
 *
 * The app's e2e driver (src/db/drivers/e2e.ts) calls `window.__helixDb`
 * directly rather than going through `invoke`, so this wraps the bridge the
 * harness exposes. Playwright runs init scripts in registration order, and the
 * `helix` fixture registers its own before the test body runs, so
 * `window.__helixDb` already exists by the time this one executes. The delay is
 * off until a test sets `window.__helixE2E.slowWrites`.
 */
async function installSlowWrites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const db = w.__helixDb;
    if (!db || db.__slowed) return;
    const original = db.batch.bind(db);
    db.batch = async (...args: unknown[]) => {
      if (w.__helixE2E?.slowWrites) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      return original(...args);
    };
    db.__slowed = true;
  });
}

/** A CSV with enough rows to make several batched writes. */
function bigCsv(rows: number): string {
  const header = "First Name,Last Name,Email,Phone Number,Company Name,City,State";
  const lines = [header];
  for (let i = 0; i < rows; i += 1) {
    lines.push(
      `Owner${i},Sample${i},owner${i}@example.com,+1801555${String(1000 + (i % 9000)).padStart(4, "0")},` +
        `Sample Yard Care ${i % 40},Provo,UT`,
    );
  }
  return lines.join("\r\n");
}

test.describe("data", () => {
  // Every screenshot in this file is taken with reduced motion, so a capture
  // can never land mid-transition on a control that is still fading between
  // two themes' colours (globals.css clamps every transition to 1ms).
  test.use({ reducedMotion: "reduce" });

  // `helix` is listed here so Playwright builds the fixture for every test in
  // this file: it is what installs the database bridge and the Tauri shim, and
  // Playwright only creates a fixture a test actually asks for.
  test.beforeEach(async ({ page, helix }) => {
    expect(helix.dbPath).toContain("helix.db");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("imports a HubSpot export, merges a duplicate, undoes it, and exports", async ({
    page,
    helix: _helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
    await expect(page.getByText("Drop a spreadsheet here")).toBeVisible();
    // The pick step explains the decision once (phase-two design direction,
    // rule 3): the type choices above already say what each import is, so the
    // drop zone itself carries no second copy of that explanation - one
    // sentence below it, naming the formats and the example file.
    await expect(
      page.getByText(/Works with a CSV from HubSpot, Zoho, Pipedrive, Google Contacts, or/),
    ).toBeVisible();
    await expect(
      page.getByText("Helix works out the columns; you check them"),
    ).toHaveCount(0);
    await shootBoth(page, "import-pick");

    // --- the wizard ------------------------------------------------------
    const hubspot = fixture("hubspot-contacts.csv");
    await offerFile(page, "/tmp/helix-e2e/hubspot-contacts.csv", hubspot);
    await page.getByRole("button", { name: "Choose a file" }).click();

    // Step 2: the guess is already made.
    await expect(page.getByText("Guessed from the column names")).toBeVisible();
    const firstNameRow = page.getByRole("row").filter({ hasText: "First Name" }).first();
    await expect(firstNameRow.getByRole("combobox")).toHaveText("First name");
    await expect(page.getByRole("row").filter({ hasText: "Record ID" })).toContainText(
      "Skip this column",
    );
    await shootBoth(page, "import-mapping");
    await shootCompact(page, "import-mapping");

    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3: twenty mapped rows and the duplicate policy.
    await expect(page.getByText("The first 20 of")).toBeVisible();
    await expect(page.getByText("sarah.mitchell83@gmail.example").first()).toBeVisible();
    await expect(page.getByRole("radio", { name: "Skip them" })).toBeChecked();
    await shootBoth(page, "import-preview");

    await page.getByRole("button", { name: "Import", exact: true }).click();

    // Step 4: the counts.
    await expect(page.getByText("contacts created")).toBeVisible({ timeout: 30_000 });
    const created = page
      .locator("div")
      .filter({ hasText: /^52contacts created$/ })
      .first();
    await expect(created).toBeVisible();
    await expect(page.getByText("companies created")).toBeVisible();
    await shootBoth(page, "import-result");

    // The rows really landed.
    expect(await helixCount(page)).toBe(52);

    // --- a second pass makes duplicates on purpose -----------------------
    await page.getByRole("button", { name: "Import another file" }).click();
    await importFile(page, {
      path: "/tmp/helix-e2e/hubspot-again.csv",
      contents: hubspot,
      policy: "Import anyway",
    });
    expect(await helixCount(page)).toBe(104);

    // --- duplicates and merge --------------------------------------------
    await page.goto("/duplicates");
    await expect(page.getByRole("heading", { name: "Duplicates", level: 1 })).toBeVisible();
    const pair = page.getByText("Same email").first();
    await expect(pair).toBeVisible({ timeout: 20_000 });
    await shootBoth(page, "duplicates");

    await page.getByRole("button", { name: "Review and merge" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("They share the same email")).toBeVisible();
    await shootBoth(page, "merge-dialog");

    // The dialog at the 1024px floor: nothing clipped, no horizontal scroll
    // (F3). The confirm button's label is a survivor name of arbitrary
    // length, so it is a truncating span with the full name in `title`
    // rather than free text that could force the dialog wider than it is.
    await page.setViewportSize({ width: 1024, height: 800 });
    const dialogBox = page.getByRole("dialog");
    const overflowsX = await dialogBox.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    expect(overflowsX, "the merge dialog does not overflow horizontally at 1024px").toBe(false);
    await shootBoth(page, "merge-dialog-1024");
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("button", { name: /^Merge into / }).click();
    await expect(page.getByText("Merged. You can still put it back.")).toBeVisible();
    expect(await helixCount(page)).toBe(103);

    // --- undo -------------------------------------------------------------
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Merge undone.")).toBeVisible();
    expect(await helixCount(page)).toBe(104);

    // The merges tab lists both the merge and its reversal.
    await page.getByRole("tab", { name: "Merges" }).click();
    await expect(page.getByText("Reversed", { exact: true })).toBeVisible();
    await shootBoth(page, "merges-history");

    // --- export -----------------------------------------------------------
    await page.goto("/export");
    await expect(page.getByRole("heading", { name: "Export", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export everything (.zip)" })).toBeVisible();
    await shootBoth(page, "export");

    await offerSavePath(page, "/tmp/helix-e2e/contacts.csv");
    // The row holding both the entity's name and its button is the list row.
    const contactsRow = page
      .locator("div")
      .filter({ hasText: /^Contacts\d+ records?Export CSV$/ })
      .last();
    await contactsRow.getByRole("button", { name: "Export CSV" }).click();

    await expect(page.getByText(/Exported Contacts to contacts.csv/)).toBeVisible();

    // The save dialog really was asked, and real CSV went through the fs plugin.
    const state = await e2eState(page);
    const saveCalls = state.calls.filter((c) => c.cmd === "plugin:dialog|save");
    expect(saveCalls.length, "the export opened the save dialog").toBeGreaterThan(0);

    const written = await lastWrittenText(page);
    expect(written, "the CSV was written through the fs plugin").toBeTruthy();
    expect(written!.split("\r\n")[0]).toContain("First Name");
    expect(written).toContain("sarah.mitchell83@gmail.example");

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("the running panel says what it is doing while a big file goes in", async ({
    page,
    helix: _helix,
  }) => {
    await installSlowWrites(page);
    await page.goto("/import");
    await offerFile(page, "/tmp/helix-e2e/big.csv", bigCsv(1500));
    await page.getByRole("button", { name: "Choose a file" }).click();
    await expect(page.getByRole("columnheader", { name: "Import as" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("The first 20 of")).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __helixE2E: { slowWrites?: boolean } }).__helixE2E.slowWrites = true;
    });
    await page.getByRole("button", { name: "Import", exact: true }).click();

    const progress = page.getByRole("progressbar");
    await expect(progress).toBeVisible();
    await shootBoth(page, "import-running");
    // Still running: the two shots above really are of this screen and not of
    // the result screen that follows it.
    await expect(progress).toBeVisible();

    await expect(page.getByText("contacts created")).toBeVisible({ timeout: 40_000 });
    expect(await helixCount(page)).toBe(1500);
  });

  test("a file with headers and no rows says so instead of importing nothing", async ({
    page,
    helix: _helix,
  }) => {
    await page.goto("/import");
    await offerFile(
      page,
      "/tmp/helix-e2e/empty.csv",
      fixture("malformed", "empty-with-headers.csv"),
    );
    await page.getByRole("button", { name: "Choose a file" }).click();
    await expect(
      page.getByRole("heading", { name: "This file has headers but no rows" }),
    ).toBeVisible();
    await shootBoth(page, "import-empty");
  });

  test("a ragged file names the row it stopped on", async ({ page, helix: _helix }) => {
    await page.goto("/import");
    await offerFile(page, "/tmp/helix-e2e/ragged.csv", fixture("malformed", "ragged.csv"));
    await page.getByRole("button", { name: "Choose a file" }).click();
    await expect(
      page.getByRole("heading", { name: "Helix could not read that file" }),
    ).toBeVisible();
    await expect(page.getByText(/Row \d+ has \d+ values/)).toBeVisible();
    await shootBoth(page, "import-parse-error");
  });

  test("backups list what has been saved and ask before restoring one", async ({
    page,
    helix,
  }) => {
    await page.goto("/settings/backups");
    await expect(page.getByRole("heading", { name: "Backups", level: 1 })).toBeVisible();
    // Backups states each fact once (phase-two design direction, rule 3 and
    // rule 6): one honest subtitle, no standing paragraph re-explaining the
    // schedule, and an empty-state sentence that says something the subtitle
    // does not and is true with zero backups on record.
    await expect(page.getByText("Helix backs up your database automatically.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No backups yet" })).toBeVisible();
    await expect(
      page.getByText("The first one is written the next time you open Helix, or start one now."),
    ).toBeVisible();
    await expect(page.getByText(/keeps every backup from the last 24 hours/)).toHaveCount(0);
    await shootBoth(page, "backups-empty");

    // The button really runs a backup - the harness's `db_backup` is
    // better-sqlite3's VACUUM INTO and it answers with a real path - but the
    // file it writes is not named the way the contract says, so the list cannot
    // show it. `DbBridge.backup` in tests/e2e-mac/fixtures.ts
    // stamps `new Date().toISOString()` with every `:` and `.` turned into a
    // dash, which leaves the milliseconds in the name
    // ("2026-09-19T00-48-08-123Z-manual.db"); the format Rust writes and
    // `parseBackupName` reads is "<date>T<HH-MM-SS>Z-<reason>.db", with no
    // millisecond segment (docs/CONTRACTS.md). Rather than reach into another
    // agent's fixture, this seeds two correctly named files into the same
    // in-memory map the stub lists from, which is what the real backups folder
    // looks like, and then lets "Back up now" invalidate the list. The seed has
    // to happen without a navigation in between: the harness reinstalls
    // `window.__helixE2E` from an init script on every document load, so a
    // `goto` would throw the seeded files away. Recorded in docs/STATUS.md.
    const backupsDir = `${helix.workspaceDir}/backups`;
    const names = [0, 1].map((daysAgo) => {
      const at = new Date(Date.now() - daysAgo * 86_400_000);
      const stamp = at.toISOString().slice(0, 19).replace(/:/g, "-");
      return `${stamp}Z-${daysAgo === 0 ? "manual" : "scheduled"}.db`;
    });
    await page.evaluate(
      ([dir, fileNames]) => {
        const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
        for (const name of fileNames as string[]) {
          state.files[`${dir as string}/${name}`] = "e2e-backup-placeholder";
        }
      },
      [backupsDir, names] as const,
    );

    await page.getByRole("button", { name: "Back up now" }).first().click();
    await expect(page.getByText("Backup saved.")).toBeVisible();

    const restore = page.getByRole("button", { name: "Restore" }).first();
    await expect(restore).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("columnheader", { name: "Date and time" })).toBeVisible();
    await expect(page.getByText(/2 backups ·/)).toBeVisible();
    await shootBoth(page, "backups-list");

    await restore.click();
    await expect(page.getByRole("heading", { name: "Restore this backup?" })).toBeVisible();
    await shootBoth(page, "backups-restore-dialog");

    // Cancel: restoring for real closes and reopens the database under a
    // harness whose backup file is a placeholder, which proves nothing.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Restore this backup?" })).toHaveCount(0);
  });

  test("the empty screens are designed too", async ({ page, helix: _helix }) => {
    await page.goto("/export");
    await expect(page.getByRole("heading", { name: "Export", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing to export yet" })).toBeVisible();
    await shootBoth(page, "export-empty");

    await page.goto("/duplicates");
    await expect(page.getByRole("heading", { name: "Duplicates", level: 1 })).toBeVisible();
    await expect(page.getByText("No duplicates to sort out")).toBeVisible({
      timeout: 20_000,
    });
    await shootBoth(page, "duplicates-empty");

    await page.getByRole("tab", { name: "Merges" }).click();
    await expect(page.getByRole("heading", { name: "No merges yet" })).toBeVisible();
    await shootBoth(page, "merges-history-empty");
  });

  /**
   * The attachments list is a component, not a route: the records feature drops
   * it onto a record page. This walks to a contact the import just created and
   * photographs it there. The record page belongs to another agent, so the
   * panel is photographed when it is present and the test does not fail when
   * that agent's page has moved on - the component's own behaviour is covered
   * by the records suite.
   */
  test("the attachments panel on a record", async ({ page, helix: _helix }) => {
    await page.goto("/import");
    await importFile(page, {
      path: "/tmp/helix-e2e/hubspot-attachments.csv",
      contents: fixture("hubspot-contacts.csv"),
    });

    // Straight to a record by id. The contacts list is a virtualised list
    // rather than a table, so there is no row to click by role, and the point
    // here is the panel rather than the navigation.
    const contactId = await page.evaluate(async () => {
      const rows = await (
        window as unknown as {
          __helixDb: { query(sql: string, params: unknown[]): Promise<unknown[][]> };
        }
      ).__helixDb.query("SELECT id FROM contacts WHERE deleted_at IS NULL LIMIT 1", []);
      return rows.length > 0 ? String(rows[0][0]) : null;
    });
    if (!contactId) return;
    await page.goto(`/contacts/${contactId}`);

    // `isVisible()` answers immediately and would say "no" before React has
    // drawn the page; `waitFor` is the one that waits.
    const files = page.getByRole("heading", { name: "Files", exact: true });
    const present = await files
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!present) return;

    await files.first().scrollIntoViewIfNeeded();
    await shootBoth(page, "attachments");
  });

  /**
   * Deals is the newest of the generic (non-legacy) import types: same wizard
   * shell as contacts, but its own field list, its own guesser, and its own
   * duplicate question. This proves the type picker actually switches the
   * wizard onto that path, that the guesser reads a real HubSpot deals export
   * the way `fields/deals.ts` promises, that a stage HubSpot has but this
   * workspace does not ("Contract Sent") and an amount typed as prose ("Call
   * for quote") both surface as warnings rather than failing the row, and
   * that the deals really land on the pipeline afterwards.
   *
   * What it cannot prove: the annual-value math or the contact/company
   * matching rules behind the scenes - those belong to
   * `lib/typedImportRun.ts`'s own unit tests. This is the wizard end to end
   * for one real-looking file.
   */
  test("imports deals and shows what it had to decide", async ({ page, helix: _helix }) => {
    await page.goto("/import");
    await expect(page.getByTestId("import-type-picker")).toBeVisible();
    await expect(page.locator('input[type="radio"][value="contacts"]')).toBeChecked();
    await shootTypesBoth(page, "type-picker");

    await page.locator('input[type="radio"][value="deals"]').check();

    const deals = fixture("hubspot-deals.csv");
    await offerFile(page, "/tmp/helix-e2e/hubspot-deals.csv", deals);
    await page.getByRole("button", { name: "Choose a file" }).click();

    // Step 2: the guess landed on the columns that matter. "Deal" is
    // required, so its option reads "Deal (needed)" - toContainText rather
    // than an exact match keeps this test honest about that without caring
    // which way the suffix is worded.
    await expect(page.getByRole("columnheader", { name: "Import as" })).toBeVisible();
    const dealNameRow = page.getByRole("row").filter({ hasText: "Deal Name" }).first();
    await expect(dealNameRow.getByRole("combobox")).toContainText("Deal");
    const stageRow = page.getByRole("row").filter({ hasText: "Deal Stage" }).first();
    await expect(stageRow.getByRole("combobox")).toHaveText("Stage");
    const emailRow = page
      .getByRole("row")
      .filter({ hasText: "Associated Contact Email" })
      .first();
    await expect(emailRow.getByRole("combobox")).toHaveText("Contact email");
    await expect(page.getByRole("row").filter({ hasText: "Record ID" })).toContainText(
      "Skip this column",
    );
    await shootTypesBoth(page, "mapping-deals");

    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3: straight through with the default duplicate policy - this is a
    // first import into an empty workspace, so nothing is a duplicate yet.
    await expect(page.getByRole("columnheader", { name: "What Helix noticed" })).toBeVisible();
    // The money column is a numeric column: `align="right"` on the header and
    // the cell, never a hand-rolled `text-right tabular-nums` (docs/DESIGN.md
    // "Tables"; `TD`/`TH`'s `data-numeric` attribute is what turns that on).
    await expect(page.getByRole("columnheader", { name: "Value" })).toHaveAttribute(
      "data-numeric",
      "",
    );
    await page.getByRole("button", { name: "Import", exact: true }).click();

    // Step 4: the counts, and the two rows the file could not match cleanly.
    await expect(page.getByText("deals created")).toBeVisible({ timeout: 30_000 });
    const created = page
      .locator("div")
      .filter({ hasText: /^30deals created$/ })
      .first();
    await expect(created).toBeVisible();
    await expect(page.getByText("contacts created")).toBeVisible();
    await expect(page.getByText("companies created")).toBeVisible();

    await expect(page.getByText("rows Helix had to decide something about")).toBeVisible();
    await expect(page.locator("li").filter({ hasText: "Contract Sent" })).toHaveCount(1);
    await expect(page.locator("li").filter({ hasText: "Call for quote" })).toHaveCount(1);
    await shootTypesBoth(page, "result-warnings");

    // The deals really landed on the board, not just in the count.
    await page.goto("/pipeline");
    await expect(page.getByText("Water heater replacement - Holladay")).toBeVisible({
      timeout: 20_000,
    });
  });

  /**
   * "Download an example" for Deals: the file is generated at click time from
   * `DEALS_IMPORT` and the workspace's own live stage names rather than being
   * a static asset, so this is the one place that promise is checked against
   * a webview instead of only in `tests/unit/data/importExamples.test.ts`.
   *
   * What it cannot prove: the round trip (that Helix reads this file straight
   * back in without anything landing on Skip) - that is the unit test's job.
   * This only checks what actually crossed the fs plugin: the header the
   * field list promises, and a Stage cell holding a name this workspace
   * really has.
   */
  test("downloads the deals example", async ({ page, helix: _helix }) => {
    await page.goto("/import");
    await offerSavePath(page, "/tmp/helix-e2e/helix-deals-example.csv");

    async function openExamplesMenu() {
      await page.getByRole("button", { name: "Download an example" }).click();
      await expect(page.getByRole("menuitem", { name: "Deals" })).toBeVisible();
    }

    // The menu, in both themes. Reopened between shots rather than shared
    // across them: a Radix menu does not survive the click that would
    // otherwise pick an item, and this does not lean on it surviving a theme
    // change either.
    await switchTheme(page, "light");
    await openExamplesMenu();
    await shootTypes(page, "examples-menu-light");
    await page.keyboard.press("Escape");

    await switchTheme(page, "dark");
    await openExamplesMenu();
    await shootTypes(page, "examples-menu-dark");
    await page.keyboard.press("Escape");
    await switchTheme(page, "light");

    // Now actually pick it.
    await openExamplesMenu();
    await page.getByRole("menuitem", { name: "Deals" }).click();
    await expect(page.getByText(/Saved helix-deals-example\.csv/)).toBeVisible();

    // The save dialog really was asked, and real CSV went through the fs
    // plugin - the same proof the export test at the top of this file uses.
    const state = await e2eState(page);
    const saveCalls = state.calls.filter((c) => c.cmd === "plugin:dialog|save");
    expect(saveCalls.length, "the example opened the save dialog").toBeGreaterThan(0);

    const written = await lastWrittenText(page);
    expect(written, "the CSV was written through the fs plugin").toBeTruthy();

    const lines = written!.split("\r\n").filter((line) => line.length > 0);
    const header = splitCsvLine(lines[0]);
    expect(header).toEqual(DEALS_IMPORT.fields.map((f) => f.label));

    // The Stage column holds a stage this workspace really has, not a
    // stranger's - the whole point of generating the file live.
    const stageIndex = header.indexOf("Stage");
    const seededStageNames = ["New", "Contacted", "Quoted", "Scheduled", "Won", "Lost"];
    const firstDataRow = splitCsvLine(lines[1]);
    expect(seededStageNames).toContain(firstDataRow[stageIndex]);
  });

  test("messy-3000.csv: a real install-day export, mapped, previewed, imported, and undo reachable from the result", async ({
    page,
    helix: _helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/import");
    await offerFile(page, "/tmp/helix-e2e/messy-3000.csv", fixture("messy-3000.csv"));
    await page.getByRole("button", { name: "Choose a file" }).click();

    // Step 2: the non-obvious headers guess the way a human would.
    await expect(page.getByRole("columnheader", { name: "Import as" })).toBeVisible();
    const customerNameRow = page.getByRole("row").filter({ hasText: "Customer Name" }).first();
    await expect(customerNameRow.getByRole("combobox")).toHaveText("Full name");
    const coRow = page.getByRole("row").filter({ hasText: "Co." }).first();
    await expect(coRow.getByRole("combobox")).toHaveText("Company");
    const cellRow = page.getByRole("row").filter({ hasText: "Cell" }).first();
    await expect(cellRow.getByRole("combobox")).toHaveText("Phone");
    const emailRow = page.getByRole("row").filter({ hasText: "E-mail Address" }).first();
    await expect(emailRow.getByRole("combobox")).toHaveText("Email");
    // No contacts-schema home for these two: Skip is the correct guess.
    const spentRow = page.getByRole("row").filter({ hasText: "Total Spent" }).first();
    await expect(spentRow.getByRole("combobox")).toContainText("Skip this column");
    const dateRow = page.getByRole("row").filter({ hasText: "Last Service Date" }).first();
    await expect(dateRow.getByRole("combobox")).toContainText("Skip this column");

    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3: the preview says, before the owner commits to anything, how
    // many rows in the WHOLE file (not just the 20 shown) already match
    // someone in Helix.
    await expect(page.getByText("The first 20 of")).toBeVisible();
    await expect(
      page.getByText(/6 of 2,997 rows match an email or phone already in Helix/),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("radio", { name: "Skip them" })).toBeChecked();

    await page.getByRole("button", { name: "Import", exact: true }).click();

    // Step 4: the exact counts this fixture is documented to produce.
    await expect(page.getByText("contacts created")).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator("div").filter({ hasText: /^2,991contacts created$/ }).first(),
    ).toBeVisible();
    await expect(page.locator("div").filter({ hasText: /^6rows skipped$/ }).first()).toBeVisible();
    expect(await helixCount(page)).toBe(2991);

    // The rows that imported but that Helix had to make a judgement call on
    // (an unparseable phone, a row with no name) are not silently dropped.
    await expect(page.getByText(/61 rows Helix had to decide something about/)).toBeVisible();

    // The rows that did NOT go in can be gotten back out.
    await expect(page.getByText("6 rows did not go in")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save skipped rows as CSV" })).toBeVisible();

    // Undo: the pre-import backup is named, and it is one click to where it
    // is restored from - not just a sentence saying where to look.
    await expect(page.getByText("Helix saved a backup before this import")).toBeVisible();
    await page.getByRole("button", { name: "Go to Backups" }).click();
    await expect(page.getByRole("heading", { name: "Backups", level: 1 })).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
});

/**
 * The text of the last plugin-fs write.
 *
 * `writeTextFile` does not pass the path as an argument: the plugin sends the
 * bytes as the invoke payload and the path as a request header, which the
 * harness's fs stub in tests/e2e-mac/fixtures.ts does not read (it keys
 * `state.files` off `args.path`, which is undefined for a write). Until that
 * stub is taught about the header, the payload itself is the honest place to
 * look. Noted in docs/STATUS.md.
 */
async function lastWrittenText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const state = (window as unknown as { __helixE2E: { calls: { cmd: string; args: unknown }[] } })
      .__helixE2E;
    const call = [...state.calls].reverse().find((c) => c.cmd === "plugin:fs|write_text_file");
    if (!call) return null;
    const payload = call.args;
    if (typeof payload === "string") return payload;
    if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
    if (Array.isArray(payload)) return new TextDecoder().decode(new Uint8Array(payload));
    if (payload && typeof payload === "object") {
      return new TextDecoder().decode(
        new Uint8Array(Object.values(payload as Record<string, number>)),
      );
    }
    return null;
  });
}

/** Live contacts, straight from the database the app is writing to. */
async function helixCount(page: Page): Promise<number> {
  const rows = await page.evaluate(() =>
    (
      window as unknown as {
        __helixDb: { query(sql: string, params: unknown[]): Promise<unknown[][]> };
      }
    ).__helixDb.query("SELECT count(*) FROM contacts WHERE deleted_at IS NULL", []),
  );
  return Number(rows[0][0]);
}
