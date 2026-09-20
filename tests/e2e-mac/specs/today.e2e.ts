/**
 * Today, end to end: the built app in Chromium, driving a real SQLite file
 * through the harness bridge.
 *
 * What this proves: the four sections pick the right rows out of real SQL, the
 * two one-tap actions actually write and the row leaves the section, the empty
 * screens render, and search finds a record by name and navigates to it.
 *
 * What it cannot prove: anything that is Rust. `tel:` goes to the opener stub,
 * not to a phone.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4182 E2E_OUT=dist-today npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/today.e2e.ts
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/brand-a/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

const DAY = 24 * 60 * 60 * 1000;

function dateOnly(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Seeded = {
  overdueTaskTitle: string;
  todayTaskTitle: string;
  leadName: string;
  quietCompany: string;
  quietDealId: string;
};

/**
 * Arranged straight through the bridge rather than through the UI, because
 * these rows exist to test Today, not to test whatever screen creates them.
 * The app has already booted once by this point, so the migrations have run
 * and the seed's stages and sources exist.
 */
function seed(helix: HelixHarness): Seeded {
  const db = helix.bridge;

  const stageId = (name: string): string => {
    const rows = db.query("SELECT id FROM stages WHERE name = ?", [name]);
    if (rows.length === 0) throw new Error(`the seed did not create a "${name}" stage`);
    return String(rows[0][0]);
  };
  const sourceId = (name: string): string => {
    const rows = db.query("SELECT id FROM sources WHERE name = ?", [name]);
    if (rows.length === 0) throw new Error(`the seed did not create a "${name}" source`);
    return String(rows[0][0]);
  };

  const stageNew = stageId("New");
  const stageContacted = stageId("Contacted");
  const website = sourceId("Website");
  const referral = sourceId("Referral");

  // --- the customer the overdue task is about ------------------------------
  db.execute(
    `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    ["c-brent", "Brent", "Hendrickson", iso(-40 * DAY), iso(-40 * DAY)],
  );
  db.execute(
    `INSERT INTO contact_phones (id, contact_id, raw, e164, label, is_primary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ["p-brent", "c-brent", "(801) 555-0147", "+18015550147", "mobile", iso(-40 * DAY), iso(-40 * DAY)],
  );

  // --- the new lead nobody has called --------------------------------------
  db.execute(
    `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    ["c-rosalind", "Rosalind", "Whitaker", iso(-2 * DAY), iso(-2 * DAY)],
  );
  db.execute(
    `INSERT INTO contact_phones (id, contact_id, raw, e164, label, is_primary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ["p-rosalind", "c-rosalind", "(801) 555-0163", "+18015550163", "mobile", iso(-2 * DAY), iso(-2 * DAY)],
  );
  db.execute(
    `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at,
                        position, contact_id, source_id, created_at, updated_at)
     VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?, ?, ?)`,
    [
      "d-lead",
      "Xeriscape conversion, front yard",
      450000,
      stageNew,
      iso(-2 * DAY),
      "c-rosalind",
      website,
      iso(-2 * DAY),
      iso(-2 * DAY),
    ],
  );
  // The poller's system entry. It must NOT take the lead off the section: the
  // owner has still not called anybody.
  db.execute(
    `INSERT INTO activities (id, kind, body, occurred_at, deal_id, contact_id, is_system, created_at, updated_at)
     VALUES (?, 'system', ?, ?, ?, ?, 1, ?, ?)`,
    [
      "a-lead-received",
      "Lead received from alpineridgelandscape.com/xeriscape",
      iso(-2 * DAY),
      "d-lead",
      "c-rosalind",
      iso(-2 * DAY),
      iso(-2 * DAY),
    ],
  );

  // --- the deal that has gone quiet ----------------------------------------
  db.execute(
    `INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ["co-quiet", "Mountain Shadows Assisted Living", iso(-90 * DAY), iso(-90 * DAY)],
  );
  db.execute(
    `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at,
                        position, company_id, source_id, created_at, updated_at)
     VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?, ?, ?)`,
    [
      "d-quiet",
      "Fall cleanup contract, 32 units",
      678000,
      stageContacted,
      iso(-30 * DAY),
      "co-quiet",
      referral,
      iso(-45 * DAY),
      iso(-30 * DAY),
    ],
  );

  // --- what is due ----------------------------------------------------------
  db.execute(
    `INSERT INTO tasks (id, title, due_on, contact_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "t-overdue",
      "Send revised estimate to Brent Hendrickson",
      dateOnly(-6 * DAY),
      "c-brent",
      iso(-6 * DAY),
      iso(-6 * DAY),
    ],
  );
  db.execute(
    `INSERT INTO tasks (id, title, due_on, deal_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "t-today",
      "Order 4,200 sq ft of Kentucky bluegrass sod",
      dateOnly(0),
      "d-quiet",
      iso(-1 * DAY),
      iso(-1 * DAY),
    ],
  );

  // --- recent activity ------------------------------------------------------
  db.execute(
    `INSERT INTO activities (id, kind, body, occurred_at, contact_id, is_system, created_at, updated_at)
     VALUES (?, 'call', ?, ?, ?, 0, ?, ?)`,
    [
      "a-call",
      "Brent wants the wall dropped to 4 ft and a revised number by Friday.",
      iso(-3 * 60 * 60 * 1000),
      "c-brent",
      iso(-3 * 60 * 60 * 1000),
      iso(-3 * 60 * 60 * 1000),
    ],
  );
  db.execute(
    `INSERT INTO activities (id, kind, body, occurred_at, company_id, is_system, created_at, updated_at)
     VALUES (?, 'note', ?, ?, ?, 0, ?, ?)`,
    [
      "a-note",
      "Left a voicemail with the facilities manager.",
      iso(-1 * DAY),
      "co-quiet",
      iso(-1 * DAY),
      iso(-1 * DAY),
    ],
  );

  return {
    overdueTaskTitle: "Send revised estimate to Brent Hendrickson",
    todayTaskTitle: "Order 4,200 sq ft of Kentucky bluegrass sod",
    leadName: "Rosalind Whitaker",
    quietCompany: "Mountain Shadows Assisted Living",
    quietDealId: "d-quiet",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function section(page: Page, id: string) {
  return page.locator(`[data-today-section="${id}"]`);
}

async function bootTodayWithData(page: Page, helix: HelixHarness): Promise<Seeded> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true, level: 1 }),
  ).toBeVisible();
  const seeded = seed(helix);
  await page.reload();
  await expect(section(page, "due-now")).toBeVisible();
  return seeded;
}

/**
 * Flip the theme and wait for it to finish arriving.
 *
 * Buttons in src/ui carry `transition-colors`, so the frame right after
 * `data-theme` changes is the OLD colour: a capture taken in the same tick
 * photographs the light theme wearing a dark label and every screenshot lies.
 * Wait for the canvas to actually change, then give the slowest transition
 * room to land.
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

/** Light and dark, at the width DESIGN.md's review pass asks for. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await settleTheme(page, theme);
    await page.screenshot({
      path: `${SCREENS}${name}-${theme}.png`,
      fullPage: true,
    });
  }
  await settleTheme(page, "light");
}

/**
 * The same screen at `data-density="compact"`, which is where a hard-coded
 * height or font size shows up: every size in the product is a token, so
 * compact is a 25% denser screen and not a broken one (DESIGN.md §7).
 */
async function shootCompact(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-density", "compact");
  });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${SCREENS}${name}-compact.png`,
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-density", "comfortable");
  });
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

