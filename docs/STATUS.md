# Helix CRM build status

Agents append dated entries here. Newest at the bottom.

---

## 2026-09-18 — Foundations (Rust) agent

### Did

**`src-tauri/Cargo.toml`** — pinned to versions that resolve on crates.io today:
tauri 2.11.5 (feature `protocol-asset`, required by the asset-protocol scope),
tauri-plugin-fs 2.5.2, -dialog 2.7.3, -opener 2.5.5, -log 2.9.1, -http 2.6.1,
-single-instance 2.4.4 (behind a `cfg(not(android|ios))` target block),
rusqlite 0.40.2 `bundled` (SQLite 3.x via libsqlite3-sys 0.38.2),
keyring 3.6.3 `apple-native,windows-native`, reqwest 0.12.28 with
`default-features = false, features = ["rustls-tls","json"]`, serde, serde_json,
thiserror 2, base64 0.23, mime_guess 2, uuid 1.26 `v7`, tempfile 3 as a dev-dep.
reqwest is deliberately held at 0.12 rather than 0.13: that is the version
tauri-plugin-http already links, so only one copy of reqwest compiles. (0.13
also renamed the feature `rustls-tls` to `rustls`.)

**`src-tauri/src/db.rs`** — the database pipe, with the state-machine diagram in
the module header. `Mutex<Option<Connection>>` plus a separate `backup_guard`.
All ten commands are `#[tauri::command(async)]`. Structured as a plain `Db`
struct with the commands as thin wrappers, so the pipe is testable without a
Tauri app.
- `db_open` creates parent dirs, closes any previous connection first, sets
  `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- `db_close` is idempotent: rolls back any open transaction, runs
  `PRAGMA wal_checkpoint(TRUNCATE)`, drops the connection.
- `db_query` returns rows as arrays in select order. NULL→null, INTEGER→number,
  REAL→number, TEXT→string, BLOB→array of bytes. Params accept
  null/number/string/bool (binds 0/1)/byte array, and also an object keyed by
  index, because a `Uint8Array` that gets JSON-stringified on the way through
  IPC arrives in that shape.
- `db_batch` uses BEGIN..COMMIT in autocommit and a uniquely named
  SAVEPOINT..RELEASE inside an open transaction; on error it unwinds only its
  own work and reports which statement number failed.
- `db_backup` opens a second `SQLITE_OPEN_READ_ONLY` connection, `VACUUM INTO`
  a `.tmp`, then renames. `db_close` and `db_open` take `backup_guard` first, so
  a close always waits for an in-flight backup. Lock order is always
  backup_guard → state.
- `db_info` reports path, size, `sqlite_compileoption_used('ENABLE_FTS5')` and
  `sqlite_version()`.

**`src-tauri/src/secrets.rs`** — `secret_set/get/delete` over keyring, service
`helix`, user `<workspaceId>:<kind>`. A missing entry reads back as `null`
rather than an error; deleting a missing entry succeeds. No plaintext fallback.

**`src-tauri/src/leads.rs`** — `leads_fetch(cursor, limit)`. Reads
`settings.site_origin` (a JSON string) from the open connection, derives the
workspace id from the open DB path, reads the `site` secret, GETs
`<origin>/api/crm/leads` with `Authorization: Bearer`, 15 s timeout, limit
clamped to 1..=200. Origin must be `https://` or `http://` on `127.0.0.1` /
`localhost`. Non-2xx → `HTTP_STATUS` with the status in the message; everything
else → `NET_ERROR`.

**`src-tauri/src/files.rs`** — `copy_in(src)` copies into
`<workspaceDir>/attachments/<uuidv7>.<ext>` (destination chosen in Rust),
refuses > 50 MB with `IO_ERROR`, returns `{ storedName, bytes, mime }`.
`app_paths()` returns `{ appData, workspacesDir }` from `app_data_dir`.

**`src-tauri/src/error.rs`** — one `AppError { code, message }` serialising
exactly the codes in CONTRACTS.md.

