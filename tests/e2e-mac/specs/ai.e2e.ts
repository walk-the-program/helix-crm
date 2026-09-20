/**
 * The AI module end to end, against a fake Anthropic on 127.0.0.1:4795.
 *
 * What the harness gives us and what it does not: `tests/e2e-mac/fixtures.ts`
 * stubs `secret_*`, so a key saved through the UI lands in
 * `window.__helixE2E.secrets` for the life of the page - but it has no stub for
 * `plugin:http|fetch`, because there is no Rust side under Playwright. The
 * provider handles that itself (`src/features/ai/lib/http.ts`): under the e2e
 * build it uses the browser's own fetch, exactly as boot swaps the database
 * driver for the e2e bridge. So the request below is a real HTTP request to a
 * real server started by this spec, which is the point - it exercises the URL,
 * the headers, the JSON schema and the parsing for real.
 *
 * The fake answers the Messages API shape and nothing more. It is deliberately
 * strict about the key: a request carrying the "bad" key gets a real 401, which
 * is how the AiKeyRejected path is proved.
 *
 * Run it on this agent's own port and build folder (the fake is always on 4795):
 *   E2E_PORT=4189 E2E_OUT=dist-sweep-settings npx playwright test \
 *     -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/ai.e2e.ts
 */
import { createServer, type Server } from "node:http";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

const FAKE_PORT = 4795;
const FAKE_ORIGIN = `http://127.0.0.1:${FAKE_PORT}`;

/**
 * Flip the theme and wait for it to finish arriving.
 *
 * Every surface, border and control in the kit carries `transition-colors`,
 * so the frame right after `data-theme` changes is the OLD colour: a capture
 * taken in the same tick photographs the light theme wearing a dark label.
 * That is how the first brand pass produced "dark" screenshots with white
 * text fields in every dialog. Wait for the canvas to actually change, then
 * give the slowest transition (--dur-slow, 200ms) room to land.
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

const GOOD_KEY = "sk-ant-e2e-good-key-1234";
const BAD_KEY = "sk-ant-e2e-bad-key-0000";

const PASTED = [
  "Hi, this is Dana Whitaker at 801-555-0147.",
  "Our sprinklers are flooding the driveway - can someone come look this week?",
  "Budget is around $600.",
].join(" ");

const EXTRACTED = {
  contact: {
    firstName: "Dana",
    lastName: "Whitaker",
    email: "dana@example.com",
    phone: "801-555-0147",
    companyName: null,
    notes: "Sprinklers flooding the driveway.",
  },
  deal: {
    title: "Sprinkler repair",
    value: 600,
    expectedOn: null,
    summary: "Wants someone out this week.",
  },
};

type Recorded = { key: string | null; version: string | null; body: unknown };

let server: Server | null = null;
const seen: Recorded[] = [];

/** Whatever the request's JSON schema asked for, in the Messages API envelope. */
function answerFor(body: Record<string, unknown>): unknown {
  const outputConfig = (body.output_config ?? {}) as Record<string, unknown>;
  const format = (outputConfig.format ?? {}) as Record<string, unknown>;
  const schema = (format.schema ?? {}) as { properties?: Record<string, unknown> };
  const keys = Object.keys(schema.properties ?? {});

  if (keys.includes("contact")) return EXTRACTED;
  if (keys.includes("subject")) {
    return { subject: "Your sprinklers", body: "Hi Dana, I can come Thursday." };
  }
  if (keys.includes("summary")) return { summary: "Dana wants a sprinkler fixed." };
  return { ok: true };
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-api-key, anthropic-version",
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      res.writeHead(404, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      const key = (req.headers["x-api-key"] as string | undefined) ?? null;
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      seen.push({
        key,
        version: (req.headers["anthropic-version"] as string | undefined) ?? null,
        body,
      });

      if (key === BAD_KEY || !key) {
        res.writeHead(401, { ...cors, "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "authentication_error", message: "invalid x-api-key" },
          }),
        );
        return;
      }

      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_e2e",
          type: "message",
          role: "assistant",
          model: String(body.model ?? "claude-sonnet-5"),
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(answerFor(body)) }],
          usage: { input_tokens: 100, output_tokens: 40 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => {
    server!.listen(FAKE_PORT, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  const running = server;
  server = null;
  if (!running) return;
  await new Promise<void>((resolve) => running.close(() => resolve()));
});

test.beforeEach(() => {
  seen.length = 0;
});

/** Boot the app and wait for the shell, as the smoke spec does. */
async function boot(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true, level: 1 }),
  ).toBeVisible();

  // The paste dialog now renders in the shell's own tree through the feature's
  // `overlays` slot, and mod+shift+v is bound by the shell from the "ai-paste"
  // command — both are up with the shell rather than after it, so there is no
  // separate host div to wait for. The Today heading above is the signal.
}