test.describe("Today", () => {
  // `helix` must be destructured even where the test does not touch it: that
  // fixture is what installs the database bridge and the Tauri invoke shim, and
  // Playwright only builds a fixture a test actually asks for.
  test("a brand-new workspace gets the first-run screen, not four empty panels", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Today", exact: true, level: 1 }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /Nothing here yet/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Import a CSV" })).toHaveAttribute(
      "href",
      "/import",
    );
    await expect(page.getByRole("button", { name: "Add a contact" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Connect website" }),
    ).toHaveAttribute("href", "/settings/site");

    // No section panels while the workspace is empty.
    await expect(section(page, "due-now")).toHaveCount(0);

    // And the workspace really is empty: the seed creates stages and sources,
    // never a contact.
    const contacts = helix.bridge.query("SELECT count(*) FROM contacts", []);
    expect(Number(contacts[0][0])).toBe(0);

    await shoot(page, "today-empty");
    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("every section shows the rows it owns", async ({ page, helix }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const seeded = await bootTodayWithData(page, helix);

    // Due now: the overdue task first, then today's. The next seven days are
    // deliberately absent.
    const dueNow = section(page, "due-now");
    await expect(dueNow.getByText(seeded.overdueTaskTitle)).toBeVisible();
    await expect(dueNow.getByText(seeded.todayTaskTitle)).toBeVisible();
    await expect(dueNow.getByText(/Overdue \d+ days/)).toBeVisible();
    await expect(dueNow.getByText("Due today")).toBeVisible();
    await expect(dueNow.getByRole("link", { name: "Brent Hendrickson" })).toHaveAttribute(
      "href",
      "/contacts/c-brent",
    );

    // New leads: the website lead, with its source badge. The system "lead
    // received" entry must not have taken it off the list.
    const newLeads = section(page, "new-leads");
    await expect(newLeads.getByRole("link", { name: seeded.leadName })).toBeVisible();
    await expect(newLeads.getByText("Website")).toBeVisible();
    await expect(
      newLeads.getByRole("button", { name: "Log a call" }),
    ).toBeVisible();
    // The 45-day-old quiet deal is not a new lead.
    await expect(newLeads.getByText(seeded.quietCompany)).toHaveCount(0);

    // Gone quiet: 30 days in a stage whose limit is 14.
    const quiet = section(page, "gone-quiet");
    await expect(quiet.getByRole("link", { name: seeded.quietCompany })).toBeVisible();
    await expect(quiet.getByText(/No activity for 30 days · Limit 14 days/)).toBeVisible();
    await expect(quiet.getByText("Contacted")).toBeVisible();
    // The two-day-old lead is not quiet.
    await expect(quiet.getByText(seeded.leadName)).toHaveCount(0);

    // Recent activity: newest first, each linked to its record.
    const recent = section(page, "recent-activity");
    await expect(recent.getByText(/Brent wants the wall dropped/)).toBeVisible();
    await expect(recent.getByText(/Left a voicemail/)).toBeVisible();
    await expect(
      recent.getByRole("link", { name: "Brent Hendrickson" }),
    ).toHaveAttribute("href", "/contacts/c-brent");

    // The connect-your-website card, because no site is configured.
    await expect(section(page, "connect-site")).toBeVisible();

    await shoot(page, "today");
    await shootCompact(page, "today");
    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("completing a task from Due now takes it off the list and writes it through", async ({
    page,
    helix,
  }) => {
    const seeded = await bootTodayWithData(page, helix);

    const dueNow = section(page, "due-now");
    const row = dueNow.locator("li", { hasText: seeded.overdueTaskTitle });
    await row.getByRole("button", { name: "Done" }).click();

    await expect(dueNow.getByText(seeded.overdueTaskTitle)).toHaveCount(0);
    // Today's task is still there: only the one row moved.
    await expect(dueNow.getByText(seeded.todayTaskTitle)).toBeVisible();

    const done = helix.bridge.query("SELECT done_at FROM tasks WHERE id = ?", [
      "t-overdue",
    ]);
    expect(done[0][0], "the task should be completed in the database").not.toBeNull();
  });

  test("snoozing a quiet deal drops it off Today and leaves a trail", async ({
    page,
    helix,
  }) => {
    const seeded = await bootTodayWithData(page, helix);

    const quiet = section(page, "gone-quiet");
    await expect(quiet.getByRole("link", { name: seeded.quietCompany })).toBeVisible();
    await quiet.getByRole("button", { name: "Snooze a week" }).click();

    await expect(quiet.getByRole("link", { name: seeded.quietCompany })).toHaveCount(0);
    await expect(quiet.getByText("Every open deal is moving")).toBeVisible();

    // The snooze is an activity, not a hidden column: the rule keys off it and
    // the timeline shows it.
    const rows = helix.bridge.query(
      `SELECT kind, is_system, body FROM activities WHERE deal_id = ? ORDER BY occurred_at DESC`,
      [seeded.quietDealId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(String(rows[0][0])).toBe("system");
    expect(Number(rows[0][1])).toBe(1);
    expect(String(rows[0][2])).toMatch(/Snoozed on Today/);
  });

  test("logging a call on a new lead takes it off the section", async ({
    page,
    helix,
  }) => {
    const seeded = await bootTodayWithData(page, helix);

    const newLeads = section(page, "new-leads");
    await newLeads.getByRole("button", { name: "Log a call" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Log a call with ${seeded.leadName}`)).toBeVisible();
    await dialog
      .getByLabel("What was said")
      .fill("Wants a quote for the front yard by Tuesday.");
    await dialog.getByRole("button", { name: "Save the call" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(newLeads.getByRole("link", { name: seeded.leadName })).toHaveCount(0);
    await expect(newLeads.getByText("No new leads waiting")).toBeVisible();

    const rows = helix.bridge.query(
      `SELECT kind, body FROM activities WHERE deal_id = ? AND is_system = 0`,
      ["d-lead"],
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0][0])).toBe("call");
    expect(String(rows[0][1])).toMatch(/front yard by Tuesday/);
  });

  test("dismissing the website card stores the dismissal", async ({ page, helix }) => {
    await bootTodayWithData(page, helix);

    const card = section(page, "connect-site");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toHaveCount(0);

    await page.reload();
    await expect(section(page, "due-now")).toBeVisible();
    await expect(section(page, "connect-site")).toHaveCount(0);

    const rows = helix.bridge.query(
      "SELECT value_json FROM settings WHERE key = ?",
      ["connectCardDismissed"],
    );
    expect(String(rows[0][0])).toBe("true");
  });
});

test.describe("search", () => {
  test("the shortcut opens it, typing finds a record, and Enter lands on its route", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await bootTodayWithData(page, helix);

    // Cmd/Ctrl+/ — the shell's palette already owns Cmd/Ctrl+K, so search has
    // its own key until the palette exposes a results provider.
    await page.keyboard.press("Meta+Slash");
    const search = page.getByTestId("today-search");
    await expect(search).toBeVisible();

    // Empty box: the records touched most recently.
    await expect(search.getByText("Recent")).toBeVisible();

    await page.keyboard.type("Hendrickson");
    await expect(search.getByText("Contacts")).toBeVisible();
    await expect(search.getByText("Brent Hendrickson")).toBeVisible();

    await shoot(page, "search-dialog");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(search).toHaveCount(0);
    await expect(page).toHaveURL(/\/contacts\/c-brent$/);

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("Cmd+K opens search, and the palette is one keystroke away", async ({
    page,
    helix,
  }) => {
    await bootTodayWithData(page, helix);

    // Wave 3: there is one search key. The shell runs the registered "search"
    // command on Cmd/Ctrl+K rather than opening the palette.
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("today-search")).toBeVisible();

    // And the command list is reachable from inside it.
    await page.getByRole("button", { name: /Commands/ }).click();
    await expect(page.getByPlaceholder("Search, or type a command")).toBeVisible();
    await expect(page.getByTestId("today-search")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("the palette's Search records command opens the same dialog", async ({
    page,
    helix,
  }) => {
    await bootTodayWithData(page, helix);

    await page.keyboard.press("Meta+Shift+k");
    // The shell's palette and this dialog are both cmdk; scope to the item so
    // the topbar button of the same name cannot be picked instead.
    const command = page.locator("[cmdk-item]", { hasText: "Search records" });
    await expect(command).toBeVisible();
    await command.click();

    await expect(page.getByTestId("today-search")).toBeVisible();
  });

  test("a query that matches nothing says so and repeats the query back", async ({
    page,
    helix,
  }) => {
    await bootTodayWithData(page, helix);

    await page.keyboard.press("Meta+Slash");
    const search = page.getByTestId("today-search");
    await expect(search).toBeVisible();

    await page.keyboard.type("zzzznobody");
    await expect(search.getByText(/Nothing matches/)).toBeVisible();
    await expect(search.getByText(/zzzznobody/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
  });
});

/* -------------------------------------------------------------------------- */
/* CPO pass regressions (2026-09-20)                                           */
/* -------------------------------------------------------------------------- */

test.describe("today: CPO regressions", () => {
  /**
   * F-LA-6, and its other half, F-CS-1.
   *
   * The invariant this protects was never the string "Nothing here yet" — it
   * is that adding one contact must never give the owner a blanker screen
   * than he had before (no stack of empty panels), and that guidance stays on
   * screen until a task, an open job or a logged activity retires it. Today
   * used to branch on "does this workspace hold any row", so saving one
   * contact swapped the three starter cards for six empty panels — the owner
   * did what the screen asked and got a blanker screen, with no link to the
   * person he had just created.
   *
   * F-CS-1 found the other half of the same bug: an owner who imports
   * fifty-two real customers and opens Today still saw the ORIGINAL first-run
   * screen, "Import a spreadsheet" and all — telling him to do the thing he
   * had just finished doing. "Nothing here yet" is exactly as false after one
   * contact as it is after an import, so both now land on the same honest
   * records-state screen (src/features/today/lib/useToday.ts's
   * `todayScreenState`), and the assertions below are about the invariant —
   * no six-empty-panels blank screen, guidance until real work exists — not
   * about which heading happens to be showing.
   */
  test("one contact gets guidance, not empty panels; work retires the guidance", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    // Nothing at all: the original three-starter-card first run.
    await expect(page.getByRole("heading", { name: /Nothing here yet/ })).toBeVisible();
    await expect(page.getByText("Due now")).toBeHidden();

    const now = new Date().toISOString();
    helix.bridge.execute(
      `INSERT INTO contacts (id, created_at, updated_at, first_name, last_name)
       VALUES ('c-first', ?, ?, 'Brent', 'Hendrickson')`,
      [now, now],
    );
    await page.reload();
    // A contact exists now, so the ORIGINAL first-run guidance ("Nothing here
    // yet") must be gone — it would be false — and so must the real panels:
    // this is the failure the CPO audit actually found, stated both ways
    // rather than as a single heading string.
    await expect(page.getByRole("heading", { name: /Nothing here yet/ })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Your customers are in Helix" })).toBeVisible();
    await expect(page.getByText("Due now")).toBeHidden();
    await expect(page.getByText("Gone quiet")).toBeHidden();

    // A promise to keep is what Today is for, so one task retires the
    // guidance and brings on the real panels.
    helix.bridge.execute(
      `INSERT INTO tasks (id, created_at, updated_at, title, contact_id)
       VALUES ('t-first', ?, ?, 'Call Brent back', 'c-first')`,
      [now, now],
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: /Nothing here yet/ })).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Your customers are in Helix" }),
    ).toBeHidden();
    await expect(page.getByText("Due now")).toBeVisible();
  });

  /**
   * F-LA-6, the second half: "Every open deal is moving" is a report about
   * work that does not exist when the workspace has no open deals.
   */
  test("gone quiet does not claim every deal is moving when there are none", async ({
    page,
    helix,
  }) => {
    // The first goto is what runs the migrations, and the heading is how we
    // know they finished: inserting before that is "no such table: contacts".
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
    const now = new Date().toISOString();
    helix.bridge.execute(
      `INSERT INTO contacts (id, created_at, updated_at, first_name, last_name)
       VALUES ('c-gq', ?, ?, 'Marla', 'Quintero')`,
      [now, now],
    );
    helix.bridge.execute(
      `INSERT INTO tasks (id, created_at, updated_at, title, contact_id)
       VALUES ('t-gq', ?, ?, 'Call Marla', 'c-gq')`,
      [now, now],
    );
    await page.reload();
    await expect(page.getByText(/No open .* yet\./)).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* CDQO-LA-W2 design/quality pass regressions (2026-09-20)                     */
/* -------------------------------------------------------------------------- */

test.describe("today: LA-W2 design regressions", () => {
  /**
   * F-W2-D1. A Today row used to put its tag (the "Overdue N days" badge, a
   * source badge, a stage badge) in a fixed-width column ahead of the name,
   * which the owner scans for first. The coordinator's direction rule 1 is
   * explicit: name, how to reach or find them, money, tags last. The tag now
   * renders after the money, immediately before the row's actions.
   */
  test("a Due now row's tag sits to the right of the task title, not ahead of it", async ({
    page,
    helix,
  }) => {
    const seeded = await bootTodayWithData(page, helix);
    const dueNow = section(page, "due-now");
    const row = dueNow.locator("li", { hasText: seeded.overdueTaskTitle });

    const titleBox = await row.getByText(seeded.overdueTaskTitle).boundingBox();
    const tagBox = await row.getByText(/Overdue \d+ days/).boundingBox();
    expect(titleBox).not.toBeNull();
    expect(tagBox).not.toBeNull();
    expect(titleBox!.x).toBeLessThan(tagBox!.x);
  });

  /**
   * F-W2-D3. Quick add's type switcher is a real ARIA tablist: only the
   * selected tab is a tab stop, and the arrow keys move both the selection and
   * focus, so a keyboard user never has to reach for the mouse to change
   * record types.
   */
  test("quick add's type tabs are keyboard-navigable with a roving tabindex", async ({
    page,
    helix,
  }) => {
    await bootTodayWithData(page, helix);
    await page.keyboard.press("Meta+n");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The Name field takes focus on open (autoFocus); Shift+Tab is how a
    // keyboard user reaches the tablist's one tab stop from there.
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("tab", { name: "Contact" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Contact" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Company" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Company" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The tab that lost the selection is out of the sequential tab order.
    await expect(page.getByRole("tab", { name: "Contact" })).toHaveAttribute(
      "tabindex",
      "-1",
    );

    await page.keyboard.press("Escape");
  });
});
