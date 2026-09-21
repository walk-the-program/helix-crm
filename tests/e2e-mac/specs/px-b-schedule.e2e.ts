/**
 * The Schedule, end to end: the built app in Chromium over a real SQLite file.
 *
 * What this proves, and what unit tests cannot: that the week the owner sees
 * is assembled from five different tables by the real feed, that the visit
 * dialog's pickers write a real task, that the one visit then appears in
 * three places at once (the Schedule, Today and the Tasks screen) because it
 * IS a task with a time on it (decision PX-6), that the file handed to his
 * calendar is a real .ics with the length and the place in it, and that a
 * reload does not lose any of it.
 *
 * What it cannot prove: anything that is Rust. The save dialog and the file
 * write are the harness's stubs, so this asserts the bytes Helix asked for
 * rather than a file on a disk.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4310 E2E_OUT=dist-pxb npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/px-b-schedule.e2e.ts
 */
import { test, expect, type HelixHarness } from "../fixtures";
import type { Locator, Page } from "@playwright/test";

type E2EState = {
  dialogQueue: (string | string[] | null)[];
  files: Record<string, string>;
};

const DAY = 24 * 60 * 60 * 1000;

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

/** A local calendar day, the way the app writes `due_on` and `expected_on`. */
function dateOnly(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TODAY = dateOnly(0);

/**
 * One customer with an address (so the dialog can suggest a place), one job
 * expected later this week, and nothing else: this spec is about the screen,
 * not about the fixtures.
 */
function seed(helix: HelixHarness): { expectedOn: string } {
  const db = helix.bridge;
  const stageId = (name: string): string => {
    const rows = db.query("SELECT id FROM stages WHERE name = ?", [name]);
    if (rows.length === 0) throw new Error(`the seed did not create a "${name}" stage`);
    return String(rows[0][0]);
  };

  db.execute(
    `INSERT INTO contacts (id, first_name, last_name, address_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "c-rosalind",
      "Rosalind",
      "Whitaker",
      JSON.stringify({ line1: "12 Mill Lane", city: "Bristol", state: "UT", postcode: "84010" }),
      iso(-3 * DAY),
      iso(-3 * DAY),
    ],
  );
  db.execute(
    `INSERT INTO contact_phones (id, contact_id, raw, e164, label, is_primary, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'mobile', 1, ?, ?)`,
    ["p-rosalind", "c-rosalind", "(801) 555-0163", "+18015550163", iso(-3 * DAY), iso(-3 * DAY)],
  );

  // A job expected today: the feed's second source, and the row whose label
  // has to follow the owner's vocabulary. Today rather than a day or two out
  // because the week starts on Monday - run this on a Sunday and "two days
  // out" is next week, which is a fixture that fails one day in seven.
  const expectedOn = TODAY;
  db.execute(
    `INSERT INTO deals (id, title, value_cents, currency, stage_id, stage_entered_at,
                        position, contact_id, expected_on, created_at, updated_at)
     VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?, ?, ?)`,
    [
      "d-fence",
      "Back fence replacement",
      320000,
      stageId("New"),
      iso(-3 * DAY),
      "c-rosalind",
      expectedOn,
      iso(-3 * DAY),
      iso(-3 * DAY),
    ],
  );

  return { expectedOn };
}

/**
 * Boot the app once before arranging anything.
 *
 * The harness hands the page an empty database file; the APP is what runs the
 * migrations, on its own first boot. So every test here loads the shell,
 * seeds through the bridge, and reloads — the same order today.e2e.ts uses,
 * and the reason a seed written before the first paint would hit "no such
 * table: contacts".
 */
async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("sidebar")).toBeVisible();
}

async function openSchedule(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Schedule" }).click();
  await expect(page.getByTestId("schedule-screen")).toBeVisible();
}

/**
 * Choose an exact day from the in-app DatePicker (never a native input).
 *
 * `scope` matters: the week strip has a "Jump to a date" picker of its own,
 * so the dialog's has to be asked for inside the dialog.
 */
async function pickDate(page: Page, scope: Locator, target: string): Promise<void> {
  await scope.getByTestId("date-picker").first().click();
  await expect(page.getByTestId("date-picker-grid")).toBeVisible();
  const day = page.locator(`[data-testid="date-picker-day"][data-date="${target}"]`);
  await day.click();
}

/**
 * Set a time through the in-app TimePicker, by typing it and pressing Enter —
 * which is how the owner with a keyboard does it, and what the field's own
 * parser exists for. Never a native `<input type="time">`.
 */
async function pickTime(page: Page, scope: Locator, target: string): Promise<void> {
  const input = scope.getByTestId("time-picker").first();
  await input.click();
  await input.fill(target);
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue(/\d/);
}

/**
 * Choose a record from one of the dialog's type-ahead pickers, by the id the
 * dialog gives it ("visit-contact", "visit-company", "visit-job") — the three
 * triggers all read "Search …" on screen, so the id is what tells them apart.
 */
async function pickRecord(page: Page, scope: Locator, triggerId: string, query: string): Promise<void> {
  await scope.locator(`#${triggerId}`).click();
  const input = page.getByTestId("combobox-input");
  await input.fill(query);
  const option = page.getByTestId("combobox-option").first();
  await expect(option).toBeVisible();
  await option.click();
}

test.describe("Schedule", () => {
  test("the week is assembled from the records that already hold the dates", async ({
    page,
    helix,
  }) => {
    await boot(page);
    const { expectedOn } = seed(helix);
    await page.reload();

    await openSchedule(page);

    // Monday first, seven days, today marked.
    const days = page.getByTestId("week-strip-day");
    await expect(days).toHaveCount(7);
    await expect(page.locator('[data-testid="week-strip-day"][aria-current="date"]')).toHaveCount(1);

    // The job's expected date is on its own day, in the owner's word for it.
    await page.locator(`[data-testid="week-strip-day"][data-date="${expectedOn}"]`).click();
    const agenda = page.getByTestId("day-agenda");
    await expect(agenda.getByText("Back fence replacement")).toBeVisible();
    await expect(agenda.getByText("Deal expected")).toBeVisible();
    await expect(agenda.getByRole("link", { name: "Rosalind Whitaker" })).toBeVisible();
  });

  test("moving between weeks, by button and by arrow key", async ({ page, helix }) => {
    await boot(page);
    seed(helix);
    await page.reload();
    await openSchedule(page);

    const heading = page.getByTestId("schedule-screen").getByRole("heading", { name: "Schedule" });
    await expect(heading).toBeVisible();
    const weekRange = page.getByTestId("week-range");
    const thisWeek = await weekRange.textContent();

    await page.getByRole("button", { name: "Next week" }).click();
    const nextWeek = await weekRange.textContent();
    expect(nextWeek).not.toBe(thisWeek);

    await page.getByRole("button", { name: "This week" }).click();
    await expect(weekRange).toHaveText(String(thisWeek));

    // The arrow keys move the week too, from a cold open with nothing focused
    // — which is exactly how the owner reaches this screen.
    await page.keyboard.press("ArrowRight");
    await expect(weekRange).toHaveText(String(nextWeek));
    await page.keyboard.press("ArrowLeft");
    await expect(weekRange).toHaveText(String(thisWeek));
  });

  test("scheduling a visit puts it on the Schedule, on Today and in Tasks", async ({
    page,
    helix,
  }) => {
    await boot(page);
    seed(helix);
    await page.reload();
    await openSchedule(page);

    await page.getByRole("button", { name: "Schedule a visit" }).first().click();
    const dialog = page.getByTestId("visit-dialog");
    await expect(dialog).toBeVisible();

    // The title chips, then the pickers. No native date or time input is
    // touched anywhere in this flow.
    await dialog.getByRole("button", { name: "Estimate" }).click();
    await pickDate(page, dialog, TODAY);
    await pickTime(page, dialog, "09:00");
    await dialog.getByRole("button", { name: "1 hr 30 min" }).click();
    await pickRecord(page, dialog, "visit-contact", "Rosalind");

    // The place suggests itself from the contact's address, and stays editable.
    const place = dialog.getByLabel("Place");
    await expect(place).toHaveValue(/12 Mill Lane/);
    await dialog.getByLabel("Note").fill("Gate code 4821");

    await dialog.getByRole("button", { name: "Schedule visit" }).click();
    await expect(dialog).toBeHidden();

    // On the Schedule, on the day it was booked for.
    const agenda = page.getByTestId("day-agenda");
    const row = agenda.getByTestId("schedule-row").filter({ hasText: "Estimate" });
    await expect(row).toBeVisible();
    await expect(row.getByText("Visit")).toBeVisible();
    await expect(row.getByRole("link", { name: "Rosalind Whitaker" })).toBeVisible();
    await expect(row).toContainText("12 Mill Lane");
    await expect(row).toContainText("Gate code 4821");

    // On Today, under "Today's schedule".
    await page.getByRole("link", { name: "Today" }).click();
    const todaySchedule = page.locator('[data-today-section="today-schedule"]');
    await expect(todaySchedule).toBeVisible();
    await expect(todaySchedule.getByText("Estimate")).toBeVisible();

    // And on the Tasks screen, because a visit is a task with a time.
    await page.getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByText("Estimate").first()).toBeVisible();

    // It survives a reload: nothing here lives in component state.
    await page.reload();
    await openSchedule(page);
    await expect(
      page.getByTestId("day-agenda").getByTestId("schedule-row").filter({ hasText: "Estimate" }),
    ).toBeVisible();
  });

  test("one visit, handed to the owner's own calendar as a .ics", async ({ page, helix }) => {
    await boot(page);
    seed(helix);

    // Arrange the visit directly: this test is about the export, not the form.
    helix.bridge.execute(
      `INSERT INTO tasks (id, title, due_on, due_at, place, duration_minutes, notes,
                          contact_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)`,
      [
        "t-visit",
        "Site visit",
        TODAY,
        `${TODAY}T16:00:00.000Z`,
        "12 Mill Lane, Bristol",
        90,
        "Gate code 4821",
        "c-rosalind",
        iso(0),
        iso(0),
      ],
    );
    await page.reload();
    await openSchedule(page);

    const target = "/tmp/helix-e2e/site-visit.ics";
    await page.evaluate((p) => {
      const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
      state.dialogQueue.push(p);
    }, target);

    const row = page.getByTestId("schedule-row").filter({ hasText: "Site visit" });
    await row.getByTestId("add-to-calendar").click();

    await expect
      .poll(async () =>
        page.evaluate(
          (p) => (window as unknown as { __helixE2E: E2EState }).__helixE2E.files[p] ?? null,
          target,
        ),
      )
      .not.toBeNull();

    const text = String(
      await page.evaluate(
        (p) => (window as unknown as { __helixE2E: E2EState }).__helixE2E.files[p],
        target,
      ),
    );
    const unfolded = text.replace(/\r\n /g, "");

    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(unfolded).toContain("UID:task-t-visit@helix-crm");
    expect(unfolded).toContain("SUMMARY:Site visit");
    // 16:00Z plus the 90 minutes the owner chose, both stamped in UTC.
    expect(unfolded).toContain(`DTSTART:${TODAY.replace(/-/g, "")}T160000Z`);
    expect(unfolded).toContain(`DTEND:${TODAY.replace(/-/g, "")}T173000Z`);
    // A comma in the address is escaped, per RFC 5545.
    expect(unfolded).toContain("LOCATION:12 Mill Lane\\, Bristol");
    expect(unfolded).toContain("Rosalind Whitaker");
    expect(unfolded).toContain("(801) 555-0163");
    expect(unfolded).toContain("Gate code 4821");
    expect(unfolded).toContain("Added from Helix CRM.");
  });

  test("a week with nothing in it offers exactly one thing to do", async ({ page, helix }) => {
    expect(helix.dbPath).toContain("helix.db");
    await boot(page);
    await openSchedule(page);
    await expect(page.getByText("Nothing in the diary this week.")).toBeVisible();
    const actions = page.getByTestId("schedule-screen").getByRole("button", {
      name: "Schedule a visit",
    });
    await expect(actions).toHaveCount(2); // the header's primary and the empty state's
    await actions.last().click();
    await expect(page.getByTestId("visit-dialog")).toBeVisible();
  });
});