**`src-tauri/src/lib.rs`** — registers single-instance first (focuses the
existing `main` window), then fs, dialog, opener, http. The log plugin is
registered in `setup()` where the app data path can be resolved: rotating file
at `<appData>/logs/helix.log`, `KeepSome(7)`, 4 MB per file, plus a launch-time
sweep of log files older than 7 days.

**`src-tauri/tauri.conf.json`** — window `main` 1280x820, minWidth 1024,
minHeight 700; CSP exactly as specified; asset protocol enabled and scoped to
`$APPDATA/workspaces/**/attachments/**`.

**`src-tauri/capabilities/default.json`** — fs limited to `$APPDATA` recursive
(dialog-selected paths are added to the fs scope at runtime by the dialog
plugin); dialog open/save; opener `open-url` restricted to https/mailto/tel/sms
and `open-path` to `$APPDATA/workspaces/**`; http scoped to
`https://api.anthropic.com/*` only; log. `opener:default` is deliberately NOT
used because it also allows plain `http://*`.

**`src-tauri/tests/db_tests.rs`** — 10 integration tests against the `Db`
struct in a temp dir. **`.github/workflows/ci.yml`** — `js` on ubuntu (npm ci,
typecheck, test) and `rust` matrix macOS + Windows (`cargo test` in src-tauri,
debug only). **`.github/workflows/release.yml`** — on tag `v*`, tauri-action
matrix macOS aarch64 + x86_64 and Windows, unsigned, uploading to a draft
release.

### Verified

```
$ cd src-tauri && cargo build
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.83s

$ cargo test
     Running unittests src/lib.rs
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
     Running unittests src/main.rs
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
     Running tests/db_tests.rs
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
   Doc-tests helix_crm_lib
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

$ cargo clippy --all-targets
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.75s
    (no warnings, no errors)
```

The 10 db tests: query/execute round trip with full type mapping and select
order; batch commits with the summed change count; batch rolls back atomically
on a mid-batch error leaving nothing and returning to autocommit; batch inside
an open transaction uses a savepoint and the outer transaction survives, stays
writable and commits; begin/commit/rollback state errors; backup writes a valid
DB that a second `Db` can open and read, leaves no `.tmp`, and a concurrent
`close` waits for it; DB_CLOSED from every command after close and before first
open; FTS5 reported by `db_info` and exercised with a real `MATCH`; open twice
switches files without losing committed data; WAL and foreign_keys applied on
open. Plus 12 unit tests covering timestamp formatting, backup reason slugging,
param conversion, origin validation, workspace-id derivation, settings-value
parsing, attachment extension safety, the 50 MB refusal and the mime guess.

Two behaviours were confirmed against SQLite directly before relying on them: a
bound parameter is accepted in `VACUUM INTO ?1`, and `VACUUM INTO` works on a
read-only connection and sees WAL-committed rows.

### Not done

- No macOS keychain round-trip test. `keyring` hits the real login keychain,
  which prompts and pollutes the developer's keychain, and CI runners have no
  unlocked keychain. `secrets.rs` is covered only by a validation test. Needs a
  manual check on first run.
- No `leads_fetch` test against a live endpoint: `tools/fake-site` is another
  agent's deliverable. Only the pure helpers (origin validation, workspace-id
  derivation, settings parsing) are tested.
- `cargo build` only. Never ran `npm run tauri dev` or a release build, so the
  app has not been launched and the capability set has not been exercised at
  runtime — only validated at build time by `tauri-build`.
- CI is unrun: the workflows have not executed on GitHub yet. The Windows
  `cargo test` leg in particular is unproven.
- Ubuntu is excluded from the CI rust matrix (no Tauri Linux system deps).

### Contract changes needed

None blocking. Four interpretations to confirm, each a place CONTRACTS.md was
silent rather than contradicted:

1. **`db_rollback` outside a transaction returns `TX_STATE`.** The contract
   annotates `db_begin` and `db_commit` with TX_STATE but leaves `db_rollback`
   bare. Rolling back with nothing open is now an error, matching SQLite. If the
   TS write lock calls `rollback()` defensively in a `catch`, it must tolerate
   TX_STATE or check first.
