/**
 * The customer-success walk (LR-CS, 2026-09-20).
 *
 * Not a regression test. It is one fresh workspace taken from the very first
 * paint to the first meaningful outcome and out the other side, counting every
 * action a real owner would have to perform and timing each leg, so "how long
 * does install day take" stops being a guess.
 *
 * The first meaningful outcome, defined from this product rather than from a
 * SaaS checklist: **the owner's own customers are in Helix, Today is telling
 * him something true about them, and he has moved one job forward.** Anything
 * short of that is a CRM he has filled in but not yet used.
 *
 * Every leg records: the actions it cost, the screens it crossed, whatever it
 * assumed the owner already knew, and a screenshot. The log lands beside the
 * screenshots in tests/e2e-mac/.cache/screens/cs/ (git-ignored), as walk.json
 * and walk.md.
 *
 *   E2E_PORT=4290 E2E_OUT=dist-cs npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/csWalk.e2e.ts
 *
 * The CSV is tests/fixtures/hubspot-contacts.csv: 52 synthetic rows with mixed
 * phone formats, blank cells, embedded commas, escaped quotes and a non-ASCII
 * name. Imperfect on purpose, and already committed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

const SCREENS = fileURLToPath(new URL("../.cache/screens/cs/", import.meta.url));
mkdirSync(SCREENS, { recursive: true });

const CSV_PATH = fileURLToPath(
  new URL("../../fixtures/hubspot-contacts.csv", import.meta.url),
);

type Leg = {
  leg: string;
  /** Discrete things the owner does: a click, a typed field, a keystroke. */
  actions: number;
  /** Distinct screens crossed on this leg. */
  screens: string[];
  ms: number;
  /** What the leg assumed the owner already knew, or could not know. */
  friction: string[];
  note?: string;
};

const legs: Leg[] = [];
let actions = 0;
let legStart = 0;
let current: Leg | null = null;

function beginLeg(name: string) {
  current = { leg: name, actions: 0, screens: [], ms: 0, friction: [] };
  actions = 0;
  legStart = Date.now();
}

function endLeg() {
  if (!current) return;
  current.actions = actions;
  current.ms = Date.now() - legStart;
  legs.push(current);
  current = null;
}

/** One thing the owner did. Everything the walk clicks or types goes through here. */
async function act<T>(what: string, fn: () => Promise<T>): Promise<T> {
  actions += 1;
  if (current) current.screens.push(what);
  return fn();
}

function friction(text: string) {
  if (current) current.friction.push(text);
}

async function shoot(page: Page, name: string, full = false) {
  await page.screenshot({ path: `${SCREENS}${name}.png`, fullPage: full });
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(250);
}

type E2EState = {
  files: Record<string, string>;
  dialogQueue: (string | string[] | null)[];
};

async function offerFile(page: Page, path: string, contents: string) {
  await page.evaluate(
    ([p, body]) => {
      const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
      state.files[p] = body;
      state.dialogQueue.push(p);
    },
    [path, contents] as const,
  );
}

async function offerSavePath(page: Page, path: string) {
  await page.evaluate((p) => {
    const state = (window as unknown as { __helixE2E: E2EState }).__helixE2E;
    state.dialogQueue.push(p);
  }, path);
}

test.use({ onboarding: "show" });

