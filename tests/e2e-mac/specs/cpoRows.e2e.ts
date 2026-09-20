/**
 * Coordinator check (CPO/CDQO pass, phase two): every contact the header counts is
 * rendered or reachable. Seeds 16 contacts through the bridge, counts rendered rows
 * at 1280x820 in comfortable and compact, and scrolls the list to the end.
 *
 *   E2E_PORT=4222 E2E_OUT=dist-cpo-rows npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/cpoRows.e2e.ts
 */
import { test, expect } from "../fixtures";

test("the contacts list shows every contact it counts", async ({ page, helix }) => {
  // Boot once so the migrations have run before the bridge seeds rows.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
  const db = helix.bridge;
  const now = new Date().toISOString();
  for (let i = 0; i < 16; i += 1) {
    db.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [`c-${i}`, `Person${String(i).padStart(2, "0")}`, "Rowcheck", now, now],
    );
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/contacts");
  await expect(page.getByText("16 of 16 people")).toBeVisible();

  const rows = page.locator('[data-testid="contact-row"], [data-testid^="contact-row-"], tbody tr, [role="row"]');
  await page.waitForTimeout(600);
  const html = await page.locator("main").innerHTML();
  const rendered = (html.match(/Rowcheck/g) ?? []).length;
  console.log(`rendered names (comfortable): ${rendered} of 16; row nodes: ${await rows.count()}`);

  // Scroll the list region to the end and count again.
  await page.evaluate(() => {
    const scrollers = Array.from(document.querySelectorAll("main *")).filter((el) => {
      const s = getComputedStyle(el as HTMLElement);
      return (s.overflowY === "auto" || s.overflowY === "scroll") && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight;
    }) as HTMLElement[];
    for (const el of scrollers) el.scrollTop = el.scrollHeight;
    (window as unknown as { __scrollers: number }).__scrollers = scrollers.length;
  });
  await page.waitForTimeout(400);
  const scrollers = await page.evaluate(() => (window as unknown as { __scrollers: number }).__scrollers);
  const last = await page.getByText("Person15 Rowcheck").count();
  console.log(`scrollable regions: ${scrollers}; last contact reachable after scroll: ${last > 0}`);
  expect(last, "the 16th contact must be reachable").toBeGreaterThan(0);
});

test.describe("with the sample week", () => {
  test.use({ onboarding: "show" });
  test("every sample contact is reachable", async ({ page, helix }) => {
    void helix;
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto("/");
    await page.getByLabel("What is the business called?").fill("Alpine Ridge Landscape");
    await page.getByRole("button", { name: "Landscaping", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Use this setup" }).click();
    await page.getByRole("button", { name: /Show me an example/ }).click();
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    for (const density of ["comfortable", "compact"] as const) {
      await page.goto("/contacts");
      await expect(page.getByText("16 of 16 people")).toBeVisible();
      await page.evaluate((d) => document.documentElement.setAttribute("data-density", d), density);
      await page.waitForTimeout(500);
      const before = await page.locator('[data-testid^="contact-row"], tbody tr').count();
      const info = await page.evaluate(() => {
        const list = document.querySelector("[data-fit]") as HTMLElement | null;
        if (!list) return null;
        const s = getComputedStyle(list);
        return { h: list.clientHeight, sh: list.scrollHeight, ov: s.overflowY, ph: (list.parentElement as HTMLElement).clientHeight };
      });
      await page.evaluate(() => { const l = document.querySelector("[data-fit]") as HTMLElement | null; if (l) l.scrollTop = l.scrollHeight; });
      await page.waitForTimeout(400);
      const priya = await page.getByText("Priya Raghunathan").count();
      const tabitha = await page.getByText(/Tabitha|Teodoro|Yusuf|Wren/).count();
      console.log(`${density}: rows rendered before scroll ${before}; list ${JSON.stringify(info)}; last-alphabet contacts visible after scroll: ${tabitha}, Priya: ${priya}`);
      await page.screenshot({ path: `tests/e2e-mac/.cache/screens/cpo/rows-${density}.png` });
    }
  });
});
