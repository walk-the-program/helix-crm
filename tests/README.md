# How Helix CRM is tested

Four suites. Each one can prove something the others cannot, and each one has a
blind spot the next one covers. Nothing here tests a signed, notarised build on
a customer's machine — that is the pre-release checklist, by hand.

```
                         +---------------------------------+
                         |        Helix CRM (Tauri)        |
                         |  React + Drizzle  <-->  Rust    |
                         +----------------+----------------+
                                          |
       ------------------------------------------------------------------
       |                    |                     |                      |
+--------------+   +-----------------+   +------------------+   +------------------+
|  tests/unit  |   |   tests/repo    |   |  tests/e2e-mac   |   |  tests/e2e-win   |
|   (Vitest)   |   |    (Vitest)     |   |   (Playwright)   |   |  (WebdriverIO)   |
+--------------+   +-----------------+   +------------------+   +------------------+
| pure         |   | repos, migrator |   | the built UI in  |   | the real .exe,   |
| functions:   |   | over the SAME   |   | Chromium, no     |   | real WebView2,   |
| phone, email |   | sqlite-proxy    |   | Tauri runtime    |   | real Rust        |
| csv, dates   |   | callback as     |   |                  |   |                  |
| fixtures     |   | production      |   | window.__helixDb |   | tauri-driver +   |
|              |   |                 |   |  -> better-      |   | msedgedriver     |
|              |   | better-sqlite3  |   |     sqlite3      |   |                  |
|              |   | in a temp file  |   | invoke shim ->   |   | nothing stubbed  |
|              |   |                 |   |  stubs           |   |                  |
+--------------+   +-----------------+   +------------------+   +------------------+
| ms           |   | seconds         |   | ~a minute        |   | ~15 minutes      |
| every commit |   | every commit    |   | every commit     |   | CI on Windows    |
+--------------+   +-----------------+   +------------------+   +------------------+
                                                 |                       |
                                      tools/fake-site (port 4711)
                                      stands in for the ClearPath site
                                      for anything that polls for leads
```

## tests/unit — Vitest, `npm test`

Pure logic, no database, no DOM: phone and email normalisation, CSV parsing and
column-mapping guesses, dedupe rules, the gone-quiet rule, export escaping, undo
batch replay, migration ordering, cursor handling. `fixtures.test.ts` also holds
the CSV fixtures to their claims, so an edit cannot quietly make them tidy.

**Cannot verify:** anything involving SQL, the UI, or Tauri.

## tests/repo — Vitest, `npm test`

The repositories, the migrator and the search triggers, running against a real
`better-sqlite3` database through the same `sqlite-proxy` callback production
uses. `tests/repo/driver.ts` is the driver swap; `harness.ts` builds a fresh
database with every migration applied.

**Cannot verify:** that the Rust pipe behaves like better-sqlite3. The two are
held to the same contract (docs/CONTRACTS.md) and tested separately —
`src-tauri/tests/db_tests.rs` on the Rust side, this suite on the JS side.

## tests/e2e-mac — Playwright, `npm run e2e:mac`

The built frontend in Chromium with no Tauri runtime at all.
`tests/e2e-mac/fixtures.ts` supplies the other half:

- `window.__helixDb`, bound by `page.exposeFunction` to a better-sqlite3
  database in a per-test temp directory, with the Rust pipe's semantics (rows as
  arrays, `batch` as BEGIN/COMMIT in autocommit and SAVEPOINT/RELEASE inside a
  transaction, `backup` as VACUUM INTO a `.tmp` then a rename). `src/db/drivers/
  e2e.ts` forwards the app's driver to it.
- A `__TAURI_INTERNALS__`-compatible invoke shim for everything else:
  `plugin:dialog|*`, `plugin:fs|*`, `plugin:opener|*`, `plugin:log|*`,
  `secret_*`, `leads_fetch`, `copy_in`, `app_paths`. A test steers them through
  `window.__helixE2E` (queue a dialog path, set what `leads_fetch` returns, read
  back what the app opened) and every invoke is recorded for assertions.

It serves `VITE_E2E=1 npx vite preview --port 4173`, so **`npm run build` has to
have run first**. Specs are `*.e2e.ts`, never `*.spec.ts`, because Vitest's
default glob would otherwise collect them.

**Cannot verify:** anything that is actually Rust — the keychain, the real file
copy, the HTTP client, a backup on a live connection, window behaviour, the
capability allowlist, restore, workspace switching. A passing run means the UI
and the SQL are right, not that the app works.

## tests/e2e-win — WebdriverIO + tauri-driver, CI only

The real compiled app on `windows-latest`: `tauri-driver` proxying WebDriver to
`msedgedriver`, which drives the WebView2 control the app renders into. Nothing
is stubbed. `scripts/match-msedgedriver.ps1` reads the installed WebView2
version and downloads the driver that matches it — they must match or the
session never starts. `.github/workflows/e2e-win.yml` builds the debug app and
runs the suite.

This is the only suite that proves the Rust commands, the capability set and a
real window. It **cannot run on macOS**: WebView2 is a Windows component. See
`tests/e2e-win/README.md`.

**Cannot verify:** macOS-specific behaviour, and anything about a signed build.

## tools/fake-site

`npm run fake-site -- --seed 25` starts a zero-dependency Node server on port
4711 that implements the ClearPath site's `GET /api/crm/leads` contract from an
in-memory list, plus a `POST /api/leads` so a developer can add leads by curl.
`--slow` and `--fail` exercise the poller's timeout and error paths. See
`tools/fake-site/README.md`.

## Fixtures

`tests/fixtures/` holds the five vendor exports (HubSpot, Zoho, Pipedrive,
Google Contacts, Excel) and `malformed/` (BOM, CRLF, semicolons, ragged rows,
headers with no rows, and a generator for a 100k-row file). See
`tests/fixtures/README.md`.

## Ports, and not killing other people's processes

| Port | What |
|------|------|
| 1420 | Vite dev server (`npm run dev`) |
| 4173 | Vite preview, used by e2e-mac |
| 4444 | tauri-driver, used by e2e-win |
| 4711 | tools/fake-site |

Never `pkill`. Kill only a PID you started yourself.

## What is still by hand

`tests/RELEASE-CHECKLIST.md` (not written yet) covers the macOS real-app checks
that no suite here can make: first launch on a machine that has never run Helix,
the right-click-open gatekeeper dance on an unsigned build, the keychain prompt,
restore from backup, and switching workspaces.