2. **Backup file names use dashes in the time**, `2026-09-18T19-05-03Z-<reason>.db`,
   not `19:05:03`. Windows rejects `:` in file names, so a literal ISO timestamp
   was not possible. The reason is also slugged, and a same-second collision
   gets a `-2` suffix.
3. **`leads_fetch` omits `after` entirely when the cursor is null** rather than
   sending `after=`. `tools/fake-site` and the ClearPath template endpoint
   should treat a missing `after` as "from the beginning".
4. **`db_info.sizeBytes` is the main DB file plus its `-wal` file.** Before a
   checkpoint most of a busy workspace lives in the WAL, and the Diagnostics
   screen showing a near-empty number would be misleading.

One implementation note for whoever builds `src/db/client.ts`: `db_open`
returns the path absolutised but **not** canonicalised. On Windows
`canonicalize` produces a `\\?\C:\...` extended-length path, which would leak
into Diagnostics and stop matching the path the frontend passed in.

---

## 2026-09-18 — Integration agent (site endpoint, fake site, import tool, test harnesses)

### Did

**ClearPath site endpoint.** `GET /api/crm/leads` added to the
`landscaping-classic` template (its own repo, commit `a4aeec0`). One new block in
`server/routes.ts` and nothing else — the schema, the storage layer and the public
form are untouched, so the diff ports to the other seventeen templates unchanged.
Bearer token from `CRM_API_TOKEN` compared in constant time through SHA-256
digests; a missing header, a wrong token and an unset env var all answer the same
401. Oldest-first on `(created_at, id)`, opaque `base64url("<ISO>|<id>")` cursor
resolved as `created_at > X OR (created_at = X AND id > Y)`; an absent or empty
`after` starts from the beginning; `limit` defaults to 100 and caps at 200;
`nextCursor` is null on a short page. 60 requests a minute per token, keyed on a
digest of the presented token so a wrong token is throttled too. The response
carries exactly the eight contract fields — the address, preferred visit, status,
owner's notes and source stay in the admin, and `pageUrl` is null because no
template has a page-attribution column. `CRM_API_TOKEN` is documented in that
template's `TEMPLATE.md` (its own section) and `.env.example`. The other seventeen
templates were not touched; the recipe for them is
`ClearPath Sites/templates/CRM-ENDPOINT-PORT.md` (the diff, the per-template
`toCrmLead` mapping table, the env var, the gates, the commit line, and the five
mistakes that are easy to make).

**`tools/fake-site/`** — zero-dependency Node server on 4711 implementing the same
contract from an in-memory list, plus `POST /api/leads` taking the ClearPath quote
form's JSON so leads can be added by curl. Token from `FAKE_SITE_TOKEN` (default
`dev-token`), `--seed N` for realistic Utah trade leads including a deliberate
timestamp tie, `--slow` (5 s) and `--fail` (500) for poller testing, loopback-only
bind, clean SIGINT. README with a curl for every endpoint.

**`tools/import-clearpath-crm.mjs`** — reads Walker's `crm/data/prospects.json`
read-only and writes `tests/fixtures/clearpath-prospects.csv` (19 rows) with the
thirteen Helix import columns. Statuses map to the default stages, the original
status rides along in `Tags` (with `clearpath` and the niche), `gap` + `notes` +
the second contact + the site and Yelp links go into `Notes`, source `Import`,
title `<Business> website`, value 1500, `contact.name` split into first and last.

**`tests/fixtures/`** — five vendor exports with the real header rows (HubSpot 52,
Zoho 47, Pipedrive 58, Google Contacts 44, Excel save-as 41 rows) of invented Utah
trade businesses, with mixed phone formats, blank cells, quoted commas, escaped
quotes, non-ASCII names, a 47-character company name, Excel's two phantom trailing
columns, and six people duplicated across three or four files by email.
`malformed/` has bom, crlf, semicolon, ragged and empty-with-headers, plus
`gen-100k.mjs` (streaming, backpressure-aware, output gitignored). README documents
every file.

