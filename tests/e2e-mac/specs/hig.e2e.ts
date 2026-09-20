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
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import type { HelixHarness } from "../fixtures";

const SHOTS = fileURLToPath(new URL("../../../design/hig/", import.meta.url));

/** The 38px `--titlebar-inset`, which is what the traffic lights need. */
const TITLEBAR_INSET = 38;

/**
 * Change the theme the way the owner does, through the toolbar button.
 *
 * `settleTheme` below sets `data-theme` on <html> directly, which is enough
 * for CSS but leaves React's own appearance state behind — and sonner reads
 * that state for the toast's colours, so a "dark" screenshot taken that way
 * comes back with a white toast sitting on a dark app. Pressing the real
 * control moves both, and exercises the Auto -> Light -> Dark cycle on the way.
 */
async function pressThemeUntil(page: Page, theme: "light" | "dark"): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    const current = await page.evaluate(() => document.documentElement.dataset.theme);
    if (current === theme) return;
    await page.getByRole("button", { name: /^Switch to / }).click();
    await page.waitForTimeout(200);
  }
  throw new Error(`the theme button never reached ${theme}`);
}

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

/**
 * Selection (finding 4).
 *
 * `user-select: none` used to sit on `body` with two opt-in hooks that nothing
 * in the product ever used, so a phone number, an address, a note and every
 * table cell were unselectable — and copying a number out of a record before
 * pasting it into a text message is the single most common thing an owner does
 * with a CRM. The policy is inverted now: content selects, chrome does not.
 * These tests drive a real triple-click and read `window.getSelection()` back,
 * because a computed `user-select` can be `text` on an element whose ancestor
 * still blocks the drag.
 */
test.describe("selection", () => {
  /**
   * A contact to look at. The harness skips the first-run flow, which is what
   * creates the sample data, so this workspace starts empty and the row goes
   * in through the bridge — the same file the app is reading.
   */
  async function aContact(page: Page, helix: HelixHarness): Promise<string> {
    // Boot first: the app's own launch is what runs the migrations, so the
    // table does not exist until the shell is on screen.
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    const id = "hig-selection-contact";
    helix.bridge.execute(
      `INSERT INTO contacts (id, first_name, last_name, notes) VALUES (?, ?, ?, ?)`,
      [id, "Priya", "Raghunathan", "Prefers a text before anyone turns up."],
    );
    return id;
  }

  async function tripleClickText(page: Page, locator: Locator): Promise<string> {
    await locator.scrollIntoViewIfNeeded();
    await locator.click({ clickCount: 3 });
    return page.evaluate(() => window.getSelection()?.toString() ?? "");
  }

  test("a record's name and its notes can be selected and copied", async ({ page, helix }) => {
    const id = await aContact(page, helix);
    await page.goto(`/contacts/${id}`);

    const heading = page.getByRole("heading", { level: 1 }).first();
    await expect(heading).toBeVisible();
    const headingText = (await heading.textContent())?.trim() ?? "";
    expect(headingText.length).toBeGreaterThan(0);

    const selected = await tripleClickText(page, heading);
    expect(selected.trim().length).toBeGreaterThan(0);
    expect(headingText).toContain(selected.trim().split(/\s+/)[0]);
  });

  test("an address line and a note are real fields, so they select too", async ({
    page,
    helix,
  }) => {
    const id = await aContact(page, helix);
    await page.goto(`/contacts/${id}`);

    // The address lines and the notes are inline-editing fields, which means a
    // real <input>/<textarea>: select-all inside one has to work, since that is
    // the path an owner takes to copy a job address into a maps app.
    const street = page.getByLabel("Street", { exact: false }).first();
    await street.fill("1180 South Pioneer Road");
    await street.selectText();
    const address = await page.evaluate(() => {
      const node = document.activeElement as HTMLInputElement | null;
      if (node && typeof node.selectionStart === "number") {
        return node.value.slice(node.selectionStart, node.selectionEnd ?? undefined);
      }
      return window.getSelection()?.toString() ?? "";
    });
    expect(address).toBe("1180 South Pioneer Road");

    const notes = page.getByLabel("What to remember");
    await notes.fill("Gate code 4417. Dog in the back yard.");
    await notes.selectText();
    const note = await page.evaluate(() => {
      const node = document.activeElement as HTMLTextAreaElement | null;
      if (node && typeof node.selectionStart === "number") {
        return node.value.slice(node.selectionStart, node.selectionEnd ?? undefined);
      }
      return window.getSelection()?.toString() ?? "";
    });
    expect(note).toBe("Gate code 4417. Dog in the back yard.");
  });

  test("the chrome still does not select", async ({ page, helix }) => {
    await aContact(page, helix);

    // A sidebar row is a click target, not a sentence: dragging across it must
    // not highlight it, or a mis-aimed double-click leaves the nav looking
    // broken.
    const todayRow = page.getByRole("navigation").getByRole("link", { name: "Today" });
    const selected = await tripleClickText(page, todayRow);
    expect(selected.trim()).toBe("");
  });
});

/**
 * Undo (finding 3), and the three remaining screenshots.
 *
 * The toast used to be the whole of undo: ten seconds, one button, and if it
 * timed out the change was gone. Cmd+Z now walks the change_log batches, and
 * the toast that comes back has to NAME what it reversed — "Undone: deleted
 * Priya Raghunathan" — because an undo that only says "Undone" leaves the
 * owner to guess which of the last four things moved.
 */
