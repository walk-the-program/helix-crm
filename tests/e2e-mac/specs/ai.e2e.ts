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
 */
import { createServer, type Server } from "node:http";
import { test, expect } from "../fixtures";

const FAKE_PORT = 4795;
const FAKE_ORIGIN = `http://127.0.0.1:${FAKE_PORT}`;
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

  // The paste dialog and its mod+shift+v binding live in an overlay host the
  // AI feature mounts from onBoot, which runs after the first paint. Wait for
  // it, or a keypress in the first moments after boot lands on nothing.
  await expect(page.locator('[data-helix-overlay="ai"]')).toHaveCount(1);
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
  test("the settings screen and the paste dialog, light and dark", async ({
    page,
    helix,
  }) => {
    const { mkdirSync } = await import("node:fs");
    const dir = new URL("../.cache/screens/settings/", import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });

    await page.setViewportSize({ width: 1280, height: 900 });
    await boot(page);
    useFakeEndpoint(helix.bridge);
    await setUpAi(page, GOOD_KEY);

    // No navigation inside the loop: the keychain stub is per page load, so a
    // goto here would drop the key this test just saved.
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme,
      );
      await expect(page.getByTestId("settings-ai")).toBeVisible();
      await page.screenshot({ path: `${dir}ai-settings-${theme}.png`, fullPage: true });

      await page.keyboard.press("Meta+Shift+V");
      await expect(page.getByTestId("ai-paste-dialog")).toBeVisible();
      await page.getByTestId("ai-paste-text").fill(PASTED);
      await page.getByTestId("ai-paste-extract").click();
      await expect(page.getByTestId("ai-paste-form")).toBeVisible();
      // Only one accent button in a dialog: once the form is up, Read it again
      // steps back to a default button and Save is the primary (DESIGN.md s9).
      await expect(page.getByTestId("ai-paste-extract")).not.toHaveClass(
        /color-accent\)\]/,
      );
      await page.screenshot({ path: `${dir}ai-paste-${theme}.png` });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("ai-paste-dialog")).toBeHidden();
    }
  });
});
