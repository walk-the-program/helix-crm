/**
 * LR-PX-C, PART 2 + PART 3: the owner switches a follow-up rule on and words
 * it himself, and a per-stage follow-up rule fires when a job moves.
 *
 * (a) Settings > Automations: word the lead-arrived rule, set its delay to
 *     zero so its task is due the instant it is created, apply one lead
 *     through the fake-site fixtures the leads e2e spec already uses
 *     (tests/e2e-mac/specs/leads.e2e.ts's `connectSite`/`setLeadsStub`
 *     pattern - fixtures.ts is off limits to this spec, so the same handful
 *     of lines are reproduced here rather than imported), and see the task
 *     the owner worded on Today's Due now list.
 *
 * (b) The stage manager: give a stage a follow-up rule and move a deal into
 *     it. `stagesRepo.update`'s minimum `followUpDays` is 1
 *     (src/db/repos/stages.ts's zod schema, matching the product decision
 *     that "after 0 days" is not a follow-up, it is the lead-arrived rule's
 *     job), so the resulting task is always due tomorrow at the earliest -
 *     it can never land on Today's Due now list, which is deliberately
 *     "everything overdue, then everything due today" and nothing further
 *     out (src/features/today/sections/DueNow.tsx's own doc comment: "the
 *     next seven days are deliberately not here - they are on /tasks").
 *     So this half proves the task through the database directly and through
 *     the Tasks screen's "Next 7 days" group, which is where the design
 *     actually puts it, rather than asserting something the feature was
 *     never meant to do.
 *
 * Run it on this agent's own port and build folder:
 *   E2E_PORT=4321 E2E_OUT=dist-pxc-auto npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/px-c-automation.e2e.ts
 */
import { test, expect, type HelixHarness } from "../fixtures";
import type { Page } from "@playwright/test";

const SITE_ORIGIN = "https://px-c-automation.example.test";
const TOKEN = "px-c-automation-token";

/* -------------------------------------------------------------------------- */
/* borrowed from leads.e2e.ts: connecting the site and steering the stub      */
/* -------------------------------------------------------------------------- */

async function connectSite(page: Page): Promise<void> {
  await page.goto("/settings/site");
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await page.getByLabel("Website address").fill(SITE_ORIGIN);
  await page.getByLabel("Token").fill(TOKEN);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByTestId("site-last-polled")).not.toHaveText("Not yet");
}

type StubLead = {
  id: string;
  createdAt: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  service: string | null;
  message: string | null;
  pageUrl: string | null;
};

async function setLeadsStub(page: Page, leads: StubLead[]): Promise<void> {
  await page.evaluate((nextLeads) => {
    (window as unknown as { __helixE2E: { leads: unknown } }).__helixE2E.leads = {
      leads: nextLeads,
      nextCursor: null,
    };
  }, leads);
}

/* -------------------------------------------------------------------------- */
/* (a) speed-to-lead, worded by the owner                                     */
/* -------------------------------------------------------------------------- */

