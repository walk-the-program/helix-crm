import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { browser } from '@wdio/globals';
import type { Options } from '@wdio/types';

// ---------------------------------------------------------------------------
// Helix CRM - Windows end-to-end harness.
//
// Drives the real compiled Tauri app (not a browser, not a mock) through
// tauri-driver, which speaks WebDriver to msedgedriver, which in turn drives
// the WebView2 control the app renders into. This only works on Windows -
// WebView2 is a Windows component - so this config only ever runs on
// windows-latest CI or a local Windows VM. See tests/e2e-win/README.md.
//
// These WebdriverIO/@wdio/* packages are intentionally NOT in this repo's
// package.json (see tests/e2e-win/README.md for why); CI installs them with
// `npm i --no-save` before this config is loaded. That means this file will
// not typecheck when opened from the repo root - expected, and why
// tests/e2e-win is excluded from tsconfig.json's `include`.
//
// Nothing here may depend on PATH or on inherited environment variables: CI
// runs this whole process de-elevated through gsudo (see the workflow's
// "Run Windows e2e suite" step and the integrity note in the README), and a
// de-elevated process is not guaranteed to inherit the caller's PATH. Every
// binary below is therefore resolved to an absolute path, with an env
// override only as a convenience for local runs.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CI builds with `tauri build --debug --no-bundle`, which produces the raw
// binary under target/debug instead of a signed/optimized target/release
// bundle. Debug is what we want here: it keeps debug assertions on (so a
// broken invariant crashes loudly instead of misbehaving silently) and skips
// the slow release optimization + installer-packaging steps this suite
// doesn't need. "helix-crm" is the crate/binary name from
// src-tauri/Cargo.toml's [package].name (there is no [[bin]] override, so
// Cargo's default binary name is the package name, not the "helix_crm_lib"
// library crate name).
const appBinary = path.resolve(__dirname, '../../src-tauri/target/debug/helix-crm.exe');

// tauri-driver is a WebDriver-to-native-driver proxy: it does not itself know
// how to drive WebView2, so it needs a real msedgedriver binary handed to it.
// That binary's version must match the installed WebView2 Evergreen runtime
// exactly, which is what scripts/match-msedgedriver.ps1 resolves and
// downloads. The CI workflow runs that script and exports the resulting path
// as MSEDGEDRIVER_PATH; the fallback is the script's own default -OutDir, so
// a run that loses its environment still finds the driver.
const msedgedriverPath =
  process.env.MSEDGEDRIVER_PATH ?? path.resolve(__dirname, '.drivers/msedgedriver.exe');

// `cargo install tauri-driver --locked` puts the binary in CARGO_HOME/bin.
// That directory is on PATH in CI and in a normal dev shell, but this process
// may have been started de-elevated without the caller's PATH, so resolve the
// absolute path first and only fall back to the bare command name.
function resolveTauriDriver(): string {
  if (process.env.TAURI_DRIVER_PATH) return process.env.TAURI_DRIVER_PATH;

  const cargoBinDirs = [
    process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME, 'bin') : undefined,
    path.join(os.homedir(), '.cargo', 'bin'),
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of cargoBinDirs) {
    for (const name of ['tauri-driver.exe', 'tauri-driver']) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  // Last resort: let the OS resolve it from PATH and report ENOENT if it can't.
  return 'tauri-driver';
}

const tauriDriverCommand = resolveTauriDriver();

const outputDir = path.resolve(__dirname, '.output');
const screenshotsDir = path.join(outputDir, 'screenshots');
const tauriDriverLog = path.join(outputDir, 'tauri-driver.log');

const driverPort = 4444;

let tauriDriverProcess: ChildProcessWithoutNullStreams | undefined;

