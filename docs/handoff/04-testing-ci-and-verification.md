# 04. Testing, CI and verification

Read 02 first for the layers being tested. Checked against `main` 2e9fb04. Counts
were re-measured on this checkout on 2026-09-28 (details under "Current counts").
Authoritative sources: `tests/README.md`, `tests/RELEASE-CHECKLIST.md`,
`docs/LAUNCH-ACCEPTANCE.md`, `.github/workflows/*.yml`, `docs/OPERATIONS.md`.

## The four suites and the hand checklist

Each suite proves something the others cannot and has a blind spot the next covers.
None of them tests a signed, notarised build on a customer's machine (Helix has no
signed build); that is the hand checklist.

| Suite | Where | Runs | Proves | Cannot prove |
| --- | --- | --- | --- | --- |
| Unit | `tests/unit/` (151 files) | Vitest, environment `node`, every commit | Pure logic: phone and email normalization, CSV parsing and column guesses, dedupe rules, gone-quiet arithmetic, export escaping, undo batch replay, migration ordering, cursor handling, shell shortcut and footer behavior (jsdom + Testing Library), money and PDF helpers | Anything needing SQL, the real UI, or Tauri |
| Repo | `tests/repo/` (86 files; `driver.ts`, `harness.ts`) | Vitest, same run as unit | Every repository, the migrator, the search triggers, the write lock and concurrency, perf budgets, against a real `better-sqlite3` file through the SAME `sqlite-proxy` callback production uses; `harness.ts` builds a fresh database with every migration applied | That the Rust pipe behaves like better-sqlite3 (held to the same contract and tested separately in `src-tauri/tests/db_tests.rs`); the UI |
| Rust | `src-tauri/src` unit tests and `src-tauri/tests/*.rs` | `cargo test`, CI on macOS and Windows | The real commands: db pipe, SQLCipher encryption and migration, keychain logic (in-memory store), file copy, leads hardening, recovery key and adopt, backup mirror, capability allowlist, disk-encryption parsers | Anything above the pipe; a real keychain (tests use an in-memory store) |
| e2e-mac | `tests/e2e-mac/` (25 spec files) | Playwright, Chromium, no Tauri runtime; CI job `e2e` on macOS | The built frontend and the SQL under it, through the real repositories, with `window.__helixDb` bound to a per-test better-sqlite3 file and every other Tauri command stubbed (`fixtures.ts`) | Anything actually Rust: keychain, real file copies, HTTP client, backup on a live connection, window behavior, the capability allowlist, restore, workspace switching |
| e2e-win | `tests/e2e-win/` (`specs/smoke.e2e.ts`, `wdio.conf.ts`, `scripts/match-msedgedriver.ps1`) | WebdriverIO + `tauri-driver` + `msedgedriver` on `windows-latest`, CI only | The real compiled app on Windows, nothing stubbed: three `it` cases (window title is "Helix CRM", the sidebar shows Today, the Today heading renders) after walking the three onboarding screens; `RELEASE-CHECKLIST.md` counts this as four assertions | Everything else on Windows. It runs a debug build, not the installer. Cannot run on macOS at all |
| By hand | `tests/RELEASE-CHECKLIST.md` | Walker (or the director), before tagging | Real window, real keychain prompt, real save dialogs, real calendar import, real clipboard and print, Gatekeeper and SmartScreen | (Manual; not automated) |

Support files: `tests/fixtures/` (five vendor CSV exports, `messy-3000.csv`,
`malformed/` cases and a 100k-row generator; all synthetic), `tools/fake-site/` (a
zero-dependency Node server implementing the ClearPath leads endpoint on port 4711,
with `POST /api/leads`, `--seed N`, `--slow`, `--fail`).

Vitest config (`vitest.config.ts`): include `tests/unit/**/*.test.{ts,tsx}` and
`tests/repo/**/*.test.{ts,tsx}`; exclude e2e folders; `testTimeout` and `hookTimeout`
30,000 ms. Specs for Playwright are named `*.e2e.ts`, never `*.spec.ts`, so Vitest's
default glob cannot collect them.

