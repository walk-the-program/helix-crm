# Contributing to Helix CRM

Helix is built by a small number of people working in parallel on separate
folders. The rules below exist so everyone can keep working without stepping
on someone else's code. Read `docs/PLAN.md` for what the product is and why,
and `docs/CONTRACTS.md` for the full interface contracts this file
summarizes.

## Repository layout

```
helix-crm/
  docs/                 PLAN.md, CONTRACTS.md, DESIGN.md, STATUS.md, ORCHESTRATION.md
  src-tauri/             Rust shell
    src/db.rs             the database pipe
    src/secrets.rs        keychain commands
    src/leads.rs          leads_fetch
    src/files.rs          copy_in
    capabilities/          permission JSON
  src/
    main.tsx              boot sequence
    app/                   shell: router, sidebar, registry, boot, query client
    db/                    client.ts (Drizzle over the pipe), schema.ts, migrator.ts,
                           writeLock.ts, changeLog.ts, repos/<entity>.ts
    lib/                   pure helpers: phone.ts, email.ts, csv.ts, dates.ts, ids.ts
    ui/                    shared components built on the design tokens
    styles/                tokens.css, globals.css
    features/
      records/             contacts, companies, deals, pipeline, timeline, tasks,
                           quick add, undo, trash
      today/                Today screen, search palette, saved views, one-tap
                           actions, gone-quiet
      data/                 CSV import, export, backup/restore, duplicates/merge,
                           attachments
      leads/                website lead poller, site settings, reports
      ai/                   the optional AI module
      settings/             settings screens, workspaces, diagnostics
  drizzle/                generated SQL migrations + meta/_journal.json
  tests/
    unit/                  Vitest, pure logic
    repo/                   Vitest against better-sqlite3 through the proxy callback
    e2e-mac/                Playwright + mockIPC
    e2e-win/                WebdriverIO + tauri-driver, Windows only
    fixtures/               CSV exports and malformed files
  tools/
    fake-site/              stands in for a ClearPath site's leads endpoint
    import-clearpath-crm.mjs
  .github/workflows/       ci.yml, e2e-win.yml, release.yml
```

## The rules that matter

**Repositories are the only place SQL lives.** One file per entity under
`src/db/repos/`. Screens and services never write SQL directly. A join must
alias every column: two tables can share a column name, and the database
driver returns rows as arrays, not objects, so an unaliased collision
silently returns the wrong value.

**The write lock is not reentrant.** Every repository write goes through
`withWrite()` (`src/db/writeLock.ts`), which queues concurrent writes. A
repository write function must never call another repository's write
function: the inner call queues behind the outer one, and both wait
forever. If you need several writes to happen together, build the SQL
statements yourself and send them as one `raw.batch()`, or wrap the whole
thing in a single `withTransaction()`.

**Tokens only.** `src/styles/tokens.css` is the only file allowed to contain
a hex, `rgb()`, or `hsl()` color. Everything else, including `src/ui` and
every feature, uses the CSS variables it defines, through Tailwind utilities
or `var(--token)` directly. If a component needs a color the tokens don't
have, add the token; don't hardcode one.

**Feature modules and the registry.** A feature agent or contributor edits
only its own `src/features/<area>/` folder, that folder's tests, and its
fixtures. A feature adds routes, sidebar items, and commands by exporting a
`FeatureModule` from its `index.tsx` (routes, nav, commands, an optional
`onBoot` and an optional `navProvider` for nav sections that depend on a
database read). `src/app/registry.ts` is the single shared file that imports
every feature. It's owned by the app shell, not by feature code: if you need
a new route or command, add it to your feature's `index.tsx`, not to the
registry.

Shared files are edited deliberately and reviewed, not casually:
`package.json`, `src/app/*`, `src/db/*`, `src/ui/*`, `src-tauri/*`,
`vite.config.ts`, `tsconfig*.json`, the Tailwind config, `drizzle/*`. If your
feature needs a new repository function or shared component, write it inside
your own feature folder first and note it for promotion, rather than editing
the shared file directly.

**Tests are required.** `npm run typecheck` and `npm test` must both pass
before any commit.

**No `git add -A`.** Stage only the files you actually changed, by name.
Commit messages are prefixed by area: `feat(records): ...`,
`feat(today): ...`, `chore(foundations): ...`, `design: ...`, `test: ...`.

**Never run `npm install <pkg>`.** Dependencies are installed up front and
reviewed as a group. If something is missing, say so rather than adding it
yourself.