/**
 * Always navigate in-app, never with a deep `page.goto("/settings/ai")`:
 * `vite preview` has no index.html fallback for a path it never built, and a
 * reload would also throw away the keychain stub, which lives in the page.
 */
async function openAiSettings(page: import("@playwright/test").Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-overview")).toBeVisible();
  await page.locator('[data-testid="settings-section-link"][data-section="ai"]').click();
  await expect(page.getByTestId("settings-ai")).toBeVisible();
}

/** Point the provider at the fake before the screen reads its settings. */
function useFakeEndpoint(bridge: { execute: (sql: string, params: unknown[]) => number }) {
  bridge.execute(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    ["aiBaseUrl", JSON.stringify(FAKE_ORIGIN), new Date().toISOString()],
  );
}

/** Turn AI on and save a key through the screen, as the owner would. */
async function setUpAi(
  page: import("@playwright/test").Page,
  key: string,
): Promise<void> {
  await openAiSettings(page);

  const toggle = page.locator("#ai-enabled");
  if ((await toggle.getAttribute("data-state")) !== "checked") {
    await toggle.click();
  }
  await expect(page.getByTestId("ai-enabled-label")).toHaveText("AI is on");

  await page.getByTestId("ai-key-input").fill(key);
  await page.getByTestId("ai-key-save").click();
  await expect(page.getByTestId("ai-key-state")).toContainText("ends in");
}

test.describe("AI, off", () => {
  test("the paste command says why it cannot run, and links to settings", async ({
    page,
    // Destructuring `helix` is what installs the e2e Tauri shim before the app
    // boots, even when the test never touches the bridge: without it the app
    // reaches for the real `invoke` and lands on the DbOpenError screen.
    helix,
  }) => {
    void helix;
    await boot(page);

    // mod+shift+v from anywhere: the AI feature binds it in its overlay host.
    await page.keyboard.press("Meta+Shift+V");

    const dialog = page.getByTestId("ai-paste-dialog");
    await expect(dialog).toBeVisible();

    const reason = page.getByTestId("ai-paste-disabled");
    await expect(reason).toBeVisible();
    await expect(reason).toContainText("AI is off");
    await expect(reason.getByRole("link", { name: "Open AI settings" })).toBeVisible();

    // Visible but disabled, with nothing sent.
    await page.getByTestId("ai-paste-text").fill(PASTED);
    await expect(page.getByTestId("ai-paste-extract")).toBeDisabled();
    expect(seen).toHaveLength(0);
  });

  test("a record page carries no AI control at all", async ({ page, helix }) => {
    void helix;
    // Finding F-LC-20 / ruling R16: an optional module that is off does not
    // narrate its absence on every customer record. Before this, all three
    // record pages carried a disabled button and the sentence "AI is off. Turn
    // it on in Settings.", and the deal page needed a CSS rule to stop
    // printing it twice.
    // The migrations run when the app boots, so the rows go in after it.
    await boot(page);
    const now = new Date().toISOString();
    helix.bridge.call("execute", [
      "insert into companies (id, name, created_at, updated_at) values ('c-ai','Alpine Ridge',?,?)",
      [now, now],
    ]);
    helix.bridge.call("execute", [
      `insert into contacts (id, company_id, first_name, last_name, created_at, updated_at)
       values ('p-ai','c-ai','Dave','Tracy',?,?)`,
      [now, now],
    ]);

    for (const route of ["/contacts/p-ai", "/companies/c-ai"]) {
      await page.evaluate((to) => window.history.pushState({}, "", to), route);
      await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByTestId("ai-summarize")).toHaveCount(0);
      await expect(page.getByTestId("ai-draft-followup")).toHaveCount(0);
      await expect(page.getByTestId("ai-disabled-reason")).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText("AI is off");
    }
  });

  test("the settings screen starts off, with no key", async ({ page, helix }) => {
    void helix; // installs the e2e shim - see the test above
    await boot(page);
    await openAiSettings(page);

    await expect(page.getByTestId("ai-enabled-label")).toHaveText("AI is off");
    await expect(page.getByTestId("ai-key-state")).toContainText("No key saved");
  });
});

