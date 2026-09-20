/**
 * Contacts list: click-to-sort headers and arrow-key row navigation
 * (apple-hig-review.md finding 6 / top-ten item 9 - "give the record lists
 * click-to-sort and arrow-key navigation, reusing the sortable TH that
 * already exists"). ContactsScreen.tsx wires the column strip's "Name"
 * header and VirtualList's `keyboardNav` to the same `sort` state the
 * "Sort" Select already drives; CompaniesScreen.tsx and TasksScreen.tsx get
 * the same treatment and are covered at the unit level
 * (tests/unit/ui/sortableHeader.test.ts, tests/unit/ui/useRovingRowNav.test.ts,
 * tests/unit/ui/virtualList.test.ts).
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4207 E2E_OUT=dist-hig npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/listNav.e2e.ts
 */
import { test, expect } from "../fixtures";
import type { HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

/** Three contacts already in first-name order, so the default "Name A to Z"
 *  sort needs no client-side reasoning to verify - the seed order IS the
 *  expected order. */
function seedContacts(bridge: HelixHarness["bridge"]): void {
  const rows: [string, string, string][] = [
    ["c-alpha", "Alpha", "Anderson"],
    ["c-bravo", "Bravo", "Brown"],
    ["c-charlie", "Charlie", "Clark"],
  ];
  for (const [id, first, last] of rows) {
    bridge.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, first, last, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    );
  }
}

function contactsList(page: Page) {
  return page.getByRole("list", { name: "Contacts" });
}

/** The shell (sidebar) has to be on screen before onBoot's migrations have
 *  run - the `contacts` table does not exist until then, so a spec that
 *  seeds through `helix.bridge` straight from the fixture (before any page
 *  has loaded) hits "no such table: contacts". */
async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole("navigation")).toBeVisible();
}

/** The row names, top to bottom, as the virtualised list currently renders
 *  them (all three fit on screen without scrolling, so nothing is virtualised
 *  out of the DOM).
 *
 *  Read from the name cell by its test id rather than from the row's whole
 *  text: the row now also holds a company cell, a next-step cell and a phone
 *  control that is itself a button, so both `allTextContents()` on the row and
 *  a `getByRole("button")` sweep pick up more than the name (CPO pass,
 *  F-LA-7). */
async function visibleNames(page: Page): Promise<string[]> {
  return contactsList(page).getByTestId("contact-row-name").allTextContents();
}

