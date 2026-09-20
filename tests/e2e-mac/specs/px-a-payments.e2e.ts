/**
 * Payments, end to end: the deposit-then-balance job a trade owner actually
 * runs, and the statement he hands the customer afterwards.
 *
 * The one journey this proves, through the real screens and the real button
 * labels: send an invoice, take a deposit, watch the invoice read Partially
 * paid with the right balance, take the rest, watch it read Paid, remove one
 * payment and watch it walk back to Partially paid. Then the Invoices list's
 * Balance column and its "Has a balance" filter, and the Statement dialog on
 * the customer's own page.
 *
 * What it proves that the repository tests cannot: that the status on screen
 * is the derived one (nobody types it), that the running balance in the card
 * matches the figure the dialog defaults to, and that removing a payment is
 * reversible from the toast rather than only from the repository.
 *
 * What it cannot prove: anything that is really Rust. The statement's "save"
 * goes through the harness's in-memory `plugin:dialog|save` and
 * `plugin:fs|write_file` stubs (tests/e2e-mac/fixtures.ts), so this shows the
 * app asked to write the right bytes to the right path, not that a PDF landed
 * on a real disk.
 *
 * Run it on this lead's own port and build folder:
 *   E2E_PORT=4300 E2E_OUT=dist-pxa npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/px-a-payments.e2e.ts
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/px-a/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

function stageIdByName(bridge: HelixHarness["bridge"], name: string): string {
  const rows = bridge.query("SELECT id FROM stages WHERE name = ?", [name]);
  if (rows.length === 0) throw new Error(`the seed did not create a "${name}" stage`);
  return String(rows[0][0]);
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole("navigation")).toBeVisible();
}

function quickAddDialog(page: Page) {
  return page.getByRole("dialog", { name: "Quick add" });
}

/** Same opener invoices.e2e.ts uses: Cmd+N, with the palette as the fallback. */
async function quickAddContact(page: Page, name: string): Promise<void> {
  await waitForShell(page);
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
  const field = dialog.getByLabel("Name");
  await field.fill(name);
  await field.press("Enter");
  await expect(dialog).toBeHidden();
}

async function queueSavePath(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    (window as unknown as { __helixE2E: { dialogQueue: (string | null)[] } }).__helixE2E.dialogQueue.push(p);
  }, path);
}

type FsCall = { cmd: string; path: string };

async function lastFsWrite(page: Page): Promise<FsCall | null> {
  return page.evaluate(() => {
    const calls = (window as unknown as { __helixE2E: { calls: FsCall[] } }).__helixE2E.calls;
    const writes = calls.filter(
      (c) => c.cmd === "plugin:fs|write_file" || c.cmd === "plugin:fs|writeFile",
    );
    return writes.length > 0 ? writes[writes.length - 1] : null;
  });
}

async function settleTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
  await page
    .waitForFunction((previous) => getComputedStyle(document.body).backgroundColor !== previous, before, {
      timeout: 2_000,
    })
    .catch(() => {
      // Already on that theme: nothing transitions and nothing is wrong.
    });
  await page.waitForTimeout(250);
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await settleTheme(page, theme);
    await page.screenshot({ path: `${SCREENS}${name}-${theme}.png`, fullPage: true });
  }
  await settleTheme(page, "light");
}

/** The status pill on the document page, by the word it carries. */
function statusPill(page: Page, word: string) {
  return page.getByTestId("document-status").filter({ hasText: word });
}

/** Fill the Record payment dialog and submit it. */
async function recordPayment(
  page: Page,
  values: { amount?: string; method?: string; reference?: string },
): Promise<void> {
  const dialog = page.getByRole("dialog", { name: /payment/i });
  await expect(dialog).toBeVisible();

  if (values.amount !== undefined) {
    const amount = dialog.getByLabel("Amount");
    await amount.fill(values.amount);
  }
  if (values.method !== undefined) {
    await dialog.getByRole("combobox", { name: "How it was paid" }).click();
    await page.getByRole("option", { name: values.method }).click();
  }
  if (values.reference !== undefined) {
    await dialog.getByLabel("Reference").fill(values.reference);
  }
  await dialog.getByRole("button", { name: /^(Record payment|Save payment)$/ }).click();
  await expect(dialog).toBeHidden();
}