test.describe("AI, on", () => {
  test("saves a key to the keychain stub and never shows it back", async ({
    page,
    helix,
  }) => {
    await boot(page);
    useFakeEndpoint(helix.bridge);
    await setUpAi(page, GOOD_KEY);

    // The screen says only the last four.
    await expect(page.getByTestId("ai-key-state")).toContainText("ends in 1234");
    const screenText = (await page.getByTestId("settings-ai").innerText()) ?? "";
    expect(screenText).not.toContain(GOOD_KEY);

    // The key itself went to secret_set, under this workspace.
    const secrets = await page.evaluate(
      () => (window as unknown as { __helixE2E: { secrets: Record<string, string> } }).__helixE2E.secrets,
    );
    expect(secrets["e2e-workspace:anthropic"]).toBe(GOOD_KEY);

    // And only the suffix reached the database.
    const rows = helix.bridge.query(
      "SELECT value_json FROM settings WHERE key = 'aiKeySuffix'",
      [],
    );
    expect(String(rows[0][0])).toContain("1234");
    const all = helix.bridge.query("SELECT value_json FROM settings", []);
    expect(all.map((r) => String(r[0])).join(" ")).not.toContain(GOOD_KEY);
  });

  test("Test key reaches the endpoint with the right headers", async ({
    page,
    helix,
  }) => {
    await boot(page);
    useFakeEndpoint(helix.bridge);
    await setUpAi(page, GOOD_KEY);

    await page.getByTestId("ai-key-test").click();
    await expect(page.getByTestId("ai-test-result")).toContainText("works");

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].key).toBe(GOOD_KEY);
    expect(seen[0].version).toBe("2023-06-01");
    const body = seen[0].body as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5");
    expect(body).not.toHaveProperty("temperature");
  });

  test("paste to record: extract, check, confirm, and the rows exist", async ({
    page,
    helix,
  }) => {
    await boot(page);
    useFakeEndpoint(helix.bridge);
    await setUpAi(page, GOOD_KEY);

    await page.keyboard.press("Meta+Shift+V");
    const dialog = page.getByTestId("ai-paste-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("ai-paste-disabled")).toHaveCount(0);

    await page.getByTestId("ai-paste-text").fill(PASTED);
    await page.getByTestId("ai-paste-extract").click();

    // The proposal lands in a form, not in the database.
    await expect(page.getByTestId("ai-paste-form")).toBeVisible();
    await expect(page.getByTestId("ai-first-name")).toHaveValue("Dana");
    await expect(page.getByTestId("ai-deal-title")).toHaveValue("Sprinkler repair");
    expect(helix.bridge.query("SELECT count(*) FROM contacts", [])[0][0]).toBe(0);

    // Only the pasted text was sent.
    const sent = seen.find((r) => JSON.stringify(r.body).includes("Whitaker"));
    expect(sent, "the paste should have reached the endpoint").toBeTruthy();

    // The owner corrects it before saving, which is the whole point of the form.
    await page.getByTestId("ai-last-name").fill("Whitaker-Ross");
    await page.getByTestId("ai-paste-confirm").click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(() =>
        helix.bridge.query(
          "SELECT first_name, last_name FROM contacts WHERE deleted_at IS NULL",
          [],
        ).length,
      )
      .toBe(1);

    const contact = helix.bridge.query(
      "SELECT first_name, last_name FROM contacts WHERE deleted_at IS NULL",
      [],
    )[0];
    expect(contact[0]).toBe("Dana");
    expect(contact[1]).toBe("Whitaker-Ross");

    const deal = helix.bridge.query(
      "SELECT title, value_cents, contact_id FROM deals WHERE deleted_at IS NULL",
      [],
    )[0];
    expect(deal[0]).toBe("Sprinkler repair");
    expect(deal[1]).toBe(60000);
    expect(deal[2]).toBeTruthy();

    const phones = helix.bridge.query("SELECT raw, e164 FROM contact_phones", []);
    expect(phones[0][1]).toBe("+18015550147");
  });
});

