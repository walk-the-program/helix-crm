/**
 * The depth features, end to end: recurring reminders, message templates, add
 * to calendar, the week summary and Help.
 *
 * What this proves that a unit test cannot: the migration really creates the
 * two tables, a reminder set on a contact turns up on Today and its date moves
 * when it is done, a template picked from a contact reaches the OS opener as an
 * `sms:` URL with the rendered message in it, and the calendar button hands a
 * real VCALENDAR to the save dialog and then to the opener.
 *
 * What it cannot prove: anything that is Rust. The dialog, the write and the
 * opener are all stubs from tests/e2e-mac/fixtures.ts, which is the point -
 * they record what the app asked for.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4198 E2E_OUT=dist-depth npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/depth.e2e.ts
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/depth/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });

const DAY = 24 * 60 * 60 * 1000;

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

/** A local calendar day, the way the app stores due_on and next_due_on. */
function dateOnly(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type E2EState = {
  files: Record<string, string>;
  dialogQueue: (string | string[] | null)[];
  opened: string[];
  calls: { cmd: string; args: unknown; path: string }[];
};

async function e2eState(page: Page): Promise<E2EState> {
  return page.evaluate(() => {
    const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
    return {
      files: state.files,
      dialogQueue: state.dialogQueue,
      opened: state.opened,
      calls: state.calls,
    };
  });
}

/** Queue the path the next save dialog returns. */
async function offerSavePath(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
    state.dialogQueue.push(p);
  }, path);
}

/** Everything the app has handed the OS opener so far. */
async function openedUrls(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __helixE2E: E2EState }).__helixE2E.opened,
  );
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

type Seeded = {
  contactId: string;
  contactName: string;
  phone: string;
  email: string;
  dealTitle: string;
};

/**
 * One customer with a phone, an email, an address and an open deal, arranged
 * straight through the bridge. The app has booted once by this point, so the
 * migrations have run and the seed's stages exist.
 */
function seed(helix: HelixHarness): Seeded {
  const db = helix.bridge;

  const stageRows = db.query("SELECT id FROM stages WHERE name = ?", ["Quoted"]);
  if (stageRows.length === 0) throw new Error('the seed did not create a "Quoted" stage');
  const stageId = String(stageRows[0][0]);

  db.execute(
    `INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ["co-shadows", "Mountain Shadows Assisted Living", iso(-90 * DAY), iso(-90 * DAY)],
  );
  db.execute(
    `INSERT INTO contacts (id, first_name, last_name, company_id, address_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      "c-nella",
      "Nella",
      "Okonkwo",
      "co-shadows",
      JSON.stringify({
        line1: "4820 South Highland Drive",
        line2: "",
        city: "Holladay",
        state: "UT",
        postalCode: "84117",
        country: "",
      }),
      iso(-30 * DAY),
      iso(-30 * DAY),
    ],
  );
  db.execute(
    `INSERT INTO contact_phones (id, contact_id, raw, e164, label, is_primary, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'mobile', 1, ?, ?)`,
    ["p-nella", "c-nella", "(801) 555-0163", "+18015550163", iso(-30 * DAY), iso(-30 * DAY)],
  );
  db.execute(
    `INSERT INTO contact_emails (id, contact_id, email_lower, label, is_primary, created_at, updated_at)
     VALUES (?, ?, ?, 'work', 1, ?, ?)`,
    ["e-nella", "c-nella", "nella@example.com", iso(-30 * DAY), iso(-30 * DAY)],
  );
  db.execute(
    `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at,
                        position, contact_id, company_id, created_at, updated_at)
     VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?, ?, ?)`,
    [
      "d-cleanup",
      "Fall cleanup, 32 units",
      678000,
      stageId,
      iso(-5 * DAY),
      "c-nella",
      "co-shadows",
      iso(-5 * DAY),
      iso(-5 * DAY),
    ],
  );
  // The owner and business names onboarding would have written.
  db.execute(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
    ["owner.name", JSON.stringify("Dale"), iso(0)],
  );
  db.execute(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
    ["business.name", JSON.stringify("Alpine Ridge Landscape"), iso(0)],
  );

  return {
    contactId: "c-nella",
    contactName: "Nella Okonkwo",
    phone: "(801) 555-0163",
    email: "nella@example.com",
    dealTitle: "Fall cleanup, 32 units",
  };
}

