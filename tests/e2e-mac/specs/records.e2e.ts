/**
 * The records feature end to end: quick add, dedupe, inline autosave,
 * one-tap call + log, the pipeline board's keyboard move, tasks, delete +
 * undo, and trash restore.
 *
 * What this proves: the UI flows write the SQL a real workspace would write,
 * against a real (if temporary) better-sqlite3 file, through the same
 * TanStack Query invalidation the app uses everywhere.
 *
 * What it cannot prove: anything that is actually Rust — the keychain, the
 * real OS opener, backup on a live connection. `tel:` lands in the stubbed
 * opener's `window.__helixE2E.opened`, not on a phone.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4181 E2E_OUT=dist-records npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/records.e2e.ts
 */
import { test, expect } from "../fixtures";
import type { HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The shape of `window.__helixE2E` this spec reads back (see fixtures.ts). */
type E2EState = {
  opened: string[];
  calls: { cmd: string; args: unknown }[];
};

function e2e(page: Page) {
  return page.evaluate(() => (window as unknown as { __helixE2E: E2EState }).__helixE2E);
}

/** The shell (sidebar) has to be on screen before onBoot's mount has landed. */
async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole("navigation")).toBeVisible();
}

function quickAddDialog(page: Page) {
  return page.getByRole("dialog", { name: "Quick add" });
}

/**
 * Open quick add. The shortcut is Cmd+N on macOS (records/quickAdd/host.tsx
 * checks navigator.platform and calls preventDefault), which is what this
 * harness's headless Chromium reports on this machine. Cmd+N can also be
 * read as a browser accelerator, so this falls back to the Cmd+K command
 * palette's "Quick add" entry (index.tsx's `quick-add` command) if the
 * dialog does not show up from the shortcut alone. The palette is on
 * Cmd/Ctrl+Shift+K: Cmd/Ctrl+K belongs to search (docs/CONTRACTS.md).
 */
async function openQuickAdd(page: Page): Promise<void> {
  await waitForShell(page);
  const dialog = quickAddDialog(page);
  await page.keyboard.press("Meta+n");
  try {
    await dialog.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    // The palette is on Cmd+Shift+K since wave 3; Cmd+K is search.
    await page.keyboard.press("Meta+Shift+k");
    await page.getByPlaceholder("Search, or type a command").fill("Quick add");
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
  }
}

/** Quick add a contact (the default tab) and save-and-close with Enter. */
async function quickAddContact(
  page: Page,
  name: string,
  opts: { email?: string; phone?: string } = {},
): Promise<void> {
  await openQuickAdd(page);
  const dialog = quickAddDialog(page);
  const nameField = dialog.getByLabel("Name");
  await nameField.fill(name);
  if (opts.phone) await dialog.getByLabel("Phone").fill(opts.phone);
  if (opts.email) await dialog.getByLabel("Email").fill(opts.email);
  await nameField.press("Enter");
  await expect(dialog).toBeHidden();
}

/** Quick add a task and save-and-close with Enter. */
async function quickAddTask(page: Page, title: string): Promise<void> {
  await openQuickAdd(page);
  const dialog = quickAddDialog(page);
  await dialog.getByRole("tab", { name: "Task", exact: true }).click();
  const titleField = dialog.getByLabel("Title");
  await titleField.fill(title);
  await titleField.press("Enter");
  await expect(dialog).toBeHidden();
}

/** Quick add a deal (the workspace vocabulary defaults to "Deal") and save. */
async function quickAddDeal(page: Page, title: string): Promise<void> {
  await openQuickAdd(page);
  const dialog = quickAddDialog(page);
  await dialog.getByRole("tab", { name: "Deal", exact: true }).click();
  const titleField = dialog.getByLabel("Title");
  await titleField.fill(title);
  await titleField.press("Enter");
  await expect(dialog).toBeHidden();
}

function contactRows(bridge: HelixHarness["bridge"]) {
  return bridge.query(
    "SELECT id, first_name, last_name FROM contacts WHERE deleted_at IS NULL ORDER BY created_at",
    [],
  ) as [string, string, string][];
}

