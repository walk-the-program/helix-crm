/**
 * CDQO-LB-W2 (phase two, design): the Invoices list, the New invoice screen
 * and the money dialogs (Mark paid, Deposit), photographed before and after
 * this packet's design pass.
 *
 * Not a regression spec - `invoices.e2e.ts` already owns the behavioural
 * pins for these screens and stays the source of truth for what still has
 * to work. This one exists only to produce the evidence this packet's return
 * cites: tests/e2e-mac/.cache/screens/lb/p2w2-after-*.png, at the viewports,
 * densities and themes the checks ask for.
 *
 * "Before" evidence is the screenshots the packet pointed at directly
 * (tests/e2e-mac/.cache/screens/cpo/dense-invoices*.png,
 * sparse-invoices*.png and lb/w2-state-a-*), taken by an earlier pass before
 * this task's edits landed - this spec cannot re-render the pre-edit source,
 * so it does not try to fake a "before" capture. This session copied those
 * exact files to p2w2-before-*.png alongside the new after set so the pair
 * sits together; see the task's final return for the mapping.
 *
 * Seeding follows `cpoWalk.e2e.ts`'s own onboarding walk (Landscaping preset,
 * "Show me an example") for the dense workspace, plus one deterministic
 * contact/deal/invoice seeded straight through the bridge - the same
 * approach `invoices.e2e.ts` uses - so the Mark paid and Deposit dialogs
 * have a known amount and a known split regardless of what the sample data
 * happens to contain that day.
 *
 * Run it on this task's own port and build folder:
 *   E2E_PORT=4243 E2E_OUT=dist-lb-p2w2 npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/lbDesignInvoices.e2e.ts
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/lb/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
}

async function shoot(page: Page, name: string, opts: { full?: boolean } = {}) {
  await page.screenshot({ path: `${SCREENS}p2w2-after-${name}.png`, fullPage: opts.full ?? false });
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(200);
}

async function setDensity(page: Page, density: "comfortable" | "compact") {
  await page.evaluate((d) => document.documentElement.setAttribute("data-density", d), density);
  await page.waitForTimeout(200);
}

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

const DAY = 24 * 60 * 60 * 1000;

/** One contact, one deal and one sent invoice, straight through the bridge. */
function seedInvoiceFixture(helix: HelixHarness): void {
  const db = helix.bridge;
  const now = iso(0);
  const stage = db.query("SELECT id FROM stages ORDER BY position ASC LIMIT 1", []);
  const stageId = String(stage[0][0]);
  db.execute(
    `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at)
     VALUES ('lb-p2w2-contact', 'Priya', 'Nakamura', ?, ?)`,
    [now, now],
  );
  db.execute(
    `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, contact_id, company_id, created_at, updated_at)
     VALUES ('lb-p2w2-deal', 'Paver patio install', 0, 'USD', ?, ?, 0, 'lb-p2w2-contact', NULL, ?, ?)`,
    [stageId, now, now, now],
  );
  db.execute(
    `INSERT INTO deal_items (id, deal_id, name, kind, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
     VALUES ('lb-p2w2-item', 'lb-p2w2-deal', 'Paver patio, 400 sq ft', 'one_time', 1, 480000, 480000, 0, 0)`,
    [],
  );
  db.execute(
    `INSERT INTO documents (id, kind, number, contact_id, status, issued_on, due_on,
        subtotal_cents, tax_rate_bp, tax_cents, total_cents, sent_at, created_at, updated_at)
     VALUES ('lb-p2w2-invoice', 'invoice', 'INV-2026-9001', 'lb-p2w2-contact', 'sent',
        ?, ?, 480000, 0, 0, 480000, ?, ?, ?)`,
    [iso(-3 * DAY), iso(11 * DAY), iso(-3 * DAY), now, now],
  );
  db.execute(
    `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
     VALUES ('lb-p2w2-doc-item', 'lb-p2w2-invoice', 'Paver patio, 400 sq ft', 1, 480000, 0, 'one_time', 0)`,
    [],
  );
}

