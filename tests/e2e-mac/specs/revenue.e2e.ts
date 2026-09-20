/**
 * D20's money end to end: the services catalog, pricing a deal from it, the
 * board and list showing the upfront/monthly breakdown, and the recurring
 * revenue report a won deal feeds.
 *
 * What this proves: /settings/services writes real `products` rows; the deal
 * page's Services panel reads and prices lines from them through
 * `dealItemsRepo`; `totalsFor` (src/db/repos/dealItems.ts) is the arithmetic
 * both the panel and this spec agree on; the pipeline board/list render the
 * same upfront+monthly breakdown as the deal page; and winning a deal starts
 * its recurring clock so /reports/revenue counts it.
 *
 * What it cannot prove: anything that is actually Rust — see fixtures.ts.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4203 E2E_OUT=dist-rev npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/revenue.e2e.ts
 */
import { test, expect } from "../fixtures";
import type { HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

/* -------------------------------------------------------------------------- */
/* the expected numbers, derived from src/db/repos/dealItems.ts's totalsFor   */
/* -------------------------------------------------------------------------- */

/**
 * Patio installation: one-time, suggested $1,500 (150000c), overridden to an
 * actual of $1,200 (120000c) on the deal.
 * Monthly upkeep: recurring/month, $150 (15000c), left at the suggested price.
 *
 * totalsFor sums oneTimeCentsFor/monthlyCentsFor over both lines at the actual
 * prices and again at the suggested prices, then:
 *   valueCents          = annualValueCents(oneTime, monthly)     = oneTime + 12*monthly
 *   suggestedTotalCents = annualValueCents(suggestedOneTime, suggestedMonthly)
 *   discountCents       = suggestedTotalCents - valueCents
 *
 *   actual:    oneTime=120000            monthly=15000  -> value     = 120000 + 12*15000 = 300000
 *   suggested: oneTime=150000            monthly=15000  -> suggested = 150000 + 12*15000 = 330000
 *   discount = 330000 - 300000 = 30000
 *
 * formatMoneyTrim (src/lib/money.ts) drops the cents when the amount is a
 * whole dollar figure, which every one of these is:
 *   totals-suggested -> "$3,300"
 *   totals-actual    -> "$3,000"
 *   totals-discount  -> "-$300"
 *   totals-breakdown -> formatBreakdown(120000, 15000, upfrontLabel) = "Upfront $1,200 + $150/mo"
 * The board/list breakdown (no upfrontLabel) is "$1,200 + $150/mo".
 * MRR is the one active recurring line: formatMoney(15000) = "$150.00".
 */
const TOTALS_SUGGESTED = "$3,300";
const TOTALS_ACTUAL = "$3,000";
const TOTALS_DISCOUNT = "-$300";
const TOTALS_BREAKDOWN = "Upfront $1,200 + $150/mo";
const BOARD_BREAKDOWN = "$1,200 + $150/mo";
const MRR_TEXT = "$150.00";

/* -------------------------------------------------------------------------- */
/* Shared helpers (copied from records.e2e.ts, the reference spec)            */
/* -------------------------------------------------------------------------- */

/**
 * The shell (sidebar) has to be on screen before onBoot's mount has landed.
 *
 * Named "Main": a settings screen also renders its own section nav
 * (`data-testid="settings-nav"`, aria-label "Settings sections"), and an
 * unscoped `getByRole("navigation")` there resolves to both.
 */
async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

function quickAddDialog(page: Page) {
  return page.getByRole("dialog", { name: "Quick add" });
}

/**
 * Open quick add. The shortcut is Cmd+N on macOS (records/quickAdd/host.tsx
 * checks navigator.platform and calls preventDefault), which is what this
 * harness's headless Chromium reports on this machine. Cmd+N can also be read
 * as a browser accelerator, so this falls back to the Cmd+K command palette's
 * "Quick add" entry if the dialog does not show up from the shortcut alone.
 */
async function openQuickAdd(page: Page): Promise<void> {
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

/* -------------------------------------------------------------------------- */
/* Screenshot helpers (same mechanism as records.e2e.ts: `data-theme` on the  */
/* root element, waited out so the transition has actually landed).          */
/* -------------------------------------------------------------------------- */

const OUT = "tests/e2e-mac/.cache/screens/revenue";

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

/* -------------------------------------------------------------------------- */
/* Feature-local helpers                                                      */
/* -------------------------------------------------------------------------- */

async function addServiceThroughSettings(
  page: Page,
  opts: { name: string; charge: "One time" | "Every month"; price: string },
): Promise<void> {
  await page.getByTestId("service-new").click();
  const dialog = page.getByRole("dialog", { name: "Add a service" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(opts.name);
  if (opts.charge !== "One time") {
    await dialog.getByRole("combobox", { name: "How is it charged?" }).click();
    await page.getByRole("option", { name: opts.charge }).click();
  }
  await dialog.getByLabel("Price").fill(opts.price);
  await page.getByTestId("service-save").click();
  await expect(dialog).toBeHidden();
}

/**
 * Round 3, criterion 11: the deal's services panel is a MultiCombobox over the
 * catalog, not the old popover with its own search box. Ticking an option adds
 * the line, so this closes the popover afterwards to leave the page settled.
 */
async function addServiceToDeal(page: Page, serviceName: string): Promise<void> {
  await page.getByTestId("deal-services-panel").getByTestId("combobox").click();
  await page.getByTestId("combobox-input").fill(serviceName);
  await page.getByTestId("combobox-option").filter({ hasText: serviceName }).first().click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("deal-services-panel").getByText(serviceName),
  ).toBeVisible();
}

test.use({ viewport: { width: 1280, height: 900 } });

test.describe("revenue", () => {
  test("prices a deal from the services catalog and carries it through to Revenue", async ({
    page,
    helix,
  }) => {
    /* ---- 1. Build the catalog ---------------------------------------- */
    await page.goto("/settings/services");
    await waitForShell(page);

    await addServiceThroughSettings(page, {
      name: "Patio installation",
      charge: "One time",
      price: "1500",
    });
    await addServiceThroughSettings(page, {
      name: "Monthly upkeep",
      charge: "Every month",
      price: "150",
    });

    // Three groups match the three answers the dialog's "How is it charged?"
    // asks (one time / every month / every year); "Monthly upkeep" lands in
    // the "every month" one.
    const oneTimeGroup = page.getByTestId("services-group-one_time");
    const monthlyGroup = page.getByTestId("services-group-month");
    const patioRow = oneTimeGroup.locator('[data-testid="service-row"][data-service-name="Patio installation"]');
    const upkeepRow = monthlyGroup.locator('[data-testid="service-row"][data-service-name="Monthly upkeep"]');
    await expect(patioRow).toBeVisible();
    await expect(upkeepRow).toBeVisible();
    // The one-time price and the monthly price are both a whole-dollar figure
    // ("$1,500" / "$150"); this checks the substring regardless of whether the
    // trailing ".00" a whole amount can legally carry is present.
    await expect(patioRow).toContainText("$1,500");
    await expect(upkeepRow).toContainText("$150");
    await expect(upkeepRow).toContainText("/mo");

    await shoot(page, "services");

    /* ---- 2. Create a deal and open it --------------------------------- */
    await page.goto("/");
    const dealTitle = "Cottonwood patio and upkeep";
    await quickAddDeal(page, dealTitle);

    const [[dealId]] = helix.bridge.query("SELECT id FROM deals WHERE title = ?", [
      dealTitle,
    ]) as [string][];
    const [[newStageId]] = helix.bridge.query(
      "SELECT id FROM stages WHERE deleted_at IS NULL ORDER BY position ASC LIMIT 1",
      [],
    ) as [string][];

    await page.goto(`/deals/${dealId}`);
    await expect(page.getByRole("heading", { name: dealTitle, level: 1 })).toBeVisible();

    /* ---- 3. Add both services from the picker -------------------------- */
    const panel = page.getByTestId("deal-services-panel");
    await addServiceToDeal(page, "Patio installation");
    await expect(panel.getByTestId("deal-service-row")).toHaveCount(1);
    await addServiceToDeal(page, "Monthly upkeep");
    await expect(panel.getByTestId("deal-service-row")).toHaveCount(2);

    /* ---- 4. Override the patio line's actual price to $1,200 ----------- */
    const patioLine = panel.getByTestId("deal-service-row").filter({ hasText: "Patio installation" });
    await expect(patioLine.getByTestId("line-suggested")).toHaveText("$1,500");
    const actualInput = patioLine.getByTestId("line-actual");
    await actualInput.fill("1200");
    await actualInput.press("Tab");

    await expect(panel.getByTestId("totals-suggested")).toHaveText(TOTALS_SUGGESTED);
    await expect(panel.getByTestId("totals-actual")).toHaveText(TOTALS_ACTUAL);
    await expect(panel.getByTestId("totals-discount")).toHaveText(TOTALS_DISCOUNT);
    await expect(panel.getByTestId("totals-breakdown")).toHaveText(TOTALS_BREAKDOWN);

    // The database agrees with the screen: the write went through
    // dealItemsRepo.update and recompute, not just local state.
    const [[oneTimeCents, recurringMonthlyCents, valueCents, suggestedTotalCents]] =
      helix.bridge.query(
        "SELECT one_time_cents, recurring_monthly_cents, value_cents, suggested_total_cents FROM deals WHERE id = ?",
        [dealId],
      ) as [[number, number, number, number]];
    expect(oneTimeCents).toBe(120000);
    expect(recurringMonthlyCents).toBe(15000);
    expect(valueCents).toBe(300000);
    expect(suggestedTotalCents).toBe(330000);

    await shoot(page, "deal");

    /* ---- 5. The pipeline board and list show the same breakdown -------- */
    await page.goto("/pipeline");
    const card = page.getByTestId("deal-card").filter({ hasText: dealTitle });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("card-value")).toHaveText(BOARD_BREAKDOWN);

    const column = page.locator(`[data-stage-id="${newStageId}"]`);
    const stageTotal = column.getByTestId("stage-total");
    await expect(stageTotal).toContainText("Upfront");
    await expect(stageTotal).toContainText("/mo");

    await shoot(page, "board");

    await page.getByRole("button", { name: "List view" }).click();
    await expect(page.getByRole("table")).toBeVisible();
    const listRow = page.getByRole("row", { name: new RegExp(dealTitle) });
    await expect(listRow.getByTestId("row-value")).toHaveText(BOARD_BREAKDOWN);

    /* ---- 6. Win the deal ------------------------------------------------ */
    await page.goto(`/deals/${dealId}`);
    await page.getByRole("combobox", { name: "Stage" }).click();
    await page.getByRole("option", { name: "Won" }).click();

    await expect
      .poll(
        () =>
          (
            helix.bridge.query(
              "SELECT s.is_won, d.recurring_started_on FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.id = ?",
              [dealId],
            ) as [[number, string | null]]
          )[0],
      )
      .toEqual([1, expect.any(String)]);

    /* ---- 7. Revenue ------------------------------------------------------ */
    await page.goto("/reports/revenue");
    const mrrLabel = page.getByText("Monthly recurring revenue", { exact: true });
    await expect(mrrLabel).toBeVisible();
    const mrrValue = mrrLabel.locator("xpath=preceding-sibling::span[1]");
    await expect(mrrValue).toHaveText(MRR_TEXT);

    await expect(page.getByRole("link", { name: dealTitle })).toBeVisible();
    const activeRow = page.getByRole("row", { name: new RegExp(dealTitle) });
    await expect(activeRow).toContainText(MRR_TEXT);

    await shoot(page, "revenue");
  });
});