// tauri-driver prints nothing reliable on stdout when it is ready, so poll the
// port it binds instead of sleeping a fixed amount and hoping. A cold start on
// a loaded CI runner is usually well under a second; 20s of polling is slack,
// not an expected wait.
async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(1000, () => done(false));
    });
    if (connected) return;
    if (Date.now() > deadline) {
      throw new Error(`tauri-driver never started listening on 127.0.0.1:${port}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export const config: Options.Testrunner = {
  hostname: '127.0.0.1',
  port: driverPort,

  // Only smoke.e2e.ts today; the naming pattern (not *.spec.ts) is what keeps
  // Vitest's default include glob from ever picking these files up, since
  // both suites live under the same tests/ tree.
  specs: ['./specs/**/*.e2e.ts'],

  // tauri-driver proxies ONE WebDriver session to ONE native msedgedriver
  // process at a time - it is not a session-multiplexing server like
  // Selenium Grid. Running more than one session concurrently against it
  // will not parallelize; it will just make the two sessions fight over the
  // same underlying driver. Keep this at 1.
  maxInstances: 1,

  capabilities: [
    {
      // Tauri's WebDriver integration registers the "wry" browser name (wry
      // being the webview library Tauri embeds); tauri-driver uses that to
      // recognize a Tauri capability set rather than a normal browser one.
      browserName: 'wry',
      // Tauri-specific vendor capability (not part of WebdriverIO's stock
      // Capabilities type, hence the cast): tells tauri-driver which compiled
      // app binary to launch in place of a browser.
      'tauri:options': {
        application: appBinary,
      },
    } as WebdriverIO.Capabilities,
  ],

  logLevel: (process.env.WDIO_LOG_LEVEL as Options.Testrunner['logLevel']) ?? 'info',
  outputDir,
  waitforTimeout: 15000, // WebView2 + Tauri IPC bring-up is slower than a browser tab; give assertions room.
  // Each retry of a failed session costs msedgedriver's full 60s browser-start
  // timeout, so a broken launch takes 4 minutes to report with 3 retries and
  // says nothing the first attempt didn't. One retry absorbs a genuinely slow
  // cold start; anything past that is a real failure worth seeing quickly.
  connectionRetryCount: 1,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    // A cold launch runs pending SQLite migrations before first paint, on a
    // possibly-throttled CI runner. 120s leaves headroom well beyond the
    // ~1.5s first-paint target from docs/PLAN.md's Performance section.
    timeout: 120000,
  },

  // tauri-driver is a standalone process the Tauri project ships separately
  // from wdio (https://v2.tauri.app/develop/tests/webdriver/) - nothing else
  // starts it, so this suite owns spawning and killing it.
  onPrepare: async function () {
    // Fail with the path that is missing rather than letting msedgedriver
    // report a generic session error 60 seconds later.
    for (const [what, binary] of [
      ['the compiled app (run `npx tauri build --debug --no-bundle` first)', appBinary],
      ['msedgedriver (run tests/e2e-win/scripts/match-msedgedriver.ps1 first)', msedgedriverPath],
    ] as const) {
      if (!fs.existsSync(binary)) {
        throw new Error(`Cannot find ${what}: ${binary}`);
      }
    }

    await fs.promises.mkdir(outputDir, { recursive: true });
    // tauri-driver's own output is the only window into what msedgedriver did
    // with the app; keep it next to the wdio logs so the CI artifact has it.
    const logStream = fs.createWriteStream(tauriDriverLog, { flags: 'w' });

    tauriDriverProcess = spawn(tauriDriverCommand, ['--native-driver', msedgedriverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    tauriDriverProcess.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(`[tauri-driver] ${chunk.toString()}`);
      logStream.write(chunk);
    });
    tauriDriverProcess.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[tauri-driver] ${chunk.toString()}`);
      logStream.write(chunk);
    });

    const exited = new Promise<never>((_resolve, reject) => {
      tauriDriverProcess?.once('error', (error) =>
        reject(new Error(`Could not start tauri-driver (${tauriDriverCommand}): ${error.message}`)),
      );
      tauriDriverProcess?.once('exit', (code) =>
        reject(new Error(`tauri-driver exited early with code ${code}`)),
      );
    });

    await Promise.race([waitForPort(driverPort, 20000), exited]);
  },

  // Kill ONLY the tauri-driver child process this config spawned above -
  // never a broad/blanket kill (e.g. by process name or port), which could
  // take down an unrelated msedgedriver or webview2 process on a shared CI
  // runner or a developer's own machine.
  onComplete: function () {
    tauriDriverProcess?.kill();
  },

  // Runs once per session, after the WebDriver session exists but before any
  // spec runs. (beforeSession would fire earlier, before the session/window
  // exist at all, so it can't wait on window state.) The Tauri window can
  // still be finishing its first paint - migrations run before it - when the
  // session comes up, so specs wait here rather than each re-implementing it.
  before: async function () {
    await browser.waitUntil(
      async () => {
        const state = await browser.execute(() => document.readyState);
        return state === 'complete';
      },
      { timeout: 30000, timeoutMsg: 'Helix CRM window never finished loading' },
    );
  },

  // Capture a screenshot on any failing test so CI has something to upload
  // beyond the mocha log; see .github/workflows/e2e-win.yml's artifact step.
  afterTest: async function (test, _context, result) {
    if (result.passed) return;
    await fs.promises.mkdir(screenshotsDir, { recursive: true });
    // WebdriverIO's framework-agnostic Test shape exposes `parent` + `title`
    // (not Mocha's own `fullTitle()` method) - see the afterTest example in
    // https://webdriver.io/docs/configurationfile.
    const safeName = `${test.parent}-${test.title}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    await browser.saveScreenshot(path.join(screenshotsDir, `${safeName}-${Date.now()}.png`));
  },
};