Three tests skip by design (`tests/unit/invoices/pdfSample.test.ts`, via
`it.skipIf(!process.env.HELIX_PDF_SAMPLE)`): they write sample PDFs to look at.

### What the e2e-mac harness does

`tests/e2e-mac/playwright.config.ts`: one worker, not fully parallel; 60 s test
timeout, 10 s expect timeout; `retries: 1` and `forbidOnly` when `CI` is set; reporter
`github` plus html in CI, `list` locally; one project (Chromium, viewport 1440x900);
trace and screenshot kept only on failure. Its `webServer` runs `VITE_E2E=1 npx vite
build --outDir $E2E_OUT` then `vite preview` on `$E2E_PORT`, so `npm run build` need not
have run first and several suites can run at once. Two things a spec cannot do: it cannot
`import()` a repository into the page (the preview serves a built bundle), so arrange
and assert through `helix.bridge.query(sql, params)` / `.execute(sql, params)` (params
array required even when empty); and every `test(...)` callback must destructure the
`helix` fixture or it is never installed. Steering hooks live on `window.__helixE2E`
(queue a dialog path, set what `leads_fetch` returns, read back what the app opened).

Side effects to expect: several specs write screenshots into tracked folders under
`design/` (`hig.e2e.ts` writes `design/hig/`; others also reference `design/`), so an
e2e run leaves a few modified `.png` files. Likewise the Vitest test
`tests/unit/ui/gallery.test.ts` rewrites `design/ui-screens/gallery.html`; a full
`npx vitest run` changed one line in it on this checkout (a date-dependent DOM
difference), which was restored with `git checkout`. Leave or restore these; do not
commit them by accident (commit by pathspec).

## Exact commands

Run from the repo root unless noted.

```sh
npm ci                       # install (CI uses this; local dev uses npm install once)
npm run typecheck            # tsc --noEmit
npx vitest run               # unit + repo suites (npm test is the same)
cd src-tauri && cargo test   # all Rust tests
npm run build                # tsc --noEmit && vite build
npm run e2e:mac              # full Playwright suite (macOS; default port 4173, out dir dist)

# One spec, with its own port and build folder so parallel runs do not collide:
E2E_PORT=4290 E2E_OUT=dist-x npm run e2e:mac -- tests/e2e-mac/specs/today.e2e.ts
rm -rf dist-x                # delete the throwaway build afterwards

npx playwright test -c tests/e2e-mac/playwright.config.ts --list   # count without running
npx vitest run tests/unit/app/shellFooter.test.ts                  # one file
npm run fake-site -- --seed 25                                     # dev/test stand-in site
npm run tauri dev            # the real app with hot reload (Vite on 1420)
npm run drizzle:generate     # only when src/db/schema.ts changed
npm audit --omit=dev --audit-level=high                            # what CI runs
```

e2e-win has no local command on macOS. On CI it is: `npm ci`, `npm run build`,
`npx tauri build --debug --no-bundle`, `cargo install tauri-driver --locked`,
`tests/e2e-win/scripts/match-msedgedriver.ps1`, `npm i --no-save webdriverio ...`
(WebdriverIO is deliberately not in `package.json`), then the wdio run de-elevated
through `gsudo --integrity Medium`. Reason: WebView2 150+ ignores the `WEBVIEW2_*`
environment variables when the host is elevated, which is how `msedgedriver` hands the app
its remote-debugging port; an elevated run fails with `session not created:
DevToolsActivePort file doesn't exist`. Full story: `tests/e2e-win/README.md`.

Ports (`CONTRIBUTING.md`, `tests/README.md`): Vite dev 1420, Vite preview (e2e-mac)
4173, `tools/fake-site` 4711, tauri-driver 4444. Never `pkill`; kill only a PID you
started.

## Current counts

The task packet cited "2802 unit/repo, 125 Rust, 202 e2e as of 2e035c6". Re-measured on
this checkout (2e9fb04, which changes docs only):