**`tests/e2e-mac/`** — `playwright.config.ts` (webServer `VITE_E2E=1 npx vite
preview --port 4173`, one chromium project, specs matched as `*.e2e.ts` so Vitest
never collects them) and `fixtures.ts`, which binds `window.__helixDb` to
better-sqlite3 in a per-test temp workspace with the Rust pipe's semantics
(rows as arrays, batch as BEGIN/COMMIT in autocommit and SAVEPOINT/RELEASE inside a
transaction, VACUUM INTO a `.tmp` then rename, `TX_STATE`/`DB_CLOSED` codes) and
installs a `__TAURI_INTERNALS__` invoke shim for `plugin:dialog|*`, `plugin:fs|*`,
`plugin:opener|*`, `plugin:log|*`, `secret_*`, `leads_fetch`, `copy_in` and
`app_paths`, steerable and readable from `window.__helixE2E`. Method names match
`src/db/drivers/e2e.ts` exactly. One smoke spec.

**`tests/e2e-win/`** — `wdio.conf.ts` (tauri-driver spawned in `onPrepare` and only
that child killed in `onComplete`, `maxInstances: 1`, `browserName: "wry"`,
failure screenshots), `scripts/match-msedgedriver.ps1` (reads the WebView2 version
from HKLM then HKCU then the install directory, downloads the matching driver,
falls back to the major version's UTF-16 pointer file, caches by version, writes
`GITHUB_OUTPUT`), a smoke spec, a README, and
`.github/workflows/e2e-win.yml` building the debug app on windows-latest.

**`tests/README.md`** — the ASCII test-setup diagram and, for each suite, what it
can and cannot verify, plus the port table.

### Verified

```
$ npm test
 Test Files  6 passed (6)
      Tests  124 passed (124)      # includes the 26 new tests/unit/fixtures.test.ts

$ npx tsc --noEmit
(silent, exit 0)

$ npx playwright test --list -c tests/e2e-mac/playwright.config.ts
  [chromium] › smoke.e2e.ts:15:3 › boot › the app boots and the sidebar shows Today
  [chromium] › smoke.e2e.ts:40:3 › boot › the database bridge answers the contract's methods
  Total: 2 tests in 1 file
```

Template gates, in `ClearPath Sites/templates/landscaping-classic`:

```
$ npx tsc --noEmit          -> exit 0
$ npm run config:check      -> OK: Sorensen Landscaping (DEMO business, fictional)
$ npx tsx server/__tests__/crm-leads.test.ts
  18 passed, 0 failed
```

Template smoked live on port 3900 against the JSON file store (server started and
stopped by this agent, `data/leads.json` removed afterwards, tree clean): no token
401, wrong token 401, junk cursor 400, three curl-posted leads accepted, paging at
`limit=4` returned 4 + 4 + 2 ids with no repeat and `nextCursor` null on the short
page, and request 61 in a minute returned 429.

Fake site, on 4711 (started and stopped by this agent, port free afterwards):

```
no token 401 · wrong token 401 · junk cursor 400 · unknown path 404
seeded 25, paged at limit=7 -> 7, 7, 7, 4 leads; 25 unique ids; paged order
  identical to the full listing; the tie pair (2026-09-11T11:21:20.434Z, two ids)
  came back whole
no `after` parameter and `after=` both start at the oldest lead
POST /api/leads -> 201, the lead comes back at the end of the list
requests 1-60 all 200, request 61 -> 429 with Retry-After: 60, window reopens
--slow -> 5.003 s · --fail -> 500 · FAKE_SITE_TOKEN honoured
```

Import tool: `19 rows -> tests/fixtures/clearpath-prospects.csv`, stages
`New 10, Lost 9`; papaparse reads it with 0 errors, 19 rows, 13 fields, `\r\n`
line breaks. `prospects.json` was opened read-only and is unchanged.