test.describe("contacts list: sort and keyboard", () => {
  test("clicking the Name header sorts the list and stays in sync with the Sort select", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await waitForShell(page);
    seedContacts(helix.bridge);
    await page.goto("/contacts");

    const header = page.getByRole("columnheader", { name: "Name" });
    const sortSelect = page.getByRole("combobox", { name: "Sort" });

    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(sortSelect).toHaveText("Name A to Z");
    expect(await visibleNames(page)).toEqual([
      "Alpha Anderson",
      "Bravo Brown",
      "Charlie Clark",
    ]);

    await header.getByRole("button", { name: "Name" }).click();

    await expect(header).toHaveAttribute("aria-sort", "descending");
    await expect(sortSelect).toHaveText("Name Z to A");
    expect(await visibleNames(page)).toEqual([
      "Charlie Clark",
      "Bravo Brown",
      "Alpha Anderson",
    ]);

    // Reverses again on a second click, back to where it started.
    await header.getByRole("button", { name: "Name" }).click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(sortSelect).toHaveText("Name A to Z");
  });

  test("arrow keys move focus one row at a time, and Enter opens the focused contact", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await waitForShell(page);
    seedContacts(helix.bridge);
    await page.goto("/contacts");

    const rows = contactsList(page).getByRole("button");
    await expect(rows).toHaveCount(3);

    const first = rows.nth(0);
    await first.focus();
    await expect(first).toHaveAttribute("tabindex", "0");
    // Roving tabindex: the list is one tab stop, not three.
    await expect(rows.nth(1)).toHaveAttribute("tabindex", "-1");
    await expect(rows.nth(2)).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await expect(rows.nth(1)).toHaveAttribute("tabindex", "0");
    await expect(rows.nth(0)).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(2)).toBeFocused();

    // End of the list: ArrowDown again is a no-op, not a wrap-around.
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(2)).toBeFocused();

    await page.keyboard.press("ArrowUp");
    await expect(rows.nth(1)).toBeFocused();

    await page.keyboard.press("Enter");
    await page.waitForURL(/\/contacts\/c-bravo$/);
    await expect(page.getByRole("heading", { name: "Bravo Brown", level: 1 })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* The guard that was missing (phase two)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every contact is reachable.
 *
 * The two tests above seed THREE contacts, which is fewer than a viewport
 * holds, so they pass under every broken arrangement of the list's height —
 * and one such arrangement shipped: `VirtualList fit` against a content-height
 * panel settled the scroller at roughly one screen of rows and never grew, so
 * a 16-contact workspace rendered 10 rows, showed no scrollbar, and still said
 * "16 of 16 people" in its own header. A list that silently hides records is
 * the worst thing this product can do, and nothing here caught it.
 *
 * What these two hold, and why each matters:
 *  - the rendered count equals the header's own count, so the screen cannot
 *    contradict itself;
 *  - with more rows than fit, scrolling reaches the last one, in both
 *    densities — compact changes the row height, which is what feeds the
 *    virtualiser's arithmetic, so it is a genuinely different case.
 */
function seedMany(bridge: HelixHarness["bridge"], count: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const last = `Row${String(i).padStart(3, "0")}`;
    names.push(`Person ${last}`);
    bridge.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at)
       VALUES (?, 'Person', ?, ?, ?)`,
      [`c-many-${i}`, last, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    );
  }
  return names;
}

/** Set the density AFTER navigation and prove it stuck: the shell re-applies
 *  appearance from helix.json when it mounts, so an attribute set before a
 *  goto is silently reverted (src/app/appSettings.ts). */
async function setDensity(page: Page, density: "comfortable" | "compact"): Promise<void> {
  await page.evaluate((d) => document.documentElement.setAttribute("data-density", d), density);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-density"))).toBe(
    density,
  );
}

test.describe("contacts list: every row is reachable", () => {
  test.use({ viewport: { width: 1280, height: 820 } });

  test("the rendered rows match the header's own count", async ({ page, helix }) => {
    await page.goto("/");
    await waitForShell(page);
    seedMany(helix.bridge, 16);
    await page.goto("/contacts");
    await expect(page.getByText("16 of 16 people")).toBeVisible();
    await expect(page.getByTestId("contact-row-name")).toHaveCount(16);
  });

  for (const density of ["comfortable", "compact"] as const) {
    test(`40 contacts: the last one can be scrolled to in ${density}`, async ({ page, helix }) => {
      await page.goto("/");
      await waitForShell(page);
      seedMany(helix.bridge, 40);
      await page.goto("/contacts");
      await expect(page.getByText("40 of 40 people")).toBeVisible();
      await setDensity(page, density);

      // A virtualised row does not exist in the DOM until the scroller reaches
      // it, so waiting on the locator is waiting forever. Drive the scroller
      // instead, which is also what the owner does.
      // The kit marks the `fit` scroller with `data-fit` (src/ui/VirtualList.tsx).
      const scroller = page.locator("[data-fit]");
      const reach = async (text: string, to: "top" | "bottom") => {
        for (let i = 0; i < 40; i += 1) {
          if ((await page.getByTestId("contact-row-name").filter({ hasText: text }).count()) > 0) {
            return true;
          }
          await scroller.evaluate(
            (el, dir) => {
              el.scrollTop = dir === "bottom" ? el.scrollTop + el.clientHeight : 0;
            },
            to,
          );
          await page.waitForTimeout(120);
        }
        return false;
      };

      // The list must actually be scrollable: a scroller no taller than its
      // content is the shape that silently hid rows before.
      const metrics = await scroller.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

      expect(await reach("Person Row039", "bottom")).toBe(true);
      await expect(
        page.getByTestId("contact-row-name").filter({ hasText: "Person Row039" }),
      ).toBeVisible();

      // And the first is still reachable on the way back.
      expect(await reach("Person Row000", "top")).toBe(true);
      await expect(
        page.getByTestId("contact-row-name").filter({ hasText: "Person Row000" }),
      ).toBeVisible();
    });
  }
});