- Unit + repo (Vitest): 237 files, 2,805 tests = 2,802 non-skipped + 3 skipped. In one
  full run under CPU load (a Playwright `--list` and other work ran alongside it) the
  result was 234 files passed, 2 files failed, 1 skipped; 2,798 passed, 4 failed, 3
  skipped, 223 s. The four failures were `tests/unit/app/shellFooter.test.ts` (2) and
  `tests/unit/app/shellQuickAdd.test.ts` (2), both `getByRole` lookups on a slow shell
  render. Rerun alone, both files passed 8 of 8 (36 s wall clock; the render is heavy).
  Treat those two files as load-sensitive; a failure in a busy run is not by itself a
  regression. 2,802 is the figure when nothing is contending.
- Rust: 125 passed, 0 failed (`cargo test`): 85 in the library (`src/*.rs` unit tests),
  0 in `main.rs`, and integration tests: `capability_tests.rs` 8, `db_tests.rs` 10,
  `encryption_tests.rs` 11, `la_w3_tests.rs` 2, `recovery_tests.rs` 9. Older docs quote
  smaller per-file numbers (for example encryption 7); they predate later additions.
- e2e-mac: 202 tests in 25 files (`playwright test --list`). Per file: leads 27,
  records 23, smoke 16, invoices 15, today 14, depth 14, settings 13, hig 11, data 10,
  ai 9, onboarding 6, backups 6, px-b-schedule 5, listNav 5, la-w2 5, la-w1 4, la-j12 4,
  revenue 3, px-c-automation 3, px-a-payments 2, cpoWalk 2, cpoRows 2, px-c-bulk 1,
  la-workspaces 1, csWalk 1. The e2e suite was listed, not executed, in this pass; the
  launch record reports a full local pass (202) at 82c06fc and a green CI `e2e` job at
  2e035c6.
- e2e-win: one spec, three `it` cases.
- `npm run typecheck` passed with no output on this checkout.

History of the Vitest gate through the launch round (launch record section 5): 2,102 at
baseline e8e7650, 2,221 after SEC, 2,285 after OPS, 2,325 REV, 2,373 CS, 2,718 PX, 2,798
at LA (plus 3 skipped throughout). Rust: 41 at baseline, 102, 123, then 125.

The launch acceptance matrix (`docs/LAUNCH-ACCEPTANCE.md`, journeys J1 to J14) names for
every scenario the surface that proved it (Rust, repo, e2e-mac, e2e-win, by hand) and
records rows that were "not run here" (real clipboard, print, calendar import, Windows
anything beyond smoke).

## CI workflows

The repository is public, so GitHub-hosted runners are free. Nothing here uses a paid
service, a scheduled trigger, a signing secret, or an external API. Artifacts are
uploaded on failure only, with short retention.

### `.github/workflows/ci.yml` (name `CI`)

Triggers: push to any branch, and pull requests. `concurrency` cancels an older run of the
same ref. Node 22 in every job.

| Job | Runner | Steps | Artifacts |
| --- | --- | --- | --- |
| `js` | ubuntu-latest | `npm ci`, `npm run typecheck`, `npm test`, `npm audit --omit=dev --audit-level=high` | none |
| `e2e` | macos-latest | `npm ci`, `npx playwright install --with-deps chromium` (Chromium only), `npm run e2e:mac` | on failure: `e2e-report` from `tests/e2e-mac/.cache/report*`, 7 days |
| `rust` | matrix macos-latest and windows-latest (`fail-fast: false`) | stable toolchain, `Swatinem/rust-cache@v2`, `cargo test` in `src-tauri` | none |
| `rust-audit` | ubuntu-latest, permissions `contents: read`, `checks: write` | `rustsec/audit-check@v2` on `src-tauri` | none (the launch record calls the resulting check "Security audit") |

