/**
 * Launch assurance: one install, two businesses, nothing crossing between
 * them.
 *
 * Helix has no accounts, no organisations and no tenants, so the prompt's
 * "confirm permissions and tenant boundaries" has exactly one analogue in this
 * product, and this is it: an owner who runs two businesses from the same
 * install must never see one business's customers while the other is open.
 * Not in the lists, not in search, not on Today, and not in what he exports.
 *
 * `settings.e2e.ts` already proves the mechanism - creating a second workspace
 * repoints the open database at a new file. What it does not do is stand
 * inside the second workspace and look for the first one's rows, which is the
 * thing an owner would actually be harmed by and the only form of the question
 * a reviewer should accept. Structurally it cannot happen (two SQLite files,
 * one open at a time, and `boot.ts` clears the query cache and the undo stack
 * after every db_open); structurally-cannot-happen is how most isolation bugs
 * are described the day before they are found. What this looks for in
 * particular is the cached kind: a screen still rendering the last workspace's
 * rows because nothing invalidated it.
 *
 * ONE HARNESS RULE, LEARNED HERE, AND IT MATTERS MORE IN THIS SPEC THAN ANY
 * OTHER. Never `page.goto` after the switch. Every full navigation reruns the
 * fixture's `installShim` with the seed captured at fixture setup, which puts
 * the ORIGINAL `helix.json` back and reopens the FIRST workspace - and the
 * first workspace's rows then appear on Today, looking exactly like a leak
 * that isn't there. This spec navigates by clicking the app's own sidebar
 * links from here on, and re-reads `info.path` at the end to prove the
 * database under it never changed back.
 *
 * What this cannot prove, and does not claim: the keychain. Each workspace's
 * key and site token are separate keychain items under a per-workspace
 * account name, and that is real Rust (`src-tauri/src/secrets.rs`) which this
 * harness stubs. `settings.e2e.ts`'s archive test covers the stub's side of
 * it; the real one is a release-checklist hand check.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4330 E2E_OUT=dist-la npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/la-workspaces.e2e.ts
 */
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

type DbInfoLike = { path: string };

const FIRST_CUSTOMER = "Zephaniah Quicksilver";
const FIRST_JOB = "Quicksilver retaining wall";
const FIRST_NOTE = "Gate code for the Quicksilver job is 4821.";

/** Click a sidebar link. Never `page.goto` - see the note above. */
async function nav(page: Page, name: string): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
}