Fixtures: all five vendor exports parse with 0 papaparse errors and uniform row
widths; `ragged.csv` produces the TooFewFields/TooManyFields errors it exists for;
`gen-100k.mjs` wrote 2,000 rows to a scratch path in 6 ms and was deleted.

### Not done

- Neither e2e suite has been run. The app does not build into `dist/` yet, so
  e2e-mac can only be listed, and e2e-win needs Windows — its config, driver
  script and workflow are unexercised, and its selectors (`nav`, `aria/Today`,
  `h1*=Today`) are guesses that will need fixing against the real shell.
- The other seventeen ClearPath templates do not have the endpoint. They need the
  port doc applied, one commit each; `restaurant-*`, `wedding-venue-*` and
  `church-*` need a different `toCrmLead` because their lead tables use
  `eventType` / `kind` instead of `service`.
- No test runs against a real Postgres: the template smoke used its JSON file
  store, and the handler tests use a stub, so the Drizzle path is unproven.
- `tests/RELEASE-CHECKLIST.md` (referenced from PLAN.md and tests/README.md) is
  not written.
- The 100k-row fixture is generated on demand and is not committed; nothing has
  yet imported it end to end.

### Contract changes needed

None. Two things worth recording, both already reflected above: the response `id`
is a string (the template's column is a serial integer, stringified, so
`leads_fetch`'s `Lead.id: string` deserialises), and the template pages in memory
over `storage.listLeads()` rather than pushing the cursor into SQL — deliberate,
to keep the port to a single file, and documented as the thing to revisit if a
site ever holds thousands of leads.

---

## 2026-09-18 — Foundations (TypeScript) agent

### Did

**Schema and migrations**
- `src/db/schema.ts`: every table in the plan's data model as Drizzle SQLite tables —
  contacts, contact_phones, contact_emails, companies, pipelines, stages, deals,
  deal_stage_events, activities, tasks, tags, tag_links, custom_fields, custom_values,
  attachments, sources, saved_views, settings, lead_sync, schema_migrations, change_log,
  plus a `merges` table the merge-reversal history needs. Every entity table carries
  `id TEXT PRIMARY KEY` (UUID v7), `created_at`, `updated_at`, `deleted_at`. Cascades and
  SET NULLs exactly as the plan states; stage references are RESTRICT so a stage cannot be
  deleted out from under a deal (the repository raises StageInUseError first). Every index
  the Performance section names, plus `(stage_id, position)` for the board.
- `drizzle.config.ts` + `npm run drizzle:generate` → `drizzle/0000_init.sql` and
  `drizzle/meta/_journal.json`. Re-running it reports "No schema changes".
- `drizzle/0001_search.sql`, hand-written and registered in the journal as a custom
  migration: `search_docs` with an INTEGER PRIMARY KEY rowid, `search_index` as FTS5
  external content over `search_docs.text` with
  `tokenize='unicode61 remove_diacritics 2'`, the three standard content-sync triggers,
  and rebuild triggers on contacts, contact_phones, contact_emails, companies, deals and
  activities. Each rebuild deletes the entity's row and re-inserts it only
  `WHERE deleted_at IS NULL`, so soft delete removes it from search and restore brings it
  back with no repository code involved. A contact's text is name + company name + every
  phone (raw and e164) + every email + notes. Changing a company name also rebuilds that
  company's contacts.

**The database layer**
- `src/db/client.ts`: the `raw` RawDriver facade, `setDriver`, the production driver over
  `@tauri-apps/api` invoke (command names and shapes straight from CONTRACTS), typed
  errors (DbError, DbClosedError, DbOpenError, Fts5MissingError), and `db` as a Drizzle
  sqlite-proxy whose callback maps run/all/values/get correctly. A Drizzle batch of pure
  writes goes out as one `db_batch`; a mixed batch falls back to sequential calls.
- `src/db/drivers/e2e.ts`: the driver over `window.__helixDb`, matching the ten methods
  the Playwright harness in `tests/e2e-mac/fixtures.ts` binds, so the app boots in a plain
  browser.
- `src/db/migrator.ts`: journal-driven exactly as the plan describes — backup via
  `raw.backup("pre-migration")` only when something is pending, `PRAGMA foreign_keys=OFF`
  outside any transaction, split on `--> statement-breakpoint`, the
  `INSERT INTO schema_migrations` appended as the last statement of the same `db_batch`,
  then `foreign_key_check` and `foreign_keys=ON`. SQL is bundled via Vite `?raw` in the
  app and read from disk in tests (`diskMigrationSource`). Comment-only chunks are dropped
  because SQLite cannot prepare them.
- `src/db/writeLock.ts` (`withWrite`, `withTransaction`, `pauseTimers`, `writeState`) and
  `src/db/changeLog.ts` (`logChange`, `logChanges`, `listBatch`, `undoBatch`).
- `src/db/errors.ts`: the named errors from the plan's rescue map.

**Repositories** (`src/db/repos/`, every write through `withWrite`, every write logged to
change_log with actor_id "owner", every join column aliased, no `SELECT *`)
contacts (phones/emails as child rows, dedupe warning on email_lower then e164, no unique
constraints), companies, deals (stage moves write deal_stage_events and stage_entered_at,
position within stage, won/lost from stage flags, reopen, gone-quiet), stages (reorder,
delete requires a target stage), pipelines, activities (system entries immutable), tasks
(snooze, complete, uncomplete), tags + tag links, customFields + custom values,
attachments (rows only), sources, savedViews, settings (typed get/set over zod, vocabulary
key), leadSync (opaque cursor, stored verbatim), search, trash (list, restore, purge in the
plan's order), merge (contacts and companies, field picks, system activity, batch id,
reversal including the refused case), seed (one pipeline with New/Contacted/Quoted/
Scheduled/Won/Lost and the four sources, idempotent).

**Helpers** `src/lib/`: ids (UUID v7), phone (libphonenumber-js, `{raw, e164|null}`, never
rejects), email, dates (local-time `todayLocal`, the plan's overdue rule), money (integer
cents both ways).

**App shell** `src/app/`: feature.ts (FeatureModule), registry.ts (all six features),
boot.ts (app_paths → helix.json registry → first workspace → `raw.open` → FTS5 check →
migrate → seed → clear the TanStack Query cache; `switchWorkspace` reruns it), Shell.tsx
(wouter, sidebar from the registry in contract order, topbar with a search trigger, sonner
toaster, theme and density attributes on `<html>`), CommandPalette.tsx (cmdk, fed by the
registry), queryClient.ts (with shared query keys), vocabulary.ts (`useVocabulary`),
appSettings.ts (helix.json: workspaces, lastOpened, theme, density), hooks.ts
(`useWriteState`, `useAppearance`, `useShortcut`), BootScreens.tsx (DbOpenError,
Fts5MissingError, MigrationError full-screen states and the one top-level error boundary).

**UI primitives** `src/ui/`: Button, IconButton, Input, Textarea, Select, Checkbox, Switch,
Tabs, Dialog (+ConfirmDialog), DropdownMenu, Popover, Tooltip, Badge, Card, EmptyState,
Table, VirtualList, Field/FormRow/FieldSet, Kbd, toast, PageHeader, Sidebar/NavItem/Topbar,
Spinner, and a barrel. Tokens only — no hex, no Tailwind palette classes anywhere in
`src/ui` — keyboard accessible, 44 px targets.

**Feature stubs** `src/features/{records,today,data,leads,ai,settings}/index.tsx`, one
placeholder route each, nav items in the contract's order (Today 10 … Settings 90). Feature
agents replace these files and never touch the registry.

**Tests** `tests/repo/driver.ts` (better-sqlite3 behind RawDriver, with the pipe's savepoint
nesting, TX_STATE on a rollback outside a transaction, and `VACUUM INTO` backups),
`tests/repo/harness.ts` (fresh database, real migrator, optional seed), 13 repo suites and
7 unit suites.

### Verified

```
$ npm run typecheck
> tsc --noEmit
(no output)

$ npm test
 Test Files  20 passed (20)
      Tests  233 passed (233)
   Duration  2.48s

$ npx vite build
dist/index.html                     0.55 kB │ gzip:   0.34 kB
dist/assets/index-E3Edz6cc.css     30.48 kB │ gzip:   6.97 kB
dist/assets/index-C0o8d3OM.js     647.18 kB │ gzip: 188.87 kB
✓ built in 343ms

$ npm run drizzle:generate
No schema changes, nothing to migrate
```

Also checked by hand in a browser on port 1420 (dev server started and stopped by this
agent): with no Tauri runtime the app reaches the DbOpenError full-screen state, styled
from the design agent's tokens in dark mode — which proves the boot sequence, the error
screens, the token wiring and the Tailwind build all work end to end.

Three bugs were found by the tests and fixed in src:
- `deals.moveToStage` left a hole in the source stage's positions after a cross-stage move.
  Added `compactStage` and called it on the stage the deal left.
- `merge.reversalRefusal` compared `merges.at` with `>`, so two merges inside the same
  millisecond did not trigger the "survivor has been merged again" refusal. Ties now break
  on the id, which is UUID v7 and therefore in creation order.
- `deals.moveToStage` treated an explicit `outcomeReason: null` as "keep the old reason"
  in its validation but wrote null to the row. One effective-reason value now decides both.

### Not done

- `src/lib/csv.ts` is not written. CONTRACTS lists it under `src/lib`, but nothing in the
  foundations scope needed it; the data feature agent should write it in its own folder and
  report it for promotion.
- No repository function for reports. The plan wants them as SQL views over `deals` and
  `deal_stage_events`; the leads/reports agent should add the views in a new migration
  (`drizzle-kit generate --custom`) rather than aggregating in memory.
- No backup, duplicate-scan or lead-poll timers. `pauseTimers()` and the `onBoot` hook exist
  for whoever adds them; `runFeatureBoot()` already runs after the first paint.
- `tests/e2e-mac` and `tests/e2e-win` were not touched (another agent owns them). The e2e
  driver they need is in place and matches their bridge.
- `src-tauri`, `tools/`, `tests/fixtures`, `package.json` untouched, as scoped.

### Contract changes needed

None to the interfaces already in CONTRACTS. Four things the orchestrator should know:

1. **`src/styles/app.css` is new and belongs to foundations.** The design agent's
   `globals.css` does not `@import "tailwindcss"`, so no Tailwind utility was reaching the
   page and every `src/ui` component rendered unstyled. Rather than edit a file I do not
   own, `main.tsx` now imports `src/styles/app.css`, which declares the layer order,
   imports Tailwind, then imports `globals.css` **into the base layer** so the reset cannot
   out-rank a utility class (`* { margin: 0 }` unlayered would otherwise beat `mt-*`).
   `tokens.css` and `globals.css` remain the design agent's, untouched. If they would rather
   own the entry, they can move the two `@import` lines into `globals.css` and delete
   `app.css`.
2. **The write lock is not reentrant.** A repository write must never call another
   repository's write function: the inner call queues behind the outer one and both wait
   forever. Compose by building statements into one `raw.batch`, or wrap the whole thing in
   a single `withTransaction`. `writeLock.ts` now logs a named warning after ten seconds of
   waiting so the mistake shows up as a console line instead of a hang. Worth repeating to
   every feature agent.
3. **Repository functions feature agents will likely ask for, which I did not build:** CSV
   import writers (bulk `createStatements` exists on contacts only), export queries, report
   views, an attachment purge that also deletes files (the repository returns
   `trash.attachmentFilesFor()` so the caller can delete them through Rust first), and a
   contacts/companies "recently viewed" list. Deals cannot be imported from CSV in v1 by
   design.
4. **`merges` is a table the plan's data model does not list.** It carries the 30-day merge
   history the plan's item 15 requires (survivor, loser, batch_id, at, reversed_at). It is
   in `0000_init.sql`, so nothing downstream needs to change; noting it so the data model
   in PLAN.md and the schema do not silently disagree.