test.describe("part (a): the lead-arrived rule, worded and switched on in Settings", () => {
  test("the task Today shows for a new lead says exactly what the owner typed", async ({
    page,
    helix,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // --- word the rule and make it fire the instant a lead lands -----------
    await page.goto("/settings/automations");
    await expect(
      page.getByRole("heading", { name: "Automations", exact: true, level: 1 }),
    ).toBeVisible();

    // The kit Switch (src/ui/Switch.tsx) does not forward a bare data-testid,
    // so it is found the way an accessibility tree finds it: by role and its
    // aria-label.
    const enableSwitch = page.getByRole("switch", { name: "Turn new lead follow-up on or off" });
    // Seeded on by default (drizzle/0008_automations.sql); turned on here too,
    // defensively, so this test does not depend on that default holding.
    if ((await enableSwitch.getAttribute("aria-checked")) !== "true") {
      await enableSwitch.click();
      await expect(enableSwitch).toHaveAttribute("aria-checked", "true");
    }

    const delay = page.getByTestId("automation-lead_arrived-delay");
    await delay.fill("0");
    await delay.blur();

    const title = page.getByTestId("automation-lead_arrived-title");
    await title.fill("Follow up: {job}");
    await title.blur();

    await expect(page.getByTestId("automation-lead_arrived-example")).toHaveText(
      "Reads like: Follow up: Sample deal",
    );

    // --- apply one lead through the fake-site fixtures ----------------------
    await connectSite(page);
    await setLeadsStub(page, [
      {
        id: "px-c-lead-dana",
        createdAt: new Date().toISOString(),
        name: "Dana Okafor",
        email: "dana@example.com",
        phone: "+18015550100",
        service: "Fence repair",
        message: "The back gate is off its hinge.",
        pageUrl: `${SITE_ORIGIN}/fence`,
      },
    ]);
    await page.getByRole("button", { name: "Poll now" }).click();
    await expect(page.getByText("1 new lead came in.")).toBeVisible();
    await expect
      .poll(() => Number(helix.bridge.query("SELECT count(*) FROM deals", [])[0][0]))
      .toBe(1);

    // The automation runs inside the same batch as the lead, so it is already
    // there once the deal is.
    const taskTitle = "Follow up: Fence repair - Dana Okafor";
    await expect
      .poll(() =>
        Number(
          helix.bridge.query("SELECT count(*) FROM tasks WHERE title = ? AND source = 'automation'", [
            taskTitle,
          ])[0][0],
        ),
      )
      .toBe(1);

    // --- see it on Today, worded exactly as typed ---------------------------
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Today", exact: true, level: 1 }),
    ).toBeVisible();
    const dueNow = page.locator('[data-today-section="due-now"]');
    await expect(dueNow.getByText(taskTitle)).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* (b) a per-stage follow-up rule                                             */
/* -------------------------------------------------------------------------- */

function stageId(helix: HelixHarness, name: string): string {
  const rows = helix.bridge.query("SELECT id FROM stages WHERE name = ?", [name]);
  if (rows.length === 0) throw new Error(`the seed did not create a "${name}" stage`);
  return String(rows[0][0]);
}

/** A deal sitting in an open stage, arranged straight through the bridge. */
function seedOpenDeal(helix: HelixHarness, title: string): string {
  const db = helix.bridge;
  const contactId = "px-c-w2-contact";
  const dealId = "px-c-w2-deal";
  const now = new Date().toISOString();
  db.execute(
    `INSERT INTO contacts (id, first_name, last_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [contactId, "Jamie", "Rivera", now, now],
  );
  db.execute(
    `INSERT INTO deals
       (id, title, value_cents, currency, stage_id, stage_entered_at, position,
        contact_id, company_id, source_id, created_at, updated_at)
     VALUES (?, ?, 0, 'USD', ?, ?, 0, ?, NULL, NULL, ?, ?)`,
    [dealId, title, stageId(helix, "New"), now, contactId, now, now],
  );
  return dealId;
}

test.describe("part (b): a per-stage follow-up rule", () => {
  test("moving a deal into a stage with a follow-up rule creates the task the owner worded", async ({
    page,
    helix,
  }) => {
    // Boot once so migrations and the first-run seed (pipeline, stages,
    // sources) exist before the bridge writes anything of its own -
    // tests/e2e-mac/specs/today.e2e.ts's seed() relies on the same ordering.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();

    const dealId = seedOpenDeal(helix, "Deck rebuild");

    // --- give the Contacted stage a follow-up rule --------------------------
    await page.goto("/pipeline");
    await page.getByRole("button", { name: "Stages" }).click();
    await expect(page.getByRole("heading", { name: "Stages", exact: true })).toBeVisible();

    const daysField = page.getByLabel("Days in Contacted before the follow-up");
    const titleField = page.getByLabel("What the Contacted follow-up says");
    await daysField.fill("1");
    await daysField.blur();
    await titleField.fill("Check in on {job}");
    await titleField.blur();

    // No refusal message, and the rule is on record.
    await expect(page.getByTestId("stage-followup-" + stageId(helix, "Contacted"))).not.toContainText(
      "Say what the reminder should say",
    );
    await expect
      .poll(() =>
        helix.bridge.query("SELECT follow_up_days, follow_up_title FROM stages WHERE name = 'Contacted'", []),
      )
      .toEqual([[1, "Check in on {job}"]]);

    await page.getByRole("button", { name: "Done" }).click();

    // --- move the deal into that stage --------------------------------------
    await page.goto(`/deals/${dealId}`);
    await page.getByRole("combobox", { name: "Stage" }).click();
    await page.getByRole("option", { name: "Contacted" }).click();

    const taskTitle = "Check in on Deck rebuild";
    await expect
      .poll(() =>
        Number(
          helix.bridge.query(
            "SELECT count(*) FROM tasks WHERE title = ? AND contact_id = ?",
            [taskTitle, "px-c-w2-contact"],
          )[0][0],
        ),
      )
      .toBe(1);

    // --- see it, where a task due tomorrow actually lives -------------------
    await page.goto("/tasks");
    await expect(page.getByText(taskTitle)).toBeVisible();
  });

  test("leaving the title empty while days is set is refused, not silently dropped", async ({
    page,
    helix,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();

    await page.goto("/pipeline");
    await page.getByRole("button", { name: "Stages" }).click();

    const daysField = page.getByLabel("Days in Quoted before the follow-up");
    await daysField.fill("3");
    await daysField.blur();

    await expect(
      page.getByText("Say what the reminder should say, or clear the days to turn this off."),
    ).toBeVisible();
    // Refused, so nothing was written.
    const row = helix.bridge.query(
      "SELECT follow_up_days, follow_up_title FROM stages WHERE name = 'Quoted'",
      [],
    );
    expect(row).toEqual([[null, null]]);
  });
});