async function createAndSwitchToWorkspace(
  page: Page,
  helix: HelixHarness,
  name: string,
): Promise<string> {
  await page.getByTestId("workspace-new").click();
  await page.getByTestId("workspace-new-name").fill(name);
  await page.getByTestId("workspace-new-create").click();

  const row = page.locator(`[data-testid="workspace-row"][data-workspace-name="${name}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toHaveAttribute("data-workspace-open", "true", { timeout: 30_000 });

  const info = (await helix.bridge.call("info", [])) as DbInfoLike;
  const match = /\/workspaces\/([^/\\]+)[/\\]helix\.db$/.exec(info.path);
  if (!match) throw new Error(`could not read a workspace id out of "${info.path}"`);
  return match[1];
}

test.describe("two businesses on one install", () => {
  test("nothing from the first workspace is reachable from the second", async ({
    page,
    helix,
  }) => {
    test.setTimeout(180_000);

    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();

    // --- Workspace one: a customer, a job, and a note on the job. ----------
    const now = new Date().toISOString();
    const stageRows = helix.bridge.query("SELECT id FROM stages ORDER BY position LIMIT 1", []);
    expect(stageRows.length, "the first workspace has no stages").toBeGreaterThan(0);
    const stageId = String(stageRows[0][0]);

    helix.bridge.execute(
      `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at)
       VALUES ('w1-c', ?, ?, ?, ?)`,
      ["Zephaniah", "Quicksilver", now, now],
    );
    helix.bridge.execute(
      `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at,
                          position, contact_id, created_at, updated_at)
       VALUES ('w1-d', ?, 125000, 'USD', ?, ?, 0, 'w1-c', ?, ?)`,
      [FIRST_JOB, stageId, now, now, now],
    );
    helix.bridge.execute(
      `INSERT INTO activities (id, kind, body, contact_id, deal_id, occurred_at, created_at, updated_at)
       VALUES ('w1-a', 'note', ?, 'w1-c', 'w1-d', ?, ?, ?)`,
      [FIRST_NOTE, now, now, now],
    );

    const firstInfo = (await helix.bridge.call("info", [])) as DbInfoLike;

    // The first workspace really does hold them, on screen, or the rest of
    // this test proves nothing at all. One reload here, before any switch, so
    // Today refetches rather than serving the empty result it cached at boot
    // (staleTime is 30 s); reloading is safe at this point and only at this
    // point, because the registry the shim restores is still the one we
    // started with.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText(FIRST_JOB).first()).toBeVisible();
    await nav(page, "Contacts");
    await expect(page.getByText(FIRST_CUSTOMER).first()).toBeVisible();

    // --- Switch to a second business. --------------------------------------
    await nav(page, "Settings");
    await page.getByRole("link", { name: "Workspaces" }).click();
    await expect(page.getByTestId("settings-workspaces")).toBeVisible();

    const secondId = await createAndSwitchToWorkspace(
      page,
      helix,
      `Second Business ${Date.now()}`,
    );

    const secondInfo = (await helix.bridge.call("info", [])) as DbInfoLike;
    expect(secondInfo.path, "the two workspaces share a database file").not.toBe(firstInfo.path);
    expect(secondInfo.path).toContain(secondId);

    // --- Now stand inside the second one and look for the first's rows. -----

    // The database itself: the floor everything below stands on.
    for (const table of ["contacts", "deals", "activities"] as const) {
      const rows = helix.bridge.query(`SELECT count(*) FROM ${table}`, []);
      expect(
        Number(rows[0][0]),
        `the second workspace can see ${table} from the first`,
      ).toBe(0);
    }

    // Today, which is the screen the switch lands on and the one whose
    // "Recent activity" section is assembled across every table at once.
    await nav(page, "Today");
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    for (const text of [FIRST_CUSTOMER, FIRST_JOB, FIRST_NOTE]) {
      await expect(
        page.getByText(text),
        `Today in the second workspace still shows "${text}" from the first`,
      ).toHaveCount(0);
    }

    // The lists.
    for (const link of ["Contacts", "Deals", "Tasks"]) {
      await nav(page, link);
      await page.waitForTimeout(300);
      await expect(
        page.getByText(/Quicksilver/),
        `${link} in the second workspace shows the first workspace's records`,
      ).toHaveCount(0);
    }

    // The search index, which is its own set of tables and the thing most
    // likely to outlive a switch if anything survived it.
    await nav(page, "Today");
    await page.keyboard.press("Meta+K");
    await page.keyboard.type("Quicksilver");
    await page.waitForTimeout(800);
    await expect(
      page.getByText(FIRST_CUSTOMER),
      "search in the second workspace finds the first workspace's customer",
    ).toHaveCount(0);
    await expect(
      page.getByText(FIRST_JOB),
      "search in the second workspace finds the first workspace's job",
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // And the database under all of that is still the second one: if the
    // harness had quietly put the first workspace back, every assertion above
    // would have failed instead of passing, but say it out loud anyway.
    const stillSecond = (await helix.bridge.call("info", [])) as DbInfoLike;
    expect(stillSecond.path).toBe(secondInfo.path);

    // --- And the first workspace still has everything. ---------------------
    // Isolation that quietly emptied the first business would satisfy every
    // assertion above and be the worse bug of the two.
    await nav(page, "Settings");
    await page.getByRole("link", { name: "Workspaces" }).click();
    await expect(page.getByTestId("settings-workspaces")).toBeVisible();

    const firstRow = page.locator(
      '[data-testid="workspace-row"][data-workspace-open="false"]',
    );
    await expect(firstRow.first()).toBeVisible();
    await firstRow.first().getByRole("button", { name: /Open|Switch/ }).first().click();
    await expect(
      page.locator(`[data-testid="workspace-row"][data-workspace-open="true"]`).first(),
    ).toBeVisible({ timeout: 30_000 });

    const backToFirst = (await helix.bridge.call("info", [])) as DbInfoLike;
    expect(backToFirst.path, "switching back did not reopen the first workspace").toBe(
      firstInfo.path,
    );

    await nav(page, "Contacts");
    await expect(
      page.getByText(FIRST_CUSTOMER).first(),
      "switching away and back lost the first workspace's customer",
    ).toBeVisible({ timeout: 30_000 });
  });
});
