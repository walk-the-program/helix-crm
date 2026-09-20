/**
 * CPO-LB-IMPL-W2: screenshot evidence for F-LB-11's three empty states on
 * Invoices and Receivables. This spec is worker-owned scaffolding, not
 * durable coverage - the lead deletes it once the screenshots are reviewed;
 * any assertion worth keeping permanently lives in tests/unit/invoices or
 * tests/repo/invoices instead (per the task packet).
 *
 * Run:
 *   E2E_PORT=4243 E2E_OUT=dist-lb-w2 npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/lbAuditWorker2.e2e.ts
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/lb/", import.meta.url));
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

async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole("navigation")).toBeVisible();
}

// Same theme-settle dance as invoices.e2e.ts / today.e2e.ts / records.e2e.ts:
// a screenshot taken in the same tick as the attribute flip photographs the
// light theme wearing a dark label, so this waits for the background colour
// to actually change before shooting.
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

async function shoot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ["light", "dark"] as const) {
    await settleTheme(page, theme);
    await page.screenshot({ path: `${SCREENS}w2-${name}-${theme}.png`, fullPage: true });
  }
  await settleTheme(page, "light");
}

/**
 * Counts visible elements painted with the exact flat colour
 * `--color-accent` resolves to right now (light or dark) - the "one flat
 * brand-primary block per view" rule (F-LB-11 acceptance 5), checked as a
 * real computed style rather than by guessing at a class name.
 *
 * Scoped to `<main>` (the routed page's own content), not the whole document
 * - the selected sidebar nav row deliberately wears the identical accent
 * fill (Button.tsx's own comment: "The selected sidebar row is the same
 * block"), and that is chrome outside the screen this finding is about, not
 * a second primary block on it.
 */
async function countPrimaryBlocks(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--color-accent)";
    document.body.appendChild(probe);
    const accentColor = getComputedStyle(probe).backgroundColor;
    probe.remove();

    const main = document.querySelector("main");
    if (!main) return -1;

    let count = 0;
    for (const el of Array.from(main.querySelectorAll<HTMLElement>("*"))) {
      if (el.offsetParent === null) continue;
      if (getComputedStyle(el).backgroundColor === accentColor) count += 1;
    }
    return count;
  });
}

test.describe("F-LB-11: which empty state is true", () => {
  test("state (a): a workspace that has never raised a document", async ({ page, helix: _helix }) => {
    await page.goto("/invoices");
    await waitForShell(page);
    await expect(page.getByRole("heading", { name: "Invoices", exact: true, level: 1 })).toBeVisible();

    await expect(page.getByRole("heading", { name: "No invoices yet" })).toBeVisible();
    await expect(
      page.getByText(
        "An invoice is the bill you send when the work is done. Raise one from a job, or start one here.",
      ),
    ).toBeVisible();
    // The old, untrue copy must be gone.
    await expect(page.getByText("Nothing outstanding")).toHaveCount(0);
    // No accent money block at all - "$0.00" does not appear anywhere.
    await expect(page.getByText("$0.00")).toHaveCount(0);

    // The header button's colour-transition (Button.tsx's `quietTransition`,
    // 150ms) can still be mid-flight right when the empty-state text first
    // appears, since both come from the same `all` query resolving. Let it
    // settle before reading computed background colours.
    await page.waitForTimeout(400);

    // Exactly one flat primary block, and it is the header's "New invoice"
    // button, promoted to primary because the money block is not rendered.
    expect(await countPrimaryBlocks(page)).toBe(1);
    const headerButton = page.getByRole("main").getByRole("button", { name: "New invoice" }).first();
    await expect(headerButton).toBeVisible();

    await shoot(page, "state-a-invoices-no-invoices-yet");
  });
});