test.describe("AI, on but no key", () => {
  test("the button is there, disabled, and says why without printing a line", async ({
    page,
    helix,
  }) => {
    // Ruling R16's other half: once the owner HAS opted in, a control that is
    // simply absent is a mystery. So the button stays, disabled, and the
    // reason moves into the tooltip and the accessible description rather
    // than onto the page.
    // The migrations run when the app boots, so the rows go in after it.
    await boot(page);
    const now = new Date().toISOString();
    helix.bridge.call("execute", [
      "insert into companies (id, name, created_at, updated_at) values ('c-ai','Alpine Ridge',?,?)",
      [now, now],
    ]);
    helix.bridge.call("execute", [
      `insert into contacts (id, company_id, first_name, last_name, created_at, updated_at)
       values ('p-ai','c-ai','Dave','Tracy',?,?)`,
      [now, now],
    ]);

    // Turn AI on and save no key.
    await openAiSettings(page);
    const toggle = page.locator("#ai-enabled");
    if ((await toggle.getAttribute("data-state")) !== "checked") await toggle.click();
    await expect(page.getByTestId("ai-enabled-label")).toHaveText("AI is on");
    await expect(page.getByTestId("ai-key-state")).toContainText("No key saved");

    await page.evaluate(() => window.history.pushState({}, "", "/contacts/p-ai"));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));

    const button = page.getByTestId("ai-summarize");
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();

    // The reason is reachable by assistive technology...
    const describedBy = await button.getAttribute("aria-describedby");
    expect(describedBy, "the disabled button names its reason").toBeTruthy();
    const reason = page.locator(`#${describedBy}`);
    await expect(reason).toHaveCount(1);
    await expect(reason).toContainText(/key/i);

    // ...and it is not a visible line of body text on the record.
    const reasonBox = await reason.boundingBox();
    expect(
      reasonBox === null || reasonBox.width <= 1 || reasonBox.height <= 1,
      "the reason is not printed on the page",
    ).toBe(true);
  });
});

