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
    await expect(payDialog.getByLabel("Date paid")).toHaveValue(dateOnly(0));

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

    await page.goto("/invoices/new");
    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Dana Ostrander" }).click();

    await page.getByLabel("Description, line 1").fill("Irrigation repair");
    await page.getByLabel("Unit price, line 1").fill("450.00");
    // Well clear of any hour-of-day rounding edge, and clear of the
    // just-created quote/invoice's numbering in the other test.
    await page.getByLabel("Due").fill(dateOnly(-12 * DAY));

    await page.getByRole("button", { name: "Create invoice" }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);

    await queueSavePath(page, "/tmp/e2e/irrigation-repair.pdf");
    await page.getByRole("button", { name: "Send" }).click();
    // The Details card's own "Due" row carries the same wording independent
    // of status, so once sent there are two matches on the page (the header
    // badge and the Details row) - "Mark paid" appearing is the unambiguous
    // proof that the send actually landed as "sent".
    await expect(page.getByRole("button", { name: "Mark paid" })).toBeVisible();

    const [[contactId]] = db.query(
      "SELECT id FROM contacts WHERE first_name = ?",
      ["Dana"],
    ) as [string][];
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
    await page.goto("/");
    await quickAddContact(page, "Oren Castillo");

    await page.goto("/invoices/new");
    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Oren Castillo" }).click();
    await page.getByLabel("Description, line 1").fill("Fall cleanup");
    await page.getByLabel("Unit price, line 1").fill("300.00");
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