async function bootWithData(page: Page, helix: HelixHarness): Promise<Seeded> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true, level: 1 }),
  ).toBeVisible();
  const seeded = seed(helix);
  await page.reload();
  await expect(page.locator('[data-today-section="due-now"]')).toBeVisible();
  return seeded;
}

/** Light and dark, at the width the design review asks for. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
    }, theme);
    // Controls carry `transition-colors`; a capture taken the instant the
    // attribute flips catches them mid-fade.
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SCREENS}${name}-${theme}.png`, fullPage: true });
  }
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// Recurring reminders
// ---------------------------------------------------------------------------

test.describe("recurring reminders", () => {
  test("a reminder set on a contact reaches Today, and Done moves its date", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const seeded = await bootWithData(page, helix);

    // --- add the rule from the contact page ---------------------------------
    await page.goto(`/contacts/${seeded.contactId}`);
    await expect(page.getByRole("heading", { name: seeded.contactName, level: 1 })).toBeVisible();

    const panel = page.getByTestId("recurring-panel");
    await expect(panel.getByText("Nothing comes back around for this one yet.")).toBeVisible();
    await panel.getByRole("button", { name: "Remind me every..." }).click();

    const dialog = page.getByTestId("rule-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("What is it").fill("Spring cleanup");
    await dialog.getByRole("button", { name: "Every year", exact: true }).click();
    // Due in three days, so it lands inside Today's seven-day window.
    await dialog.getByLabel("First one due").fill(dateOnly(3 * DAY));
    await dialog.getByRole("button", { name: "Add reminder" }).click();
    await expect(dialog).toHaveCount(0);

    // The row is on the record, with its next date and its interval.
    await expect(panel.getByTestId("recurring-chip")).toHaveCount(1);
    await expect(panel.getByText(/every year/)).toBeVisible();

    const stored = helix.bridge.query(
      `SELECT title, every_n, unit, next_due_on, active, contact_id FROM recurring_rules`,
      [],
    );
    expect(stored).toHaveLength(1);
    expect(String(stored[0][0])).toBe("Spring cleanup");
    expect(Number(stored[0][1])).toBe(1);
    expect(String(stored[0][2])).toBe("year");
    expect(String(stored[0][3])).toBe(dateOnly(3 * DAY));
    expect(Number(stored[0][4])).toBe(1);
    expect(String(stored[0][5])).toBe("c-nella");

    // --- it shows up on Today ----------------------------------------------
    await page.goto("/");
    const comingUp = page.locator('[data-today-section="coming-up"]');
    await expect(comingUp).toBeVisible();
    await expect(comingUp.getByText("Spring cleanup")).toBeVisible();
    await expect(comingUp.getByText("Due in 3 days")).toBeVisible();
    await expect(
      comingUp.getByRole("link", { name: seeded.contactName }),
    ).toHaveAttribute("href", `/contacts/${seeded.contactId}`);

    await shoot(page, "today-sections");

    // --- Done advances the date by the interval ----------------------------
    await comingUp.getByRole("button", { name: "Done" }).click();
    // `getByText(string)` is case-insensitive and this section's own empty
    // state says "a spring cleanup every year", so match the row exactly.
    await expect(comingUp.getByText("Spring cleanup", { exact: true })).toHaveCount(0);
    await expect(comingUp.getByText("Nothing comes back around this week")).toBeVisible();

    const after = helix.bridge.query(
      `SELECT next_due_on, last_completed_on FROM recurring_rules`,
      [],
    );
    const nextDue = String(after[0][0]);
    expect(nextDue).not.toBe(dateOnly(3 * DAY));
    // One year on from the first date.
    expect(nextDue.slice(0, 4)).toBe(String(Number(dateOnly(3 * DAY).slice(0, 4)) + 1));
    expect(nextDue.slice(4)).toBe(dateOnly(3 * DAY).slice(4));
    expect(String(after[0][1])).toBe(dateOnly(0));

    // And the completion left a trail on the customer.
    const activity = helix.bridge.query(
      `SELECT kind, is_system, body FROM activities WHERE contact_id = ? ORDER BY occurred_at DESC`,
      ["c-nella"],
    );
    expect(String(activity[0][0])).toBe("system");
    expect(Number(activity[0][1])).toBe(1);
    expect(String(activity[0][2])).toMatch(/Spring cleanup done/);

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("the Reminders screen lists every rule, and pause takes one off Today", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await bootWithData(page, helix);

    helix.bridge.execute(
      `INSERT INTO recurring_rules (id, contact_id, title, every_n, unit, next_due_on, active, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'year', ?, 1, ?, ?)`,
      ["r-spring", "c-nella", "Spring cleanup", dateOnly(2 * DAY), iso(-DAY), iso(-DAY)],
    );
    helix.bridge.execute(
      `INSERT INTO recurring_rules (id, company_id, title, every_n, unit, next_due_on, active, created_at, updated_at)
       VALUES (?, ?, ?, 3, 'month', ?, 1, ?, ?)`,
      ["r-filters", "co-shadows", "Filter change", dateOnly(40 * DAY), iso(-DAY), iso(-DAY)],
    );

    await page.goto("/recurring");
    await expect(page.getByRole("heading", { name: "Reminders", level: 1 })).toBeVisible();

    const rows = page.getByTestId("recurring-row");
    await expect(rows).toHaveCount(2);
    // Soonest first.
    await expect(rows.first()).toContainText("Spring cleanup");
    await expect(rows.first()).toContainText("Every year");
    await expect(rows.nth(1)).toContainText("Filter change");
    await expect(rows.nth(1)).toContainText("Every 3 months");
    await expect(page.getByText("2 reminders running")).toBeVisible();

    await shoot(page, "recurring");

    // Pause the first one: it stays on this screen and leaves Today.
    await rows.first().getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText(/Paused "Spring cleanup"/)).toBeVisible();
    await expect(page.getByText("1 reminder running, 1 paused")).toBeVisible();

    const active = helix.bridge.query(
      `SELECT active FROM recurring_rules WHERE id = ?`,
      ["r-spring"],
    );
    expect(Number(active[0][0])).toBe(0);

    await page.goto("/");
    const comingUp = page.locator('[data-today-section="coming-up"]');
    await expect(comingUp.getByText("Nothing comes back around this week")).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("Skip this one moves the date without claiming the work was done", async ({
    page,
    helix,
  }) => {
    await bootWithData(page, helix);

    helix.bridge.execute(
      `INSERT INTO recurring_rules (id, contact_id, title, every_n, unit, next_due_on, active, created_at, updated_at)
       VALUES (?, ?, ?, 2, 'week', ?, 1, ?, ?)`,
      ["r-checkin", "c-nella", "Check in on the beds", dateOnly(DAY), iso(-DAY), iso(-DAY)],
    );

    await page.goto("/");
    const comingUp = page.locator('[data-today-section="coming-up"]');
    await expect(comingUp.getByText("Check in on the beds")).toBeVisible();

    await comingUp.getByRole("button", { name: "Skip this one" }).click();
    await expect(comingUp.getByText("Check in on the beds")).toHaveCount(0);

    const after = helix.bridge.query(
      `SELECT next_due_on, last_completed_on FROM recurring_rules WHERE id = ?`,
      ["r-checkin"],
    );
    expect(String(after[0][0])).not.toBe(dateOnly(DAY));
    expect(after[0][1], "a skip never claims the work happened").toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

test.describe("templates", () => {
  test("the four starters are there, and a new one can be written", async ({ page, helix }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await bootWithData(page, helix);

    await page.goto("/settings/templates");
    await expect(page.getByTestId("templates-screen")).toBeVisible();

    // Seeded on first use: two texts and two emails.
    await expect(page.getByTestId("template-row")).toHaveCount(4);
    await expect(
      page.getByTestId("template-row").filter({ hasText: "Quote follow-up" }),
    ).toBeVisible();
    await expect(page.getByTestId("template-row").filter({ hasText: "Thank you" })).toBeVisible();

    await shoot(page, "templates");

    // Write one, with a merge field inserted by its own button.
    await page.getByTestId("template-new").click();
    const editor = page.getByTestId("template-editor");
    await expect(editor).toBeVisible();
    await editor.getByTestId("template-name-input").fill("On my way");

    // The merge-field buttons put the field into the message.
    const message = editor.getByLabel("Message");
    await message.fill("Hi ");
    await editor.getByRole("button", { name: "{{first_name}}" }).click();
    await expect(message).toHaveValue("Hi {{first_name}}");

    await message.fill("Hi {{first_name}}, on my way now.");

    // The preview renders against the sample customer, not against braces.
    await expect(editor.getByText(/Shown for Nella Okonkwo/)).toBeVisible();
    await expect(editor.getByText("Hi Nella, on my way now.")).toBeVisible();

    await editor.getByTestId("template-save").click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId("template-row")).toHaveCount(5);

    const stored = helix.bridge.query(
      `SELECT kind, body FROM templates WHERE name = ?`,
      ["On my way"],
    );
    expect(stored).toHaveLength(1);
    expect(String(stored[0][0])).toBe("text");
    expect(String(stored[0][1])).toContain("{{first_name}}");

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("picking a template from a contact opens sms: with the rendered message", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const seeded = await bootWithData(page, helix);

    await page.goto(`/contacts/${seeded.contactId}`);
    await expect(page.getByRole("heading", { name: seeded.contactName, level: 1 })).toBeVisible();

    const split = page.getByTestId("send-split-text");
    await expect(split).toBeVisible();
    await split.getByRole("button", { name: /Pick a text template/ }).click();
    await page.getByRole("menuitem", { name: "Quote follow-up" }).click();

    await expect
      .poll(() => openedUrls(page), { message: "the opener received an sms: URL" })
      .toEqual(expect.arrayContaining([expect.stringContaining("sms:")]));

    const opened = (await openedUrls(page)).find((url) => url.startsWith("sms:"));
    expect(opened).toBeTruthy();
    expect(opened).toContain("+18015550163");
    expect(opened).toContain("?&body=");

    const body = decodeURIComponent(opened!.slice(opened!.indexOf("?&body=") + 7));
    // Every merge field resolved: the customer, the job, the money, the owner
    // and the business name onboarding wrote.
    expect(body).toContain("Hi Nella,");
    expect(body).toContain("Dale");
    expect(body).toContain("Alpine Ridge Landscape");
    expect(body).toContain(seeded.dealTitle);
    expect(body).toContain("$6,780.00");
    expect(body).not.toContain("{{");

    // The offer to log it, which is a separate deliberate tap.
    const logButton = page.getByRole("button", { name: "Log this text" });
    await expect(logButton).toBeVisible();
    await logButton.click();

    await expect
      .poll(
        () =>
          helix.bridge.query(
            `SELECT kind, body FROM activities WHERE contact_id = ? AND is_system = 0`,
            ["c-nella"],
          ).length,
        { message: "the text was logged to the timeline" },
      )
      .toBe(1);
    const logged = helix.bridge.query(
      `SELECT kind, body FROM activities WHERE contact_id = ? AND is_system = 0`,
      ["c-nella"],
    );
    expect(String(logged[0][0])).toBe("text");

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("the email split button opens mailto: with a subject and a body", async ({
    page,
    helix,
  }) => {
    const seeded = await bootWithData(page, helix);

    await page.goto(`/contacts/${seeded.contactId}`);
    const split = page.getByTestId("send-split-email");
    await split.getByRole("button", { name: /Pick an email template/ }).click();
    await page.getByRole("menuitem", { name: "Quote sent" }).click();

    await expect
      .poll(() => openedUrls(page), { message: "the opener received a mailto: URL" })
      .toEqual(expect.arrayContaining([expect.stringContaining("mailto:")]));

    const opened = (await openedUrls(page)).find((url) => url.startsWith("mailto:"));
    expect(opened).toContain("subject=");
    expect(opened).toContain("body=");
    // Percent-encoded, never "+" for a space: a mail client shows a plus sign.
    expect(opened).not.toContain("+");
    const query = opened!.slice(opened!.indexOf("?") + 1);
    const params = new URLSearchParams(query);
    expect(params.get("subject")).toBe("Your quote from Alpine Ridge Landscape");
    expect(params.get("body")).toContain("Fall cleanup, 32 units");
  });
});

// ---------------------------------------------------------------------------
// Add to calendar
// ---------------------------------------------------------------------------

test.describe("add to calendar", () => {
  test("a task with a due date saves a real .ics and hands it to the OS", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await bootWithData(page, helix);

    helix.bridge.execute(
      `INSERT INTO tasks (id, title, due_on, contact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "t-estimate",
        "Walk the beds with Nella",
        dateOnly(2 * DAY),
        "c-nella",
        iso(-DAY),
        iso(-DAY),
      ],
    );

    await page.goto("/tasks");
    const row = page.locator('[data-testid="task-row"][data-task-title="Walk the beds with Nella"]');
    await expect(row).toBeVisible();

    await offerSavePath(page, "/tmp/helix-e2e/walk-the-beds-with-nella.ics");
    // The row's controls are revealed on hover, the way every row in the
    // product reveals them.
    await row.hover();
    await row.getByTestId("add-to-calendar").click();

    await expect(page.getByText(/Saved "Walk the beds with Nella" to your calendar/)).toBeVisible();

    const state = await e2eState(page);
    const saveCalls = state.calls.filter((c) => c.cmd === "plugin:dialog|save");
    expect(saveCalls.length, "the calendar button opened the save dialog").toBeGreaterThan(0);

    const written = state.files["/tmp/helix-e2e/walk-the-beds-with-nella.ics"];
    expect(written, "the .ics was written through the fs plugin").toBeTruthy();
    expect(written).toContain("BEGIN:VCALENDAR");
    expect(written).toContain("VERSION:2.0");
    expect(written).toContain("SUMMARY:Walk the beds with Nella");
    expect(written).toContain(`DTSTART;VALUE=DATE:${dateOnly(2 * DAY).replace(/-/g, "")}`);
    // DTEND is exclusive, so a one-day event ends on the following day.
    expect(written).toContain(`DTEND;VALUE=DATE:${dateOnly(3 * DAY).replace(/-/g, "")}`);
    // The address on the contact became the event's location.
    expect(written).toContain("LOCATION:");
    expect(written).toContain("Highland Drive");
    expect(written!.endsWith("END:VCALENDAR\r\n")).toBe(true);

    // And it was opened, which is what makes Calendar import it.
    expect(state.opened).toContain("/tmp/helix-e2e/walk-the-beds-with-nella.ics");

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("a meeting in the timeline saves a timed event", async ({ page, helix }) => {
    const seeded = await bootWithData(page, helix);

    helix.bridge.execute(
      `INSERT INTO activities (id, kind, body, occurred_at, contact_id, is_system, created_at, updated_at)
       VALUES (?, 'meeting', ?, ?, ?, 0, ?, ?)`,
      [
        "a-meeting",
        "Walk the site with the facilities manager",
        iso(2 * DAY),
        "c-nella",
        iso(0),
        iso(0),
      ],
    );

    await page.goto(`/contacts/${seeded.contactId}`);
    const entry = page.locator('[data-kind="meeting"]');
    await expect(entry).toBeVisible();

    await offerSavePath(page, "/tmp/helix-e2e/meeting.ics");
    await entry.hover();
    await entry.getByTestId("add-to-calendar").click();

    await expect(page.getByText(/to your calendar/)).toBeVisible();

    const state = await e2eState(page);
    const written = state.files["/tmp/helix-e2e/meeting.ics"];
    expect(written).toBeTruthy();
    expect(written).toContain("SUMMARY:Walk the site with the facilities manager");
    // A timed event: the UTC basic form with a Z, and an hour long by default.
    expect(written).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(written).toMatch(/DTEND:\d{8}T\d{6}Z/);
    expect(state.opened).toContain("/tmp/helix-e2e/meeting.ics");
  });
});

// ---------------------------------------------------------------------------
// The week summary
// ---------------------------------------------------------------------------

test.describe("the week summary", () => {
  test("says what the week amounted to, and stays hidden when nothing happened", async ({
    page,
    helix,
  }) => {
    await bootWithData(page, helix);

    // The seed deal was created five days ago, which may be last week
    // depending on the day this runs; nothing has been won and nothing logged,
    // so the only thing this can assert unconditionally is what happens once
    // there is something to say.
    helix.bridge.execute(
      `INSERT INTO activities (id, kind, body, occurred_at, contact_id, is_system, created_at, updated_at)
       VALUES (?, 'call', ?, ?, ?, 0, ?, ?)`,
      ["a-call-1", "Talked through the beds.", iso(-60 * 60 * 1000), "c-nella", iso(0), iso(0)],
    );
    helix.bridge.execute(
      `INSERT INTO activities (id, kind, body, occurred_at, contact_id, is_system, created_at, updated_at)
       VALUES (?, 'call', ?, ?, ?, 0, ?, ?)`,
      ["a-call-2", "Left a voicemail.", iso(-2 * 60 * 60 * 1000), "c-nella", iso(0), iso(0)],
    );

    await page.goto("/");
    const summary = page.getByTestId("week-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("This week:");
    await expect(summary).toContainText("2 calls logged");
  });

  test("a brand-new workspace gets the first-run screen and no summary line", async ({
    page,
    helix: _helix,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Nothing here yet/ })).toBeVisible();
    await expect(page.getByTestId("week-summary")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

test.describe("help", () => {
  test("the page renders its six sections and the way out", async ({ page, helix }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await bootWithData(page, helix);

    await page.getByRole("link", { name: "Help" }).click();
    await expect(page).toHaveURL(/\/help$/);

    const help = page.getByTestId("help-screen");
    await expect(help).toBeVisible();
    await expect(page.getByRole("heading", { name: "Help", level: 1 })).toBeVisible();

    for (const title of [
      "Getting your customers in",
      "Working a job from lead to won",
      "Today and follow-ups",
      "Your website's leads",
      "Backups and where your data lives",
      "Keyboard shortcuts",
      "Something's wrong?",
    ]) {
      await expect(help.getByRole("heading", { name: title, level: 2 })).toBeVisible();
    }

    await expect(
      help.getByText("https://github.com/walk-the-program/helix-crm/issues", { exact: true }),
    ).toBeVisible();
    await expect(help.getByRole("button", { name: "Open Diagnostics" })).toBeVisible();

    await shoot(page, "help");

    // The shortcuts button runs the registered command, not a second sheet.
    await help.getByRole("button", { name: "Show the shortcuts" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
});