test.describe("undo", () => {
  async function aContactPage(page: Page, helix: HelixHarness): Promise<string> {
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();
    const id = "hig-undo-contact";
    helix.bridge.execute(
      `INSERT INTO contacts (id, first_name, last_name) VALUES (?, ?, ?)`,
      [id, "Priya", "Raghunathan"],
    );
    await page.goto(`/contacts/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    return id;
  }


  /**
   * Dismiss whatever toasts are on screen, the way the owner would: sonner's
   * own close button. Ripping the nodes out of the DOM with `evaluate` leaves
   * sonner's internal list pointing at elements that are gone and it renders
   * nothing afterwards — which looks exactly like a broken undo.
   */
  async function dismissToasts(page: Page): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      const close = page.locator("[data-close-button]").first();
      if ((await close.count()) === 0) break;
      await close.click({ force: true });
      await page.waitForTimeout(150);
    }
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  }

  test("Cmd+Z reverses a delete after the toast has gone, and says what it did", async ({
    page,
    helix,
  }) => {
    const id = await aContactPage(page, helix);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete contact" }).click();
    await page.waitForURL("**/contacts");

    // Dismiss the ten-second toast, which is the whole point: the old undo
    // died with it, and this one does not.
    await dismissToasts(page);

    await page.keyboard.press("Meta+z");

    await expect(page.getByText("Undone: deleted Priya Raghunathan")).toBeVisible();
    const [[deletedAt]] = helix.bridge.query("SELECT deleted_at FROM contacts WHERE id = ?", [
      id,
    ]) as [string | null][];
    expect(deletedAt).toBeNull();
  });

  test("Shift+Cmd+Z puts it back", async ({ page, helix }) => {
    const id = await aContactPage(page, helix);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete contact" }).click();
    await page.waitForURL("**/contacts");
    await dismissToasts(page);

    await page.keyboard.press("Meta+z");
    await expect(page.getByText("Undone: deleted Priya Raghunathan")).toBeVisible();

    await dismissToasts(page);
    await page.keyboard.press("Meta+Shift+z");
    await expect(page.getByText("Redone: deleted Priya Raghunathan")).toBeVisible();

    const [[deletedAt]] = helix.bridge.query("SELECT deleted_at FROM contacts WHERE id = ?", [
      id,
    ]) as [string | null][];
    expect(deletedAt).not.toBeNull();
  });

  test("Cmd+Z inside a text field is the field's own undo, not the app's", async ({
    page,
    helix,
  }) => {
    const id = await aContactPage(page, helix);
    expect(id).toBe("hig-undo-contact");

    const notes = page.getByLabel("What to remember");
    await notes.click();
    await notes.fill("Gate code 4417.");
    await page.keyboard.press("Meta+z");

    // Whatever the field does with it, the application stack must not have
    // answered: there is nothing of the owner's to reverse yet, and the app's
    // handler is the one that would have said so.
    await expect(page.getByText("Nothing to undo")).toHaveCount(0);
    await expect(page.getByText(/^Undone: /)).toHaveCount(0);
  });
});

test.describe("screenshots for the brand review", () => {
  test("the toolbar, a sorted list and the undo toast, light and dark", async ({
    page,
    helix,
  }) => {
    test.setTimeout(120_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    for (const [i, name] of ["Aguirre", "Halvorsen", "Nakamura", "Okafor"].entries()) {
      helix.bridge.execute(
        `INSERT INTO contacts (id, first_name, last_name) VALUES (?, ?, ?)`,
        [`hig-shot-${i}`, ["Marisol", "Dwayne", "Pearl", "Ana"][i], name],
      );
    }

    async function shoot(name: string, clip?: { x: number; y: number; width: number; height: number }) {
      for (const theme of ["light", "dark"] as const) {
        await pressThemeUntil(page, theme);
        await page.screenshot({ path: `${SHOTS}${name}-${theme}.png`, ...(clip ? { clip } : {}) });
      }
      await pressThemeUntil(page, "light");
    }

    // The toolbar: the view title on the leading edge, search on the trailing
    // one (finding 9). The whole strip across the content column.
    await shoot("toolbar", { x: 0, y: 0, width: 1280, height: 120 });

    // A sorted list: the header strip with its caret, and the rows under it
    // (finding 6).
    await page.getByRole("navigation").getByRole("link", { name: "Contacts" }).click();
    const list = page.getByRole("list", { name: "Contacts" });
    await expect(list).toBeVisible();
    await page.getByRole("columnheader", { name: "Name" }).getByRole("button").click();
    await page.waitForTimeout(200);
    await shoot("list-sorted");

    // The undo toast, naming what it reversed (finding 3).
    helix.bridge.execute(
      `INSERT INTO contacts (id, first_name, last_name) VALUES (?, ?, ?)`,
      ["hig-shot-undo", "Priya", "Raghunathan"],
    );
    await page.goto("/contacts/hig-shot-undo");
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete contact" }).click();
    await page.waitForURL("**/contacts");
    for (let i = 0; i < 5; i += 1) {
      const close = page.locator("[data-close-button]").first();
      if ((await close.count()) === 0) break;
      await close.click({ force: true });
      await page.waitForTimeout(150);
    }
    await page.keyboard.press("Meta+z");
    await expect(page.getByText("Undone: deleted Priya Raghunathan")).toBeVisible();
    await shoot("undo-toast");
  });
});