test.describe("records", () => {
  // docs/PLAN.md item 8 (quick add): a contact is one field, Enter, done.
  test("creates a contact through quick add", async ({ page, helix }) => {
    await page.goto("/");
    await quickAddContact(page, "Brent Hendrickson");

    await page.getByRole("navigation").getByRole("link", { name: "Contacts" }).click();
    // Scoped to the contacts list: the "Added Brent Hendrickson" undo toast
    // (still up to 10s from lib/mutations.ts's offerUndoCreate) also
    // contains the substring "Brent Hendrickson".
    await expect(page.getByRole("list", { name: "Contacts" }).getByText("Brent Hendrickson")).toBeVisible();

    const rows = contactRows(helix.bridge);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe("Brent");
    expect(rows[0][2]).toBe("Hendrickson");
  });

  // docs/PLAN.md item 8's dedupe warning: an email or phone that already
  // exists is a warning with a way in, never a hard block, in both the
  // quick-add flow and the /contacts "New contact" dialog.
  test("warns on a duplicate email and still allows creating anyway", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await quickAddContact(page, "Brent Hendrickson", { email: "brent@example.com" });
    expect(contactRows(helix.bridge)).toHaveLength(1);

    // Quick add: the warning shows, but the primary button stays "Save".
    await openQuickAdd(page);
    const quickDialog = quickAddDialog(page);
    await quickDialog.getByLabel("Name").fill("Brent H. Duplicate");
    await quickDialog.getByLabel("Email").fill("brent@example.com");

    const warning = quickDialog.getByTestId("duplicate-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("Brent Hendrickson");
    await expect(warning).toContainText(/email/i);
    await expect(quickDialog.getByRole("button", { name: "Save", exact: true })).toBeVisible();

    await quickDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(quickDialog).toBeHidden();
    expect(contactRows(helix.bridge)).toHaveLength(2);

    // The /contacts "New contact" dialog: same warning, but its own button
    // flips its label to "Create anyway" (NewContactDialog.tsx).
    await page.getByRole("navigation").getByRole("link", { name: "Contacts" }).click();
    await page.getByRole("button", { name: "New contact" }).click();
    const newContactDialog = page.getByRole("dialog", { name: "New contact" });
    await newContactDialog.getByLabel("First name").fill("Brent Third");
    await newContactDialog.getByLabel("Email").fill("brent@example.com");

    const secondWarning = newContactDialog.getByTestId("duplicate-warning");
    await expect(secondWarning).toBeVisible();
    await expect(secondWarning).toContainText("Brent Hendrickson");

    const createAnyway = newContactDialog.getByRole("button", { name: "Create anyway" });
    await expect(createAnyway).toBeVisible();
    await createAnyway.click();
    await expect(newContactDialog).toBeHidden();

    expect(contactRows(helix.bridge)).toHaveLength(3);
  });

  // ContactPage.tsx: "Nothing on this page has a save button. Every field
  // autosaves." (InlineEdit.tsx, ~600ms debounce, then "Saved" for 2s.)
  test("autosaves an inline edit on the contact page", async ({ page, helix }) => {
    await page.goto("/");
    await quickAddContact(page, "Original Name");

    const [[contactId]] = helix.bridge.query(
      "SELECT id FROM contacts WHERE deleted_at IS NULL",
      [],
    ) as [string][];

    await page.goto(`/contacts/${contactId}`);
    const firstName = page.getByLabel("First name");
    await expect(firstName).toHaveValue("Original");

    await firstName.fill("Brenton");
    await expect(page.getByTestId("saved-indicator")).toBeVisible();

    const rows = helix.bridge.query("SELECT first_name FROM contacts WHERE id = ?", [
      contactId,
    ]) as [string][];
    expect(rows[0][0]).toBe("Brenton");

    await page.reload();
    await expect(page.getByLabel("First name")).toHaveValue("Brenton");
  });

  // ContactMethods.tsx: the phone is a real control (one tap dials through
  // the OS opener), and oneTap.ts's toast offers a one-click "Log it" so the
  // call lands on the timeline without a form.
  test("adds a phone and logs a call from it", async ({ page, helix }) => {
    await page.goto("/");
    await quickAddContact(page, "Call Test");

    const [[contactId]] = helix.bridge.query(
      "SELECT id FROM contacts WHERE deleted_at IS NULL",
      [],
    ) as [string][];

    await page.goto(`/contacts/${contactId}`);
    await page.getByRole("button", { name: "Add a phone" }).click();
    // Exact match: "Label for the new phone number" (the label select) also
    // contains the substring "phone number".
    const phoneInput = page.getByLabel("Phone number", { exact: true });
    await phoneInput.fill("(801) 555-0147");
    await phoneInput.press("Enter");

    const phoneRow = page.getByTestId("phone-row");
    await expect(phoneRow).toBeVisible();
    await expect(phoneRow).toHaveCount(1);

    await phoneRow.getByTestId("call-button").click();

    const state = await e2e(page);
    expect(state.opened.some((url) => url.startsWith("tel:"))).toBe(true);

    await page.getByRole("button", { name: "Log it" }).click();

    const callEntry = page.locator('[data-kind="call"]').getByText(/^Called /);
    await expect(callEntry).toBeVisible();

    const activities = helix.bridge.query(
      "SELECT kind, body FROM activities WHERE is_system = 0",
      [],
    ) as [string, string][];
    expect(activities).toHaveLength(1);
    expect(activities[0][0]).toBe("call");
    expect(activities[0][1]).toMatch(/^Called /);
  });

  // PipelineBoard.tsx / lib/board.ts: shift+arrow moves a focused card
  // between stages without a mouse — the documented keyboard-move path.
  test("creates a deal and moves it to the next stage with the keyboard", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await quickAddDeal(page, "Spring Cleanup and Mulch");

    const stages = helix.bridge.query(
      "SELECT id, name, position FROM stages WHERE deleted_at IS NULL ORDER BY position",
      [],
    ) as [string, string, number][];
    expect(stages.length).toBeGreaterThanOrEqual(2);
    const [firstStage, secondStage] = stages;

    const dealRowBefore = helix.bridge.query(
      "SELECT id, stage_id FROM deals WHERE title = ?",
      ["Spring Cleanup and Mulch"],
    ) as [string, string][];
    expect(dealRowBefore).toHaveLength(1);
    const [dealId, stageIdBefore] = dealRowBefore[0];
    expect(stageIdBefore).toBe(firstStage[0]);

    // The sidebar row is named from the vocabulary setting, which is "deals" on
    // a workspace nobody has changed, so it reads "Deals" and matches the
    // heading on the screen it opens.
    await page.getByRole("navigation").getByRole("link", { name: "Deals" }).click();
    const card = page.getByTestId("deal-card").filter({ hasText: "Spring Cleanup and Mulch" });
    await expect(card).toBeVisible();
    await card.focus();
    await page.keyboard.press("Shift+ArrowRight");

    await expect(
      page.locator(`[data-stage-id="${secondStage[0]}"]`).getByTestId("deal-card").filter({
        hasText: "Spring Cleanup and Mulch",
      }),
    ).toBeVisible();

    const dealRowAfter = helix.bridge.query("SELECT stage_id FROM deals WHERE id = ?", [
      dealId,
    ]) as [string][];
    expect(dealRowAfter[0][0]).toBe(secondStage[0]);
  });

  // TaskRow.tsx: the checkbox's accessible name is `Mark "<title>" done`,
  // and completing a task writes done_at and flips the row to Reopen.
  test("marks a task done from the tasks list", async ({ page, helix }) => {
    await page.goto("/");
    await quickAddTask(page, "Call back about the quote");

    await page.getByRole("navigation").getByRole("link", { name: "Tasks" }).click();
    const checkbox = page.getByRole("checkbox", {
      name: 'Mark "Call back about the quote" done',
    });
    await expect(checkbox).toBeVisible();
    await checkbox.click();

    // TasksScreen hides done tasks by default (showDone starts false), so
    // the row disappearing from the open list is itself evidence it saved;
    // flip "Show done" to see it rendered with the Reopen state too.
    await expect(checkbox).toHaveCount(0);
    await page.getByRole("switch", { name: "Show done tasks" }).click();
    await expect(
      page.getByRole("checkbox", { name: 'Reopen "Call back about the quote"' }),
    ).toBeVisible();

    const rows = helix.bridge.query(
      "SELECT done_at FROM tasks WHERE title = ?",
      ["Call back about the quote"],
    ) as [string | null][];
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).not.toBeNull();
  });

  // ContactPage.tsx delete + lib/mutations.ts's deleteWithUndo: soft delete,
  // ten seconds of Undo, and Undo is the exact inverse (restore).
  test("deletes a contact and undoes it", async ({ page, helix }) => {
    await page.goto("/");
    await quickAddContact(page, "Delete Me");

    const [[contactId]] = helix.bridge.query(
      "SELECT id FROM contacts WHERE deleted_at IS NULL",
      [],
    ) as [string][];

    await page.goto(`/contacts/${contactId}`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete contact" }).click();

    await page.waitForURL("**/contacts");
    // Scoped to the contacts list itself: the undo toast's own text
    // ("Deleted Delete Me") also contains the substring "Delete Me".
    const contactsList = page.getByRole("list", { name: "Contacts" });
    await expect(contactsList.getByText("Delete Me")).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(contactsList.getByText("Delete Me")).toBeVisible();

    const rows = helix.bridge.query("SELECT deleted_at FROM contacts WHERE id = ?", [
      contactId,
    ]) as [string | null][];
    expect(rows[0][0]).toBeNull();
  });

  // TrashScreen.tsx: past the undo window, a soft-deleted contact still
  // lives in Trash for 30 days and Restore is the same inverse.
  test("restores a contact from trash after the undo toast expires", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await quickAddContact(page, "Trash Me");

    const [[contactId]] = helix.bridge.query(
      "SELECT id FROM contacts WHERE deleted_at IS NULL",
      [],
    ) as [string][];

    await page.goto(`/contacts/${contactId}`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete contact" }).click();
    await page.waitForURL("**/contacts");

    // Do NOT click Undo: let the toast run out its ten seconds so this
    // exercises the Trash path instead of the Undo path.
    const deletedToast = page.getByText("Deleted Trash Me");
    await expect(deletedToast).toBeVisible();
    await expect(deletedToast).toBeHidden({ timeout: 15000 });

    await page.getByRole("navigation").getByRole("link", { name: "Trash" }).click();
    // The Contacts tab is TrashScreen's default (TYPES[0] in TrashScreen.tsx).
    const row = page.getByRole("row", { name: /Trash Me/ });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Restore" }).click();

    await page.getByRole("navigation").getByRole("link", { name: "Contacts" }).click();
    // Scoped to the contacts list: the "Restored Trash Me" toast also
    // contains the substring "Trash Me".
    await expect(page.getByRole("list", { name: "Contacts" }).getByText("Trash Me")).toBeVisible();

    const rows = helix.bridge.query("SELECT deleted_at FROM contacts WHERE id = ?", [
      contactId,
    ]) as [string | null][];
    expect(rows[0][0]).toBeNull();
  });
});

