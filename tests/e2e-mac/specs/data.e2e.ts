/**
 * The data feature end to end: import a real vendor export through the UI,
 * merge a duplicate it produced, undo the merge, and export contacts.
 *
 * What this harness can prove: the wizard, the mapping, the SQL the import
 * writes, the merge and its undo, and that export reached the save dialog.
 *
 * What it cannot prove: backups and restore. The fs stub in fixtures.ts is an
 * in-memory map with no readDir and no copyFile, and `db_backup` here is
 * better-sqlite3's VACUUM INTO rather than the Rust pipe's second read-only
 * connection. The retention policy and the schedule are covered as pure
 * functions in tests/unit/data/retention.test.ts; the real thing belongs to
 * tests/e2e-win and the manual checklist.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
const SCREENS = join(here, "..", ".cache", "screens", "data");

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
 * Flip the app's own theme toggle rather than poking the attribute: the shell
 * re-applies the stored theme whenever it mounts, so a navigation would undo
 * anything set by hand. The toggle writes helix.json, which the stubbed
 * filesystem keeps for the rest of the page session.
 */
async function setTheme(page: Page, theme: "light" | "dark") {
  const current = await page.locator("html").getAttribute("data-theme");
  if (current !== theme) {
    await page.getByRole("button", { name: theme === "dark" ? "Dark" : "Light" }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
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

/** Walk the wizard from the file dialog to the result screen. */
async function importFile(
  page: Page,
  options: { path: string; contents: string; policy?: "Skip them" | "Fill in the blanks" | "Import anyway" },
) {
  await offerFile(page, options.path, options.contents);
  await page.getByRole("button", { name: "Choose a file" }).click();

  await expect(page.getByRole("columnheader", { name: "Import as" })).toBeVisible();
  await page.getByRole("button", { name: "Preview 20 rows" }).click();

  await expect(page.getByRole("columnheader", { name: "What Helix noticed" })).toBeVisible();
  if (options.policy && options.policy !== "Skip them") {
    await page.getByRole("radio", { name: options.policy }).check();
  }
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(page.getByText("contacts created")).toBeVisible({ timeout: 30_000 });
}

test.describe("data", () => {
  // `helix` is listed here so Playwright builds the fixture for every test in
  // this file: it is what installs the database bridge and the Tauri shim, and
  // Playwright only creates a fixture a test actually asks for.
  test.beforeEach(async ({ page, helix }) => {
    expect(helix.dbPath).toContain("helix.db");
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("imports a HubSpot export, merges a duplicate, undoes it, and exports", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
    await expect(page.getByText("Drop a spreadsheet here")).toBeVisible();

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
    await shoot(page, "import-mapping-light");

    await page.getByRole("button", { name: "Preview 20 rows" }).click();

    // Step 3: twenty mapped rows and the duplicate policy.
    await expect(page.getByText("The first 20 of")).toBeVisible();
    await expect(page.getByText("sarah.mitchell83@gmail.com").first()).toBeVisible();
    await expect(page.getByRole("radio", { name: "Skip them" })).toBeChecked();
    await shoot(page, "import-preview-light");

    await page.getByRole("button", { name: "Import", exact: true }).click();

    // Step 4: the counts.
    await expect(page.getByText("contacts created")).toBeVisible({ timeout: 30_000 });
    const created = page
      .locator("div")
      .filter({ hasText: /^52contacts created$/ })
      .first();
    await expect(created).toBeVisible();
    await expect(page.getByText("companies created")).toBeVisible();
    await shoot(page, "import-result-light");

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
    await shoot(page, "duplicates-light");

    await page.getByRole("button", { name: "Review and merge" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("They share the same email")).toBeVisible();
    await shoot(page, "merge-dialog-light");

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

    // --- export -----------------------------------------------------------
    await page.goto("/export");
    await expect(page.getByRole("heading", { name: "Export", level: 1 })).toBeVisible();
    await shoot(page, "export-light");

    await offerSavePath(page, "/tmp/helix-e2e/contacts.csv");
    // The innermost element holding both the heading and the button is the card.
    const contactsCard = page
      .locator("div")
      .filter({ has: page.getByRole("heading", { name: "Contacts", exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Export CSV" }) })
      .last();
    await contactsCard.getByRole("button", { name: "Export CSV" }).click();

    await expect(page.getByText(/Exported Contacts to contacts.csv/)).toBeVisible();

    // The save dialog really was asked, and real CSV went through the fs plugin.
    const state = await e2eState(page);
    const saveCalls = state.calls.filter((c) => c.cmd === "plugin:dialog|save");
    expect(saveCalls.length, "the export opened the save dialog").toBeGreaterThan(0);

    const written = await lastWrittenText(page);
    expect(written, "the CSV was written through the fs plugin").toBeTruthy();
    expect(written!.split("\r\n")[0]).toContain("First Name");
    expect(written).toContain("sarah.mitchell83@gmail.com");

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("a file with headers and no rows says so instead of importing nothing", async ({
    page,
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
    await shoot(page, "import-empty-light");
  });

  test("a ragged file names the row it stopped on", async ({ page }) => {
    await page.goto("/import");
    await offerFile(page, "/tmp/helix-e2e/ragged.csv", fixture("malformed", "ragged.csv"));
    await page.getByRole("button", { name: "Choose a file" }).click();
    await expect(
      page.getByRole("heading", { name: "Helix could not read that file" }),
    ).toBeVisible();
    await expect(page.getByText(/Row \d+ has \d+ values/)).toBeVisible();
    await shoot(page, "import-parse-error-light");
  });

  test("every screen is designed in the dark too", async ({ page }) => {
    await page.goto("/import");
    await setTheme(page, "dark");
    await expect(page.getByText("Drop a spreadsheet here")).toBeVisible();
    await shoot(page, "import-pick-dark");

    await page.goto("/export");
    await setTheme(page, "dark");
    await expect(page.getByRole("heading", { name: "Export", level: 1 })).toBeVisible();
    await shoot(page, "export-empty-dark");

    await page.goto("/duplicates");
    await setTheme(page, "dark");
    await expect(page.getByRole("heading", { name: "Duplicates", level: 1 })).toBeVisible();
    await expect(page.getByText("No duplicates to sort out")).toBeVisible({
      timeout: 20_000,
    });
    await shoot(page, "duplicates-empty-dark");

    await page.goto("/backups");
    await setTheme(page, "dark");
    await expect(page.getByRole("heading", { name: "Backups", level: 1 })).toBeVisible();
    await shoot(page, "backups-dark");

    // And the light versions of the two empty states, for the same look.
    await page.goto("/import");
    await setTheme(page, "light");
    await expect(page.getByText("Drop a spreadsheet here")).toBeVisible();
    await shoot(page, "import-pick-light");

    await page.goto("/backups");
    await setTheme(page, "light");
    await expect(page.getByRole("heading", { name: "Backups", level: 1 })).toBeVisible();
    await shoot(page, "backups-light");
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