test.describe("AI, a rejected key", () => {
  test("401 says AiKeyRejected and disables the actions until it is replaced", async ({
    page,
    helix,
  }) => {
    await boot(page);
    useFakeEndpoint(helix.bridge);
    await setUpAi(page, BAD_KEY);

    await page.getByTestId("ai-key-test").click();

    const result = page.getByTestId("ai-test-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("rejected");
    // The API's own message is shown, not a generic one.
    await expect(result).toContainText("invalid x-api-key");

    // The state is remembered, so the buttons stop offering to fail again.
    await expect
      .poll(() =>
        String(
          helix.bridge.query(
            "SELECT value_json FROM settings WHERE key = 'aiKeyState'",
            [],
          )[0]?.[0] ?? "",
        ),
      )
      .toContain("rejected");

    await page.keyboard.press("Meta+Shift+V");
    const reason = page.getByTestId("ai-paste-disabled");
    await expect(reason).toBeVisible();
    await expect(reason).toContainText("rejected");
    await expect(page.getByTestId("ai-paste-extract")).toBeDisabled();
  });
});

test.describe("AI, screenshots", () => {
  test("the settings screen and all three sheets, light and dark", async ({ page, helix }) => {
    test.setTimeout(180_000);
    const { mkdirSync } = await import("node:fs");
    const dir = new URL("../.cache/screens/brand-b/", import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });

    await page.setViewportSize({ width: 1280, height: 900 });
    await boot(page);
    useFakeEndpoint(helix.bridge);
    await setUpAi(page, GOOD_KEY);

    /**
     * A screen is captured full page; a sheet is captured at the viewport,
     * because a dialog is `position: fixed` and a full-page capture of one puts
     * it somewhere that is not where a person sees it.
     */
    async function shoot(name: string, fullPage = true): Promise<void> {
      for (const theme of ["light", "dark"] as const) {
        await settleTheme(page, theme);
        await page.screenshot({ path: `${dir}${name}-${theme}.png`, fullPage });
      }
      await settleTheme(page, "light");
    }

    /**
     * In-app navigation without a page load. A deep `goto` 404s under
     * `vite preview` and would also throw away the keychain stub, which lives in
     * the page; pushState plus a popstate is what wouter itself listens for, so
     * the router moves and nothing is reloaded.
     */
    async function goInApp(path: string): Promise<void> {
      await page.evaluate((next) => {
        window.history.pushState({}, "", next);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, path);
    }

    await expect(page.getByTestId("settings-ai")).toBeVisible();
    await shoot("ai-settings");

    // The paste sheet, with the proposal form up.
    await page.keyboard.press("Meta+Shift+V");
    await expect(page.getByTestId("ai-paste-dialog")).toBeVisible();
    await page.getByTestId("ai-paste-text").fill(PASTED);
    await page.getByTestId("ai-paste-extract").click();
    await expect(page.getByTestId("ai-paste-form")).toBeVisible();
    // One block of brand primary in a sheet: "Read it" is a secondary push
    // button and Save is the primary, whether or not the form is up yet.
    await expect(page.getByTestId("ai-paste-extract")).not.toHaveClass(/color-accent\)\]/);
    await shoot("ai-paste", false);

    // Saving it gives the other two sheets something real to talk about: they
    // hang off a record, and the fixtures seed no deals.
    await page.getByTestId("ai-paste-confirm").click();
    await expect(page.getByTestId("ai-paste-dialog")).toBeHidden();
    await expect
      .poll(() => helix.bridge.query("SELECT id FROM contacts WHERE deleted_at IS NULL", []).length)
      .toBe(1);

    const contactId = String(
      helix.bridge.query("SELECT id FROM contacts WHERE deleted_at IS NULL", [])[0][0],
    );
    const dealId = String(
      helix.bridge.query("SELECT id FROM deals WHERE deleted_at IS NULL", [])[0][0],
    );

    // Summarise, from the contact the paste just created.
    await goInApp(`/contacts/${contactId}`);
    await page.getByTestId("ai-summarize").click();
    await expect(page.getByTestId("ai-summary-dialog")).toBeVisible();
    await expect(page.getByTestId("ai-summary-text")).toContainText("sprinkler");
    await shoot("ai-summary", false);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ai-summary-dialog")).toBeHidden();

    // Draft a follow-up, from its deal.
    await goInApp(`/deals/${dealId}`);
    await page.getByTestId("ai-draft-followup").click();
    await expect(page.getByTestId("ai-draft-dialog")).toBeVisible();
    await expect(page.getByTestId("ai-draft-subject")).toHaveValue("Your sprinklers");
    await shoot("ai-draft", false);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ai-draft-dialog")).toBeHidden();
  });
});
