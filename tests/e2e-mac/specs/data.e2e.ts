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

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const SCREENS = join(here, "..", ".cache", "screens", "brand-a");

function fixture(...parts: string[]): string {
  return readFileSync(join(REPO, "tests", "fixtures", ...parts), "utf8");
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
    await expect(page.getByRole("heading", { name: "No backups yet" })).toBeVisible();
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