test.describe("F-LB-11: invoices exist but none unpaid", () => {
  test("state (b): one paid invoice, none sent - the honest 'all paid' sentence", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;
    await page.goto("/invoices");
    await waitForShell(page);

    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["w2-contact", "Priya", "Shah", iso(-30 * DAY), iso(-30 * DAY)],
    );
    db.execute(
      `INSERT INTO documents (
         id, kind, number, contact_id, status, issued_on, due_on,
         subtotal_cents, tax_rate_bp, tax_cents, total_cents,
         paid_on, paid_method, created_at, updated_at
       ) VALUES ('w2-doc-paid', 'invoice', 'INV-W2-0001', 'w2-contact', 'paid', ?, ?, 42000, 0, 0, 42000, ?, 'Card', ?, ?)`,
      [dateOnly(-20 * DAY), dateOnly(-6 * DAY), dateOnly(-1 * DAY), iso(-20 * DAY), iso(-1 * DAY)],
    );
    db.execute(
      `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
       VALUES ('w2-doc-paid-item', 'w2-doc-paid', 'Spring cleanup', 1, 42000, 0, 'one_time', 0)`,
      [],
    );

    await page.reload();
    await waitForShell(page);
    await expect(page.getByRole("heading", { name: "Invoices", exact: true, level: 1 })).toBeVisible();
    // Default tab is Unpaid, and there is now one document (paid) but zero unpaid.
    await expect(page.getByRole("tab", { name: /^Unpaid/ })).toHaveAttribute("aria-selected", "true");

    await expect(page.getByRole("heading", { name: "Nothing outstanding" })).toBeVisible();
    await expect(page.getByText("Every invoice you have sent has been paid.")).toBeVisible();
    // The wrong, first-invoice copy must NOT show now that a document exists.
    await expect(page.getByRole("heading", { name: "No invoices yet" })).toHaveCount(0);

    // Exactly one flat primary block: the money-outstanding accent, at $0.00
    // (true this time - there really is nothing outstanding).
    expect(await countPrimaryBlocks(page)).toBe(1);
    await expect(page.getByText("$0.00")).toBeVisible();

    await shoot(page, "state-b-invoices-all-paid");
  });
});

test.describe("F-LB-11: Receivables with nothing owed", () => {
  test("state (c): exactly one empty state, and the collected line is hidden at zero", async ({
    page,
    helix: _helix,
  }) => {
    await page.goto("/reports/receivables");
    await waitForShell(page);
    await expect(page.getByRole("heading", { name: "Receivables", exact: true, level: 1 })).toBeVisible();

    // Exactly one empty message on the whole page.
    await expect(page.getByText("Nothing owed to you right now.")).toBeVisible();
    await expect(page.getByText("Nothing outstanding")).toHaveCount(0);

    // "Collected this month" is not printed when nothing has been collected.
    await expect(page.getByText(/Collected this month/)).toHaveCount(0);

    // A report page with nothing owed carries zero primary blocks - same
    // convention as an empty ReportCard elsewhere in Reports.
    expect(await countPrimaryBlocks(page)).toBe(0);

    await shoot(page, "state-c-receivables-nothing-owed");
  });
});

/**
 * F-LB-19 sanity check (not one of F-LB-11's three states, but the other
 * finding this packet implements): with something actually owed, both the
 * aging table and the outstanding list offer "Copy as CSV", and the copied
 * text is a real CSV whose money column is a plain decimal.
 */
test.describe("F-LB-19: Copy as CSV on Receivables", () => {
  test("both the aging card and the outstanding list copy a plain-decimal CSV", async ({
    page,
    helix,
  }) => {
    const db = helix.bridge;
    await page.goto("/reports/receivables");
    await waitForShell(page);

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ["w2-contact-owed", "Jordan", "Reyes", iso(-40 * DAY), iso(-40 * DAY)],
    );
    db.execute(
      `INSERT INTO documents (
         id, kind, number, contact_id, status, issued_on, due_on,
         subtotal_cents, tax_rate_bp, tax_cents, total_cents, created_at, updated_at
       ) VALUES ('w2-doc-sent', 'invoice', 'INV-W2-0002', 'w2-contact-owed', 'sent', ?, ?, 78900, 0, 0, 78900, ?, ?)`,
      [dateOnly(-10 * DAY), dateOnly(-3 * DAY), iso(-10 * DAY), iso(-10 * DAY)],
    );
    db.execute(
      `INSERT INTO document_items (id, document_id, name, qty, unit_cents, taxable, kind, position)
       VALUES ('w2-doc-sent-item', 'w2-doc-sent', 'Fence repair', 1, 78900, 0, 'one_time', 0)`,
      [],
    );

    await page.reload();
    await waitForShell(page);
    await expect(page.getByRole("heading", { name: "Receivables", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText("$789.00").first()).toBeVisible();

    const csvButtons = page.getByRole("button", { name: "Copy as CSV" });
    await expect(csvButtons).toHaveCount(2);

    await csvButtons.nth(0).click(); // the aging card
    await expect(page.getByText("Copied the report to the clipboard")).toBeVisible();
    const agingClip = await page.evaluate(() => navigator.clipboard.readText());
    expect(agingClip).toContain("Bucket,Invoices,Amount");
    expect(agingClip).toContain("789.00");
    expect(agingClip).not.toContain("$");

    await csvButtons.nth(1).click(); // the outstanding list
    const listClip = await page.evaluate(() => navigator.clipboard.readText());
    expect(listClip).toContain("Number,Customer,Due,Days over,Amount");
    expect(listClip).toContain("INV-W2-0002");
    expect(listClip).toContain("789.00");
    expect(listClip).not.toContain("$");

    await shoot(page, "flb19-receivables-copy-as-csv");
  });
});
