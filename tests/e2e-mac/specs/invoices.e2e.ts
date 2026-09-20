/**
 * Invoices and quotes, end to end: the deal-to-cash flow (quote -> send ->
 * accept -> invoice -> send -> paid), a from-scratch invoice that lands on
 * Today because it is overdue, the PDF write path, and paying straight from
 * Today's Unpaid invoices section.
 *
 * What this proves: DealInvoicesPanel, DocumentPage, NewDocumentScreen,
 * InvoicesScreen and UnpaidInvoicesSection drive the same repositories
 * (src/db/repos/documents.ts, src/db/repos/invoiceSchedules.ts) that already
 * have their own unit coverage, against a real (if temporary) better-sqlite3
 * file, through the real screens and the real button labels.
 *
 * What it cannot prove: anything that is actually Rust. "Download PDF" and
 * "Send" never touch a real filesystem - `plugin:dialog|save` and
 * `plugin:fs|write_file` are the harness's in-memory stubs (fixtures.ts), so
 * this proves the app asked to write the right bytes to the right path, not
 * that a PDF landed on a real disk.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4204 E2E_OUT=dist-inv npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/invoices.e2e.ts
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/invoices/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });

const DAY = 24 * 60 * 60 * 1000;

/**
 * What this workspace calls a deal, on screen.
 *
 * The New document screen's deal field follows `settings.vocabulary` like the
 * rest of the product (F-LB-D21), and these specs run on a workspace that
 * never sets it - so the default, "Deal", is what the label reads. Naming it
 * once here rather than inlining the literal is the point: a spec that
 * hard-codes "Job" is what made that field the last one in the product still
 * telling the owner what to call his own work.
 */
const DEAL_WORD = "Deal";
const NEW_DEAL_WORD = /New deal/;

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

function dateOnly(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A stage the app's own migration seed creates, by name. */
function stageIdByName(bridge: HelixHarness["bridge"], name: string): string {
  const rows = bridge.query("SELECT id FROM stages WHERE name = ?", [name]);
  if (rows.length === 0) throw new Error(`the seed did not create a "${name}" stage`);
  return String(rows[0][0]);
}

/**
 * A deal for one contact, straight through the bridge - the same way the
 * first test seeds its own deal. Round 3 made a deal a required parent for
 * every document a screen creates (`src/db/repos/documents.ts`), so every
 * test below that submits NewDocumentScreen needs one of these first. The
 * deal combobox's own "New deal" row is a real feature in its own right and
 * gets no separate coverage here - seeding through the bridge is the
 * deterministic path, not a workaround.
 */
function seedContactDeal(
  db: HelixHarness["bridge"],
  params: { id: string; title: string; contactId: string; stageId: string },
): void {
  const now = iso(0);
  db.execute(
    `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, contact_id, company_id, created_at, updated_at)
     VALUES (?, ?, 0, 'USD', ?, ?, 0, ?, NULL, ?, ?)`,
    [params.id, params.title, params.stageId, now, params.contactId, now, now],
  );
}

/** Picks a job on NewDocumentScreen's Job combobox by its (unique) title. */
async function pickJob(page: Page, dealTitle: string): Promise<void> {
  await page.getByRole("combobox", { name: DEAL_WORD }).click();
  await page.getByRole("option").filter({ hasText: dealTitle }).click();
}

/**
 * Opens a `DatePicker` by its label and clicks the exact day. The picker
 * focuses on the field's current value (or today, if it has none), so this
 * walks backward a month at a time until the requested day is on screen -
 * every date this spec ever picks is in the past relative to whatever the
 * field started at, so one direction is all it needs.
 */
async function pickDatePickerDay(page: Page, label: string, isoDate: string): Promise<void> {
  await page.getByLabel(label).click();
  const day = page.locator(`[data-testid="date-picker-day"][data-date="${isoDate}"]`);
  for (let i = 0; i < 24 && (await day.count()) === 0; i += 1) {
    await page.getByRole("button", { name: "Previous month" }).click();
  }
  await day.click();
}

// ---------------------------------------------------------------------------
// Quick add, trimmed to the one type this spec needs (contacts) - the full
// version with every type lives in records.e2e.ts; each spec keeps its own
// copy rather than importing across files.
// ---------------------------------------------------------------------------

async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole("navigation")).toBeVisible();
}

function quickAddDialog(page: Page) {
  return page.getByRole("dialog", { name: "Quick add" });
}

async function openQuickAdd(page: Page): Promise<void> {
  await waitForShell(page);
  const dialog = quickAddDialog(page);
  await page.keyboard.press("Meta+n");
  try {
    await dialog.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    // The palette is on Cmd/Ctrl+Shift+K; Cmd/Ctrl+K belongs to search.
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

// ---------------------------------------------------------------------------
// The e2e harness's own steering: dialog paths and the invoke log.
// ---------------------------------------------------------------------------

type FsCall = { cmd: string; path: string };

/** Push a path onto the queue the next dialog open/save call consumes. */
async function queueSavePath(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    (window as unknown as { __helixE2E: { dialogQueue: (string | null)[] } }).__helixE2E.dialogQueue.push(p);
  }, path);
}

/** The most recent fs write the app made, or null if it has not made one. */
async function lastFsWrite(page: Page): Promise<FsCall | null> {
  return page.evaluate(() => {
    const calls = (window as unknown as { __helixE2E: { calls: FsCall[] } }).__helixE2E.calls;
    const writes = calls.filter(
      (c) => c.cmd === "plugin:fs|write_file" || c.cmd === "plugin:fs|writeFile",
    );
    return writes.length > 0 ? writes[writes.length - 1] : null;
  });
}

// ---------------------------------------------------------------------------
// Screenshots: same pattern as today.e2e.ts and records.e2e.ts (there is no
// shared helper module between specs in this suite - each file keeps its own
// copy of the theme-settle dance).
// ---------------------------------------------------------------------------

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

/** Light and dark, at 1280px wide, into tests/e2e-mac/.cache/screens/invoices/. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await settleTheme(page, theme);
    await page.screenshot({ path: `${SCREENS}${name}-${theme}.png`, fullPage: true });
  }
  await settleTheme(page, "light");
}

/**
 * CPO-LB-IMPL-W4: the round-4 money findings' own screenshot evidence, at a
 * fixed 1280x800 (not full-page - the brief asks for one frame, not the
 * whole scrolled screen), prefixed "w4-" into its own folder so it never
 * collides with another agent's screenshots in this shared tree.
 */
