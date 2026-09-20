/**
 * The CPO/CDQO discovery walk (2026-09-20). Not a regression test: it
 * photographs every route with a dense workspace (a landscaping business plus
 * its sample week) and again with an empty one, and records every page error
 * and console error it meets. The screenshots land in
 * tests/e2e-mac/.cache/screens/cpo/ and the error log beside them.
 *
 *   E2E_PORT=4220 E2E_OUT=dist-cpo npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/cpoWalk.e2e.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/cpo/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });

type Log = { route: string; pageErrors: string[]; consoleErrors: string[] };

function watch(page: Page, logs: Log[]) {
  let current: Log = { route: "(boot)", pageErrors: [], consoleErrors: [] };
  logs.push(current);
  page.on("pageerror", (err) => current.pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") current.consoleErrors.push(msg.text());
  });
  return (route: string) => {
    current = { route, pageErrors: [], consoleErrors: [] };
    logs.push(current);
  };
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(350);
}

async function shoot(page: Page, name: string, opts: { full?: boolean } = {}) {
  await page.screenshot({ path: `${SCREENS}${name}.png`, fullPage: opts.full ?? false });
}

async function visit(page: Page, mark: (r: string) => void, route: string, name: string, full = false) {
  mark(route);
  await page.goto(route);
  await settle(page);
  await shoot(page, name, { full });
}

const STATIC_ROUTES: [string, string][] = [
  ["/", "today"],
  ["/contacts", "contacts"],
  ["/companies", "companies"],
  ["/pipeline", "pipeline"],
  ["/services", "services"],
  ["/invoices", "invoices"],
  ["/invoices/new", "invoices-new"],
  ["/reports", "reports-overview"],
  ["/reports/revenue", "reports-revenue"],
  ["/reports/deals", "reports-deals"],
  ["/reports/people", "reports-people"],
  ["/reports/receivables", "reports-receivables"],
  ["/tasks", "tasks"],
  ["/recurring", "recurring"],
  ["/import", "import"],
  ["/export", "export"],
  ["/duplicates", "duplicates"],
  ["/trash", "trash"],
  ["/settings", "settings"],
  ["/settings/workspace", "settings-workspace"],
  ["/settings/vocabulary", "settings-vocabulary"],
  ["/settings/appearance", "settings-appearance"],
  ["/settings/templates", "settings-templates"],
  ["/settings/invoices", "settings-invoices"],
  ["/settings/shortcuts", "settings-shortcuts"],
  ["/settings/services", "settings-services"],
  ["/settings/tags", "settings-tags"],
  ["/settings/fields", "settings-fields"],
  ["/settings/site", "settings-site"],
  ["/settings/backups", "settings-backups"],
  ["/settings/ai", "settings-ai"],
  ["/settings/workspaces", "settings-workspaces"],
  ["/settings/diagnostics", "settings-diagnostics"],
  ["/help", "help"],
  ["/nowhere-at-all", "unknown-route"],
];

function firstId(helix: HelixHarness, sql: string): string | null {
  const rows = helix.bridge.query(sql, []);
  return rows.length ? String(rows[0][0]) : null;
}

test.describe("dense", () => {
  test.use({ onboarding: "show" });

  test("landscaping with the sample week", async ({ page, helix }) => {
    test.setTimeout(240_000);
    const logs: Log[] = [];
    const mark = watch(page, logs);
    await page.setViewportSize({ width: 1280, height: 800 });

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
    await shoot(page, "dense-onboarding-3");
    await page.getByRole("button", { name: /Show me an example/ }).click();
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    await settle(page);
    await shoot(page, "dense-today", { full: true });

    for (const [route, name] of STATIC_ROUTES) {
      await visit(page, mark, route, `dense-${name}`, true);
    }

    // Record pages: the busiest contact, company and deal.
    const contactId = firstId(
      helix,
      `SELECT c.id FROM contacts c LEFT JOIN activities a ON a.contact_id = c.id
       WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY count(a.id) DESC LIMIT 1`,
    );
    const companyId = firstId(
      helix,
      `SELECT co.id FROM companies co LEFT JOIN deals d ON d.company_id = co.id
       WHERE co.deleted_at IS NULL GROUP BY co.id ORDER BY count(d.id) DESC LIMIT 1`,
    );
    const dealId = firstId(
      helix,
      `SELECT d.id FROM deals d LEFT JOIN activities a ON a.deal_id = d.id
       WHERE d.deleted_at IS NULL GROUP BY d.id ORDER BY count(a.id) DESC LIMIT 1`,
    );
    const wonDealId = firstId(
      helix,
      `SELECT d.id FROM deals d JOIN stages s ON s.id = d.stage_id WHERE s.is_won = 1 AND d.deleted_at IS NULL LIMIT 1`,
    );
    if (contactId) await visit(page, mark, `/contacts/${contactId}`, "dense-contact-page", true);
    if (companyId) await visit(page, mark, `/companies/${companyId}`, "dense-company-page", true);
    if (dealId) await visit(page, mark, `/deals/${dealId}`, "dense-deal-page", true);
    if (wonDealId) await visit(page, mark, `/deals/${wonDealId}`, "dense-deal-won-page", true);

    // Compact density and dark theme on the two densest screens.
    mark("/pipeline dark");
    await page.goto("/pipeline");
    await settle(page);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.waitForTimeout(300);
    await shoot(page, "dense-pipeline-dark");
    if (dealId) {
      mark("/deals dark");
      await page.goto(`/deals/${dealId}`);
      await settle(page);
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await page.waitForTimeout(300);
      await shoot(page, "dense-deal-page-dark", { full: true });
    }
    // The shell re-applies data-theme and data-density from helix.json when it
    // mounts, so the attributes are set AFTER the navigation has settled and
    // asserted before the shot; setting them first and then navigating leaves
    // a comfortable screenshot with a compact file name.
    mark("/contacts compact");
    await page.goto("/contacts");
    await settle(page);
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
      document.documentElement.setAttribute("data-density", "compact");
    });
    await page.waitForTimeout(300);
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await shoot(page, "dense-contacts-compact");

    // Narrow: the 1024 floor.
    await page.setViewportSize({ width: 1024, height: 700 });
    for (const [route, name] of [["/", "today"], ["/pipeline", "pipeline"], ["/reports/revenue", "revenue"]] as const) {
      await visit(page, mark, route, `dense-1024-${name}`);
    }
    if (dealId) await visit(page, mark, `/deals/${dealId}`, "dense-1024-deal", true);

    // Overlays: quick add, search, palette.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await settle(page);
    mark("quick add");
    await page.keyboard.press("Meta+N");
    await page.waitForTimeout(400);
    await shoot(page, "dense-quick-add");
    await page.keyboard.press("Escape");
    mark("search");
    await page.keyboard.press("Meta+K");
    await page.waitForTimeout(300);
    await page.keyboard.type("marla");
    await page.waitForTimeout(500);
    await shoot(page, "dense-search");
    await page.keyboard.press("Escape");
    mark("palette");
    await page.keyboard.press("Meta+Shift+K");
    await page.waitForTimeout(400);
    await shoot(page, "dense-palette");
    await page.keyboard.press("Escape");

    writeFileSync(`${SCREENS}dense-errors.json`, JSON.stringify(logs, null, 2));
  });
});

test.describe("sparse", () => {
  test("an empty workspace, setup skipped", async ({ page, helix }) => {
    test.setTimeout(180_000);
    void helix;
    const logs: Log[] = [];
    const mark = watch(page, logs);
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [route, name] of STATIC_ROUTES) {
      await visit(page, mark, route, `sparse-${name}`, true);
    }
    writeFileSync(`${SCREENS}sparse-errors.json`, JSON.stringify(logs, null, 2));
  });
});
