import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

/**
 * The macOS end-to-end suite.
 *
 * It runs the real frontend build in Chromium with no Tauri runtime at all.
 * `tests/e2e-mac/fixtures.ts` supplies the missing half: a better-sqlite3
 * database bound to `window.__helixDb` (which `src/db/drivers/e2e.ts` forwards
 * to) and a stub for every other Tauri command.
 *
 * What this can prove: the UI flows, the SQL, the repositories, the migrator.
 * What it cannot: anything that is actually Rust — the keychain, the real file
 * copy, the HTTP client, backup on a live connection, window behaviour. Those
 * belong to tests/e2e-win and to the manual checklist. See tests/README.md.
 *
 * `vite preview` serves the built app, so `npm run build` must have run first.
 */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Per-agent overrides so several suites can run at once without colliding on
// the port or the build folder: E2E_PORT=4174 E2E_OUT=dist-records npm run e2e:mac
const PORT = Number(process.env.E2E_PORT ?? 4173);
const OUT_DIR = process.env.E2E_OUT ?? "dist";
const BASE_URL = `http://127.0.0.1:${PORT}`;

// `tests/e2e-mac/.cache/results` is a single `outputDir` shared by every
// agent's Playwright run; two runs at once collide there (Playwright fails at
// browserContext.close with an ENOENT on its own trace file). Derive a
// per-agent results folder from E2E_OUT the same way PORT is derived from
// E2E_PORT, sanitised to a safe folder name. The CI html report folder gets
// the same treatment so it never collides either.
const RESULTS_SUFFIX = process.env.E2E_OUT
  ? `-${process.env.E2E_OUT.replace(/[^a-zA-Z0-9._-]+/g, "-")}`
  : "";
const RESULTS_DIR = `./.cache/results${RESULTS_SUFFIX}`;
const REPORT_DIR = `./.cache/report${RESULTS_SUFFIX}`;

export default defineConfig({
  testDir: fileURLToPath(new URL("./specs", import.meta.url)),
  // Not *.spec.ts: Vitest's default glob would collect those as unit tests.
  testMatch: "**/*.e2e.ts",
  outputDir: fileURLToPath(new URL(RESULTS_DIR, import.meta.url)),

  // One worker. Every test drives its own SQLite file, but the app is a
  // single-window desktop app and the flows are stateful; parallel runs buy
  // nothing here and make failures harder to read.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: fileURLToPath(new URL(REPORT_DIR, import.meta.url)), open: "never" }]]
    : [["list"]],

  webServer: {
    command: `VITE_E2E=1 npx vite build --outDir ${OUT_DIR} --logLevel error && VITE_E2E=1 npx vite preview --outDir ${OUT_DIR} --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: repoRoot,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },

  use: {
    baseURL: BASE_URL,
    // The app's minimum supported window is 1024px wide; test above it.
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