/**
 * Screenshots of every finished records screen, light and dark, at the
 * 1280 px width DESIGN.md's review pass calls for. They land in
 * tests/e2e-mac/.cache/screens/brand-a/ (gitignored) so the agent that built
 * the screens can look at them and fix what reads wrong.
 */
test.describe("records screens", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const OUT = "tests/e2e-mac/.cache/screens/brand-a";

  /**
   * Flip the theme and wait for it to finish arriving.
   *
   * Every control in src/ui carries `transition-colors`, so the frame right
   * after `data-theme` changes is the OLD colour: a capture taken in the same
   * tick photographs the light theme wearing a dark label. Wait for the
   * canvas to actually change, then give the slowest transition room to land.
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

  /** Dismiss any live toast so it does not sit over the screen being shot. */
  async function settle(page: Page): Promise<void> {
    await page.evaluate(() => {
      document.querySelectorAll("[data-sonner-toast]").forEach((node) => node.remove());
    });
    await page.waitForTimeout(150);
  }

  async function shoot(page: Page, name: string): Promise<void> {
    for (const theme of ["light", "dark"] as const) {
      await settleTheme(page, theme);
      await settle(page);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage: true });
    }
    await settleTheme(page, "light");
  }

  /**
   * The same screen at `data-density="compact"`. Compact is what catches a
   * hard-coded height or font size: every size in the product is a token, so a
   * compact screen is 25% denser and not a broken one (DESIGN.md §7).
   */
  async function shootCompact(page: Page, name: string): Promise<void> {
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-density", "compact");
    });
    await settle(page);
    await page.screenshot({ path: `${OUT}/${name}-compact.png`, fullPage: true });
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-density", "comfortable");
    });
    await settle(page);
  }

  test("captures every screen, light and dark", async ({ page, helix }) => {
    await page.goto("/");
    await waitForShell(page);

    // --- the designed empty states, before anything exists ----------------
    await page.getByRole("navigation").getByRole("link", { name: "Contacts" }).click();
    await expect(page.getByText("No contacts yet")).toBeVisible();
    await shoot(page, "contacts-empty");

    await page.getByRole("navigation").getByRole("link", { name: "Deals" }).click();
    await expect(page.getByRole("heading", { name: "Deals", level: 1 })).toBeVisible();
    await shoot(page, "pipeline-empty");

    await page.getByRole("navigation").getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByText("Nothing to do yet")).toBeVisible();
    await shoot(page, "tasks-empty");

    await page.getByRole("navigation").getByRole("link", { name: "Trash" }).click();
    await expect(page.getByText("Trash is empty")).toBeVisible();
    await shoot(page, "trash-empty");

    // --- fill the workspace ------------------------------------------------
    await page.goto("/");
    await quickAddContact(page, "Brent Hendrickson", {
      email: "brent@example.com",
      phone: "(801) 555-0147",
    });
    await quickAddContact(page, "Marta Reyes", { phone: "(801) 555-0188" });
    // A 47-character name is the edge case DESIGN.md §4 names by hand.
    await quickAddContact(page, "Little Cottonwood Canyon Homeowners Assoc");

    await page.goto("/companies");
    await page.getByRole("button", { name: "New company" }).click();
    const companyDialog = page.getByRole("dialog", { name: "New company" });
    await companyDialog.getByLabel("Company name").fill("Little Cottonwood Canyon Homeowners Association");
    await companyDialog.getByLabel("Phone").fill("(801) 555-0199");
    await companyDialog.getByLabel("Website").fill("lcchoa.example.com");
    await companyDialog.getByRole("button", { name: "Create company" }).click();
    await page.waitForURL(/\/companies\/.+/);

    await page.goto("/");
    await quickAddDeal(page, "Spring cleanup and mulch");
    await quickAddDeal(page, "Retaining wall rebuild");
    await quickAddTask(page, "Call back about the quote");
    await quickAddTask(page, "Drop off the estimate");

    // Give one deal a next step and move one along, so the board is not flat.
    const stages = helix.bridge.query(
      "SELECT id FROM stages WHERE deleted_at IS NULL ORDER BY position",
      [],
    ) as [string][];
    await page.goto("/pipeline");
    const card = page.getByTestId("deal-card").filter({ hasText: "Retaining wall rebuild" });
    await expect(card).toBeVisible();
    await card.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(
      page.locator(`[data-stage-id="${stages[1][0]}"]`).getByTestId("deal-card"),
    ).toHaveCount(1);
    // The card rendering in the next column is optimistic; the screenshots are
    // only honest once the move has actually landed in the database.
    await expect
      .poll(
        () =>
          (
            helix.bridge.query("SELECT stage_id FROM deals WHERE title = ?", [
              "Retaining wall rebuild",
            ]) as [string][]
          )[0][0],
      )
      .toBe(stages[1][0]);
    // `helix.bridge` is the SAME better-sqlite3 connection the app writes
    // through, so the poll above can see the move from inside its still-open
    // transaction. Reloading the page reopens the database, which rolls that
    // transaction back — so give the commit a beat before navigating away,
    // then prove across a real reload that the move is durable.
    await page.waitForTimeout(500);
    await page.goto("/pipeline");
    await expect(
      page.locator(`[data-stage-id="${stages[1][0]}"]`).getByTestId("deal-card"),
    ).toHaveCount(1);

    // --- the full screens ---------------------------------------------------
    await page.goto("/contacts");
    await expect(page.getByRole("list", { name: "Contacts" })).toBeVisible();
    await shoot(page, "contacts-list");

    // The saved-views toolbar, open: a popover is a floating layer and is the
    // one thing on a list screen allowed to cast a shadow.
    await page.getByRole("button", { name: "Views" }).click();
    await shoot(page, "saved-views");
    await page.keyboard.press("Escape");

    const [[contactId]] = helix.bridge.query(
      "SELECT id FROM contacts WHERE first_name = ?",
      ["Brent"],
    ) as [string][];
    await page.goto(`/contacts/${contactId}`);
    await expect(page.getByRole("heading", { name: "Brent Hendrickson", level: 1 })).toBeVisible();
    await shoot(page, "contact-page");
    await shootCompact(page, "contact-page");

    await page.goto("/companies");
    await expect(page.getByRole("list", { name: "Companies" })).toBeVisible();
    await shoot(page, "companies-list");

    const [[companyId]] = helix.bridge.query(
      "SELECT id FROM companies WHERE deleted_at IS NULL",
      [],
    ) as [string][];
    await page.goto(`/companies/${companyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shoot(page, "company-page");

    await page.goto("/pipeline");
    await expect(page.getByTestId("deal-card").first()).toBeVisible();
    // The board must show what the database holds, not what it held before
    // the keyboard move: a stale column here is a bug, not a slow screenshot.
    // The board must show what the database holds, not what it held before
    // the keyboard move: a stale column here would be a bug, not a slow shot.
    await expect(
      page.locator(`[data-stage-id="${stages[1][0]}"]`).getByTestId("deal-card"),
    ).toHaveCount(1);
    await shoot(page, "pipeline-board");
    await shootCompact(page, "pipeline-board");

    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await shoot(page, "pipeline-list");

    await page.getByRole("button", { name: "Stages" }).click();
    await expect(page.getByRole("dialog", { name: "Stages" })).toBeVisible();
    await shoot(page, "stage-manager");
    await page.getByRole("button", { name: "Done" }).click();

    const [[dealId]] = helix.bridge.query(
      "SELECT id FROM deals WHERE title = ?",
      ["Spring cleanup and mulch"],
    ) as [string][];
    await page.goto(`/deals/${dealId}`);
    await expect(
      page.getByRole("heading", { name: "Spring cleanup and mulch", level: 1 }),
    ).toBeVisible();
    await shoot(page, "deal-page");

    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
    await shoot(page, "tasks-list");

    // --- quick add and the trash with something in it -----------------------
    await openQuickAdd(page);
    await expect(quickAddDialog(page)).toBeVisible();
    await shoot(page, "quick-add");
    await page.keyboard.press("Escape");

    await page.goto(`/contacts/${contactId}`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete contact" }).click();
    await page.waitForURL("**/contacts");
    await page.goto("/trash");
    await expect(page.getByRole("table")).toBeVisible();
    await shoot(page, "trash-list");
  });
});