Notes: Ubuntu is excluded from the `rust` matrix because Tauri's Linux build needs system
packages (webkit2gtk and others) that the workflow does not install. `e2e` runs on macOS
rather than Ubuntu because the suite is developed there and dates, fonts and locale are
the things a Linux runner would quietly disagree about. `e2e` was added by the launch
assurance round (finding F-LA-1: before it, the largest suite in the repo ran on nobody's
CI). `npm audit --omit=dev` covers production dependencies only; the dev-only esbuild
advisory through `drizzle-kit` is left alone by decision. No scheduled audit run exists:
on a scheduled trigger `rustsec/audit-check` opens GitHub issues, and the owner does not
manage GitHub (decision LR-5). Consequence: an advisory against an unchanged dependency
is not caught until the next push.

### `.github/workflows/e2e-win.yml` (name `e2e-win`)

Triggers: `workflow_dispatch`, pull requests, push to `main` and to `e2e-win/**`.
`windows-latest`, `timeout-minutes: 45`. Steps: checkout, Node 22, stable Rust, rust-cache,
`npm ci`, `npm run build`, `npx tauri build --debug --no-bundle`, install `tauri-driver`,
resolve the matching `msedgedriver`, install WebdriverIO with `--no-save`, print versions,
run the suite de-elevated (see above), print the app log. On failure: upload
`tests/e2e-win/.output/**` as `e2e-win-output`, 3 days.

### `.github/workflows/release.yml` (name `Release`)

Trigger: a pushed tag matching `v*`. `permissions: contents: write`. Matrix (fail-fast
false): macOS arm64 (`--target aarch64-apple-darwin`), macOS x86_64 (`--target
x86_64-apple-darwin`), Windows. Steps: checkout, Node 22, stable Rust with the target,
rust-cache, `npm ci`, `tauri-apps/tauri-action@v0` with `tagName`, `releaseName "Helix CRM
<tag>"`, `releaseDraft: true`, `prerelease: false` and a body naming the unsigned-build
steps. No signing secrets are referenced. Output: a DRAFT GitHub Release with `.dmg`,
`.msi` and `.exe` assets. It does not publish itself.

## The release procedure

