/**
 * LR-PX-C: bulk actions on the Contacts list.
 *
 * Ticks a run of rows (one plain click, one shift-click), runs one bulk
 * action, and proves it landed as ONE undoable batch: one toast, the tag on
 * every row, and Undo (or Cmd+Z) taking it all back in one step.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4320 E2E_OUT=dist-pxc-bulk npm run e2e:mac -- px-c-bulk.e2e.ts
 */
import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

function quickAddDialog(page: Page) {
  return page.getByRole("dialog", { name: "Quick add" });
}

async function openQuickAdd(page: Page): Promise<void> {
  await expect(page.getByRole("navigation")).toBeVisible();
  const dialog = quickAddDialog(page);
  await page.keyboard.press("Meta+n");
  try {
    await dialog.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    await page.keyboard.press("Meta+Shift+k");
    await page.getByPlaceholder("Search, or type a command").fill("Quick add");
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
  }
}

async function quickAddContact(page: Page, name: string): Promise<void> {
  await openQuickAdd(page);
  const dialog = quickAddDialog(page);
  const nameField = dialog.getByLabel("Name");
  await nameField.fill(name);
  await nameField.press("Enter");
  await expect(dialog).toBeHidden();
}

test.describe("bulk actions: Contacts", () => {
  test("selects a run of rows, adds a tag to all of them in one batch, and undoes it", async ({
    page,
    helix,
  }) => {
    await page.goto("/");

    // Three contacts, named so the list's default "Name A to Z" sort keeps
    // them in creation order — the shift-click range below relies on that.
    await quickAddContact(page, "Alpha One");
    await quickAddContact(page, "Bravo Two");
    await quickAddContact(page, "Charlie Three");

    // A tag to bulk-add. Inserted straight into the database, the same way
    // records.e2e.ts arranges rows it does not need a form for — the schema
    // only exists once the app's own migrator has run, hence after goto("/").
    const now = new Date().toISOString();
    helix.bridge.execute(
      `INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["e2e-tag-repeat", "Repeat", "var(--stage-1)", now, now],
    );

    await page.goto("/contacts");
    const contactsList = page.getByRole("list", { name: "Contacts" });
    await expect(contactsList).toBeVisible();

    // No bulk bar until something is ticked.
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);

    // Tick the first row.
    await page.getByRole("checkbox", { name: "Select Alpha One" }).click();
    await expect(page.getByTestId("bulk-bar")).toBeVisible();
    await expect(page.getByTestId("bulk-bar-count")).toHaveText("1 person selected");

    // Shift-click the third row: the inclusive range, all three now selected.
    await page
      .getByRole("checkbox", { name: "Select Charlie Three" })
      .click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("bulk-bar-count")).toHaveText("3 people selected");

    // Add the tag to the whole run through the bulk bar's menu.
    await page.getByRole("button", { name: "Add tag" }).click();
    await page.getByRole("menuitem", { name: "Repeat" }).click();

    // Exactly one toast for the whole batch, past tense, with Undo.
    const toast = page.getByText("Added the tag Repeat to 3 people");
    await expect(toast).toBeVisible();

    // The selection clears once the action runs.
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);

    const linksAfterAdd = helix.bridge.query(
      `SELECT count(*) FROM tag_links WHERE tag_id = ? AND entity_type = 'contact' AND deleted_at IS NULL`,
      ["e2e-tag-repeat"],
    ) as [number][];
    expect(linksAfterAdd[0][0]).toBe(3);

    // One batch, one undo: pressing it once removes the tag from all three.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Undone: added the tag Repeat to 3 people")).toBeVisible();

    const linksAfterUndo = helix.bridge.query(
      `SELECT count(*) FROM tag_links WHERE tag_id = ? AND entity_type = 'contact' AND deleted_at IS NULL`,
      ["e2e-tag-repeat"],
    ) as [number][];
    expect(linksAfterUndo[0][0]).toBe(0);
  });
});
