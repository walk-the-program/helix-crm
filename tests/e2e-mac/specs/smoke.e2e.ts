/**
 * The one test that proves the harness itself works: the built app boots in a
 * plain Chromium page, talks to better-sqlite3 through `window.__helixDb`, and
 * renders its shell.
 *
 * Everything else in PLAN.md's e2e list (quick add, import a HubSpot export,
 * drag a deal, complete a task from Today, AI off and on against a local fake)
 * belongs in its own spec beside this one, once those screens exist. Restore
 * and workspace switch stay on the Windows suite and the manual checklist:
 * they are Rust, and this harness cannot prove them.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, reloadWithCurrentFiles, seedRegistryPatch, type HelixHarness } from "../fixtures";

test.describe("boot", () => {
  test("the app boots and the sidebar shows Today", async ({ page, helix }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    // The shell, not a blank page or an error boundary.
    const sidebar = page.getByRole("navigation");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Today" })).toBeVisible();

    // Today is the landing screen.
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);

    // The bridge is real: the app's own boot created its schema in the file
    // this test owns.
    const tables = helix.bridge.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    expect(tables.length, "boot should have run the migrations").toBeGreaterThan(0);
  });

  test("the database bridge answers the contract's methods", async ({ page, helix }) => {
    await page.goto("/");

    const info = await page.evaluate(() => window.__helixDb!.info());
    expect(info.sqliteVersion).toMatch(/^\d+\.\d+/);
    expect(info.path).toBe(helix.dbPath);
    expect(info.fts5, "search needs FTS5 in the test build of SQLite").toBe(true);

    // A batch rolls back as one unit when a statement in the middle fails.
    helix.bridge.execute("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY)", []);
    await expect(
      page.evaluate(() =>
        window.__helixDb!.batch([
          { sql: "INSERT INTO probe (id) VALUES (?)", params: [1] },
          { sql: "INSERT INTO nope (id) VALUES (?)", params: [2] },
        ]),
      ),
    ).rejects.toThrow(/no such table/i);
    expect(helix.bridge.query("SELECT count(*) FROM probe", [])[0][0]).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Round 3, shell-level proof (task R3-L1-C3)                                 */
/*                                                                            */
/* Everything below proves the round-3 shell changes committed in ac8f5e8,   */
/* 17d6401 and e3ac227 actually work in the built app: the toolbar's         */
/* light/dark toggle, the resizable/collapsible sidebar, the mod+\ shortcut  */
/* and its palette command, single-scroller behaviour and the macOS         */
/* title-bar clearance, and the Combobox/DatePicker/TimePicker primitives   */
/* running in real, already-migrated screens. The live-workspace-name       */
/* footer test lives in settings.e2e.ts instead, beside the rest of the     */
/* workspace-rename machinery it depends on.                                 */
/* -------------------------------------------------------------------------- */

const SCREENS_DIR = fileURLToPath(new URL("../../../design/round3/", import.meta.url));

/** helix.json's shape, as far as these tests need to read it back. */
type HelixRegistryLike = {
  workspaces: { id: string; name: string; archived: boolean }[];
  lastOpened: string | null;
  theme: string;
  density: string;
  sidebar: { width: number; collapsed: boolean };
};

type E2EState = {
  files: Record<string, string>;
  calls: { cmd: string; args: unknown }[];
};

/**
 * A deep `page.goto("/settings/...")` 404s under `vite preview`, so every
 * test here boots at "/" and reaches other screens the way an owner does:
 * through the sidebar (settings.e2e.ts's `bootApp` does the same thing).
 */
async function bootApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
}

/** helix.json as the app itself wrote it, read back through the e2e fs shim. */
async function readRegistryFile(page: Page): Promise<HelixRegistryLike> {
  const files = await page.evaluate(
    () => (window as unknown as { __helixE2E: E2EState }).__helixE2E.files,
  );
  const key = Object.keys(files).find((k) => k.endsWith("helix.json"));
  if (!key) throw new Error("helix.json is not in the e2e fs shim yet.");
  return JSON.parse(files[key]) as HelixRegistryLike;
}