Owned by the director (Walker's coordinator), not by workers. Source:
`docs/OPERATIONS.md` "Cut and ship a release, end to end" and the top of
`tests/RELEASE-CHECKLIST.md`.

1. Bump the version to X.Y.Z in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`, plus the lock files `package-lock.json` (two places) and
   `src-tauri/Cargo.lock` (the `helix-crm` package). The 0.2.0 bump commit (941ca78)
   touched exactly those five files plus `CHANGELOG.md`. Tauri reads its own
   `tauri.conf.json`; a mismatch makes the installer and Diagnostics' "This copy of Helix"
   row disagree. How the lock files were regenerated is not documented in the repo
   (unverified).
2. Turn `CHANGELOG.md`'s Unreleased section into the version heading.
3. Confirm `main` is green at the commit to tag: `js`, `e2e`, `rust` (both OSes) and
   `rust-audit` in GitHub Actions; `e2e-win` green or knowingly waived.
4. Run `tests/RELEASE-CHECKLIST.md` on both macOS and Windows.
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. This starts `release.yml`
   (three legs).
6. When all three legs finish, open the repository's Releases page and publish the draft.
7. Tell each affected client the version is out and, if it matters, what changed.

History: v0.1.0 (2026-09-18) is tagged on `e8e7650`; v0.2.0 tagged on 2e035c6 after CI was
green on that commit (js, rust macOS and Windows, e2e, Security audit, rust-audit; e2e-win).
Nothing enforces "a bump was followed by a tag" or "a tag was followed by publishing the
draft" (`docs/OPERATIONS.md` finding F-OPS-W3-5).

## The hand checklist (`tests/RELEASE-CHECKLIST.md`)

Run on a machine or OS account that has never run Helix. Sections, in order: Before you
tag; Setup; First launch (Gatekeeper right-click Open or SmartScreen; workspace created
and the three-screen setup shown; recovery-key card first on Today until confirmed); Keychain
and secrets (prompt on entering a token; survives quit and relaunch; macOS reprompts after
each unsigned rebuild, expected); Site connection and lead poll (use `tools/fake-site`,
token `dev-token`, wrong token shows the banner); Backup and restore (new `.db` appears;
restore dialog names both dates; the change made after the backup is gone); Workspace switch
(data isolation, only the open workspace polls); Attachments (generated name on disk,
thumbnail, over 50 MB refused); Export (save dialog, file exists and opens);
Product-expansion screens (Payments partial then paid, undo within 10 s, statement totals;
Schedule visit on the right day and time, `.ics` opens in the real calendar app and a second
export REPLACES the entry, a time change in Helix does not move an exported entry; Automations
two on and one off, fires once, reword, off means nothing; Sources report counts add up);
Opener actions (phone, mail, maps); Appearance (light/dark, density); Window behavior (minimum
1024x700, quit and relaunch keeps everything); Windows: what is covered and what is not (a
hand list of everything unautomated on Windows). Honest statement in the file: "Helix is
verified on macOS and smoke-tested on Windows."

Operating conditions from the launch record that bear on verification (owner Walker):
C1 real app on a never-run Mac with Keychain "Always Allow"; C2 recovery-key Copy and Print
on the real webview; C3 Windows smoke-tested only, so onboard Mac clients first or run the
Windows checklist section; C4 the new CI `e2e` job green on the first push (cleared at
2e035c6); C5 second backup folder is an install-day step; C6 unsigned installers; C7 do not
reopen a removed workspace (F-LA-7 deferred); C8 token hand-over by hand; C9 keep the client
roster (no telemetry).

## Known flakes and their fixes

- `tests/repo/data/purgeSweep.test.ts` failed every evening in the Americas (commit
  3948a8e). The 31-day cases backdated relative to `Date.now()`; once local time lags UTC by a
  calendar day, now minus 31 days lands on the cutoff's own UTC day after 00:00Z, so the row
  is not older than the cutoff and the sweep correctly leaves it. Backdating is now
  relative to `trash.purgeCutoffIso()`, the value the sweep compares against.
- The records screen-capture walk in `tests/e2e-mac/specs/records.e2e.ts` hit the 60 s test
  timeout on GitHub's macOS runner in the first CI `e2e` run (commit fd73b6b). It now calls
  `test.slow()` (triples the timeout). The same commit widened one toast expectation in
  `la-w1.e2e.ts` (J3, "Checked your website. Nothing new.") to 20 s after it passed only on
  retry. No assertion changed.
- Not fixed, observed in this pass: `shellFooter.test.ts` and `shellQuickAdd.test.ts` can time
  out their `getByRole` lookups when the machine is busy (see Current counts).
- CI mitigation: `retries: 1` for e2e-mac when `CI` is set, so a single retry-green test
  is reported but does not fail the job. Do not add retries to hide a real failure.

## Rules for verification work

From `CONTRIBUTING.md` and the launch record's standing rules: `npm run typecheck` and
`npx vitest run` before any commit; `cargo test` when Rust changed; `npm run build`;
e2e for the area touched on a unique `E2E_PORT` and `E2E_OUT`; never weaken a test to
make it pass; no skips or `.only`; mutation-check new guards (show the new test fails on
the old code); report checks actually run with the revision tested, and distinguish
existing failures from new ones.

Verified against: `tests/README.md`, `tests/RELEASE-CHECKLIST.md`, `tests/e2e-win/README.md`,
`.github/workflows/ci.yml`, `.github/workflows/e2e-win.yml`, `.github/workflows/release.yml`,
`vitest.config.ts`, `tests/e2e-mac/playwright.config.ts`, `tests/e2e-mac/fixtures.ts`,
`package.json` scripts, `docs/OPERATIONS.md` "Cut and ship a release", the launch record
sections 5 and 6, `git show 3948a8e`, `git show fd73b6b`, `git show 941ca78`, and commands run
on 2026-09-28: `npx vitest run` (2,798 passed, 4 failed under load, 3 skipped; the two failing
files rerun alone 8/8), `cargo test` (125 passed), `npx playwright test --list` (202 tests, 25
files), `npm run typecheck` (clean).
