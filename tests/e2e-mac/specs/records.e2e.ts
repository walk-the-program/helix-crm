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
import type { Locator, Page } from "@playwright/test";

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

    // The card moves optimistically; the write behind it is a transaction that
    // also stamps the stage event and the timeline entry, so poll rather than
    // read once.
    await expect
      .poll(
        () =>
          (
            helix.bridge.query("SELECT stage_id FROM deals WHERE id = ?", [dealId]) as [
              string,
            ][]
          )[0][0],
      )
      .toBe(secondStage[0]);
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

  // ContactsScreen.tsx's "Show as" and "Hide contacts without a name": a
  // company-only row (what a website or CSV import creates when there is no
  // person's name) can be hidden without touching the SQL count, and grouped
  // under its company's header when the list is shown "By company".
  test("hides unnamed contacts and groups the rest by company", async ({ page, helix }) => {
    await page.goto("/");
    await waitForShell(page);

    // A company-only contact, the shape a website/CSV import creates — there
    // is no UI path to this today, so it is written straight through the
    // bridge, the same way tests/e2e-mac/specs/depth.e2e.ts seeds a company.
    helix.bridge.execute(
      `INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ["co-acme", "Acme Corp", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    );
    helix.bridge.execute(
      `INSERT INTO contacts (id, first_name, last_name, company_id, created_at, updated_at)
       VALUES (?, '', '', ?, ?, ?)`,
      ["c-company-only", "co-acme", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    );
    await quickAddContact(page, "Priya Shah");

    await page.getByRole("navigation").getByRole("link", { name: "Contacts" }).click();
    const contactsList = page.getByRole("list", { name: "Contacts" });
    await expect(contactsList.getByText("Priya Shah")).toBeVisible();
    await expect(page.getByText("2 of 2 people")).toBeVisible();

    // Toggle the filter: the company-only row disappears and only the named
    // contact is left.
    await page.getByRole("switch", { name: "Hide contacts without a name" }).click();
    await expect(page.getByText("1 of 1 person")).toBeVisible();
    await expect(contactsList.getByText("Priya Shah")).toBeVisible();

    // Switch to "By company": Priya has no company, so she groups under the
    // "No company" header.
    await page.getByRole("combobox", { name: "Show as" }).click();
    await page.getByRole("option", { name: "By company" }).click();
    await expect(contactsList.getByText("No company")).toBeVisible();
    await expect(contactsList.getByText("Priya Shah")).toBeVisible();

    // Both settings persist across a reload — they are workspace settings,
    // not component state.
    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Hide contacts without a name" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("combobox", { name: "Show as" })).toHaveText("By company");
    await expect(page.getByRole("list", { name: "Contacts" }).getByText("No company")).toBeVisible();

    // Turning the filter back off brings the company-only contact back,
    // grouped under Acme Corp.
    await page.getByRole("switch", { name: "Hide contacts without a name" }).click();
    await expect(page.getByRole("list", { name: "Contacts" }).getByText("Acme Corp")).toBeVisible();

    const rows = helix.bridge.query(
      "SELECT first_name, last_name, company_id FROM contacts ORDER BY created_at",
      [],
    ) as [string, string, string | null][];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r[2] === "co-acme")).toEqual(["", "", "co-acme"]);
  });

  // -------------------------------------------------------------------------
  // Round 3, criteria 3 and 4: the record pickers and the date fields.
  // -------------------------------------------------------------------------


/**
   * Choose an exact date from the in-app DatePicker.
   *
   * The popover opens on the month of whatever the field already holds - a
   * yearly reminder defaults a year out - so this pages to the target month
   * before clicking the day. Each cell carries its own `data-date`, so the
   * click is never ambiguous between two months showing the same digit.
   */
  async function pickDate(page: Page, trigger: Locator, target: string): Promise<void> {
    await trigger.click();
    await expect(page.getByTestId("date-picker-grid")).toBeVisible();
    const day = page.locator(`[data-testid="date-picker-day"][data-date="${target}"]`);
    const back = page.getByRole("button", { name: "Previous month" });
    const forward = page.getByRole("button", { name: "Next month" });

    for (let hop = 0; hop < 30 && (await day.count()) === 0; hop += 1) {
      const heading = await page.getByTestId("date-picker-grid").getAttribute("aria-label");
      const shown = new Date(`${heading} 1`);
      const wanted = new Date(`${target}T00:00:00`);
      await (shown > wanted ? back : forward).click();
    }
    await day.click();
  }

  /** A local YYYY-MM-DD this many days from today, the way the app stores it. */
  function localDateIn(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
  }

  /**
   * Pick a row out of a Combobox. The popover is portaled to the body, so the
   * options are looked up on the page and not inside the dialog.
   */
  async function pickFromCombobox(
    page: Page,
    trigger: ReturnType<Page["getByRole"]>,
    query: string,
    optionText: string,
  ): Promise<void> {
    await trigger.click();
    await page.getByTestId("combobox-input").fill(query);
    await page
      .getByTestId("combobox-option")
      .filter({ hasText: optionText })
      .first()
      .click();
  }

  // Walker: "it should let me start typing and then it'll autofill... if I
  // pick one, it should automatically fill the company."
  test("new deal: typing finds the contact and fills their company", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await quickAddContact(page, "Priya Raman");

    // Give her a company through the company combobox's create row, which is
    // the same "Add “…”" path the deal form offers.
    const [[contactId]] = contactRows(helix.bridge);
    await page.goto(`/contacts/${contactId}`);
    const companyPicker = page.getByRole("combobox", { name: "Company" });
    await companyPicker.click();
    await page.getByTestId("combobox-input").fill("Acme Roofing");
    await page.getByTestId("combobox-create").click();
    await expect(companyPicker).toContainText("Acme Roofing");

    // Now the deal form: three characters, pick her, and the company fills.
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "New deal" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New deal" });
    await dialog.getByLabel("Title").fill("Re-roof at 14 Elm");

    await pickFromCombobox(
      page,
      dialog.getByRole("combobox", { name: "Contact" }),
      "Pri",
      "Priya Raman",
    );

    await expect(dialog.getByRole("combobox", { name: "Contact" })).toContainText(
      "Priya Raman",
    );
    await expect(dialog.getByRole("combobox", { name: "Company" })).toContainText(
      "Acme Roofing",
    );
  });

  // Walker: "When I hit New Deal and then Contact, the list is off the screen.
  // That 100% needs to be fixed."
  test("the contact list stays on screen in a short window", async ({
    page,
    helix,
  }) => {
    void helix; // the fixture is what provisions the workspace this test needs
    await page.goto("/");
    await quickAddContact(page, "Priya Raman");

    // Shortened only once the workspace is up: the complaint is about a short
    // window, not about booting into one.
    await page.setViewportSize({ width: 1280, height: 620 });
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "New deal" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New deal" });
    await dialog.getByRole("combobox", { name: "Contact" }).click();

    const list = page.getByTestId("combobox-option").first();
    await expect(list).toBeVisible();

    const box = await list.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    // Every option the owner can see is inside the window, top and bottom.
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  });

  // Criterion 3: no native date control survives anywhere in records.
  test("a task's due date is chosen with the in-app date picker", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await openQuickAdd(page);
    const dialog = quickAddDialog(page);
    await dialog.getByRole("tab", { name: "Task", exact: true }).click();
    await dialog.getByLabel("Title").fill("Call about the roof");

    // The native control would be an <input type="date">; this is a button
    // that opens a grid drawn by the app. Each day cell carries its own
    // data-date, so the test picks an exact day rather than a digit that an
    // adjacent month also shows.
    await expect(dialog.locator('input[type="date"]')).toHaveCount(0);
    const target = localDateIn(3);
    await pickDate(page, dialog.getByTestId("date-picker").first(), target);

    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();

    const rows = helix.bridge.query(
      "SELECT title, due_on FROM tasks WHERE deleted_at IS NULL",
      [],
    ) as [string, string | null][];
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe(target);
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

  /**
   * Round 3's four review shots, into design/round3/: the states Walker
   * called out, each with its picker open so the popover is in the frame.
   */
  test("round 3 review shots", async ({ page, helix }) => {
    const ROUND3 = "design/round3";

    async function shootTo(name: string): Promise<void> {
      for (const theme of ["light", "dark"] as const) {
        await settleTheme(page, theme);
        await settle(page);
        await page.screenshot({ path: `${ROUND3}/${name}-${theme}.png` });
      }
      await settleTheme(page, "light");
    }

    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();

    // --- the Create contact dialog (criterion 10: spacing) ------------------
    await page.goto("/contacts");
    await page.getByRole("button", { name: "New contact" }).click();
    const contactDialog = page.getByRole("dialog", { name: "New contact" });
    await expect(contactDialog).toBeVisible();
    await contactDialog.getByLabel("First name").fill("Priya");
    await contactDialog.getByLabel("Email").fill("priya@acme.example");

    // Criterion 10: the last field keeps at least --space-6 (24px) of clear
    // air above the footer, and more than the gap between two fields, so the
    // footer reads as a separate zone rather than the next row down.
    const gap = await contactDialog.evaluate((node) => {
      const email = node.querySelector<HTMLElement>('input[type="email"]');
      const phone = node.querySelector<HTMLElement>('input[type="tel"]');
      const footer = node.querySelector<HTMLElement>("button")?.closest("div");
      const confirm = Array.from(node.querySelectorAll("button")).find(
        (b) => b.textContent?.trim().startsWith("Create"),
      ) as HTMLElement | undefined;
      if (!email || !phone || !confirm || !footer) return null;
      return {
        toFooter: confirm.getBoundingClientRect().top - email.getBoundingClientRect().bottom,
        betweenFields:
          email.getBoundingClientRect().top - phone.getBoundingClientRect().bottom,
      };
    });
    expect(gap).not.toBeNull();
    expect(gap!.toFooter).toBeGreaterThanOrEqual(24);
    expect(gap!.toFooter).toBeGreaterThan(gap!.betweenFields);

    await shootTo("records-create-contact");
    await contactDialog.getByRole("button", { name: /^Create contact$/ }).click();
    await expect(contactDialog).toBeHidden();

    // --- New deal with the contact combobox open (criterion 4) --------------
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "New deal" }).first().click();
    const dealDialog = page.getByRole("dialog", { name: "New deal" });
    await dealDialog.getByLabel("Title").fill("Re-roof at 14 Elm");
    await dealDialog.getByRole("combobox", { name: "Contact" }).click();
    await page.getByTestId("combobox-input").fill("Pri");
    await expect(page.getByTestId("combobox-option").first()).toBeVisible();
    await shootTo("records-new-deal-combobox");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // --- Tasks with the date picker open (criterion 3) ----------------------
    await openQuickAdd(page);
    const quick = quickAddDialog(page);
    await quick.getByRole("tab", { name: "Task", exact: true }).click();
    await quick.getByLabel("Title").fill("Call about the roof");
    await quick.getByTestId("date-picker").first().click();
    await expect(page.getByTestId("date-picker-grid")).toBeVisible();
    await shootTo("records-task-date-picker");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // --- the deal page services picker (criterion 11) -----------------------
    const contactId = contactRows(helix.bridge)[0][0];
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "New deal" }).first().click();
    const second = page.getByRole("dialog", { name: "New deal" });
    await second.getByLabel("Title").fill("Gutter work at 14 Elm");
    await second.getByRole("button", { name: /^Create/ }).click();
    await expect(second).toBeHidden();
    void contactId;

    const dealId = (
      helix.bridge.query("SELECT id FROM deals WHERE deleted_at IS NULL LIMIT 1", []) as [
        string,
      ][]
    )[0][0];
    await page.goto(`/deals/${dealId}`);
    const servicesAction = page
      .getByTestId("deal-services-panel")
      .getByTestId("combobox");
    await expect(servicesAction).toBeVisible();
    await servicesAction.click();
    await expect(page.getByTestId("combobox-input")).toBeVisible();
    await shootTo("records-deal-services-picker");
  });
});

/* -------------------------------------------------------------------------- */
/* CPO pass regressions (2026-09-20)                                           */
/* -------------------------------------------------------------------------- */

/**
 * One test per finding from the CPO audit that only the real UI can hold.
 * Each one failed before the fix it names; the comment says what it looked
 * like, because a regression test whose reason is lost gets deleted by the
 * next person who finds it slow.
 */
test.describe("records: CPO regressions", () => {
  /**
   * F-LA-1. `save()` set React state and nothing checked it, so a second
   * Enter arriving before the re-render created a second row. The audit walk
   * produced two identical $2,500 deals from two keypresses.
   */
  test("two fast Enters in quick add create one record, not two", async ({ page, helix }) => {
    await page.goto("/");
    await openQuickAdd(page);
    const dialog = quickAddDialog(page);
    await dialog.getByRole("tab", { name: "Deal", exact: true }).click();
    const titleField = dialog.getByLabel("Title");
    await titleField.fill("Double submit probe");
    // Both keydowns in ONE task, which is the race the guard exists for: a
    // second Enter that lands before React has re-rendered `saving`. Sending
    // them as two Playwright presses cannot reproduce it - the first press
    // detaches the input, and the second would just wait for it.
    await titleField.evaluate((el) => {
      const fire = () =>
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      fire();
      fire();
    });
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(1200);

    const rows = helix.bridge.query(
      "SELECT id FROM deals WHERE title = ? AND deleted_at IS NULL",
      ["Double submit probe"],
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * F-LA-2. The board's subtitle totalled every column `deals.board()`
   * returns — won and lost included — and called the result "open". The
   * landscaping sample read "10 open" for 7 open deals.
   */
  test("the pipeline headline counts open deals only", async ({ page, helix }) => {
    await page.goto("/");
    await quickAddDeal(page, "Still open");
    await quickAddDeal(page, "Already won");

    const wonStage = helix.bridge.query(
      "SELECT id FROM stages WHERE is_won = 1 AND deleted_at IS NULL LIMIT 1",
      [],
    );
    expect(wonStage.length).toBe(1);
    helix.bridge.execute("UPDATE deals SET stage_id = ?, closed_at = ? WHERE title = ?", [
      String(wonStage[0][0]),
      new Date().toISOString(),
      "Already won",
    ]);

    await page.goto("/pipeline");
    await page.reload();
    await expect(page.getByTestId("pipeline-total")).toHaveText(/^1 open/);
    // The won deal is still ON the board — its column is a drop target — it
    // just is not counted as open.
    await expect(page.getByTestId("deal-card").filter({ hasText: "Already won" })).toBeVisible();
  });

  /**
   * F-LA-5. A contact page had a timeline, tasks, reminders and ten field
   * groups and no jobs on it, so the only route to a person's work was the
   * board.
   */
  test("the contact page lists the person's jobs", async ({ page, helix }) => {
    await page.goto("/");
    await quickAddContact(page, "Priya Raghunathan", { phone: "(801) 555-0120" });

    const contact = helix.bridge.query("SELECT id FROM contacts LIMIT 1", []);
    const stage = helix.bridge.query(
      "SELECT id FROM stages WHERE is_won = 0 AND is_lost = 0 AND deleted_at IS NULL LIMIT 1",
      [],
    );
    const now = new Date().toISOString();
    helix.bridge.execute(
      `INSERT INTO deals (id, created_at, updated_at, title, value_cents, currency, stage_id,
         stage_entered_at, position, contact_id, one_time_cents, recurring_monthly_cents,
         suggested_total_cents)
       VALUES ('deal-cp-1', ?, ?, 'Full front yard redesign', 1480000, 'USD', ?, ?, 0, ?, 0, 0, 0)`,
      [now, now, String(stage[0][0]), now, String(contact[0][0])],
    );

    await page.goto(`/contacts/${String(contact[0][0])}`);
    await page.reload();
    await expect(page.getByRole("link", { name: /Full front yard redesign/ })).toBeVisible();
  });

  /**
   * F-LA-3 and F-LA-10. The strip read "Quoted $0" on a won deal because it
   * summed quote documents, and the "Won on" row told the owner to "change it
   * by moving the stage again" — which the stage picker cannot do.
   */
  test("a won deal shows what it was won for, and its date can be corrected", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await quickAddDeal(page, "Weed control, 600 feet of fence line");
    const deal = helix.bridge.query("SELECT id FROM deals LIMIT 1", []);
    const dealId = String(deal[0][0]);
    const wonStage = helix.bridge.query(
      "SELECT id FROM stages WHERE is_won = 1 AND deleted_at IS NULL LIMIT 1",
      [],
    );
    helix.bridge.execute(
      "UPDATE deals SET value_cents = 145000, stage_id = ?, closed_at = ? WHERE id = ?",
      [String(wonStage[0][0]), "2026-09-10T12:00:00.000Z", dealId],
    );

    await page.goto(`/deals/${dealId}`);
    await page.reload();
    const strip = page.getByTestId("deal-money");
    await expect(strip).toContainText("Won");
    await expect(page.getByTestId("deal-value")).toHaveText("$1,450");

    // Correcting the date writes closed_at without a second stage event.
    const eventsBefore = helix.bridge.query(
      "SELECT count(*) FROM deal_stage_events WHERE deal_id = ?",
      [dealId],
    )[0][0];
    await page.getByRole("button", { name: "Change the date" }).click();
    await expect(page.getByTestId("dialog-body").getByTestId("date-picker")).toBeVisible();
    await page.getByRole("button", { name: "Save the date" }).click();
    await page.waitForTimeout(800);
    const eventsAfter = helix.bridge.query(
      "SELECT count(*) FROM deal_stage_events WHERE deal_id = ?",
      [dealId],
    )[0][0];
    expect(Number(eventsAfter)).toBe(Number(eventsBefore));
    // The deal is still won: correcting a date must not reopen anything.
    expect(
      helix.bridge.query("SELECT closed_at FROM deals WHERE id = ?", [dealId])[0][0],
    ).not.toBeNull();
  });
});

test.describe("records: merged-away records", () => {
  /**
   * CPO audit, scenario 7. A merge loser is soft-deleted, so its page rendered
   * exactly like any trashed record: an "Archived" badge and a Restore button.
   * Restoring it would rebuild an empty duplicate of someone who already
   * exists, because the merge moved every task, deal and activity to the
   * survivor. The page has to say what actually happened instead.
   */
  test("a merged-away contact names its survivor and offers no Restore", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await waitForShell(page);

    const now = new Date().toISOString();
    helix.bridge.execute(
      `INSERT INTO contacts (id, created_at, updated_at, first_name, last_name)
       VALUES ('c-survivor', ?, ?, 'Marla', 'Quintero')`,
      [now, now],
    );
    helix.bridge.execute(
      `INSERT INTO contacts (id, created_at, updated_at, first_name, last_name, deleted_at)
       VALUES ('c-loser', ?, ?, 'Marla', 'Q', ?)`,
      [now, now, now],
    );
    helix.bridge.execute(
      `INSERT INTO contacts (id, created_at, updated_at, first_name, last_name, deleted_at)
       VALUES ('c-plain', ?, ?, 'Hollis', 'Fenwick', ?)`,
      [now, now, now],
    );
    helix.bridge.execute(
      `INSERT INTO merges (id, created_at, updated_at, entity_type, survivor_id, loser_id,
         batch_id, at)
       VALUES ('m-1', ?, ?, 'contact', 'c-survivor', 'c-loser', 'b-1', ?)`,
      [now, now, now],
    );

    await page.goto("/contacts/c-loser");
    await page.reload();
    await expect(page.getByRole("link", { name: /Merged into Marla Quintero/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore" })).toBeHidden();

    // An ordinary deletion still offers the way back.
    await page.goto("/contacts/c-plain");
    await page.reload();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

    // And the Trash tells the two apart in its own rows.
    await page.goto("/trash");
    await page.reload();
    await expect(page.getByText("Merged into Marla Quintero")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(1);
  });
});

test.describe("records: phase-two design", () => {
  /**
   * An empty list rendered its whole toolbar over the empty state: a count
   * reading "0 of 0 people" and six controls for narrowing nothing. The
   * controls stand down until there is something to use them on — but a filter
   * that matches nothing keeps them, because the owner needs the control that
   * got him there.
   */
  test("an empty list hides its toolbar; a filter that matches nothing keeps it", async ({
    page,
    helix,
  }) => {
    await page.goto("/contacts");
    await waitForShell(page);
    await expect(page.getByRole("heading", { name: "No contacts yet" })).toBeVisible();
    await expect(page.getByLabel("Search contacts")).toBeHidden();
    await expect(page.getByText(/0 of 0 people/)).toBeHidden();

    // With a contact on file the toolbar comes back...
    const now = new Date().toISOString();
    helix.bridge.execute(
      `INSERT INTO contacts (id, created_at, updated_at, first_name, last_name)
       VALUES ('c-tb', ?, ?, 'Annika', 'Sorensen')`,
      [now, now],
    );
    await page.reload();
    await expect(page.getByLabel("Search contacts")).toBeVisible();

    // ...and a search that matches nothing must NOT take it away again.
    await page.getByLabel("Search contacts").fill("zzzz-no-such-person");
    await expect(page.getByLabel("Search contacts")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Nothing matches/ })).toBeVisible();
  });

  /**
   * The deal page lost its expected date in phase one and got it back in phase
   * two: at 1024 the Identity card that also carries it sits below the whole
   * timeline.
   */
  test("the deal header states the close date, open or closed", async ({ page, helix }) => {
    await page.goto("/");
    await quickAddDeal(page, "Sprinkler repair");
    const dealId = String(helix.bridge.query("SELECT id FROM deals LIMIT 1", [])[0][0]);
    helix.bridge.execute("UPDATE deals SET expected_on = '2026-09-28' WHERE id = ?", [dealId]);
    await page.goto(`/deals/${dealId}`);
    await page.reload();
    await expect(page.getByText(/Expected Sep 28/)).toBeVisible();

    const wonStage = helix.bridge.query(
      "SELECT id FROM stages WHERE is_won = 1 AND deleted_at IS NULL LIMIT 1",
      [],
    )[0][0];
    helix.bridge.execute("UPDATE deals SET stage_id = ?, closed_at = ? WHERE id = ?", [
      String(wonStage),
      "2026-09-12T12:00:00.000Z",
      dealId,
    ]);
    await page.reload();
    await expect(page.getByText(/Won Sep 12/)).toBeVisible();
    await expect(page.getByText(/Expected Sep 28/)).toBeHidden();
  });
});

test.describe("records: trash usability (CDQO-LA-W1)", () => {
  /**
   * The type tab row (contact, company, deal, activity, task, tag, saved
   * view, attachment, recurring rule, template, product, custom field,
   * document - thirteen in all) is wider than any reviewed width holds on one
   * line. It used to just run off the edge of the window with no way back:
   * Templates, Services, Custom fields and Invoices and quotes were
   * unreachable at 1024, 1280 and 1440px alike. It now scrolls horizontally,
   * so this proves the tenth tab is still reachable and clickable at the
   * app's own documented minimum width, not merely present in the DOM.
   */
  test("the trash type tabs scroll to reach a tab past the fold", async ({ page, helix }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/");
    await waitForShell(page);

    const now = new Date().toISOString();
    helix.bridge.execute(
      `INSERT INTO contacts (id, created_at, updated_at, first_name, last_name, deleted_at)
       VALUES ('c-trash-w1', ?, ?, 'Odell', 'Fenwick', ?)`,
      [now, now, now],
    );

    await page.goto("/trash");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Trash", level: 1 })).toBeVisible();

    const templatesTab = page.getByRole("tab", { name: /^Templates/ });
    await templatesTab.scrollIntoViewIfNeeded();
    await templatesTab.click();
    await expect(templatesTab).toHaveAttribute("data-state", "active");
    await expect(page.getByText("Nothing deleted")).toBeVisible();
  });

  /**
   * Ruling R6b: a deal a sent invoice still refers to keeps its "Delete
   * forever" disabled rather than letting the purge fail. A dimmed button is
   * not an explanation on its own - the CPO audit's coordinator asked
   * specifically whether the disabled state carries one. It has to be
   * reachable to something other than eyesight, so this checks the
   * accessible name/description, not just the pixels.
   */
  test("a deal's disabled Delete forever explains what is holding it", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await waitForShell(page);

    const now = new Date().toISOString();
    const stageId = String(
      helix.bridge.query("SELECT id FROM stages WHERE name = 'New'", [])[0][0],
    );
    helix.bridge.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at,
                          position, created_at, updated_at, deleted_at)
       VALUES ('d-trash-w1', 'Fence repair', 50000, 'USD', ?, ?, 0, ?, ?, ?)`,
      [stageId, now, now, now, now],
    );
    helix.bridge.execute(
      `INSERT INTO documents (id, kind, number, deal_id, status, created_at, updated_at)
       VALUES ('doc-w1', 'invoice', 'INV-2026-0099', 'd-trash-w1', 'sent', ?, ?)`,
      [now, now],
    );

    await page.goto("/trash");
    await page.reload();
    await page.getByRole("tab", { name: /^Deals/ }).click();
    await expect(page.getByText(/Kept: INV-2026-0099 refers to it/)).toBeVisible();

    const deleteButton = page.getByRole("button", { name: "Delete forever" });
    await expect(deleteButton).toBeDisabled();
    await expect(deleteButton).toHaveAccessibleDescription(/INV-2026-0099 refers to it/);
  });
});