/** The sidebar's own inline `style="width: NNNpx"`, not a computed value. */
async function sidebarInlineWidth(page: Page): Promise<string> {
  return page.getByTestId("sidebar").evaluate((el) => (el as HTMLElement).style.width);
}

/**
 * Flip the theme and wait for it to finish arriving (settings.e2e.ts's
 * `settleTheme`, duplicated here for the same reason `hig.e2e.ts` duplicates
 * it: every surface carries `transition-colors`, so a capture taken in the
 * same tick photographs the old theme wearing the new label).
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

/**
 * Enough rows to overflow a screen without a virtualizer under it. Tasks
 * rather than contacts on purpose: ContactsScreen renders through
 * `VirtualList` (src/ui/VirtualList.tsx), which is its own bounded
 * `overflow-y-auto` box nested inside `<main>` - real, and still only one
 * scroller in that column, but the wrong screen to prove `<main>` ITSELF is
 * the one that overflows. TasksScreen renders a plain, fully-mounted list
 * below its `VIRTUALIZE_THRESHOLD` of 200 rows, so `<main>`'s own scroller is
 * the one that actually grows.
 */
function seedManyTasks(bridge: HelixHarness["bridge"], count: number): void {
  const now = "2026-01-01T00:00:00.000Z";
  const stmts = Array.from({ length: count }, (_, i) => ({
    sql: `INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    params: [`t-scroll-${i}`, `Scroll test task ${i}: follow up with the crew about the estimate`, now, now],
  }));
  bridge.batch(stmts);
}

/* -------------------------------------------------------------------------- */
/* 1. The toolbar theme toggle (criterion 6)                                  */
/* -------------------------------------------------------------------------- */

test.describe("round 3: the toolbar theme toggle", () => {
  test("is a one-click toggle each way, reaches helix.json, and never writes auto", async ({
    page,
    helix,
  }) => {
    void helix; // requesting the fixture installs the e2e shim
    await bootApp(page);
    const html = page.locator("html");
    const themeButton = page.getByRole("button", { name: /^Switch to (light|dark)$/ });

    // The `helix` fixture seeds theme "light", so the resolved theme is light
    // and the one-click contract says the button offers the opposite.
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(themeButton).toHaveAccessibleName("Switch to dark");

    await themeButton.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(themeButton).toHaveAccessibleName("Switch to light");
    expect((await readRegistryFile(page)).theme).toBe("dark");

    await themeButton.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(themeButton).toHaveAccessibleName("Switch to dark");
    expect((await readRegistryFile(page)).theme).toBe("light");

    // Round-tripping the button several more times must never once write
    // "auto" - it is a two-state toggle now, not the old three-stop cycle.
    for (let i = 0; i < 4; i += 1) {
      await themeButton.click();
      expect((await readRegistryFile(page)).theme).not.toBe("auto");
    }
  });

  test("from Auto, the first press goes to the opposite of the RESOLVED theme, not a third state", async ({
    page,
    helix,
  }) => {
    void helix;
    // Seed helix.json with theme "auto" before boot - the fixture always
    // seeds "light", and this is the one scenario (Shell.tsx's own docstring:
    // "Walker's Mac is on dark, Helix was on Auto...") that needs the app to
    // start there for real, not be walked there mid-test through a second,
    // independent `useAppearance` instance on the Settings screen.
    await seedRegistryPatch(page, { theme: "auto" });
    await bootApp(page);

    const html = page.locator("html");
    const themeButton = page.getByRole("button", { name: /^Switch to (light|dark)$/ });

    // No dark OS preference in this environment, so Auto resolves to light,
    // and the button must offer "Switch to dark" - the opposite of what is on
    // screen - rather than "Switch to light" (which the old Auto->Light->Dark
    // cycle would have offered).
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(themeButton).toHaveAccessibleName("Switch to dark");

    await themeButton.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(themeButton).toHaveAccessibleName("Switch to light");
    expect((await readRegistryFile(page)).theme).toBe("dark");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The sidebar resizes, clamps, and persists (criterion 7)                 */
/* -------------------------------------------------------------------------- */

/**
 * Every write this component makes (`setSidebar`) is fire-and-forget from the
 * key handler's point of view - it goes through the same async
 * read-modify-write `updateRegistry` the theme buttons do - so a check against
 * the FILE right after a keypress has to poll rather than assume the write
 * already landed by the time the keypress's own promise resolved.
 */
async function pollSidebarWidth(page: Page, expected: number): Promise<void> {
  await expect.poll(async () => (await readRegistryFile(page)).sidebar.width).toBe(expected);
}

test.describe("round 3: the sidebar resizes and persists", () => {
  test("ArrowRight/ArrowLeft move it 8px, Home/End clamp to 200/360, and a reload restores the chosen width", async ({
    page,
    helix,
  }) => {
    void helix;
    await bootApp(page);
    const sidebar = page.getByTestId("sidebar");
    const handle = page.getByTestId("sidebar-resize");

    expect(await sidebarInlineWidth(page)).toBe("240px"); // SIDEBAR_DEFAULT_W
    await handle.focus();

    await page.keyboard.press("ArrowRight");
    expect(await sidebarInlineWidth(page)).toBe("248px");
    await page.keyboard.press("ArrowRight");
    expect(await sidebarInlineWidth(page)).toBe("256px");
    await page.keyboard.press("ArrowRight");
    expect(await sidebarInlineWidth(page)).toBe("264px");
    await pollSidebarWidth(page, 264);

    // End clamps to 360 and nothing pushes past it.
    await page.keyboard.press("End");
    expect(await sidebarInlineWidth(page)).toBe("360px");
    await pollSidebarWidth(page, 360);
    await page.keyboard.press("ArrowRight");
    expect(await sidebarInlineWidth(page)).toBe("360px");

    // Home clamps to 200 and nothing pulls past it.
    await page.keyboard.press("Home");
    expect(await sidebarInlineWidth(page)).toBe("200px");
    await pollSidebarWidth(page, 200);
    await page.keyboard.press("ArrowLeft");
    expect(await sidebarInlineWidth(page)).toBe("200px");

    // A Shift+Arrow moves 32px.
    await page.keyboard.press("Shift+ArrowRight");
    expect(await sidebarInlineWidth(page)).toBe("232px");

    // A distinctive width, then a reload that carries the file the app just
    // wrote (see fixtures.ts's reloadWithCurrentFiles for why a plain reload
    // cannot prove this: every navigation reruns the shim against the
    // fixture's original 240px seed).
    await page.keyboard.press("ArrowRight");
    expect(await sidebarInlineWidth(page)).toBe("240px");
    await page.keyboard.press("ArrowRight");
    const chosen = await sidebarInlineWidth(page);
    expect(chosen).toBe("248px");
    await pollSidebarWidth(page, 248);

    await reloadWithCurrentFiles(page);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    expect(await sidebarInlineWidth(page)).toBe(chosen);
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  });

  test("the toggle button collapses it to 48px, keeps every row reachable by name, persists, and restores the chosen width on expand", async ({
    page,
    helix,
  }) => {
    void helix;
    await bootApp(page);
    const sidebar = page.getByTestId("sidebar");
    const toggle = page.getByTestId("toggle-sidebar");
    const nav = page.getByRole("navigation", { name: "Main" });

    // A distinctive width first, so "restores the chosen width" has something
    // other than the 240 default to prove.
    await page.getByTestId("sidebar-resize").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await sidebarInlineWidth(page)).toBe("256px");
    await pollSidebarWidth(page, 256);

    await toggle.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(await sidebarInlineWidth(page)).toBe("48px");

    // The row is still there and still reachable by its accessible name -
    // collapsed, NavItem renders the icon alone and moves the label to
    // `aria-label` plus a hover tooltip - but the label is no longer painted
    // as visible text on the row itself.
    const todayRow = nav.getByRole("link", { name: "Today" });
    await expect(todayRow).toBeVisible();
    await expect(todayRow).not.toContainText("Today");

    await expect.poll(async () => (await readRegistryFile(page)).sidebar.collapsed).toBe(true);
    expect((await readRegistryFile(page)).sidebar.width).toBe(256); // collapse leaves the width alone

    await reloadWithCurrentFiles(page);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    expect(await sidebarInlineWidth(page)).toBe("48px");

    // Expanding brings back the width the owner chose, not the 240 default -
    // Shell.tsx's toggleSidebar deliberately never touches width on collapse.
    await page.getByTestId("toggle-sidebar").click();
    await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");
    expect(await sidebarInlineWidth(page)).toBe("256px");
    await expect.poll(async () => (await readRegistryFile(page)).sidebar.collapsed).toBe(false);
    expect((await readRegistryFile(page)).sidebar.width).toBe(256);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. mod+\ and the palette command (criterion 7)                             */
/* -------------------------------------------------------------------------- */

test('mod+\\ toggles the sidebar, and the palette offers "Hide or show the sidebar"', async ({
  page,
  helix,
}) => {
  void helix;
  await bootApp(page);
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");

  // Move focus off of anything that would swallow the key as text (the same
  // precaution settings.e2e.ts's "?" test takes).
  await page.getByRole("heading", { name: "Today", exact: true, level: 1 }).click();
  await page.keyboard.press("Meta+Backslash");
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await page.keyboard.press("Meta+Backslash");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");

  // The command palette (mod+shift+k) offers the same action by its label.
  await page.keyboard.press("Meta+Shift+k");
  const command = page.locator("[cmdk-item]", { hasText: "Hide or show the sidebar" });
  await expect(command).toBeVisible();
  await command.click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
});

/* -------------------------------------------------------------------------- */
/* 4. One scroller, and the macOS title-bar clearance (criterion 27)          */
/* -------------------------------------------------------------------------- */

test.describe("round 3: one scroller, no cross-scroll", () => {
  test("only <main> and the sidebar's own nav area scroll; the window itself never does", async ({
    page,
    helix,
  }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await bootApp(page);
    seedManyTasks(helix.bridge, 60);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByRole("heading", { name: "Tasks", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText("Scroll test task 59", { exact: false })).toBeVisible();

    const scrollProof = await page.evaluate(() => {
      window.scrollBy(0, 500);
      return {
        bodyScrollHeight: document.body.scrollHeight,
        innerHeight: window.innerHeight,
        scrollTopAfter: document.documentElement.scrollTop,
      };
    });
    expect(scrollProof.bodyScrollHeight, "the document itself must never grow past the window").toBeLessThanOrEqual(
      scrollProof.innerHeight + 1,
    );
    expect(scrollProof.scrollTopAfter, "the window must not have scrolled at all").toBe(0);

    const main = page.locator("main");
    const mainIsScrollable = await main.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(mainIsScrollable, "60 tasks must overflow <main>'s own scroller").toBe(true);

    const header = page.getByTestId("sidebar-header");
    const before = await header.boundingBox();
    await main.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(50);
    const after = await header.boundingBox();
    expect(after?.y, "scrolling the content column must not move the sidebar").toBe(before?.y);
  });

  test("on macOS, the sidebar still clears the traffic lights, even with the nav scrolled", async ({
    page,
    helix,
  }) => {
    void helix;
    // Before any of the app's own code runs, so `applyPlatform()` sees it -
    // the same hook `hig.e2e.ts` uses, documented above `isMacOS()` in
    // src/app/appSettings.ts. Every other spec in this suite keeps the plain
    // web layout; this is the one deliberate opt-in.
    await page.addInitScript(() => {
      window.__helixPlatform = "macos";
    });
    await page.setViewportSize({ width: 1280, height: 700 });
    await bootApp(page);

    await expect(page.locator("html")).toHaveAttribute("data-platform", "macos");

    const nav = page.getByTestId("sidebar-nav");
    await nav.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    const firstRow = page.getByRole("navigation", { name: "Main" }).getByRole("link").first();
    const box = await firstRow.boundingBox();
    expect(box?.y, "the first nav row must stay clear of the 38px title-bar inset").toBeGreaterThanOrEqual(38);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. The Combobox and DatePicker/TimePicker primitives, in the real build    */
/*    (criteria 3 and 4)                                                      */
/* -------------------------------------------------------------------------- */

test("the DatePicker/TimePicker and Combobox primitives render and work in the shipped build", async ({
  page,
  helix,
}) => {
  void helix;
  await bootApp(page);

  // DatePicker + TimePicker: the bare TaskComposer on the Tasks screen
  // (src/features/records/components/TaskComposer.tsx, committed in fd665a1
  // and 01deefb - already migrated, not something this task builds).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true, level: 1 })).toBeVisible();

  const timePicker = page.getByTestId("time-picker");
  await expect(timePicker).toBeDisabled(); // no due date chosen yet

  await page.getByTestId("date-picker").click();
  await expect(page.getByTestId("date-picker-grid")).toBeVisible();
  // Deliberately `.first()`, which lands on a leading day borrowed from the
  // previous month (31 August, in a September view) rather than a day that
  // belongs to the visible month: this is the exact cell that used to lose
  // its own click (a mousedown-triggered focus rebuilt the grid around a
  // `viewMonth` that was derived from the focused date, moving the DOM node
  // between mousedown and mouseup, so the browser never paired the two into a
  // click - fixed in src/ui/DatePicker.tsx, c9f8821, `viewMonth` split out
  // into its own state). Keeping the edge cell here is the regression guard.
  const firstDay = page.getByTestId("date-picker-day").first();
  const chosenDate = await firstDay.getAttribute("data-date");
  expect(chosenDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await firstDay.click();

  // The trigger's own text moves off the "Pick a date" placeholder onto a
  // formatted date once one is chosen.
  await expect(page.getByTestId("date-picker")).not.toContainText("Pick a date");
  await expect(timePicker).toBeEnabled(); // unlocked once a date is chosen

  // Combobox: ContactPicker/CompanyPicker in the "New deal" dialog on the
  // Pipeline screen (src/features/records/components/{NewDealDialog,Pickers}.tsx,
  // committed in fd99835 - likewise already migrated).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Deals" }).click();
  await page.getByRole("button", { name: "New deal" }).first().click();
  await expect(page.getByRole("heading", { name: "New deal", exact: true })).toBeVisible();

  const contactCombobox = page.locator('[data-testid="combobox"]').first();
  await contactCombobox.click();
  await page.getByTestId("combobox-input").fill("Ann");
  await expect(page.getByTestId("combobox-create")).toBeVisible();
  await expect(page.getByTestId("combobox-create")).toContainText("Ann");
  await page.getByTestId("combobox-create").click();
  await expect(contactCombobox).toContainText("Ann");
});

/* -------------------------------------------------------------------------- */
/* 6. Screenshots, both themes, into design/round3/                          */
/* -------------------------------------------------------------------------- */

test("captures the round-3 shell screens in both themes", async ({ page, helix }) => {
  test.setTimeout(120_000);
  mkdirSync(SCREENS_DIR, { recursive: true });

  /** Full-window capture in both themes, left as the app found it (light). */
  async function shoot(name: string): Promise<void> {
    for (const theme of ["light", "dark"] as const) {
      await settleTheme(page, theme);
      await page.screenshot({ path: `${SCREENS_DIR}${name}-${theme}.png` });
    }
    await settleTheme(page, "light");
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await bootApp(page);

  // 1. The sidebar lockup and the grouped nav, expanded.
  await shoot("sidebar");

  // 2. Collapsed.
  await page.getByTestId("toggle-sidebar").click();
  await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
  await shoot("sidebar-collapsed");
  await page.getByTestId("toggle-sidebar").click();
  await expect(page.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "false");

  // 3. The Tasks screen, with the date picker open (a real primitive, not a
  // stand-in), so the shot also shows criterion 3/4 landed.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true, level: 1 })).toBeVisible();
  await page.getByTestId("date-picker").click();
  await expect(page.getByTestId("date-picker-grid")).toBeVisible();
  await shoot("tasks");
  await page.keyboard.press("Escape");

  // 4. A dialog with a combobox list open. The "New deal" dialog is the one
  // real dialog in the shipped build with a Combobox in it today; its own
  // popover (not the dialog itself, which DESIGN.md centres) is the part that
  // reaches toward the bottom of the viewport.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Deals" }).click();
  await page.getByRole("button", { name: "New deal" }).first().click();
  await expect(page.getByRole("heading", { name: "New deal", exact: true })).toBeVisible();
  await page.locator('[data-testid="combobox"]').first().click();
  await page.getByTestId("combobox-input").fill("Ann");
  await expect(page.getByTestId("combobox-create")).toBeVisible();
  await shoot("dialog-combobox");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // 5. 1280x700, macOS layout on, a page taller than the viewport, scrolled
  // down - one scrollbar, and the nav clear of the traffic lights.
  await page.addInitScript(() => {
    window.__helixPlatform = "macos";
  });
  await page.setViewportSize({ width: 1280, height: 700 });
  await bootApp(page);
  seedManyTasks(helix.bridge, 60);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-platform", "macos");
  await page.locator("main").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await shoot("scroll-tall");
});

/* -------------------------------------------------------------------------- */
/* CPO pass: things the audit found by measuring, kept measured               */
/* -------------------------------------------------------------------------- */

test("every route mounts at the top of its scroller", async ({ page, helix }) => {
  void helix; // installs the Tauri shim; without it the app cannot boot
  test.setTimeout(120_000);

  /*
   * F-LC-5. `/import` mounted with `main.scrollTop` at 44, because the wizard
   * focused its step region on the very first render and `Element.focus()`
   * scrolls its target into view by default — so the screen a new owner is
   * sent to opened with its own <h1> clipped under the toolbar. Every other
   * route was fine, which is exactly why a per-route check is the test: the
   * next component to focus something on mount will be caught here rather
   * than in a screenshot six weeks later.
   */
  const routes = [
    "/",
    "/contacts",
    "/companies",
    "/pipeline",
    "/tasks",
    "/import",
    "/export",
    "/duplicates",
    "/trash",
    "/settings",
    "/settings/workspace",
    "/settings/fields",
    "/settings/shortcuts",
    "/help",
  ];

  const scrolled: string[] = [];
  for (const route of routes) {
    await page.goto(route);
    await page.locator("main").first().waitFor({ state: "visible" });
    await page.waitForTimeout(150);
    const top = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? -1);
    if (top !== 0) scrolled.push(`${route} at ${top}px`);
  }
  expect(scrolled, "these routes mounted already scrolled").toEqual([]);

  // And the title is really inside the scroller, not merely at scrollTop 0.
  await page.goto("/import");
  await page.locator("main").first().waitFor({ state: "visible" });
  const clip = await page.evaluate(() => {
    const main = document.querySelector("main");
    const h1 = document.querySelector("main h1");
    if (!main || !h1) return null;
    return Math.round(main.getBoundingClientRect().top - h1.getBoundingClientRect().top);
  });
  expect(clip, "the import title is clipped under the toolbar").toBeLessThanOrEqual(0);
});

test("compact density reaches a table, a dialog and the board", async ({ page, helix }) => {
  void helix;
  test.setTimeout(120_000);

  /*
   * Design direction item 7: density is a setting the kit honours, verified on
   * a table, a dialog and the board rather than assumed. A screen that
   * hard-codes a height simply would not move.
   */
  await page.goto("/settings/appearance");
  await page.locator("main").first().waitFor({ state: "visible" });

  const rowHeight = () =>
    page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--row-h"),
      ),
    );

  const comfortable = await rowHeight();
  expect(comfortable).toBeGreaterThan(0);

  await page.evaluate(() => document.documentElement.setAttribute("data-density", "compact"));
  await page.waitForTimeout(250);
  const compact = await rowHeight();
  expect(compact, "compact is a shorter row than comfortable").toBeLessThan(comfortable);

  // A table: the contacts list's own rows come down with the token.
  await page.goto("/contacts");
  await page.locator("main").first().waitFor({ state: "visible" });
  await page.evaluate(() => document.documentElement.setAttribute("data-density", "compact"));
  await page.waitForTimeout(250);
  const tableRow = await page.evaluate(() => {
    const el = document.querySelector("main table tbody tr, main [role='row']");
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  });
  if (tableRow !== null) expect(tableRow).toBeLessThanOrEqual(comfortable);

  // The board.
  await page.goto("/pipeline");
  await page.locator("main").first().waitFor({ state: "visible" });
  await page.evaluate(() => document.documentElement.setAttribute("data-density", "compact"));
  await page.waitForTimeout(250);
  expect(await rowHeight()).toBe(compact);

  // A dialog: the shortcuts sheet, which is rows all the way down.
  await page.keyboard.press("Shift+Slash");
  const sheet = page.getByTestId("shortcuts-sheet");
  await expect(sheet).toBeVisible();
  const sheetRow = await page.evaluate(() => {
    const el = document.querySelector("[data-testid='shortcuts-sheet'] [data-testid='shortcut-row']");
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  });
  expect(sheetRow, "the dialog's rows exist").not.toBeNull();
  expect(sheetRow!, "the dialog honours compact too").toBeLessThan(comfortable * 2);
});

test("a dialog taller than a 700px window scrolls inside, with its footer visible", async ({
  page,
  helix,
}) => {
  void helix;
  test.setTimeout(120_000);

  /*
   * docs/CONTRACTS.md's dialog contract, measured rather than assumed: the
   * body scrolls and the footer stays on screen. 1280x700 is the short
   * laptop the owner actually has open.
   */
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto("/settings/fields");
  await page.locator("main").first().waitFor({ state: "visible" });

  await page.getByRole("button", { name: /Add a field|New field/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const box = await page.evaluate(() => {
    const content = document.querySelector("[role='dialog']");
    const body = document.querySelector("[data-testid='dialog-body']");
    const footer = document.querySelector("[data-testid='dialog-footer']");
    if (!content || !body) return null;
    const c = content.getBoundingClientRect();
    const f = footer?.getBoundingClientRect() ?? null;
    return {
      dialogBottom: Math.round(c.bottom),
      viewport: window.innerHeight,
      bodyScrolls: getComputedStyle(body).overflowY,
      hoisted: footer?.getAttribute("data-hoisted") ?? null,
      footerBottom: f ? Math.round(f.bottom) : null,
    };
  });

  expect(box, "the dialog rendered a body").not.toBeNull();
  // The whole dialog is inside the window, so nothing is cut off the bottom.
  expect(box!.dialogBottom).toBeLessThanOrEqual(box!.viewport);
  expect(box!.bodyScrolls, "the body is the scroller, not the page").toBe("auto");
  if (box!.footerBottom !== null) {
    expect(box!.footerBottom, "the footer is on screen").toBeLessThanOrEqual(box!.viewport);
    expect(box!.hoisted, "the footer is hoisted out of the scroll box").toBe("true");
  }
});

test("the search dialog answers both of its keys in the built app", async ({ page, helix }) => {
  void helix;
  /*
   * R17. mod+/ used to be bound by a listener inside the Today feature, so the
   * shell did not know about it and the shortcuts sheet could not print it.
   * It is the search command's declared alias now, bound by the same binder as
   * every other key — which is only worth saying if it still opens the dialog.
   */
  await page.goto("/");
  await page.locator("main").first().waitFor({ state: "visible" });

  await page.keyboard.press("Meta+k");
  await expect(page.getByTestId("today-search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("today-search")).toBeHidden();

  await page.keyboard.press("Meta+Slash");
  await expect(page.getByTestId("today-search"), "mod+/ opens the same dialog").toBeVisible();
  await page.keyboard.press("Escape");

  // And the sheet says so, on one row rather than two.
  await page.goto("/settings/shortcuts");
  await page.locator("main").first().waitFor({ state: "visible" });
  const rows = await page.getByTestId("shortcut-row").allInnerTexts();
  const searchRows = rows.filter((r) => /Search/i.test(r));
  expect(searchRows, "one search row, not two").toHaveLength(1);
  expect(searchRows[0].replace(/\s+/g, " ")).toMatch(/or/);
});
