# Windows e2e suite (WebdriverIO + tauri-driver)

This suite drives the real, compiled Helix CRM desktop app on Windows through
[tauri-driver](https://v2.tauri.app/develop/tests/webdriver/) and
[WebdriverIO](https://webdriver.io/). It is the Windows counterpart to
`tests/e2e-mac` (Playwright against a mocked IPC layer); see `docs/PLAN.md`'s
"Tests" section for how the two suites divide the flows between them.

## Why this needs a real Windows machine

Tauri's Windows webview is Microsoft Edge WebView2, a Windows-only OS
component. `tauri-driver` drives it by forwarding WebDriver commands to
`msedgedriver`, the WebDriver server Microsoft ships for Edge/WebView2 - there
is no macOS or Linux equivalent of that pairing. Nothing in this suite runs,
or can be made to run, on macOS or Linux.

**This suite cannot be run on macOS.** It only runs in CI on `windows-latest`
(`.github/workflows/e2e-win.yml`) and locally on a Windows machine or VM.

## What's here

```
tests/e2e-win/
  wdio.conf.ts                    WebdriverIO config: spawns tauri-driver,
                                   points it at the compiled debug app and at
                                   msedgedriver, waits for the window to load.
  scripts/match-msedgedriver.ps1  Downloads the msedgedriver build matching
                                   the machine's installed WebView2 runtime.
  specs/smoke.e2e.ts              The e2e specs. Named *.e2e.ts, not
                                   *.spec.ts, so Vitest's glob never picks
                                   these up.
  .drivers/                       (git-ignored, created on demand) where
                                   match-msedgedriver.ps1 downloads msedgedriver.exe.
  .output/                        (git-ignored, created on demand) wdio logs
                                   and failure screenshots.
```

## Why the driver version has to match WebView2

`msedgedriver` and the WebView2 runtime it drives have to be the same build,
the same way `chromedriver` has to match the installed Chrome version. A
mismatch fails the WebDriver session on startup rather than misbehaving
subtly, so `match-msedgedriver.ps1` always resolves the driver from whatever
WebView2 build is actually installed on the machine running the suite,
instead of pinning a driver version in source that would drift out of sync
with Windows Update's WebView2 auto-updates.

The script:

1. Reads the installed WebView2 Evergreen runtime version from the registry
   (`HKLM` then `HKCU`), falling back to the version folder name under
   `%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application` if the registry
   lookup fails.
2. Downloads `https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip`
   for that exact version.
3. If that exact version hasn't been published as a driver yet, falls back to
   the latest driver for the same major version (via that version's
   `LATEST_RELEASE_<major>_WINDOWS` pointer file).
4. Extracts `msedgedriver.exe` into `-OutDir` (default `tests/e2e-win/.drivers`)
   and prints its path, writing it to `$env:GITHUB_OUTPUT` as
   `msedgedriver-path` when run inside GitHub Actions.

Re-running it is cheap - it skips the download if a driver matching the
currently-installed WebView2 version is already in `-OutDir`.

## Why these packages aren't in package.json

`webdriverio`, `@wdio/cli`, and the rest of the WebdriverIO toolchain are
**not** listed as dependencies of the repo's root `package.json`. They only
run on Windows, only in this one suite, and adding them to the shared
`package.json` would mean every contributor and every other CI job (macOS,
Linux, `npm ci`) pays for installing packages they never use.

Instead, `.github/workflows/e2e-win.yml` installs them itself, on the Windows
runner, right before running the suite:

```
npm i --no-save --no-audit --no-fund webdriverio @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter @wdio/globals @wdio/types tsx
```

`--no-save` means this never touches `package.json` or `package-lock.json`.
`tsx` is included so the WebdriverIO CLI can load `wdio.conf.ts` and the
`*.e2e.ts` specs directly, without a separate compile step.

Because these packages aren't installed in a normal `npm ci` checkout,
**`wdio.conf.ts` will not typecheck when you open this repo normally** -
`tsconfig.json`'s `include` deliberately excludes `tests/e2e-win` so this
doesn't break `npm run typecheck` or editor tooling for everyone else.

## Running it locally on a Windows VM

You need a real Windows machine or VM (Walker: UTM or Parallels, per
`docs/PLAN.md`'s Deployment section) with the WebView2 Runtime installed
(it ships with Windows 11 and current Windows 10; if it's missing, install
the Evergreen runtime from Microsoft first).

From a PowerShell prompt, at the repo root:

```powershell
# 1. Install JS dependencies (same as any other checkout).
npm ci

# 2. Build the frontend and the debug Tauri binary.
npm run build
npx tauri build --debug --no-bundle

# 3. Install tauri-driver (once per machine; it's a real Rust binary, not an npm package).
cargo install tauri-driver --locked

# 4. Download the msedgedriver build matching this machine's WebView2 runtime.
.\tests\e2e-win\scripts\match-msedgedriver.ps1
# Prints the resolved path, e.g. C:\...\tests\e2e-win\.drivers\msedgedriver.exe

# 5. Install the WebdriverIO toolchain (not part of package.json - see above).
npm i --no-save --no-audit --no-fund webdriverio @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter @wdio/globals @wdio/types tsx

# 6. Point wdio.conf.ts at the driver from step 4 and run the suite.
$env:MSEDGEDRIVER_PATH = "$PWD\tests\e2e-win\.drivers\msedgedriver.exe"
npx wdio run tests/e2e-win/wdio.conf.ts
```

If step 6 hangs or fails to connect, check that no stray `tauri-driver.exe` or
`msedgedriver.exe` process is still running from a previous interrupted run
(`wdio.conf.ts` only ever kills the process it itself spawned, so a killed
`wdio` process can leave one behind) - end it in Task Manager and re-run.

## What's tested today, and what's next

`specs/smoke.e2e.ts` only proves the harness works end to end: the real app
launches, the window title is correct, the sidebar renders with a "Today"
item, and the Today screen's heading appears. The fuller flows from
`docs/PLAN.md`'s "Tests" section - first launch, quick add, importing a
HubSpot export, dragging a deal, completing a task from Today, restoring a
backup, switching workspace, and AI off/on against a local fake endpoint -
are listed as a comment at the top of that spec and still need to be written
against the real UI as each feature lands.