test.describe("payments", () => {
  test("a deposit, then the balance, then one payment removed", async ({ page, helix }) => {
    const db = helix.bridge;

    await page.goto("/");
    await quickAddContact(page, "Dana Reed");
    const [[contactId]] = db.query(
      "SELECT id FROM contacts WHERE deleted_at IS NULL",
      [],
    ) as [string][];

    const dealId = "deal-retaining-wall";
    const now = iso(0);
    db.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, contact_id, company_id, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, NULL, ?, ?)`,
      [dealId, "Retaining wall", 120000, stageIdByName(db, "New"), now, contactId, now, now],
    );
    db.execute(
      `INSERT INTO deal_items (id, deal_id, product_id, name, description, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
       VALUES (?, ?, NULL, ?, NULL, 'one_time', NULL, 1, ?, ?, 0, 0)`,
      ["item-wall", dealId, "Retaining wall", 120000, 120000],
    );

    // Raise the invoice from the job, the way the owner does.
    await page.goto(`/deals/${dealId}`);
    const panel = page.getByTestId("deal-invoices-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Create invoice" }).click();

    const invoiceLink = panel.getByRole("link", { name: /^INV-/ });
    await expect(invoiceLink).toBeVisible();
    await invoiceLink.click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    const invoiceId = page.url().split("/").pop() as string;

    // A draft cannot take a payment, and the card says so instead of
    // offering a button that would throw.
    await expect(page.getByText(/still a draft/i)).toBeVisible();

    await queueSavePath(page, "/tmp/e2e/px-a/invoice.pdf");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(statusPill(page, "Sent")).toBeVisible();

    // ---- the deposit -----------------------------------------------------
    await page.getByRole("button", { name: "Record payment" }).first().click();
    await recordPayment(page, { amount: "500", method: "Check", reference: "4412" });

    await expect(statusPill(page, "Partially paid")).toBeVisible();
    const card = page.getByText("Payments").locator("xpath=..");
    await expect(card.getByText("Paid $500.00 of $1,200.00")).toBeVisible();
    await expect(card.getByText("$700.00 still owed")).toBeVisible();
    await expect(page.getByRole("cell", { name: "4412" })).toBeVisible();
    await shoot(page, "invoice-partially-paid");

    // The database agrees with the screen: the status is derived, not typed.
    await expect
      .poll(() =>
        String(
          (db.query("SELECT status FROM documents WHERE id = ?", [invoiceId]) as [string][])[0][0],
        ),
      )
      .toBe("partial");

    // ---- the balance -----------------------------------------------------
    await page.getByRole("button", { name: "Record payment" }).first().click();
    // The amount field defaults to what is left, so this submits without
    // typing a figure - which is the behaviour worth pinning.
    await expect(page.getByRole("dialog", { name: /payment/i }).getByLabel("Amount")).toHaveValue(
      "700.00",
    );
    await recordPayment(page, { method: "Bank transfer" });

    await expect(statusPill(page, "Paid")).toBeVisible();
    await expect(card.getByText("Paid in full")).toBeVisible();
    await shoot(page, "invoice-paid");

    // ---- remove one, and it is owed again --------------------------------
    await page.getByRole("button", { name: "Remove payment" }).last().click();
    await expect(statusPill(page, "Partially paid")).toBeVisible();
    await expect(card.getByText("$700.00 still owed")).toBeVisible();

    // And the toast puts it back, which is the only undo a payment has.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(statusPill(page, "Paid")).toBeVisible();
  });

  test("the list shows a balance and filters on it, and a customer gets a statement", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;

    await page.goto("/");
    await quickAddContact(page, "Priya Raman");
    const [[contactId]] = db.query(
      "SELECT id FROM contacts WHERE deleted_at IS NULL",
      [],
    ) as [string][];

    const dealId = "deal-patio";
    const now = iso(0);
    db.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, contact_id, company_id, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, NULL, ?, ?)`,
      [dealId, "Patio rebuild", 80000, stageIdByName(db, "New"), now, contactId, now, now],
    );
    db.execute(
      `INSERT INTO deal_items (id, deal_id, product_id, name, description, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
       VALUES (?, ?, NULL, ?, NULL, 'one_time', NULL, 1, ?, ?, 0, 0)`,
      ["item-patio", dealId, "Patio rebuild", 80000, 80000],
    );

    await page.goto(`/deals/${dealId}`);
    const panel = page.getByTestId("deal-invoices-panel");
    await panel.getByRole("button", { name: "Create invoice" }).click();
    await panel.getByRole("link", { name: /^INV-/ }).click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);

    await queueSavePath(page, "/tmp/e2e/px-a/patio.pdf");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(statusPill(page, "Sent")).toBeVisible();

    await page.getByRole("button", { name: "Record payment" }).first().click();
    await recordPayment(page, { amount: "300", method: "Cash" });
    await expect(statusPill(page, "Partially paid")).toBeVisible();

    // ---- the list --------------------------------------------------------
    await page.goto("/invoices");
    const balanceCell = page.getByRole("cell", { name: "$500.00" });
    await expect(balanceCell.first()).toBeVisible();

    await page.getByLabel("Has a balance").click();
    await expect(page.getByRole("link", { name: /^INV-/ })).toHaveCount(1);
    await shoot(page, "invoices-has-a-balance");

    // ---- the statement ---------------------------------------------------
    await page.goto(`/contacts/${contactId}`);
    await expect(page.getByText("Balance")).toBeVisible();
    await page.getByRole("button", { name: "Statement…" }).click();

    const dialog = page.getByRole("dialog", { name: /Statement for/ });
    await expect(dialog).toBeVisible();
    await shoot(page, "statement-dialog");

    await queueSavePath(page, "/tmp/e2e/px-a/statement.pdf");
    await dialog.getByRole("button", { name: /Save/ }).click();

    await expect
      .poll(async () => (await lastFsWrite(page))?.path ?? null)
      .toBe("/tmp/e2e/px-a/statement.pdf");
  });
});