test("a fresh owner walks from first launch to a job moved forward", async ({
  page,
  helix,
}) => {
  test.setTimeout(300_000);
  // A missing control must fail this leg quickly and be recorded, not hang the
  // whole walk: the point is to find out what is not reachable.
  page.setDefaultTimeout(15_000);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const walkStart = Date.now();

  /* ---------------------------------------------------------------- leg 1 */
  beginLeg("1. First launch → setup screen 1 (the business)");
  await page.goto("/");
  await settle(page);
  await expect(page.getByRole("heading", { name: "Your business", level: 1 })).toBeVisible();
  await shoot(page, "01-setup-business");
  friction(
    "Before this screen exists the owner has already had to right-click → Open past Gatekeeper and allow a Keychain prompt. Neither is mentioned anywhere in the product.",
  );
  await act("type the business name", () =>
    page.getByLabel("What is the business called?").fill("Alpine Ridge Landscape"),
  );
  await act("type the owner name", () => page.getByLabel("Your name").fill("Dave Tracy"));
  await act("type the owner email", () =>
    page.getByLabel("Your email").fill("dave@alpineridge.example"),
  );
  await act("type the owner phone", () =>
    page.getByLabel("Your phone").fill("(801) 555-0134"),
  );
  await act("pick the trade", () =>
    page.getByRole("button", { name: "Landscaping", exact: true }).click(),
  );
  await shoot(page, "02-setup-business-filled");
  await act("Continue", () => page.getByRole("button", { name: "Continue" }).click());
  endLeg();

  /* ---------------------------------------------------------------- leg 2 */
  beginLeg("2. Setup screen 2 (the pipeline)");
  await expect(
    page.getByRole("heading", { name: "How you'll track work", level: 1 }),
  ).toBeVisible();
  await settle(page);
  await shoot(page, "03-setup-tracking", true);
  await act("Use this setup", () =>
    page.getByRole("button", { name: "Use this setup" }).click(),
  );
  endLeg();

  /* ---------------------------------------------------------------- leg 3 */
  beginLeg("3. Setup screen 3 (bring your customers in) → Import");
  await expect(
    page.getByRole("heading", { name: "Bring your customers in", level: 1 }),
  ).toBeVisible();
  await shoot(page, "04-setup-customers");
  await act("choose Import a spreadsheet", () =>
    page.getByRole("button", { name: /Import a spreadsheet/ }).click(),
  );
  await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
  await settle(page);
  await shoot(page, "05-import-empty");
  endLeg();

  /* ---------------------------------------------------------------- leg 4 */
  beginLeg("4. Import 52 imperfect rows");
  const csv = readFileSync(CSV_PATH, "utf8");
  await offerFile(page, "/e2e/hubspot-contacts.csv", csv);
  await act("Choose a file", () =>
    page.getByRole("button", { name: "Choose a file" }).click(),
  );
  await expect(page.getByRole("columnheader", { name: "Import as" })).toBeVisible();
  await settle(page);
  await shoot(page, "06-import-mapping", true);

  // What the guesser actually did with a real vendor export.
  const mappingRows = await page
    .getByRole("row")
    .evaluateAll((rows) => rows.map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim()));
  writeFileSync(`${SCREENS}mapping.txt`, mappingRows.join("\n"), "utf8");
  const skipped = mappingRows.filter((r) => / Skip| Don't import/i.test(r));
  if (skipped.length > 0) {
    friction(
      `${skipped.length} column(s) landed on Skip and the owner has to notice: ${skipped
        .slice(0, 6)
        .map((r) => r.slice(0, 60))
        .join(" | ")}`,
    );
  }

  await act("Continue past the mapping", () =>
    page.getByRole("button", { name: "Continue" }).click(),
  );
  await expect(
    page.getByRole("columnheader", { name: "What Helix noticed" }),
  ).toBeVisible();
  await settle(page);
  await shoot(page, "07-import-preview", true);
  await act("Import", () =>
    page.getByRole("button", { name: "Import", exact: true }).click(),
  );
  await expect(page.getByText("contacts created")).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await shoot(page, "08-import-result", true);
  const resultText = (await page.locator("main").innerText()).replace(/\n{2,}/g, "\n");
  writeFileSync(`${SCREENS}import-result.txt`, resultText, "utf8");
  if (!/backup/i.test(resultText)) {
    friction(
      "The result screen never names the pre-import backup, so the owner is not told there is a way back from an import that went wrong.",
    );
  }
  endLeg();

  /* ---------------------------------------------------------------- leg 5 */
  beginLeg("5. Today, with the owner's own customers in it");
  await act("open Today", () =>
    page.getByRole("navigation").getByRole("link", { name: "Today" }).click(),
  );
  await expect(page.getByRole("heading", { name: "Today", exact: true, level: 1 })).toBeVisible();
  await settle(page);
  await shoot(page, "09-today-after-import", true);
  const todayText = (await page.locator("main").innerText()).replace(/\n{2,}/g, "\n");
  writeFileSync(`${SCREENS}today-after-import.txt`, todayText, "utf8");
  if (/Nothing here yet/.test(todayText)) {
    friction(
      "52 real customers are in the workspace and Today still shows the first-run starter cards, because Today reports on tasks, open jobs and activity - none of which a contacts import creates. The owner's reasonable reading is that the import did not work.",
    );
  }
  const sawRecoveryPrompt = /recovery key/i.test(todayText);
  if (!sawRecoveryPrompt) {
    friction(
      "Nothing anywhere in first run mentions the recovery key (LR-6). A client who never opens Settings -> Backups has no way to open his own backups on a new machine.",
    );
  }
  endLeg();

  /* ---------------------------------------------------------------- leg 6 */
  beginLeg("6. First job, and moving it a stage");
  await act("open the jobs board", async () => {
    const nav = page.getByRole("navigation");
    const jobs = nav.getByRole("link", { name: "Jobs" });
    if (await jobs.count()) await jobs.click();
    else await nav.getByRole("link", { name: "Deals" }).click();
  });
  await settle(page);
  await shoot(page, "10-jobs-board-empty", true);

  let movedAJob = false;
  try {
    await act("New job", () =>
      page.getByRole("button", { name: /^New (job|deal)/ }).first().click(),
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await act("type the job title", () =>
      dialog.getByLabel("Title").fill("Spring cleanup - Mitchell"),
    );
    await shoot(page, "11-new-job-dialog");
    await act("Save the job", () =>
      dialog.getByRole("button", { name: /^(Save|Create)/ }).first().click(),
    );
    await settle(page);
    await shoot(page, "12-after-saving-the-job", true);

    // Saving from the board lands on the job's own page rather than back on
    // the board, so the stage move happens through the Stage picker there.
    const stage = page.getByRole("combobox", { name: "Stage" });
    if (await stage.count()) {
      await act("open the Stage picker", () => stage.click());
      const options = page.getByRole("option");
      await expect(options.first()).toBeVisible();
      const names = await options.evaluateAll((els) =>
        els.map((e) => (e.textContent ?? "").trim()),
      );
      const next = names[1] ?? names[0];
      await act(`move the job to "${next}"`, () =>
        page.getByRole("option", { name: next, exact: true }).first().click(),
      );
      friction(
        "Saving a new job from the board opens the job's own page instead of returning to the board, so the stage move is a picker on that page rather than the drag the board teaches.",
      );
    } else {
      const card = page.getByTestId("deal-card").first();
      await expect(card).toBeVisible();
      await act("focus the card", () => card.click());
      await act("shift+ArrowRight to the next stage", () =>
        page.keyboard.press("Shift+ArrowRight"),
      );
    }
    await settle(page);
    await shoot(page, "13-job-moved-a-stage", true);
    movedAJob = true;
  } catch (err) {
    friction(
      `Creating and moving the first job did not complete through the obvious path: ${
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      }`,
    );
    await shoot(page, "13-job-move-failed", true);
  }
  endLeg();

  const outcomeMs = Date.now() - walkStart;
  const outcomeActions = legs.reduce((sum, l) => sum + l.actions, 0);

  /* ---------------------------------------------------------------- leg 7 */
  beginLeg("7. Quit and reopen");
  await act("reload the app", () => page.reload());
  await settle(page);
  await expect(page.getByRole("navigation")).toBeVisible();
  await shoot(page, "14-after-reopen", true);
  const reopened = (await page.locator("main").innerText()).replace(/\n{2,}/g, "\n");
  writeFileSync(`${SCREENS}after-reopen.txt`, reopened, "utf8");
  endLeg();

  /* ---------------------------------------------------------------- leg 8 */
  beginLeg("8. Make a mistake and recover from it");
  await act("open Contacts", () =>
    page.getByRole("navigation").getByRole("link", { name: "Contacts" }).click(),
  );
  await expect(page.getByRole("heading", { name: "Contacts", level: 1 })).toBeVisible();
  await settle(page);
  try {
    // The contacts list is virtualised, so pick a real person out of the
    // database and click them by name, the way the owner would.
    const picked = helix.bridge.query(
      "select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) as n from contacts where deleted_at is null and coalesce(first_name,'') <> '' order by n limit 1",
      [],
    );
    const name = String(picked[0]?.[0] ?? "").trim();
    const firstContact = page.getByText(name, { exact: true }).first();
    await expect(firstContact).toBeVisible();
    await act("open a contact", () => firstContact.click());
    await settle(page);
    await act("Delete", () =>
      page.getByRole("button", { name: "Delete", exact: true }).click(),
    );
    await act("confirm the delete", () =>
      page.getByRole("button", { name: "Delete contact" }).click(),
    );
    await settle(page);
    await shoot(page, "15-deleted-a-contact", true);
    await act("open Trash", () =>
      page.getByRole("navigation").getByRole("link", { name: "Trash" }).click(),
    );
    await settle(page);
    await shoot(page, "16-trash", true);
    const row = page
      .getByRole("row")
      .filter({ hasText: name.split(" ")[0] })
      .first();
    const restore = (await row.count())
      ? row.getByRole("button", { name: "Restore" })
      : page.getByRole("button", { name: "Restore" }).first();
    await act("Restore", () => restore.click());
    await settle(page);
    await shoot(page, "17-restored", true);
  } catch (err) {
    friction(
      `Delete-and-restore did not complete through the obvious path: ${
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      }`,
    );
    await shoot(page, "17-recover-failed", true);
  }
  endLeg();

  /* ---------------------------------------------------------------- leg 9 */
  beginLeg("9. Export everything");
  // Export is not in the sidebar: it is Settings -> Export, or the command
  // palette. That is where the owner has to find the way out of the product.
  const exportInNav = await page
    .getByRole("navigation")
    .getByRole("link", { name: "Export" })
    .count();
  if (exportInNav === 0) {
    friction(
      "Export is not in the sidebar. The only ways to it are Settings -> Export and the command palette, which is the one screen an owner reaches for when he wants his data out.",
    );
  }
  await act("open Export", () => page.goto("/export"));
  await settle(page);
  await shoot(page, "18-export", true);
  try {
    await offerSavePath(page, "/e2e/helix-export.zip");
    await act("Export everything", () =>
      page.getByRole("button", { name: /Export everything/ }).click(),
    );
    await settle(page);
    await shoot(page, "19-export-done", true);
  } catch (err) {
    friction(
      `Export everything did not complete: ${
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      }`,
    );
  }
  endLeg();

  /* ---------------------------------------------------------------- leg 10 */
  beginLeg("10. Ask for help");
  await act("open Help", () =>
    page.getByRole("navigation").getByRole("link", { name: "Help" }).click(),
  );
  await settle(page);
  await shoot(page, "20-help", true);
  const help = (await page.locator("main").innerText()).replace(/\n{2,}/g, "\n");
  writeFileSync(`${SCREENS}help.txt`, help, "utf8");
  for (const [topic, probe] of [
    ["import", /import/i],
    ["connect the website", /website/i],
    ["first quote", /quote/i],
    ["mark an invoice paid", /paid/i],
    ["backups and the recovery key", /recovery key/i],
    ["removing a workspace", /workspace/i],
    ["reporting an issue", /github|report/i],
  ] as const) {
    if (!probe.test(help)) friction(`Help says nothing about: ${topic}`);
  }
  await act("open Diagnostics", () => page.goto("/settings/diagnostics"));
  await settle(page);
  await shoot(page, "21-diagnostics", true);
  const diag = (await page.locator("main").innerText()).replace(/\n{2,}/g, "\n");
  writeFileSync(`${SCREENS}diagnostics.txt`, diag, "utf8");
  if (!/copy details/i.test(diag)) {
    friction(
      "Diagnostics has no single copyable support block: Walker has to talk the client through reading several rows aloud, or through copying a whole log file.",
    );
  }
  endLeg();

  /* ------------------------------------------------------------------ log */
  const contacts = helix.bridge.query(
    "select count(*) from contacts where deleted_at is null",
    [],
  );
  const deals = helix.bridge.query("select count(*) from deals where deleted_at is null", []);

  const summary = {
    revision: process.env.CS_WALK_LABEL ?? "unlabelled",
    firstMeaningfulOutcome: {
      definition:
        "The owner's own customers are in Helix, Today reflects them, and one job has been moved to the next stage.",
      reached: movedAJob,
      actions: outcomeActions,
      seconds: Math.round(outcomeMs / 1000),
      screens: 6,
    },
    totals: {
      actions: legs.reduce((sum, l) => sum + l.actions, 0),
      seconds: Math.round((Date.now() - walkStart) / 1000),
    },
    rows: { contacts: Number(contacts[0]?.[0] ?? 0), deals: Number(deals[0]?.[0] ?? 0) },
    legs,
    pageErrors,
    consoleErrors,
  };

  writeFileSync(`${SCREENS}walk.json`, JSON.stringify(summary, null, 2), "utf8");
  writeFileSync(
    `${SCREENS}walk.md`,
    [
      `# CS walk — ${summary.revision}`,
      "",
      `First meaningful outcome reached: **${summary.firstMeaningfulOutcome.reached}** in ` +
        `**${summary.firstMeaningfulOutcome.actions} actions / ` +
        `${summary.firstMeaningfulOutcome.seconds}s of machine time** across 6 screens.`,
      `Whole walk: ${summary.totals.actions} actions, ${summary.totals.seconds}s. ` +
        `${summary.rows.contacts} contacts, ${summary.rows.deals} jobs in the workspace at the end.`,
      "",
      "| leg | actions | s | friction found |",
      "|---|---|---|---|",
      ...legs.map(
        (l) =>
          `| ${l.leg} | ${l.actions} | ${Math.round(l.ms / 1000)} | ${
            l.friction.length ? l.friction.join("<br>") : "—"
          } |`,
      ),
      "",
      `Page errors: ${pageErrors.length ? pageErrors.join(" · ") : "none"}`,
      `Console errors: ${consoleErrors.length ? consoleErrors.join(" · ") : "none"}`,
    ].join("\n"),
    "utf8",
  );

  // The walk is a measurement, not a gate: it records what it found and only
  // fails if the app itself threw.
  expect(pageErrors, `page errors: ${pageErrors.join(" · ")}`).toEqual([]);
});