test.describe("dense: the landscaping sample", () => {
  test.use({ onboarding: "show" });

  test("Invoices list, New invoice and the money dialogs", async ({ page, helix }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Onboarding: Landscaping preset, "Show me an example" - same walk
    // cpoWalk.e2e.ts uses, so the sample carries real priced deals and
    // invoices rather than an empty shell.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toBeVisible();
    await page.getByLabel("What is the business called?").fill("Alpine Ridge Landscape");
    await page.getByLabel("Your name").fill("Dave Tracy");
    await page.getByLabel("Your email").fill("dave@alpineridge.example");
    await page.getByLabel("Your phone").fill("(801) 555-0134");
    await page.getByRole("button", { name: "Landscaping", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "How you'll track work", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Use this setup" }).click();
    await expect(page.getByRole("heading", { name: "Bring your customers in", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /Show me an example/ }).click();
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    await settle(page);

    seedInvoiceFixture(helix);

    // --- Invoices list -----------------------------------------------------
    await page.goto("/invoices");
    await settle(page);
    await shoot(page, "invoices-1280-light");

    await setTheme(page, "dark");
    await shoot(page, "invoices-1280-dark");
    await setTheme(page, "light");

    await page.setViewportSize({ width: 1024, height: 700 });
    await settle(page);
    await shoot(page, "invoices-1024-light");
    await page.setViewportSize({ width: 1280, height: 800 });

    // Quotes tab and All tab, so the empty/populated tab wiring is on record.
    await page.getByRole("tab", { name: /^Quotes/ }).click();
    await settle(page);
    await shoot(page, "invoices-quotes-tab");
    await page.getByRole("tab", { name: /^Unpaid/ }).click();
    await settle(page);

    // --- New invoice ---------------------------------------------------------
    await page.goto("/invoices/new");
    await settle(page);
    await shoot(page, "new-invoice-1280-light");

    await setTheme(page, "dark");
    await shoot(page, "new-invoice-1280-dark");
    await setTheme(page, "light");

    await page.setViewportSize({ width: 1024, height: 700 });
    await settle(page);
    await shoot(page, "new-invoice-1024-light");
    await page.setViewportSize({ width: 1280, height: 800 });

    // A priced line, so the description/detail separation and the totals
    // column are both on record with real content rather than an empty row.
    await page.getByRole("combobox", { name: "Contact" }).click();
    await page.getByRole("option", { name: "Priya Nakamura" }).click();
    await page.getByLabel("Description").first().fill("Retaining wall, 60 linear feet");
    await page.getByLabel("Detail").first().fill("Segmental block, drainage gravel behind");
    await page.getByLabel("Unit price").first().fill("3200.00");
    await settle(page);
    await shoot(page, "new-invoice-line-filled");

    await setDensity(page, "compact");
    await settle(page);
    await shoot(page, "new-invoice-lines-compact");
    await setDensity(page, "comfortable");

    // --- Mark paid dialog ------------------------------------------------
    await page.goto("/invoices/lb-p2w2-invoice");
    await settle(page);
    await page.getByRole("button", { name: "Mark paid" }).click();
    const payDialog = page.getByRole("dialog", { name: /Mark INV-2026-9001 paid/ });
    await expect(payDialog).toBeVisible();
    await shoot(page, "mark-paid-1280-light");

    await setTheme(page, "dark");
    await shoot(page, "mark-paid-dark");
    await setTheme(page, "light");

    await setDensity(page, "compact");
    await settle(page);
    await shoot(page, "mark-paid-compact");
    await setDensity(page, "comfortable");

    // The hoisted footer, confirmed structurally rather than by eye.
    const payFooter = payDialog.getByTestId("dialog-footer");
    await expect(payFooter).toHaveAttribute("data-hoisted", "true");

    await page.keyboard.press("Escape");
    await expect(payDialog).not.toBeVisible();

    // --- Deposit dialog (needs a deal that has not been invoiced yet) ----
    const stage = helix.bridge.query("SELECT id FROM stages ORDER BY position ASC LIMIT 1", []);
    helix.bridge.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at, position, contact_id, company_id, created_at, updated_at)
       VALUES ('lb-p2w2-deal-2', 'Backyard irrigation system', 0, 'USD', ?, ?, 0, 'lb-p2w2-contact', NULL, ?, ?)`,
      [String(stage[0][0]), iso(0), iso(0), iso(0)],
    );
    helix.bridge.execute(
      `INSERT INTO deal_items (id, deal_id, name, kind, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
       VALUES ('lb-p2w2-item-2', 'lb-p2w2-deal-2', 'Irrigation system, 8 zones', 'one_time', 1, 620000, 620000, 0, 0)`,
      [],
    );

    await page.goto("/deals/lb-p2w2-deal-2");
    await settle(page);
    await page.getByRole("button", { name: "Deposit invoice" }).click();
    const depositDialog = page.getByRole("dialog", { name: "Invoice a deposit" });
    await expect(depositDialog).toBeVisible();
    await settle(page);
    await shoot(page, "deposit-1280-light-half");

    await depositDialog.getByRole("combobox", { name: "How much up front" }).click();
    await page.getByRole("option", { name: "A third" }).click();
    await settle(page);
    await shoot(page, "deposit-split-updated-a-third");

    await setTheme(page, "dark");
    await shoot(page, "deposit-dark");
    await setTheme(page, "light");

    const depositFooter = depositDialog.getByTestId("dialog-footer");
    await expect(depositFooter).toHaveAttribute("data-hoisted", "true");

    await page.keyboard.press("Escape");
    await expect(depositDialog).not.toBeVisible();
  });
});

test.describe("sparse: an empty workspace", () => {
  test("Invoices list and New invoice with nothing in the workspace", async ({ page, helix }) => {
    void helix;
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto("/invoices");
    await settle(page);
    await shoot(page, "empty-invoices-1280-light");

    await setTheme(page, "dark");
    await shoot(page, "empty-invoices-dark");
    await setTheme(page, "light");

    await page.goto("/invoices/new");
    await settle(page);
    await shoot(page, "empty-new-invoice-1280-light");
  });
});