async function shootLb(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ["light", "dark"] as const) {
    await settleTheme(page, theme);
    await page.screenshot({ path: `tests/e2e-mac/.cache/screens/lb/w4-${name}-${theme}.png` });
  }
  await settleTheme(page, "light");
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

test.describe("invoices", () => {
  test("from a deal: quote, send, accept, pay, and Today goes quiet", async ({ page, helix }) => {
    const db = helix.bridge;

    // The contact and the company through the app's own UI: each is one
    // dialog with a single required field, so there is nothing to gain from
    // going straight to the bridge.
    await page.goto("/");
    await quickAddContact(page, "Marisol Fenwick");

    await page.goto("/companies");
    await page.getByRole("button", { name: "New company" }).click();
    const companyDialog = page.getByRole("dialog", { name: "New company" });
    await companyDialog.getByLabel("Company name").fill("Fenwick Properties LLC");
    await companyDialog.getByRole("button", { name: "Create company" }).click();
    await page.waitForURL(/\/companies\/.+/);

    const [[contactId]] = db.query(
      "SELECT id FROM contacts WHERE deleted_at IS NULL",
      [],
    ) as [string][];
    const [[companyId]] = db.query(
      "SELECT id FROM companies WHERE deleted_at IS NULL",
      [],
    ) as [string][];
    const stageId = stageIdByName(db, "New");

    // The deal and its two one-time lines. `deal_items` has no repository
    // yet, so both go straight through the bridge with raw SQL, per the task
    // brief - the same way today.e2e.ts seeds deals directly.
    const dealId = "deal-full-maintenance";
    const now = iso(0);
    db.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, contact_id, company_id, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?, ?, ?)`,
      [dealId, "Full property maintenance", 23500, stageId, now, contactId, companyId, now, now],
    );
    db.execute(
      `INSERT INTO deal_items (id, deal_id, product_id, name, description, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
       VALUES (?, ?, NULL, ?, NULL, 'one_time', NULL, 1, ?, ?, 0, 0)`,
      ["item-sprinkler", dealId, "Sprinkler system tune-up", 15000, 15000],
    );
    db.execute(
      `INSERT INTO deal_items (id, deal_id, product_id, name, description, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
       VALUES (?, ?, NULL, ?, NULL, 'one_time', NULL, 1, ?, ?, 0, 1)`,
      ["item-backflow", dealId, "Backflow test", 8500, 8500],
    );

    await page.goto(`/deals/${dealId}`);
    await expect(
      page.getByRole("heading", { name: "Full property maintenance", level: 1 }),
    ).toBeVisible();

    const panel = page.getByTestId("deal-invoices-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Create quote" }).click();

    const quoteLink = panel.getByRole("link", { name: /^QUO-/ });
    await expect(quoteLink).toBeVisible();
    await quoteLink.click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    const quoteId = page.url().split("/").pop() as string;

    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

    // Push a save path so Send's PDF-write branch actually runs, rather than
    // exercising the cancelled-dialog fallback - test 3 below covers a clean
    // download in isolation, so this run proves the write happens on the
    // way to "sent" too.
    await queueSavePath(page, "/tmp/e2e/quote-full-maintenance.pdf");
    await page.getByRole("button", { name: "Send" }).click();
    // Accept/Decline only render once the quote has actually reached "sent"
    // (canTransition gates them), so their appearing is itself the proof.
    await expect(page.getByRole("button", { name: "Accepted" })).toBeVisible();

    await page.getByRole("button", { name: "Accepted" }).click();
    // Accepting is what creates the invoice; wait for the write rather than
    // guessing at timing, then follow the navigation it triggers.
    await expect
      .poll(
        () =>
          (
            db.query(
              "SELECT count(*) FROM documents WHERE deal_id = ? AND kind = 'invoice'",
              [dealId],
            ) as [number][]
          )[0][0],
      )
      .toBe(1);
    const [[invoiceId]] = db.query(
      "SELECT id FROM documents WHERE deal_id = ? AND kind = 'invoice'",
      [dealId],
    ) as [string][];
    expect(invoiceId).not.toBe(quoteId);
    await expect(page).toHaveURL(new RegExp(invoiceId));

    // The invoice accept() creates is a DRAFT. Today only ever shows a SENT
    // invoice under Unpaid (a draft is not money anyone owes yet), so it has
    // to be sent before "Mark paid" proves anything about Today.
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
    await queueSavePath(page, "/tmp/e2e/invoice-full-maintenance.pdf");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Mark paid" })).toBeVisible();

    // A sent invoice's page, per the screenshot list.
    await shoot(page, "document-page");

    await page.getByRole("button", { name: "Mark paid" }).click();
    const payDialog = page.getByTestId("mark-paid-dialog");
    await expect(payDialog).toBeVisible();
    // "Date paid" is now the in-app DatePicker, not input[type=date] - open
    // it and check today's cell is the one the calendar marks selected,
    // which is the same fact ".toHaveValue(dateOnly(0))" used to prove.
    await payDialog.getByLabel("Date paid").click();
    await expect(
      page.locator(`[data-testid="date-picker-day"][data-date="${dateOnly(0)}"]`),
    ).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");

    await shoot(page, "mark-paid-dialog");

    await payDialog.getByRole("button", { name: "Mark paid" }).click();
    await expect(payDialog).toBeHidden();

    await page.goto("/");
    const unpaidSection = page.locator('[data-today-section="unpaid-invoices"]');
    await expect(unpaidSection).toBeVisible();
    await expect(unpaidSection.getByText("nothing unpaid")).toBeVisible();
  });

  test("from scratch: an overdue invoice lands on Today", async ({ page, helix }) => {
    const db = helix.bridge;

    await page.goto("/");
    await quickAddContact(page, "Dana Ostrander");

    // Round 3: every document belongs to a deal, so a from-scratch invoice
    // needs a job to attach to before NewDocumentScreen will save it.
    const [[contactId]] = db.query(
      "SELECT id FROM contacts WHERE first_name = ?",
      ["Dana"],
    ) as [string][];
    const stageId = stageIdByName(db, "New");
    seedContactDeal(db, {
      id: "deal-dana-irrigation",
      title: "Irrigation repair job",
      contactId,
      stageId,
    });

    await page.goto("/invoices/new");
    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Dana Ostrander" }).click();
    await pickJob(page, "Irrigation repair job");

    // NewDocumentScreen no longer has its own line table - it renders the
    // shared DocumentLines editor, one blank line already on it.
    await page.getByLabel("Description").first().fill("Irrigation repair");
    await page.getByLabel("Unit price").first().fill("450.00");
    // Well clear of any hour-of-day rounding edge, and clear of the
    // just-created quote/invoice's numbering in the other test. Due is now
    // the in-app DatePicker, not input[type=date].
    await pickDatePickerDay(page, "Due", dateOnly(-12 * DAY));

    await page.getByRole("button", { name: "Create invoice" }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);

    await queueSavePath(page, "/tmp/e2e/irrigation-repair.pdf");
    await page.getByRole("button", { name: "Send" }).click();
    // The Details card's own "Due" row carries the same wording independent
    // of status, so once sent there are two matches on the page (the header
    // badge and the Details row) - "Mark paid" appearing is the unambiguous
    // proof that the send actually landed as "sent".
    await expect(page.getByRole("button", { name: "Mark paid" })).toBeVisible();

    const [[number]] = db.query(
      "SELECT number FROM documents WHERE contact_id = ? AND kind = 'invoice'",
      [contactId],
    ) as [string][];

    await page.goto("/");
    const unpaidSection = page.locator('[data-today-section="unpaid-invoices"]');
    await expect(unpaidSection.getByText("Dana Ostrander")).toBeVisible();
    await expect(unpaidSection.getByText(/Overdue by \d+ days?/)).toBeVisible();

    await shoot(page, "today-overdue");

    // The default tab on /invoices is Unpaid - no click needed to find it.
    await page.goto("/invoices");
    await expect(page.getByRole("link", { name: number })).toBeVisible();
  });

  test("download PDF writes a .pdf", async ({ page, helix }) => {
    const db = helix.bridge;
    await page.goto("/");
    await quickAddContact(page, "Oren Castillo");

    const [[contactId]] = db.query(
      "SELECT id FROM contacts WHERE first_name = ?",
      ["Oren"],
    ) as [string][];
    const stageId = stageIdByName(db, "New");
    seedContactDeal(db, {
      id: "deal-oren-cleanup",
      title: "Fall cleanup job",
      contactId,
      stageId,
    });

    await page.goto("/invoices/new");
    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Oren Castillo" }).click();
    await pickJob(page, "Fall cleanup job");
    await page.getByLabel("Description").first().fill("Fall cleanup");
    await page.getByLabel("Unit price").first().fill("300.00");
    await page.getByRole("button", { name: "Create invoice" }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);

    const queuedPath = "/tmp/e2e/INV-2026-0001.pdf";
    await queueSavePath(page, queuedPath);
    await page.getByRole("button", { name: "Download PDF" }).click();

    // Asserted against the stub, exactly as the task brief asks: the last
    // plugin:fs|write_file (or writeFile) entry in window.__helixE2E.calls
    // has a `path` ending in ".pdf", and that path is the one queued above.
    await expect.poll(() => lastFsWrite(page)).not.toBeNull();
    const write = await lastFsWrite(page);
    expect(write?.path.endsWith(".pdf")).toBe(true);
    expect(write?.path).toBe(queuedPath);
  });

  test("mark paid from Today", async ({ page, helix }) => {
    const db = helix.bridge;

    // The app's own migrator has to run before the bridge can write into
    // tables it creates - visit the shell once before seeding straight
    // through SQL, the same way today.e2e.ts's bootTodayWithData does.
    await page.goto("/");
    await waitForShell(page);

    // A sent, overdue invoice, arranged straight through the bridge: this
    // test is about the Today interaction, not about how a document gets
    // created (that is what the first two tests cover).
    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["c-vernon", "Vernon", "Iglesias", iso(-40 * DAY), iso(-40 * DAY)],
    );
    const stamped = iso(-20 * DAY);
    db.execute(
      `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, due_on, subtotal_cents, tax_rate_bp, tax_cents, total_cents, sent_at, created_at, updated_at)
       VALUES (?, 'invoice', ?, ?, 'sent', ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      [
        "doc-vernon",
        "INV-2026-0099",
        "c-vernon",
        dateOnly(-20 * DAY),
        dateOnly(-5 * DAY),
        30000,
        30000,
        stamped,
        stamped,
        stamped,
      ],
    );
    db.execute(
      `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
       VALUES (?, ?, ?, 1, ?, 0, 'one_time', 0)`,
      ["item-vernon", "doc-vernon", "Lawn renovation", 30000],
    );

    await page.goto("/");
    const unpaidSection = page.locator('[data-today-section="unpaid-invoices"]');
    await expect(unpaidSection.getByText("Vernon Iglesias")).toBeVisible();
    await expect(unpaidSection.getByText(/Overdue by \d+ days?/)).toBeVisible();

    const row = unpaidSection.locator("li", { hasText: "Vernon Iglesias" });
    await row.getByRole("button", { name: "Mark paid" }).click();

    await expect(row).toHaveCount(0);
    await expect(unpaidSection.getByText("nothing unpaid")).toBeVisible();

    const [[status]] = db.query("SELECT status FROM documents WHERE id = ?", [
      "doc-vernon",
    ]) as [string][];
    expect(status).toBe("paid");
  });

  // ---------------------------------------------------------------------
  // Round 3 acceptance evidence: the Status control, the Contact -> Company
  // autofill, the services picker's catalog and custom lines, "New
  // service...", and default payment instructions.
  // ---------------------------------------------------------------------

  test("the Status control alone moves Draft -> Sent -> Paid, with no PDF write", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;

    // The migrator has to run before the bridge can write into its tables.
    await page.goto("/");
    await waitForShell(page);

    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["c-marguerite", "Marguerite", "Voss", iso(-10 * DAY), iso(-10 * DAY)],
    );
    const docId = "doc-marguerite-status";
    const now = iso(0);
    db.execute(
      `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, due_on, subtotal_cents, tax_rate_bp, tax_cents, total_cents, created_at, updated_at)
       VALUES (?, 'invoice', ?, ?, 'draft', ?, ?, ?, 0, 0, ?, ?, ?)`,
      [docId, "INV-2026-0900", "c-marguerite", dateOnly(0), dateOnly(14 * DAY), 40000, 40000, now, now],
    );
    db.execute(
      `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
       VALUES (?, ?, ?, 1, ?, 0, 'one_time', 0)`,
      ["item-marguerite", docId, "Hedge trimming", 40000],
    );

    await page.goto(`/invoices/${docId}`);
    await expect(page.getByTestId("document-status")).toBeVisible();

    // Draft -> Sent, through the Status select only. Never "Send".
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Sent" }).click();

    await expect
      .poll(
        () =>
          (db.query("SELECT status FROM documents WHERE id = ?", [docId]) as [string][])[0][0],
      )
      .toBe("sent");
    const [[, sentAt]] = db.query("SELECT status, sent_at FROM documents WHERE id = ?", [
      docId,
    ]) as [string, string | null][];
    expect(sentAt).not.toBeNull();
    // The whole point: moving the status writes no file. Sending (the other
    // test's "Send" button) does.
    expect(await lastFsWrite(page)).toBeNull();

    // The header's own "Mark paid" is visible now that the invoice is sent -
    // proving it is never clicked is the point of using the select instead.
    await expect(page.getByRole("button", { name: "Mark paid" })).toBeVisible();

    // Sent -> Paid, through the Status select. Paid needs a date and a
    // method, so the select hands off to the same MarkPaidDialog the header
    // button opens - its own confirm button is not "the Mark paid button"
    // this test is avoiding, that button is in the header and stays unclicked.
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Paid" }).click();

    const payDialog = page.getByTestId("mark-paid-dialog");
    await expect(payDialog).toBeVisible();
    await payDialog.getByRole("button", { name: "Mark paid" }).click();
    await expect(payDialog).toBeHidden();

    const [[finalStatus]] = db.query("SELECT status FROM documents WHERE id = ?", [
      docId,
    ]) as [string][];
    expect(finalStatus).toBe("paid");
    expect(await lastFsWrite(page)).toBeNull();
  });

  test("picking a contact on a new document fills in their company", async ({ page, helix }) => {
    const db = helix.bridge;

    await page.goto("/");
    await waitForShell(page);

    db.execute(
      `INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ["co-larkspur", "Larkspur Grounds LLC", iso(-30 * DAY), iso(-30 * DAY)],
    );
    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, company_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ["c-holt", "Holt", "Ferris", "co-larkspur", iso(-30 * DAY), iso(-30 * DAY)],
    );

    await page.goto("/invoices/new");
    const contactCombo = page.getByRole("combobox", { name: "Contact" });
    await contactCombo.click();

    // The /invoices/new screen with the Contact combobox open - one of the
    // two new screenshot pairs this round adds.
    await shoot(page, "new-document");

    await page.keyboard.type("Holt");
    await page.getByRole("option", { name: /Holt Ferris/ }).click();

    // Never touched: the Company combobox fills itself from the chosen
    // contact's own company.
    await expect(page.getByRole("combobox", { name: "Company" })).toHaveText(
      "Larkspur Grounds LLC",
    );
  });

  test("Add a line: catalog services, then a custom line", async ({ page, helix }) => {
    const db = helix.bridge;

    await page.goto("/");
    await waitForShell(page);

    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["c-benedek", "Benedek", "Toth", iso(-5 * DAY), iso(-5 * DAY)],
    );
    const docId = "doc-benedek-lines";
    const now = iso(0);
    db.execute(
      `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, subtotal_cents, tax_rate_bp, tax_cents, total_cents, created_at, updated_at)
       VALUES (?, 'invoice', ?, ?, 'draft', ?, ?, 0, 0, ?, ?, ?)`,
      [docId, "INV-2026-0910", "c-benedek", dateOnly(0), 20000, 20000, now, now],
    );
    db.execute(
      `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
       VALUES (?, ?, ?, 1, ?, 0, 'one_time', 0)`,
      ["item-benedek-existing", docId, "Initial site visit", 20000],
    );
    db.execute(
      `INSERT INTO products (id, name, description, kind, interval, unit_price_cents, taxable, active, position, created_at, updated_at)
       VALUES (?, ?, NULL, 'one_time', NULL, ?, 0, 1, 0, ?, ?)`,
      ["prod-mulch", "Mulch install", 12000, now, now],
    );
    db.execute(
      `INSERT INTO products (id, name, description, kind, interval, unit_price_cents, taxable, active, position, created_at, updated_at)
       VALUES (?, ?, NULL, 'one_time', NULL, ?, 0, 1, 1, ?, ?)`,
      ["prod-edging", "Bed edging", 8500, now, now],
    );

    await page.goto(`/invoices/${docId}`);
    await expect(page.getByLabel("Description").first()).toHaveValue("Initial site visit");

    await page.getByRole("button", { name: "Add a line" }).click();
    await shoot(page, "services-picker");

    await page.getByRole("checkbox", { name: "Mulch install" }).click();
    await page.getByRole("checkbox", { name: "Bed edging" }).click();
    await page.getByRole("button", { name: "Add 2 services" }).click();

    // Two new lines, carrying the catalog's own names and prices - appended
    // after the one line the document already had, in catalog order.
    const descriptions = page.getByLabel("Description");
    const unitPrices = page.getByLabel("Unit price");
    await expect(descriptions).toHaveCount(3);
    await expect(descriptions.nth(1)).toHaveValue("Mulch install");
    await expect(unitPrices.nth(1)).toHaveValue("120.00");
    await expect(descriptions.nth(2)).toHaveValue("Bed edging");
    await expect(unitPrices.nth(2)).toHaveValue("85.00");

    await page.getByRole("button", { name: "Add a line" }).click();
    await page.getByRole("button", { name: "Custom line" }).click();

    // A third (newly added) line: blank, for the owner to type himself.
    await expect(descriptions).toHaveCount(4);
    await expect(descriptions.nth(3)).toHaveValue("");
    await expect(unitPrices.nth(3)).toHaveValue("0.00");
  });

  test("New service... saves a catalog row and adds it as a line", async ({ page, helix }) => {
    const db = helix.bridge;

    await page.goto("/");
    await waitForShell(page);

    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["c-adaeze", "Adaeze", "Nnamdi", iso(-5 * DAY), iso(-5 * DAY)],
    );
    const docId = "doc-adaeze-newservice";
    const now = iso(0);
    db.execute(
      `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, subtotal_cents, tax_rate_bp, tax_cents, total_cents, created_at, updated_at)
       VALUES (?, 'invoice', ?, ?, 'draft', ?, ?, 0, 0, ?, ?, ?)`,
      [docId, "INV-2026-0920", "c-adaeze", dateOnly(0), 15000, 15000, now, now],
    );
    db.execute(
      `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
       VALUES (?, ?, ?, 1, ?, 0, 'one_time', 0)`,
      ["item-adaeze-existing", docId, "Consultation", 15000],
    );

    await page.goto(`/invoices/${docId}`);
    await page.getByRole("button", { name: "Add a line" }).click();

    // No catalog yet in this fresh workspace, so the picker's own empty
    // state is what opens the form - the same form a populated catalog's
    // "New service..." button opens.
    await page.getByRole("button", { name: "New service..." }).click();

    const dialog = page.getByTestId("new-service-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("Gutter guard install");
    await dialog.getByLabel("Price").fill("225.00");
    await dialog.getByRole("button", { name: "Add service" }).click();
    await expect(dialog).toBeHidden();

    const productRows = db.query(
      "SELECT id, unit_price_cents FROM products WHERE name = ?",
      ["Gutter guard install"],
    ) as [string, number][];
    expect(productRows.length).toBe(1);
    expect(productRows[0][1]).toBe(22500);

    const descriptions = page.getByLabel("Description");
    await expect(descriptions).toHaveCount(2);
    await expect(descriptions.nth(1)).toHaveValue("Gutter guard install");
    await expect(page.getByLabel("Unit price").nth(1)).toHaveValue("225.00");
  });

  test("default payment instructions prefill a new document, and an override does not change the setting", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;

    await page.goto("/");
    await waitForShell(page);

    await page.goto("/settings/invoices");
    const defaultInstructions = "Zelle to payments@example.com, or a check to the office.";
    const settingsBox = page.getByTestId("invoice-payment-instructions-input");
    await settingsBox.fill(defaultInstructions);
    await settingsBox.blur();
    await expect(page.getByText("Saved your payment instructions")).toBeVisible();

    // Off the Settings screen before quickAddContact's own waitForShell: the
    // settings layout renders a second <nav> (its own section list), which
    // makes getByRole("navigation") ambiguous while it is on screen.
    await page.goto("/");
    await quickAddContact(page, "Farrukh Islom");
    const [[contactId]] = db.query(
      "SELECT id FROM contacts WHERE first_name = ?",
      ["Farrukh"],
    ) as [string][];
    const stageId = stageIdByName(db, "New");
    seedContactDeal(db, {
      id: "deal-farrukh-fence",
      title: "Fence repair job",
      contactId,
      stageId,
    });

    await page.goto("/invoices/new");
    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Farrukh Islom" }).click();

    const paymentBox = page.getByLabel("Payment instructions");
    await expect(paymentBox).toHaveValue(defaultInstructions);

    const overrideText = "Cash or Venmo @farrukh-fence only for this one.";
    await paymentBox.fill(overrideText);

    await pickJob(page, "Fence repair job");
    await page.getByLabel("Description").first().fill("Fence repair");
    await page.getByLabel("Unit price").first().fill("500.00");

    await page.getByRole("button", { name: "Create invoice" }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    const newDocId = page.url().split("/").pop() as string;

    const [[storedInstructions]] = db.query(
      "SELECT payment_instructions FROM documents WHERE id = ?",
      [newDocId],
    ) as [string][];
    expect(storedInstructions).toBe(overrideText);

    const [[settingJson]] = db.query("SELECT value_json FROM settings WHERE key = ?", [
      "business.paymentInstructions",
    ]) as [string][];
    expect(JSON.parse(settingJson) as string).toBe(defaultInstructions);
  });
});

/**
 * The two screenshot pairs that do not fall naturally out of a functional
 * test: the list with several documents on it, and the AR block. The other
 * three pairs (document-page, mark-paid-dialog, today-overdue) are captured
 * above, at the point in the functional flow where that exact state exists.
 */
test.describe("invoices screens", () => {
  test("captures the invoices list and the receivables block, light and dark", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;

    // The migrator runs on first boot - seed only after the shell exists.
    await page.goto("/");
    await waitForShell(page);

    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["c-priya", "Priya", "Shah", iso(-60 * DAY), iso(-60 * DAY)],
    );
    db.execute(
      `INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ["co-riverside", "Riverside HOA", iso(-90 * DAY), iso(-90 * DAY)],
    );

    function insertDocument(row: {
      id: string;
      kind: "invoice" | "quote";
      number: string;
      contactId?: string | null;
      companyId?: string | null;
      status: string;
      issuedOn?: string | null;
      dueOn?: string | null;
      validUntil?: string | null;
      sentAt?: string | null;
      paidOn?: string | null;
      paidMethod?: string | null;
      totalCents: number;
      itemName: string;
    }): void {
      db.execute(
        `INSERT INTO documents (
           id, kind, number, contact_id, company_id, status, issued_on, due_on, valid_until,
           subtotal_cents, tax_rate_bp, tax_cents, total_cents, sent_at, paid_on, paid_method,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.kind,
          row.number,
          row.contactId ?? null,
          row.companyId ?? null,
          row.status,
          row.issuedOn ?? null,
          row.dueOn ?? null,
          row.validUntil ?? null,
          row.totalCents,
          row.totalCents,
          row.sentAt ?? null,
          row.paidOn ?? null,
          row.paidMethod ?? null,
          iso(-60 * DAY),
          iso(-60 * DAY),
        ],
      );
      db.execute(
        `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
         VALUES (?, ?, ?, 1, ?, 0, 'one_time', 0)`,
        [`${row.id}-item`, row.id, row.itemName, row.totalCents],
      );
    }

    insertDocument({
      id: "doc-priya-draft",
      kind: "invoice",
      number: "INV-2026-0501",
      contactId: "c-priya",
      status: "draft",
      totalCents: 45000,
      itemName: "Spring aeration",
    });
    const number2 = "INV-2026-0502";
    insertDocument({
      id: "doc-riverside-overdue",
      kind: "invoice",
      number: number2,
      companyId: "co-riverside",
      status: "sent",
      issuedOn: dateOnly(-20 * DAY),
      dueOn: dateOnly(-8 * DAY),
      sentAt: iso(-20 * DAY),
      totalCents: 128000,
      itemName: "Grounds contract, Q1",
    });
    insertDocument({
      id: "doc-priya-paid",
      kind: "invoice",
      number: "INV-2026-0503",
      contactId: "c-priya",
      status: "paid",
      issuedOn: dateOnly(-30 * DAY),
      dueOn: dateOnly(-16 * DAY),
      sentAt: iso(-30 * DAY),
      paidOn: dateOnly(-10 * DAY),
      paidMethod: "bank",
      totalCents: 60000,
      itemName: "Fence repair",
    });
    insertDocument({
      id: "doc-priya-quote",
      kind: "quote",
      number: "QUO-2026-0501",
      contactId: "c-priya",
      status: "sent",
      issuedOn: dateOnly(-5 * DAY),
      validUntil: dateOnly(25 * DAY),
      sentAt: iso(-5 * DAY),
      totalCents: 90000,
      itemName: "Backyard renovation",
    });

    await page.goto("/invoices");
    await page.getByRole("tab", { name: /^All/ }).click();
    await expect(page.getByRole("link", { name: number2 })).toBeVisible();
    await expect(page.getByText("4 documents")).toBeVisible();
    await shoot(page, "invoices-list");

    await page.goto("/reports/receivables");
    await expect(page.getByRole("heading", { name: "Receivables", level: 1 })).toBeVisible();
    // The overdue invoice is the only sent-and-unpaid row, so the block has
    // something real to show rather than "nothing owed to you".
    await expect(page.getByText(number2)).toBeVisible();
    await shoot(page, "ar-block");
  });
});

/**
 * CPO-LB-IMPL-W4: browser-level regressions for six money findings fixed this
 * round (commits 835a797, 7bea580, d2aea80, 044ee0c, 52eb441, 4d22ae4), which
 * until now only had repo-level or no coverage at all. Money is asserted
 * against the database; what the owner sees is asserted against the screen -
 * the whole point of these findings is that the two used to disagree.
 */
test.describe("invoices: audited findings (round 4 pin)", () => {
  test("F-LB-4: a paid invoice can be corrected back to unpaid, from the Status control", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;

    await page.goto("/");
    await waitForShell(page);

    // A paid invoice, arranged straight through the bridge - this test is
    // about the correction, not about how a document gets marked paid (the
    // other tests in this file already cover that).
    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["c-oduya", "Oduya", "Chike", iso(-30 * DAY), iso(-30 * DAY)],
    );
    const docId = "doc-oduya-paid";
    const now = iso(0);
    const number = "INV-2026-0930";
    db.execute(
      `INSERT INTO documents (
         id, kind, number, contact_id, status, issued_on, due_on,
         subtotal_cents, tax_rate_bp, tax_cents, total_cents,
         sent_at, paid_on, paid_method, paid_note, created_at, updated_at
       ) VALUES (?, 'invoice', ?, ?, 'paid', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docId,
        number,
        "c-oduya",
        dateOnly(0),
        dateOnly(14 * DAY),
        40000,
        40000,
        iso(-2 * DAY),
        dateOnly(0),
        "bank",
        "Paid on time",
        now,
        now,
      ],
    );
    db.execute(
      `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
       VALUES (?, ?, ?, 1, ?, 0, 'one_time', 0)`,
      ["item-oduya", docId, "Hedge removal", 40000],
    );

    await page.goto(`/invoices/${docId}`);
    await expect(page.getByTestId("document-status")).toBeVisible();

    // Before this fix, `TRANSITIONS.invoice.paid` was `[]` - a paid invoice
    // had nowhere left to go, so the Status control's own option list would
    // have been just ["Paid"], disabled, and this "Sent" option would not
    // exist to click.
    //
    // The screenshot needs the dropdown open WITH "Sent" showing, in each
    // theme - and switching theme while it is open closes the popover (a
    // viewport/attribute change reads as a dismiss to Radix), so each shot
    // settles its theme first and only then opens the menu fresh.
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const theme of ["light", "dark"] as const) {
      await settleTheme(page, theme);
      await page.getByRole("combobox", { name: "Status" }).click();
      await expect(page.getByRole("option", { name: "Sent" })).toBeVisible();
      await page.screenshot({
        path: `tests/e2e-mac/.cache/screens/lb/w4-paid-status-${theme}.png`,
      });
      await page.keyboard.press("Escape");
    }
    await settleTheme(page, "light");

    await page.getByRole("combobox", { name: "Status" }).click();
    await expect(page.getByRole("option", { name: "Sent" })).toBeVisible();
    await page.getByRole("option", { name: "Sent" }).click();

    const unpayDialog = page.getByRole("dialog", { name: `Mark ${number} unpaid?` });
    await expect(unpayDialog).toBeVisible();
    await unpayDialog.getByRole("button", { name: "Mark unpaid" }).click();
    await expect(unpayDialog).toBeHidden();

    const [[status, paidOn, paidMethod, paidNote]] = db.query(
      "SELECT status, paid_on, paid_method, paid_note FROM documents WHERE id = ?",
      [docId],
    ) as [[string, string | null, string | null, string | null]];
    expect(status).toBe("sent");
    expect(paidOn).toBeNull();
    expect(paidMethod).toBeNull();
    expect(paidNote).toBeNull();

    // Back on Receivables: it is owed again.
    await page.goto("/reports/receivables");
    await expect(page.getByText(number)).toBeVisible();

    // And out of Collected on Revenue - nothing else moved money this
    // period, so the headline reads exactly zero once the payment is gone.
    await page.goto("/reports/revenue");
    const collectedLabel = page.getByText("Collected", { exact: true }).first();
    const collectedValue = collectedLabel.locator("xpath=preceding-sibling::span[1]");
    await expect(collectedValue).toHaveText("$0.00");
  });

  test("F-LB-23: a draft invoice can be deleted; a sent one only offers Void", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;

    await page.goto("/");
    await waitForShell(page);

    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["c-thandiwe", "Thandiwe", "Moyo", iso(-3 * DAY), iso(-3 * DAY)],
    );
    const now = iso(0);
    const draftId = "doc-thandiwe-draft";
    const draftNumber = "INV-2026-0940";
    db.execute(
      `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, subtotal_cents, tax_rate_bp, tax_cents, total_cents, created_at, updated_at)
       VALUES (?, 'invoice', ?, ?, 'draft', ?, ?, 0, 0, ?, ?, ?)`,
      [draftId, draftNumber, "c-thandiwe", dateOnly(0), 12000, 12000, now, now],
    );
    const sentId = "doc-thandiwe-sent";
    db.execute(
      `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, due_on, subtotal_cents, tax_rate_bp, tax_cents, total_cents, sent_at, created_at, updated_at)
       VALUES (?, 'invoice', ?, ?, 'sent', ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
      [sentId, "INV-2026-0941", "c-thandiwe", dateOnly(0), dateOnly(14 * DAY), 20000, 20000, now, now, now],
    );

    // Before this fix, a sent-or-later document's only destructive control was
    // Void; a draft had no way off the list except the same button, wearing
    // the word "Void" on a document nobody had ever seen.
    await page.goto(`/invoices/${sentId}`);
    await expect(page.getByRole("button", { name: "Void" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

    await page.goto(`/invoices/${draftId}`);
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: `Delete ${draftNumber}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete this invoice" }).click();

    await page.waitForURL(/\/invoices$/);
    // The default tab on /invoices is Unpaid, so a deleted draft would not
    // show there anyway - the real proof is the soft-delete in the database.
    await expect(page.getByRole("link", { name: draftNumber })).toHaveCount(0);

    const [[deletedAt]] = db.query("SELECT deleted_at FROM documents WHERE id = ?", [
      draftId,
    ]) as [string | null][];
    expect(deletedAt).not.toBeNull();
  });

  test("F-LB-10: Today says when invoices are sitting as drafts", async ({ page, helix }) => {
    const db = helix.bridge;

    await page.goto("/");
    await waitForShell(page);

    // `useTodayIsUnstarted` (src/features/today/lib/useToday.ts) counts only
    // tasks, open deals and activities - never documents - so Today shows the
    // three-card first-run screen instead of any section, drafts line
    // included, until an open deal exists. One is seeded here so this test
    // reaches the real dashboard; see this run's regression note about that
    // gate hiding the very feature under test on a documents-only workspace.
    const stageId = stageIdByName(db, "New");
    const now = iso(0);
    db.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, created_at, updated_at)
       VALUES (?, ?, 0, 'USD', ?, ?, 0, ?, ?)`,
      ["deal-esteban-anchor", "Keeps Today out of its first-run state", stageId, now, now, now],
    );

    // Before this fix, `UnpaidInvoicesSection` never rendered anything about
    // a draft at all - it read `useUnpaidInvoices`, which explicitly filters
    // to `status = 'sent'`, so a drafted invoice was invisible everywhere on
    // Today.
    await page.goto("/");
    await expect(page.getByTestId("unsent-drafts")).toHaveCount(0);

    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["c-esteban", "Esteban", "Roig", iso(-2 * DAY), iso(-2 * DAY)],
    );
    db.execute(
      `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, subtotal_cents, tax_rate_bp, tax_cents, total_cents, created_at, updated_at)
       VALUES (?, 'invoice', ?, ?, 'draft', ?, ?, 0, 0, ?, ?, ?)`,
      ["doc-esteban-draft-1", "INV-2026-0950", "c-esteban", dateOnly(0), 5000, 5000, now, now],
    );

    await page.goto("/");
    const unpaidSection = page.locator('[data-today-section="unpaid-invoices"]');
    // It shows up even though nothing is unpaid and the section itself has
    // collapsed to its one-line empty state.
    await expect(unpaidSection.getByText("nothing unpaid")).toBeVisible();
    await expect(page.getByTestId("unsent-drafts")).toHaveText(
      /^1 invoice is drafted and not sent yet\./,
    );

    db.execute(
      `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, subtotal_cents, tax_rate_bp, tax_cents, total_cents, created_at, updated_at)
       VALUES (?, 'invoice', ?, ?, 'draft', ?, ?, 0, 0, ?, ?, ?)`,
      ["doc-esteban-draft-2", "INV-2026-0951", "c-esteban", dateOnly(0), 7500, 7500, now, now],
    );

    await page.goto("/");
    await expect(unpaidSection.getByText("nothing unpaid")).toBeVisible();
    await expect(page.getByTestId("unsent-drafts")).toHaveText(
      /^2 invoices are drafted and not sent yet\./,
    );
    await expect(
      page.getByTestId("unsent-drafts").getByRole("link", { name: "Open invoices" }),
    ).toBeVisible();

    await shootLb(page, "today-drafts");
  });

  test("F-LB-13: New invoice fills its lines from the job, edits write back onto the deal, and opens with no line until a customer is chosen", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;

    await page.goto("/");
    await quickAddContact(page, "Priyanka Deol");

    const [[contactId]] = db.query(
      "SELECT id FROM contacts WHERE first_name = ?",
      ["Priyanka"],
    ) as [string][];
    const stageId = stageIdByName(db, "New");
    const dealId = "deal-priyanka-grounds";
    const now = iso(0);
    db.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, contact_id, company_id, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, NULL, ?, ?)`,
      [dealId, "Grounds contract", 188000, stageId, now, contactId, now, now],
    );
    db.execute(
      `INSERT INTO products (id, name, description, kind, interval, unit_price_cents, taxable, active, position, created_at, updated_at)
       VALUES (?, ?, NULL, 'one_time', NULL, ?, 0, 1, 0, ?, ?)`,
      ["prod-lawn-mow", "Lawn mowing", 8000, now, now],
    );
    // One one-time line linked to a product (F-LB-13's own claim: editing it
    // must not orphan the product link) and one monthly line, which an
    // invoice must never show and must never remove.
    db.execute(
      `INSERT INTO deal_items (id, deal_id, product_id, name, description, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
       VALUES (?, ?, ?, ?, NULL, 'one_time', NULL, 1, ?, ?, 0, 0)`,
      ["item-priyanka-onetime", dealId, "prod-lawn-mow", "Lawn mowing", 8000, 8000],
    );
    db.execute(
      `INSERT INTO deal_items (id, deal_id, product_id, name, description, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
       VALUES (?, ?, NULL, ?, NULL, 'recurring', 'month', 1, ?, ?, 0, 1)`,
      ["item-priyanka-monthly", dealId, "Monthly maintenance", 15000, 15000],
    );

    // Before this fix, the screen mounted one blank line unconditionally, for
    // a customer who was not chosen yet.
    await page.goto("/invoices/new");
    await expect(page.getByLabel("Description")).toHaveCount(0);

    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Priyanka Deol" }).click();
    await pickJob(page, "Grounds contract");

    // Picking the job fills the ONE-TIME line only - the monthly line is
    // billed by the schedule, not shown here. Before this fix, picking an
    // EXISTING deal filled in nothing at all: the line editor stayed empty
    // and the owner had to retype the price himself.
    const descriptions = page.getByLabel("Description");
    await expect(descriptions).toHaveCount(1);
    await expect(descriptions.first()).toHaveValue("Lawn mowing");
    await expect(page.getByLabel("Unit price").first()).toHaveValue("80.00");

    // Edit the prefilled line - this must write back onto the SAME deal
    // item (an UPDATE, not a delete-and-readd, so `product_id` survives).
    await descriptions.first().fill("Lawn mowing, biweekly");
    await page.getByLabel("Unit price").first().fill("95.00");

    // Add a line the owner typed himself - this must ADD a new deal item.
    await page.getByRole("button", { name: "Add a line" }).click();
    await page.getByRole("button", { name: "Custom line" }).click();
    await descriptions.nth(1).fill("Gutter clearing");
    await page.getByLabel("Unit price").nth(1).fill("150.00");

    await page.getByRole("button", { name: "Create invoice" }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    const docId = page.url().split("/").pop() as string;

    // The document itself carries only the two lines it showed - never the
    // deal's monthly line.
    const docItems = db.query(
      "SELECT name, unit_cents FROM document_items WHERE document_id = ? ORDER BY position",
      [docId],
    ) as [string, number][];
    expect(docItems).toEqual([
      ["Lawn mowing, biweekly", 9500],
      ["Gutter clearing", 15000],
    ]);

    // The deal now has three lines. Before this fix, `useSyncDealLines` did
    // not exist: an edited line here never reached the deal at all, so the
    // deal kept its original $8,000 lawn-mowing price and the deal page
    // could read a different figure than the invoice that was just raised
    // against it.
    const dealItemRows = db.query(
      "SELECT id, name, actual_unit_cents, product_id, kind FROM deal_items WHERE deal_id = ?",
      [dealId],
    ) as [string, string, number, string | null, string][];
    expect(dealItemRows).toHaveLength(3);

    const oneTime = dealItemRows.find((row) => row[0] === "item-priyanka-onetime");
    expect(oneTime).toEqual(["item-priyanka-onetime", "Lawn mowing, biweekly", 9500, "prod-lawn-mow", "one_time"]);

    const monthly = dealItemRows.find((row) => row[0] === "item-priyanka-monthly");
    expect(monthly).toEqual(["item-priyanka-monthly", "Monthly maintenance", 15000, null, "recurring"]);

    const added = dealItemRows.find(
      (row) => row[0] !== "item-priyanka-onetime" && row[0] !== "item-priyanka-monthly",
    );
    expect(added?.[1]).toBe("Gutter clearing");
    expect(added?.[2]).toBe(15000);
  });

  test("F-LB-14: a billed job lands won, a quoted job stays open", async ({ page, helix }) => {
    const db = helix.bridge;

    await page.goto("/");
    await quickAddContact(page, "Soraya Beltran");

    // Kind defaults to Invoice. Before this fix, "New job" always landed in
    // the FIRST stage regardless of kind, so raising an invoice against a
    // brand-new job left it sitting in the open pipeline - inflating Open
    // value while the same job was simultaneously being invoiced - and
    // Won never moved because nothing ever stamped `closed_at`.
    await page.goto("/invoices/new");
    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Soraya Beltran" }).click();
    await page.getByRole("combobox", { name: DEAL_WORD }).click();
    await page.keyboard.type("Deck resurfacing");
    await page.getByRole("option", { name: NEW_DEAL_WORD }).click();
    await expect(page.getByText("Started Deck resurfacing.")).toBeVisible();

    const [[invoiceIsWon, invoiceClosedAt]] = db.query(
      `SELECT s.is_won, d.closed_at FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.title = ?`,
      ["Deck resurfacing"],
    ) as [[number, string | null]];
    expect(invoiceIsWon).toBe(1);
    expect(invoiceClosedAt).not.toBeNull();

    // A fresh screen, Kind switched to Quote: the work has not been agreed
    // to, so "New job" must leave it in the first stage, open.
    await page.goto("/invoices/new");
    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Soraya Beltran" }).click();
    await page.getByRole("combobox", { name: "Kind" }).click();
    await page.getByRole("option", { name: "Quote" }).click();
    await page.getByRole("combobox", { name: DEAL_WORD }).click();
    await page.keyboard.type("Fence estimate");
    await page.getByRole("option", { name: NEW_DEAL_WORD }).click();
    await expect(page.getByText("Started Fence estimate.")).toBeVisible();

    const [[firstStageId]] = db.query(
      "SELECT id FROM stages WHERE deleted_at IS NULL ORDER BY position ASC LIMIT 1",
      [],
    ) as [string][];
    const [[quoteStageId, quoteClosedAt]] = db.query(
      "SELECT stage_id, closed_at FROM deals WHERE title = ?",
      ["Fence estimate"],
    ) as [[string, string | null]];
    expect(quoteStageId).toBe(firstStageId);
    expect(quoteClosedAt).toBeNull();
  });
});