**Never kill a process you didn't start.** Ports in use during development:
Vite dev server 1420, Vite preview (e2e-mac) 4173, `tools/fake-site` 4711,
tauri-driver (e2e-win) 4444.

## Running the tests

### Unit and repository tests (Vitest)

```sh
npm test
```

Runs `tests/unit` (pure functions: phone/email normalization, CSV parsing,
dedupe rules, the gone-quiet rule, export escaping, undo replay, migration
ordering) and `tests/repo` (every repository, the migrator, and the search
triggers, against a real `better-sqlite3` database through the same
sqlite-proxy callback production code uses) in one run.

### Typecheck

```sh
npm run typecheck
```

### macOS end-to-end (Playwright)

```sh
npm run e2e:mac
```

Runs the built frontend in Chromium with no Tauri runtime at all.
`tests/e2e-mac/fixtures.ts` stands in for the database and every Tauri
command. Several suites can run at once because the build output directory
and preview port are both overridable per run:

```sh
E2E_PORT=4182 E2E_OUT=dist-today npx playwright test \
  -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/today.e2e.ts
```

`E2E_PORT` picks the port `vite preview` serves on (default 4173);
`E2E_OUT` picks the build output directory (default `dist`), so one
person's build doesn't collide with another's. This suite cannot verify
anything that's actually Rust: the keychain, real file copies, the HTTP
client, a live backup connection, window behavior, the capability allowlist,
restore, or workspace switching. See `tests/README.md` for the full
breakdown of what each suite can and can't prove.

### Windows end-to-end (WebdriverIO + tauri-driver)

This suite drives the real compiled app through WebView2 and only runs on
Windows. There's no macOS or Linux equivalent of the WebView2 driver
pairing. It runs in CI on `windows-latest` (`.github/workflows/e2e-win.yml`)
and can be run locally on a Windows machine or VM:

```powershell
npm ci
npm run build
npx tauri build --debug --no-bundle
cargo install tauri-driver --locked
.\tests\e2e-win\scripts\match-msedgedriver.ps1
npm i --no-save --no-audit --no-fund webdriverio @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter @wdio/globals @wdio/types tsx
npx wdio run tests/e2e-win/wdio.conf.ts
```

The WebdriverIO toolchain is deliberately not in `package.json`: it only
runs on Windows, in this one suite, and `tests/e2e-win` is excluded from
`tsconfig.json`'s `include` so it doesn't affect `npm run typecheck` for
everyone else. See `tests/e2e-win/README.md` for the full explanation and
troubleshooting.

## Adding a migration

Schema changes go through Drizzle Kit:

```sh
npm run drizzle:generate
```

This reads `src/db/schema.ts`, compares it against the existing migrations,
and writes a new SQL file under `drizzle/` plus a matching entry in
`drizzle/meta/_journal.json`.

Anything Drizzle Kit can't generate on its own — the FTS5 search tables and
their triggers, or a set of SQL views like the reports migration — is a
**custom migration**, written by hand and registered the same way:

```sh
npx drizzle-kit generate --custom --name <name>
```

That command creates an empty SQL file and journal entry for you to fill in.
Follow the pattern in `drizzle/0001_search.sql` (the FTS5 migration) or
`drizzle/0002_report_views.sql` (the report views): one `.sql` file, one
journal entry, applied in order by the JS migrator.

Two tests read the journal rather than a hardcoded list, specifically so
adding a migration doesn't require editing them:
`tests/repo/migrations.test.ts` and `tests/repo/boot.test.ts` both call
`diskMigrationSource.list()` to get the current set of applied migrations.
If you add a migration and one of those tests fails, check that your new
file is actually registered in the journal. Don't edit the test's
expectations by hand.

## The unsigned-build Keychain prompt

Helix stores the site token and the AI key in the OS keychain, never in the
database or in `helix.json`. On macOS, an app's Keychain access is tied to
its code-signing identity. Because dev and release builds are unsigned in
v1, **every rebuild gets treated as a new, unrecognized app**, so macOS will
prompt for Keychain access again each time you rebuild and run the app
locally, even if you already granted it. Click Allow. This is expected
during development and goes away once builds are signed (see the changelog's
"Not in v1" list).

## Getting a fake site running

`tools/fake-site` implements the same `GET /api/crm/leads` contract a
ClearPath site does, so you can develop and test the lead poller without a
real site:

```sh
npm run fake-site -- --seed 25
```

See `tools/fake-site/README.md` for every endpoint and flag, including
`--slow` and `--fail` for testing the poller's timeout and error handling.
