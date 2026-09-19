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

---

## 2026-09-18 — Design agent

Scope touched: `docs/DESIGN.md`, `src/styles/tokens.css`, `src/styles/globals.css`,
`design/**`. Nothing else.

### Did

**`design/research.md`** — the evidence the direction rests on, cited. Who the owner is,
what he scans for, what the literature says about his eyes (16 px floor, 7:1 preferred for
older readers, pale blue loses apparent contrast as the lens yellows) and about why he
would quit (36% of CRM users abandon over complexity; 23% name manual data entry; poor
adoption is the leading cause of CRM failure). Three reference patterns described in words
— the ledger, the day list, the record with a fixed identity block — with what each
contributes and what we reject from it. The two-sentence test from PLAN.md applied screen
by screen in a table.

**`docs/DESIGN.md`** — the direction contract. Audience, eight principles, hierarchy law,
the type scale on the system stack, the colour system in both themes, spacing/radius/
elevation, density, motion, component rules for buttons, inputs, tables, cards, badges,
empty states, dialogs, toasts and the status bar, iconography, a do/don't list, and a
rationale section naming what was rejected and why.

The direction, in one line: **paper-white panels on a cool grey canvas, ink-dark text at
16 px, one saturated equipment orange that only ever means "this needs you", and a cool
stage ramp that never borrows the accent's hue.**

**`src/styles/tokens.css`** — every variable in CONTRACTS.md for `:root`,
`[data-theme="dark"]` and `[data-density="compact"]`, plus additions (never renames):
`--color-sidebar`, `--color-hover`, `--color-selected`, `--color-overlay`,
`--color-accent-ink`, `--color-danger-ink`, `--color-success-ink`, `--color-warning-ink`,
`--stage-1-soft` … `--stage-8-soft`, `--control-h`, `--control-h-sm`, `--content-max`,
`--focus-ring-w`, `--dur-fast/base/slow`, `--ease-out`, `--ease-in-out`. Every text/
background pair the product can produce is stated in a comment with its measured ratio.

The stage ramp was solved numerically, not picked: hues held out of the 5–100° warm band
the accent owns, lightness and chroma chosen to maximise the worst pairwise CIE Lab ΔE
across normal, protanope, deuteranope and tritanope simulation (Viénot 1999). Worst case
over all 28 pairs and all four vision types is **ΔE 11.1**. Every value clears 3:1 against
both canvases, so the ramp is shared by the light and dark themes.

**`src/styles/globals.css`** — reset, base typography, the focus ring on `--color-focus`,
always-visible scrollbars (so macOS and Windows do not lay out differently), selection
colour, `html, body { min-width: 1024px }`, tabular-nums utilities, reduced-motion, and a
print block.

**`design/comps/`** — `today.html`, `contact.html`, `pipeline.html`, `import.html`,
`empty-states.html`, sharing `comp.css` (the component layer) and `comp.js` (an inline
lucide sprite, so there is no CDN, plus the theme/density switch). Each comp accepts
`?theme=dark&density=compact&chrome=off` so a capture can request a mode directly. Content
is a Utah landscaping company with a 47-character company name, a $12,450.00 deal, long
hyphenated names, an unparseable phone extension, an empty email cell and a zero-result
search.

**`design/screenshots/`** — 40 captures: five comps × 1024/1280/1440 × light/dark, plus
each comp at 1280 in both themes in compact.

**`design/review.md`** — the review. **`design/contrast-audit.js`** — the tool that ran it.

### Verified

- **Contrast: zero failures.** `design/contrast-audit.js` walks every element that paints
  text, resolves the real background by climbing to the first opaque ancestor, and applies
  the right WCAG threshold for size and weight. Run on all five comps × light/dark ×
  comfortable/compact: 0 failures out of roughly 550 measured text elements per mode.
- **No horizontal page scroll at 1024** on any comp (`scrollWidth == innerWidth`). The
  pipeline board scrolls inside its own wrapper at 1024 and 1280, which is intended.
- **Zero console errors and zero failed requests** on all five comps in all modes.
- **Focus ring** measured on tab: `rgb(29, 111, 209) 2px solid`, offset 1 px.
- **Hit targets** measured: minimum 32 px comfortable, 28 px compact, matching the spec.
- **No hex, rgb() or hsl()** anywhere in `globals.css` or in `design/comps/` (the only
  `#` matches are sprite hrefs and a fixture gate code).
- **All 47 token names referenced by `src/ui`, `src/app` and `src/features` are defined**
  in `tokens.css`. No component has invented a name, and no hex appears outside
  `tokens.css` anywhere in `src/`.
- Review found and fixed 19 defects, four of which were errors in DESIGN.md itself
  (the accent was in the global chrome; overdue was styled as danger; the compact-density
  claim was overstated; dark stage tints failed AA under muted text). All are itemised in
  `design/review.md` with the measurement that caught each one.
- A static server on port 4790 was started for the capture pass and stopped afterwards.
  `.playwright-cli/` is gitignored. No process I did not start was touched.

### Not done

- **No Tailwind `@theme` mapping.** CONTRACTS says "Tailwind config maps utilities to
  those variables", but `src/styles/app.css` belongs to foundations and there is no config
  file. Today `src/ui` uses `var(--token)` directly and it works. If first-class utilities
  like `bg-surface` or `text-muted` are wanted, foundations needs an `@theme` block in
  `app.css`; Tailwind 4 only generates a utility for a custom property declared inside
  `@theme`, not in a plain `:root`. Worth knowing: the contract's names for `--text-*`,
  `--radius-*`, `--shadow-*`, `--font-*`, `--leading-*` collide with Tailwind 4's own
  theme namespace. That collision is benign and useful — `base` is declared after `theme`,
  so our values win and `text-lg`, `shadow-md`, `rounded-md` already emit our scale.
- **No dark/compact review of `src/ui` itself.** The comps are the reference; the real
  components were built in parallel and have not been screenshotted against this contract.
  That belongs in the session-7 polish pass.
- **No Reports comp.** The brief asked for five comps and reports was not one of them.
  The empty and filtered-to-nothing report states are in `empty-states.html`; the charts
  are not designed yet and will need the dataviz skill.
- **No motion prototype.** Motion is specified in DESIGN.md §8 but nothing in the comps
  animates, so the durations and curves are unverified in use.
- **No printed-page check.** `globals.css` has a print block; it has not been rendered.

### Contract changes needed

None. `tokens.css` adds names and renames none, as CONTRACTS.md requires. Two notes for
the component builders:

1. **`--color-accent` is for fills, rails, dots and borders. Accent-coloured *text* uses
   `--color-accent-ink`.** `#C1440E` measures 4.44:1 on the grey canvas and fails AA;
   `#8F3008` measures 7.02:1. The same split exists for danger, success and warning.
2. **Use `--control-h` and `--control-h-sm` for every button, input and select height.**
   They are what makes a control shrink correctly under `[data-density="compact"]`, and
   they are the hit-target floor. Also give buttons `flex: none` — without it a flex row
   squeezes an icon button to 27 px, which this review caught.

---

## 2026-09-18 — Today agent (Today screen, search, saved views, gone-quiet, one-tap actions)

### Did

**Today screen** (`src/features/today/TodayScreen.tsx`, `sections/`, `components/`) at
`/` and `/today`, in DESIGN.md's fixed order:

- **Due now** — overdue tasks then today's, from `tasks.today()`. Overdue rows carry the
  3 px accent left rail and an "Overdue N days" badge; every row carries the customer's
  name as a link, and three controls: Call (when the record has a number), Done, and a
  Snooze menu (Tomorrow / Next week). Completing leaves a ten-second Undo toast that
  calls `tasks.uncomplete`. The next seven days are deliberately **not** on Today —
  DESIGN.md's rule is that every row here is one he can act on now; they stay on /tasks.
- **New leads** — deals created in the last 7 days with no owner-written activity, with
  the source badge, the value, Call, and a one-tap "Log a call" that opens a note box.
  Saving takes the row off the section. System activities are excluded from the "no
  activity yet" test on purpose: the lead poller writes one the instant a lead lands, so
  counting them would empty the section before the owner ever saw it.
- **Gone quiet** — `deals.goneQuiet()` for the selection, then the pure rule in
  `lib/goneQuiet.ts` for the explanation each row prints ("No activity for 30 days ·
  Limit 14 days") and a second opinion on the verdict. Stage badge with the stage's
  colour, "Log a call", and "Snooze a week".
- **Recent activity** — the last 20 entries across every record, each with the name of
  the thing it happened to and a link to it, resolved in one join rather than twenty
  round trips. System entries are included and marked.
- **Connect your website** — one dismissible card, shown until `settings.site_origin` is
  set or `settings.connect_card_dismissed` is true (both keys already existed in
  `settings.ts`). Links to `/settings/site`, which the leads agent owns.
- Every section has its own designed empty state. A **brand-new workspace** gets a
  different screen entirely rather than four empty panels: three cards for the three
  things that fill Today — import a CSV (`/import`), add a contact (runs the registry's
  `quick-add` command, falling back to `/contacts` until records ships it), connect a
  website (`/settings/site`).

**Search** (`src/features/today/search/`) — a cmdk dialog on **Cmd/Ctrl+/**, plus a
"Search records" command in the palette and a button in the page header. It debounces
80 ms, queries `search.searchGrouped()`, resolves each hit to a real name and subtitle
(`lib/searchRows.ts`), groups by contacts / companies / deals / notes, navigates on
Enter, and shows the most recently touched records when the box is empty. A
zero-result state repeats the query back in quotes and says what search looks at.
**It is not on Cmd/Ctrl+K** — see "Contract changes needed" item 1.

**Saved views** (`src/features/today/views/`, with `README.md` as the adoption doc) —
`ViewQuery` (filters, sort, columns, version); pure `serialiseQuery` /
`deserialiseQuery` / `queryEquals` / `describeQuery` that never throw on a corrupted
`query_json`; `useSavedViews(entityType, current)` on the shared `qk.savedViews` keys
with the active view held in the `?view=<id>` search param so a picker and a save
popover agree without a parent threading state; `usePinnedViews()`; `SaveViewPopover`;
`ViewPicker`. Pinned views render as a strip at the top of Today
(`views/PinnedViewsStrip.tsx`) rather than in the sidebar — see item 2 below.

**One-tap actions** (`src/features/today/actions.ts`) — `openTel` / `openSms` /
`openMailto` / `openMaps` through `@tauri-apps/plugin-opener`, each returning a
`logThis` callback and a label rather than writing the activity itself, because tapping
a number is not proof a conversation happened. Maps is an https URL, not a platform
scheme, because the opener capability only allows https/mailto/tel/sms. Kept small and
documented for reconciliation with the records agent's copy.

**Gone-quiet rule** (`src/features/today/lib/goneQuiet.ts`) — `lastTouch`, `daysSince`,
`quietVerdict`, `describeQuiet`, `compareQuiet`, `snoozeActivityBody`. Whole days,
floored, never negative; a won or lost stage is never quiet; `quiet_days = 0`, a
negative value or `NaN` switches the rule off; unparseable dates never produce a
verdict.

**Tests** — `tests/unit/today/goneQuiet.test.ts` (25), `tests/unit/today/viewSerialise.test.ts`
(29), `tests/repo/today/search10k.test.ts`, `tests/e2e-mac/specs/today.e2e.ts` (9).

### Verified

```
$ npx vitest run tests/unit/today tests/repo/today
 Test Files  3 passed (3)
      Tests  54 passed (54)

$ E2E_PORT=4182 E2E_OUT=dist-today npx playwright test \
    -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/today.e2e.ts
  9 passed (8.8s)

$ npx vite build --outDir dist-today
  built, no errors
```

The 10k search test seeds 10,000 contacts and 20 companies (29,020 statements) through
`contacts.createStatements` in batches of 500 inside one transaction — the CSV import's
shape — in ~1.4 s, asserts `indexCounts()` reports at least 10,000 contact documents so
the timing is not measuring an empty index, then takes the median of 7 timed runs after
a discarded warm-up. Medians over three runs: rare surname 0.031–0.037 ms, common first
name 0.181–0.196 ms, two-token "first last" 0.073–0.078 ms, phone fragment
0.030–0.036 ms, prefix "joh" 0.243–0.254 ms. PLAN item 7's 50 ms bar is not marginal;
there is more than 150x of headroom. It does not prove the Rust pipe's IPC round trip,
only the SQL and the index.

The e2e spec seeds an overdue task, a task due today, a website lead with its system
"lead received" entry, a 30-day-quiet deal in a 14-day stage, and two activities — then
asserts each section picks the right rows and that the near-misses stay out (the
45-day-old deal is not a new lead; the two-day-old lead is not quiet; the system entry
does not clear the lead). It completes a task and checks `done_at` in the database,
snoozes a quiet deal and checks the section empties and a system activity was written,
logs a call on a lead and checks the row leaves and the activity landed, dismisses the
website card and checks the setting survives a reload, and drives search with the
keyboard from shortcut to typed query to arrow to Enter to `/contacts/c-brent`.

Six screenshots at 1280 in `tests/e2e-mac/.cache/screens/today/` (full, empty and
search, light and dark), looked at. Two things they caught and that are now fixed:

- Every button rendered mid-fade in the dark captures, because `src/ui/Button`'s
  `transition-colors` was still running when the shot was taken. The theme flip now
  settles before the capture. Worth knowing for any other agent screenshotting themes.
- The Gone quiet row truncated its own explanation ("…Limit 14 …") because the deal
  title, the money and two buttons shared one truncating line. The deal title truncates
  now and the number — the reason the row is on screen at all — stays whole.

### Not done

- **Pinned views are not in the sidebar.** They are a strip at the top of Today. See
  item 2 below; this is a shell limitation, not an oversight.
- **No saved-view consumer.** The library is built, documented and unit-tested, but no
  list screen adopts it yet — Contacts, Pipeline and Tasks belong to the records agent.
  `ViewPicker` and `SaveViewPopover` have therefore never been driven by a person, only
  typechecked and read.
- **No repo test for the Today queries themselves.** `newLeads`, `lastActivityFor`,
  `recentWithLinks` and `taskLinks` are covered end to end by the e2e spec against real
  SQL, but they have no direct repo test. They should get one when they are promoted
  into `src/db/repos` (see item 3), where the harness is already set up for it.
- **`openSms` / `openMailto` / `openMaps` are unused by Today.** Only `openTel` has a
  caller. They are written and documented for the records agent's record screens.
- The 44 px floor is enforced with `min-h-[44px]` on Today's own controls rather than by
  changing `src/ui/Button`'s `lg` size, which is 48 px of `--space-9` and not mine to
  change.

### Contract changes needed

1. **The command palette has no search-results provider, and a feature cannot bind a
   key.** `src/app/CommandPalette.tsx` says in its own header that "search results are
   wired in by the today feature", but it exposes no hook to do that, and `src/app`
   belongs to foundations. Separately, `FeatureCommand.shortcut` is only ever *rendered*
   next to a command — the shell binds `mod+k` for the palette in `Shell.tsx` and
   nothing binds a feature's string. So search ships on **Cmd/Ctrl+/** with a palette
   command and a header button. The fix is either of:
   - a `registerSearchProvider(fn)` on the palette, so Today feeds results into the
     existing Cmd/Ctrl+K panel and the two search entry points collapse into one; or
   - the shell binding `FeatureCommand.shortcut` for every registered command, so a
     feature's declared key actually works.
   The first is better: two search boxes on one screen ("Search everything" in the top
   bar, "Search records" in the page header) is the visible cost of not having it.

2. **`FeatureModule.nav` is static, so pinned saved views cannot reach the sidebar.**
   `allNavItems()` is flattened once inside a `useMemo(..., [])` when the shell mounts,
   before any row is read. DESIGN.md asks for a "Views" group under Pipeline; PLAN item
   13 asks for pinned views in the sidebar. Neither is possible today. Needs either
   `nav?: () => FeatureNavItem[]` re-read on a signal, or — cleaner — a shell-owned
   "Views" section that subscribes to `savedViews.listPinned()` through the shared
   `qk.savedViews()` key. **Sidebar order 15 is reserved for it.** Until then the strip
   at the top of Today stands in, and `views/viewRoute()` already produces the
   `/<screen>?view=<id>` deep link such a section would use.

3. **Four repository functions are living in `src/features/today/lib/`** because a
   feature agent may not edit `src/db/repos`. Each follows the repository conventions
   exactly (aliased columns, no `SELECT *`, parameters never interpolated, read-only),
   so promoting them is a move, not a rewrite:
   - `todayData.newLeads()` → `deals.ts`
   - `todayData.lastActivityFor()` and `todayData.recentWithLinks()` → `activities.ts`
   - `todayData.taskLinks()` → `tasks.ts`
   - `todayData.workspaceIsEmpty()` → wherever the first-run check settles
   - `searchRows.searchRows()` and `searchRows.recentRecords()` → `search.ts`
   `search.searchGrouped()` returns the indexed blob as `text`, which is right for
   matching and unusable for display; `searchRows()` is the second pass that fixes that,
   and it belongs beside it.

4. **A feature cannot contribute an overlay, so Today mounts its own React root.**
   `search/overlay.tsx` appends a `<div>` to `document.body` from `onBoot` and renders
   the search dialog into it with the *same* shared `queryClient`, because search has to
   work on /pipeline and /contacts, not only on Today. It is the one awkward thing in
   this feature and it is awkward on purpose rather than by accident — the alternative
   was editing `Shell.tsx`. An `overlays?: ReactNode[]` field on `FeatureModule`, or a
   single shell-rendered slot, removes it.

5. **Two things another agent broke, neither mine, both reproducible on a clean tree:**
   - `npm run typecheck` reports one error, `tests/repo/data/import-100k.test.ts(24,7):
     'TIME_BUDGET_MS' is declared but its value is never read` (data agent).
   - `npm test` fails 2 of 638 in `tests/repo/boot.test.ts`, which asserts the applied
     migration list is exactly `["0000_init", "0001_search"]`. The leads agent has added
     `0002_report_views`, so that assertion needs updating by whoever owns it. Every
     other suite passes, including all three of this agent's.
   Both were confirmed to be outside `src/features/today`, `tests/unit/today`,
   `tests/repo/today` and `tests/e2e-mac/specs/today.e2e.ts`.

6. **Non-blocking, recorded for the orchestrator:** `tests/e2e-mac/fixtures.ts`'s `helix`
   fixture must be destructured by a test even when the test never touches it — it is
   what installs the database bridge and the Tauri invoke shim, and Playwright only
   builds a fixture a test asks for. A spec that writes `async ({ page })` and calls
   `page.goto("/")` gets "Cannot read properties of undefined (reading 'invoke')" and the
   boot error screen. Worth a line in that file's header comment; it cost this agent a
   confusing twenty minutes.

---

## 2026-09-18 — Data feature agent (import, export, backups, duplicates, attachments)

### Did

**CSV import, `/import`** — a five-step wizard (`src/features/data/import/`).
`ImportScreen` holds the state machine; `FilePickStep`, `MappingStep`,
`PreviewStep`, `ResultStep` and `ProgressBar` are the pieces.
- **Reading** (`lib/csv.ts`, the file CONTRACTS lists as `src/lib/csv.ts` and
  foundations left unwritten). Bytes in: BOM detected from the bytes, not the
  decoded text, because `TextDecoder("utf-8")` eats a BOM itself; encoding by
  strict UTF-8 decode, falling back to windows-1252; delimiter by consistency
  across the first ten logical lines outside quotes, which is what tells a
  European `;` file from its `1250,00` decimal commas; CRLF vs LF reported.
  Parsing is papaparse with a `step` callback, so one row is in memory at a
  time; a ragged row raises `ImportParseError` with the row number, the first
  column that has no value, and a sample, and `{ tolerant: true }` pads and
  truncates instead (used by nothing in the app, only by the tests).
- **Mapping** (`lib/mapping.ts`). Sixteen fields; emails, phones, tags, notes
  and custom fields may take several columns. The guess is a rule list with a
  disqualifier pass in front, which is what keeps Google's `Phonetic First
  Name` and `E-mail 1 - Label` off first name and tags, and every deal-ish
  column on Skip. Verified column by column against all six fixtures.
  `headerSignature()` keys the remembered mapping, stored in the workspace's
  `settings` table as `import.mapping.<signature>` (`lib/rememberMapping.ts`)
  and restored by header text, not position.
- **Writing** (`lib/importRun.ts`, `lib/importWrite.ts`). One
  `withTransaction` for the whole file with `pauseTimers()` around it. Existing
  emails, E.164 phones, company names, sources, tags and custom fields are
  prefetched into maps once; per row the policy is skip / update / create,
  keyed on `email_lower` then `e164`, and a contact created earlier in the same
  file is registered in those maps so a repeat row in one file dedupes too.
  Companies are linked by exact name or created. Statements accumulate and
  flush every 500 rows through `raw.batch`.
- **Result.** Counts (created, updated, skipped, companies created, plus new
  tags and custom fields), and "Save skipped rows as CSV" through the save
  dialog with a reason column appended. One `change_log` row for the whole
  import rather than one per contact.

**Export, `/export` and the `export-all` command** (`lib/exportCsv.ts`,
`lib/exportRun.ts`, `export/ExportScreen.tsx`). Any entity to CSV with phones
and emails flattened, or everything as a jszip of five CSVs plus a full JSON.
Formula-injection guard on a leading `= + - @ TAB CR`, and a guarded cell is
always quoted. Child rows are fetched in one bulk query per relation and
grouped in JS, never per row.

**Backups, `/backups`** (`lib/retention.ts`, `lib/backupsFs.ts`,
`backups/scheduler.ts`, `backups/BackupsScreen.tsx`). List with dates, reason,
size and total; "Back up now"; the schedule as this feature's `onBoot` (one
after first paint unless a backup ran in the last hour, then every six hours,
skipping any tick while `timersPaused()`); retention (everything from the last
24 h, then one per day for 30 days, and the newest file always); restore with a
confirmation naming both dates, `pre-restore` backup, `raw.close()`,
`copyFile`, `raw.open()`, then `openWorkspace()` from `src/app/boot.ts` so the
migrations and the query cache rerun. `BackupWriteError` shows a persistent
banner until a backup succeeds.

**Duplicates and merge, `/duplicates`** (`lib/duplicates.ts`,
`duplicates/DuplicatesScreen.tsx`, `MergeDialog.tsx`, `MergesHistory.tsx`,
`scanner.ts`). A whole-workspace pair scan on contacts (shared email, then
shared E.164) and companies (same name ignoring case, or same phone), on boot
and every 24 hours. Each pair shows the matching value highlighted and links to
both records. The merge screen picks the survivor and then, per differing
field, which value it keeps, and calls `merge.merge`. A 10-second Undo toast
reverses it; the Merges tab lists every merge for 30 days with Reverse, and
shows the refusal reason (already reversed, out of the window, or the survivor
has been merged again) instead of a dead button.

**Attachments** (`attachments/AttachmentList.tsx` + `README.md`). The component
the records agent can adopt: add through the dialog then `copy_in`, list with
image thumbnails over the asset protocol, open through the OS opener, remove as
a soft delete with Undo. `AttachmentTooLarge` inline, not as a toast.

**Feature module.** Routes `/import`, `/export`, `/duplicates`, `/backups`; nav
"Import" at 70; commands `import-csv` and `export-all`; `onBoot` starts the
backup schedule and the duplicate scan.

### Verified

```
$ npm run typecheck
(no output)

$ npm test
 Test Files  52 passed (52)
      Tests  691 passed (691)

$ npx vitest run tests/repo/data/import-100k.test.ts --reporter=verbose
 [import-100k] runImport durationMs = 6985
 ✓ imports 100,000 rows against a real file-backed database within the time budget

$ npx vite build --outDir dist-data
(clean)

$ E2E_PORT=4183 E2E_OUT=dist-data npx playwright test -c tests/e2e-mac/playwright.config.ts \
    tests/e2e-mac/specs/data.e2e.ts
  4 passed (11.0s)      # three consecutive runs green
```

New tests: `tests/unit/data/{csv,mapping,importWrite,exportCsv,retention}.test.ts`
(118 assertions over parsing, the guesses on every fixture header row, the
statement planner, export escaping and the retention policy) and
`tests/repo/data/{import,export,import-100k}.test.ts` (the whole import run
against every fixture through the harness, with counts asserted).

Every fixture imports: HubSpot 52, Zoho 47, Pipedrive 58, Google Contacts 44,
Excel save-as 41, `clearpath-prospects.csv` 19 — `created + updated + skipped`
always equals the row count, and the contacts really in the database match
`created`. Spot-checked through the repositories: Sarah Mitchell's phone
normalises to `+18015550142` and her email lowercases, Pipedrive's single
`Person - Name` column splits, Google's `* myContacts ::: Suppliers` becomes two
tags, ClearPath's nameless rows file under their company, and `deals` stays
empty because v1 does not import deals. `ragged.csv` raises `ImportParseError`
and writes nothing; a driver forced to fail on the third `raw.batch` raises
`ImportWriteError` and leaves zero contacts, proving the outer transaction rolls
back rather than just the failing savepoint.

The e2e spec drives the HubSpot fixture through the real UI (dialog stub fed
through `window.__helixE2E`), asserts 52 created and 46 companies, imports the
same file again with "Import anyway" to manufacture duplicates, merges a pair
(104 → 103 contacts), undoes it (→ 104), sees the reversal in the Merges tab,
and exports contacts — asserting both that the save dialog was called and that
the CSV that went through the fs plugin has the right header and content.
Screens were screenshotted at 1280 in light and dark into
`tests/e2e-mac/.cache/screens/data/` and looked at; two things the pictures
caught were fixed: the mapping table's select overflowed its rounded border
(now a fixed width), and `/export` and `/backups` were double-padded inside the
shell's own `<main>`.

One defect the 100k test caught, and the fix: `coalesceInserts` only merged
*adjacent* inserts, and the import emits statements row by row (contact, phone,
email, tag), so nothing ever merged — 100k rows went out as ~400k statements in
35 s. `planBatch()` now buckets a batch by table first, in a fixed
foreign-key-safe order (sources, companies, tags, custom_fields, contacts,
contact_phones, contact_emails, tag_links, custom_values, then everything that
is not an insert), and coalesces inside each bucket. Same run: **6,985 ms**.

### Not done

- **Backups and restore are not proven end to end.** The e2e harness's fs stub
  is an in-memory map with no `readDir` and no `copyFile`, and `db_backup`
  there is better-sqlite3's `VACUUM INTO` rather than the Rust pipe's second
  read-only connection, so `/backups` always shows an empty list under
  Playwright. The pure halves — the retention policy, the name parsing, the
  schedule arithmetic — are covered in `tests/unit/data/retention.test.ts`.
  Restore needs the Windows suite or a manual pass.
- **`/backups` is at a top-level route**, not `/settings/backups`, because the
  settings agent owns `/settings/*`. It is nav-less (reachable by URL and from
  Diagnostics later). The orchestrator should move it.
- No drag-and-drop *files* test: the Tauri drag-drop event has no stub in the
  harness, so `subscribeFileDrop` is only exercised by hand. The HTML5 drop
  path and the dialog fallback are what the spec drives.
- Attachments have no automated test at all. `copy_in` is Rust, and its e2e
  stub returns a made-up stored name with no file behind it, so a thumbnail can
  never render under Playwright. The component is typechecked and reviewed only.
- No purge of attachment files on disk: that needs a Rust command to delete a
  file inside the workspace, which does not exist (see below).
- The import's `region` is never set from settings — `settings.defaultRegion`
  exists and the import accepts a region, but nothing passes it yet, so phones
  normalise as US. One line once the settings screen exposes it.

### Contract changes needed

1. **`src/lib/csv.ts` should be promoted.** It lives at
   `src/features/data/lib/csv.ts` today. Nothing outside this feature imports
   it yet; the leads poller may want the same normalisers.
2. **Repository functions this feature wrote for itself**, all in
   `src/features/data/lib/importWrite.ts`, all pure statement builders:
   `importContactStatements` (what `contacts.createStatements` does, plus
   `address_json` in the same insert — the repository version cannot take an
   address, and following each contact with an `UPDATE` is what defeated the
   batch planner), `companyCreateStatement` (create-or-link by exact name),
   `sourceCreateStatement`, `tagCreateStatement`, `tagLinkStatement`,
   `customFieldCreateStatement`, `customValueStatement`,
   `contactEmailStatement`, `contactPhoneStatement`, and
   `contactUpdateStatement` (fills only columns that are empty today and
   appends to notes rather than replacing them). `planBatch` and
   `coalesceInserts` belong beside them wherever they land.
3. **A whole-workspace duplicate scan** (`lib/duplicates.ts`:
   `findContactPairs`, `findCompanyPairs`). `contacts.findDuplicates` answers
   "does this one record clash with anything" for the create form, which is a
   different query from "list every candidate pair in the file".
4. **An attachment-file delete command.** `trash.attachmentFilesFor()` hands
   back the stored names a purge must remove first, but there is no Rust
   command to delete a file inside the workspace, and the fs plugin's scope is
   `$APPDATA` (writable, so `remove()` would work) — decide whether the purge
   goes through `plugin-fs` or a `delete_in(storedName)` command with the same
   shape as `copy_in`. Backup pruning already deletes through `plugin-fs`.
5. **The e2e fs stub loses the path on writes.** `writeTextFile` in
   `@tauri-apps/plugin-fs` sends the bytes as the invoke payload and the path
   as a request header; `tests/e2e-mac/fixtures.ts` keys `state.files` off
   `args.path`, which is `undefined` for a write, so everything written lands
   under one key. The data spec asserts on the payload instead. Worth teaching
   the stub to read `options.headers.path`.
6. **`settings.set` is typed too narrowly for a dynamic key** — not a change,
   just a note: this feature uses `setRaw`/`getRaw` for the remembered
   mappings, which is what they are for.

---

## 2026-09-18 — Records feature agent

### Did

**Contacts.** `screens/ContactsScreen.tsx` is a virtualised list (`VirtualList`,
20 000-row page, 68 px rows) with search-as-you-type (200 ms debounce), four
sorts, tag and source filters, and an Archived toggle. Three distinct empty
states: first run, zero-result search (repeats the query in quotes and offers to
clear the filters), and "nothing archived".
`screens/ContactPage.tsx` follows DESIGN.md §3 exactly — the fixed top block is
the name, then the phone as a real `tel:` control at `--text-2xl`, then the next
step (the soonest open task, or "No next step" in `--color-accent-ink`), then at
most two more controls. Everything else sits below: phones and emails with
labels and a primary flag, company link, source, tags, address, custom fields,
notes. Nothing on the page has a save button; every field autosaves through
`components/InlineEdit.tsx` (600 ms debounce, "Saved" for two seconds, blur
flushes, Escape reverts). Create goes through `components/NewContactDialog.tsx`
with the live dedupe warning ("… already has that email. Open it instead?" plus
"Create anyway"). Archive/restore and a soft delete with an Undo toast.

**One-tap actions.** `lib/links.ts` builds `tel:`, `sms:` and `mailto:` (pure);
`lib/address.ts` builds the maps URL; `lib/oneTap.ts` opens it through
`@tauri-apps/plugin-opener` and then offers a ten-second toast whose one click
writes the matching timeline entry ("Called (801) 555-0147").

**Companies.** `CompaniesScreen.tsx` mirrors the contacts list.
`CompanyPage.tsx` shows linked people, open and closed deals (labelled from the
vocabulary), and a merged timeline over `activities.list({ mergedForCompanyId })`
so every call logged against any of its contacts appears, with the same
autosaving detail panel.

**Pipeline.** `PipelineScreen.tsx` toggles a board and a list.
`components/PipelineBoard.tsx` is dnd-kit (pointer + keyboard sensors) with
optimistic columns and `deals.moveTo` behind them; `components/DealCard.tsx`
shows exactly four things and supports shift+arrow to move between and within
stages. Column headers carry the name, the count and the value total in tabular
money. Moving into a lost stage is refused by the repository until there is a
reason, so `components/LostReasonDialog.tsx` asks for one and retries.
`components/StageManagerDialog.tsx` adds, renames, reorders, recolours from the
eight-step stage ramp, sets quiet days, and deletes with a forced move target.
`screens/DealPage.tsx` edits title, value, stage, expected date, contact,
company and source inline, shows won/lost and the reason, and reopens.

**Timeline.** `components/Timeline.tsx`, shared by all three record pages.
Note/call/email/meeting/text, two clicks to add (pick the kind, type, save),
edit and delete of user entries with an Undo toast, system entries rendered
dashed and muted with no controls, relative dates with the exact timestamp in a
tooltip.

**Tasks.** `screens/TasksScreen.tsx` groups Overdue / Today / Next 7 days /
Later / Done from the pure `lib/taskGroups.ts`, completes from the list, snoozes
to tomorrow or next week, shows linked-record chips, and creates with a due date
and an optional time. `components/TaskRail.tsx` puts the same rows and composer
on every record page. Overdue uses the accent, never danger.

**Quick add.** `quickAdd/` — a module store, the dialog, and a host mounted once
from the feature's `onBoot` into its own React root beside the shell, because
the shell renders only route elements. Cmd/Ctrl+N works from any screen; the
`quick-add` FeatureCommand with `shortcut: "mod+n"` is registered as well.
Type switcher for contact, company, deal, task and note with exactly the
required fields from the plan. Enter saves and closes, shift+Enter saves and
clears, and every save shows a ten-second Undo that replays
`changeLog.undoBatch`.

**Undo and trash.** `lib/mutations.ts` centralises invalidation and undo.
`screens/TrashScreen.tsx` at `/trash` (sidebar order 85) lists all eight types
with counts, restore, "Delete forever" behind a confirm dialog, and a sequential
"Empty the trash".

Throughout: repositories are the only data access, every read is TanStack Query
on the shared `qk` keys, every write invalidates. Only `src/ui` components and
token-bound Tailwind utilities — no hex and no palette classes anywhere in the
feature (grepped). 44 px targets on the primary row actions, keyboard access
everywhere, long names truncated with a `title`, and no animation at all, which
is how `prefers-reduced-motion` is respected.

### Verified

```
$ npx tsc --noEmit
(no output, exit 0)

$ npm test
 Test Files  52 passed (52)
      Tests  691 passed (691)

$ npx vite build --outDir dist-records
(no output, exit 0)

$ E2E_PORT=4181 E2E_OUT=dist-records npx playwright test \
    -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/records.e2e.ts
  ✓ 1 records › creates a contact through quick add (400ms)
  ✓ 2 records › warns on a duplicate email and still allows creating anyway (2.1s)
  ✓ 3 records › autosaves an inline edit on the contact page (1.2s)
  ✓ 4 records › adds a phone and logs a call from it (1.4s)
  ✓ 5 records › creates a deal and moves it to the next stage with the keyboard (436ms)
  ✓ 6 records › marks a task done from the tasks list (468ms)
  ✓ 7 records › deletes a contact and undoes it (1.3s)
  ✓ 8 records › restores a contact from trash after the undo toast expires (11.0s)
  ✓ 9 records screens › captures every screen, light and dark (8.5s)
  9 passed (29.1s)
```

New tests: `tests/unit/records/` — board.test.ts (the board's move arithmetic,
including the "dropped one slot early" case and the clamp at the ends),
taskGroups.test.ts (every bucket boundary, ordering, `dueLabel`, the due
date/time round trip), address.test.ts (parse/stringify, legacy aliases, the
maps URL), links.test.ts (tel/sms/mailto), inlineEdit.test.ts (jsdom: no save
button, one write per burst, blur flushes, Escape reverts, the failure state).
`tests/repo/records/` — boardMoves.test.ts (drag and shift+arrow against the
real repositories, stage events, the lost-reason refusal, forced stage move,
column totals), undoFlow.test.ts (undoBatch on every quick-add type, restore on
every delete, the dedupe query), trashFlow.test.ts (delete → trash → restore →
purge, including tag links and custom values).

Screenshots at 1280 px, light and dark, in
`tests/e2e-mac/.cache/screens/records/` (30 files, gitignored), captured by the
last test in the spec and reviewed by hand. Two things they caught and that are
now fixed: the phone and email rows wrapped their action cluster onto a second
line in the 380 px details column and looked broken, so each is now a
deliberate two-line block with the number full width and the label, primary
badge and icon actions beneath it; and the timeline card floated as a short card
in a tall empty column, so it now fills the grid row (`fill` prop).

### Not done

- **Saved views (plan item 13) are not wired into these lists.** The filters,
  sort and the archived toggle are component state; nothing names or pins them.
  `savedViews` exists in the repositories and nobody has claimed the screen.
- **No pointer-drag e2e.** The board's drag path is exercised by hand and by the
  pure `lib/board.ts` tests; the spec uses the keyboard move, which the brief
  allows. dnd-kit's pointer sensor needs synthetic pointer events with a real
  activation distance, which is a lot of fragility for the same assertion.
- **Deal tags, deal custom fields and deal attachments have no repository-side
  filter in the lists.** The deal page edits them; the pipeline's filters are
  stage only (value range and date range are in `DealFilter` but not on screen —
  they belong with saved views).
- **Timeline paging.** A record's timeline loads 200 entries and stops. A
  record with more needs an infinite list; nothing in v1 reaches that.
- **The contacts list does not show a phone column.** The row is name plus
  company plus tags; the phone lives on the record page where it is the hero.
- `src/app`, `src/db`, `src/ui`, `src/styles`, `src-tauri`, `package.json` and
  the registry were not touched, as scoped.

### Contract changes needed

Five things the orchestrator should promote or decide. Nothing here blocks.

1. **`undoBatch` cannot undo a soft delete.** `_base.softDeleteRow` logs
   `op: "delete"` with an `after` and no `before`, and `changeLog.undoBatch`
   skips a `delete` entry that has no `before` (`if (!before) continue`). So the
   Undo toast on a delete calls the entity's `restore()` instead of
   `undoBatch()` — the exact inverse, and one statement rather than a replay.
   Either is fine, but the two paths should be made explicit in CONTRACTS so the
   next agent does not assume `undoBatch` covers deletes. Quick add's Undo does
   use `undoBatch`, which handles `create` correctly.

2. **`deals.board()` omits empty stages and does not order by stage position.**
   It groups `list()` into a Map, so a stage with no deals is missing and the
   column order is insertion order. Every caller has to drive the columns from
   `stages.list()` and look the group up — which `PipelineBoard` and the repo
   test both do. Worth making `board()` take the stage list and return one entry
   per stage in position order.

3. **There is no `contacts.updateEmail`.** `addPhone`/`updatePhone`/`removePhone`
   exist, but emails only have `addEmail`/`removeEmail`. Changing an email's
   label or primary flag is therefore a remove followed by an add
   (`components/ContactMethods.tsx`), which loses the row's id and its
   `created_at`. `updateEmail(emailId, { label?, isPrimary? })` mirroring
   `updatePhone` is the fix.

4. **There is no "tags for many entities" read.** `tags.listForEntity` answers
   one row at a time, so a list that wants a tag column walks the workspace's
   tags and calls `listEntityIdsForTag` for each
   (`lib/hooks.ts`: `useEntityTagIndex`). Fine for a handful of tags, wrong at
   scale. `tags.indexFor(entityType): Promise<Map<entityId, Tag[]>>` in one
   query is the promotion.

5. **Candidates for promotion out of `src/features/records/lib/`:**
   `board.ts` (pure board arithmetic — Today may want it), `taskGroups.ts` (the
   Overdue/Today/Next-7 buckets and `dueLabel`, which the Today screen almost
   certainly duplicates), `address.ts` (address JSON parse/stringify/format —
   the CSV import needs the same shape), `links.ts` (tel/sms/mailto builders)
   and `mutations.ts`'s `invalidateRecords` + `deleteWithUndo`. If Today or Data
   has written its own copy of any of these, they should be reconciled before
   either lands.

One note, not a change: `tests/e2e-mac/.cache/results` is a single `outputDir`
shared by every agent's Playwright run, and two runs at once make Playwright
fail at `browserContext.close` with an ENOENT on its own trace file. Passing
`--output tests/e2e-mac/.cache/results-records` on the command line avoids it
without touching the shared config; the config should probably derive
`outputDir` from `E2E_OUT` the way it already derives the port.

---

## 2026-09-18 — Leads and reports agent (website lead poller, site connection, reports)

### Did

**`drizzle/0002_report_views.sql`** — one custom migration (generated with
`npx drizzle-kit generate --custom --name report_views`, with its journal entry
and snapshot) creating the five report views the plan's item 14 asks for. The
views do the joins and the derivations; the period filter and the final
aggregation belong to the caller, because a period picker cannot be baked into a
view. Every view hides soft-deleted rows, keeps money in integer cents, and
defines "open" as no `closed_at` in a stage that is neither won nor lost.
- `v_report_pipeline_stage` — open deals per stage. LEFT JOIN from `stages`, so a
  stage with nothing in it still gets a row: an empty column is information and
  the chart needs the slot.
- `v_report_closed_deals` — one row per closed deal, with `outcome` derived from
  the stage flags rather than a column on the deal (so renaming or recolouring a
  stage cannot rewrite history) and `period_month` / `period_quarter` /
  `period_year` as string prefixes of `closed_at`.
- `v_report_deal_sources` — one row per live deal with its source resolved. A
  deal with no source, or whose source was deleted, lands in a single "Unknown"
  bucket instead of disappearing from the total.
- `v_report_stage_transitions` — one row per (deal, consecutive stage pair) for
  every deal that entered the earlier stage, with `advanced` set when the deal
  entered the next stage *afterwards*, so a deal that bounced back and then went
  forward still counts. "Consecutive" is by `position`, so reordering the board
  reshapes the report and deleting a stage closes the gap. A won or lost stage is
  never the `from` side: a closed deal has nowhere left to convert to, and
  "Won -> Lost" is not a funnel step. It can still be the `to` side, because
  "Scheduled -> Won" is the most interesting number on the page.
- `v_report_stage_dwell` — one row per stage entry. `left_at` is the next event
  for that deal (a same-millisecond tie breaks on id, which is UUID v7 and so in
  creation order); `days_in_stage` runs to `left_at`, or to now for the deal's
  current stage. That is what separates "how long a visit takes" from "how long
  this has been sitting there", which the report shows side by side.

**The poller** — `src/features/leads/poller.ts` plus `lib/`. Started from the
feature's `onBoot` after the first paint, idempotent, and with no site configured
the timer never starts at all. Each tick pages `leads_fetch(cursor, 200)` until
`nextCursor` is null or the page comes back short, applies each page inside one
`withTransaction`, saves the cursor after every page (so an interrupted run
resumes instead of re-reading from the beginning), mirrors `lastPolledAt` into
helix.json through `touchWorkspace`, and skips the tick entirely while
`timersPaused()` — an import holds the write lock and a poll must not queue
behind it. 401/403 writes `last_error`, shows the banner and stops the timer
until the settings change; anything else backs off 1, 2, 4, 8 minutes and stays
silent until the third consecutive failure. Start, end, counts and named errors
go through `@tauri-apps/plugin-log`, imported lazily and swallowed on failure so
a missing log plugin can never be the reason a poll died. A small store
(`subscribe` / `getStatus`, and the `usePollStatus` hook) plus `PollBanner` are
exported for Today and Diagnostics.

Two dependencies are injected rather than imported, and both exist for the tests:
`setLeadsFetch` lets the integration test point the poller at `tools/fake-site`
over plain `fetch` and the e2e harness at its stub, and `setSecretStore` stands
in for the keychain, which has no Tauri runtime under Vitest. A null cursor is
passed as null and never as an empty string; the Rust command omits `after`
entirely.

**`lib/applyLeads.ts`** — one page of leads in one transaction: skip when
`deals.findByExternalId("<origin>:<lead id>")` already exists, else dedupe the
contact on email then phone, create it with source Website when neither matches,
create the deal in the first stage with source Website and the external id, and
write one immutable system activity holding the original message, the service and
the page URL. It builds statements instead of calling repository writes, because
the write lock is not reentrant: a repo write inside `withTransaction` would queue
behind the transaction already holding the lock and both would wait forever.

**Site connection at `/settings/site`** — `screens/SiteConnectionScreen.tsx`, also
exported as `SiteConnectionScreen` for the settings feature to mount. The origin
is validated with the same rule as `validate_origin` in Rust, restated in the UI
so the owner gets the message before the round trip rather than after it. The
token goes through `secret_set` with kind "site" and the open workspace id; it is
write-only in the UI, so the screen can say a token is stored but never shows it
again. Then "Test connection" (`leads_fetch(null, 1)`, writes nothing), the fixed
five-minute interval, last polled time and last error from `lead_sync`, "Poll
now", and "Disconnect", which forgets the address and deletes the key but keeps
every contact and deal the site ever sent.

**Reports at `/reports`** — a period picker (this month, quarter, year, custom),
then five cards, each with a chart, a table view with tabular numbers, a "Copy as
CSV" button (CRLF, quoted, with the formula-injection guard the plan requires on
every export) and its own worded empty state. Money goes through
`src/lib/money.ts` throughout.

Chart decisions follow the dataviz skill, and the categorical palette was run
through its validator rather than eyeballed:
- Pipeline value by stage, leads by source, conversion and both days-in-stage
  small multiples are single-series, so identity is carried by the axis label and
  colour is redundant. The per-stage charts fill each bar from that stage's own
  `color` column; leads by source uses one hue (`--stage-2`) and conversion one
  hue (`--stage-4`).
- Won and lost is the only two-series chart: `--stage-5` and `--stage-6`, the
  ramp's own won and lost slots. Validated light and dark — CVD separation dE
  10.8 and normal-vision dE 21.8, both passing; the only failing check is the
  chroma floor on the mauve `--stage-6` (0.077 against a 0.1 floor), which is a
  property of a design token this agent does not own. It ships with a legend and
  direct labels, so identity is never colour alone.
- The won and lost card leads with two stat tiles and draws no chart at all when
  the period yields a single bucket, which is the skill's "is it even a chart"
  rule: one bucket is a number, not a trend.
- Charts never animate. `docs/DESIGN.md` section 8 forbids entrance animations
  outright, which is stricter than `prefers-reduced-motion` and satisfies it by
  construction. That also fixed a real defect: recharts 3.10 withholds a
  `LabelList` until the series animation finishes, so an animating chart showed
  its bars a second before their values.
- `formatAxisMoney` keeps a value axis in one shape. `formatMoneyCompact` only
  compacts above $1,000, so an axis was reading "$0.00, $400.00, $800.00, $1.2K,
  $1.6K" — three shapes in one row of ticks, which reads as sloppy bookkeeping to
  this audience. Axis ticks are now always compact and never carry cents; the
  exact figure with its two decimals is on the bar's own label, in the tooltip
  and in the table.

### Verified

```
$ npm run typecheck
(no output)

$ npm test
 Test Files  52 passed (52)
      Tests  692 passed (692)

$ E2E_PORT=4184 E2E_OUT=dist-leads npx playwright test \
    -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/leads.e2e.ts
  12 passed (7.5s)

$ npx vite build
✓ built in 513ms
```

New tests: 79 unit (backoff schedule and the 1/2/4/8 ceiling, the auth-versus-
network split, cursor handling including the binding rule that a null cursor
sends no `after` at all, lead-to-record mapping, the period model, origin
validation), 30 repo (each of the five views asserted on a hand-built history,
and applying a page of leads — idempotent on re-poll, dedupe on email then phone,
external_id set, whole page rolled back when one lead fails), and 12 e2e.

The integration test in `tests/repo/leads/pollerIntegration.test.ts` runs the real
poller against `tools/fake-site`, which it starts on 4711 with `--seed 25` and
stops itself. It pages at 7 a request so the cursor genuinely has to be carried
back (4 round trips, 25 unique external ids, the seed's deliberate `createdAt`
tie survives), re-polls to nothing, picks up a lead posted to the site in between,
resumes from a saved cursor, stops on a wrong token with `LeadPollAuthError` in
`lead_sync`, and stays silent for two network failures before speaking on the
third.

Screenshots at 1280 in both themes are in
`tests/e2e-mac/.cache/screens/leads/` (gitignored) and were looked at. Three
things they caught and that are now fixed: the missing chart value labels (the
recharts animation issue above), an axis mixing compact and full money, and
"Won -> Lost" appearing as a conversion step.

### Not done

- The five report views are not indexed and nothing has been run against a large
  workspace. `v_report_stage_dwell` does a correlated subquery per stage event,
  which is fine for the thousands of events a solo owner will have and is not
  fine for a million. Worth measuring before anyone imports a decade of history.
- Reports are not exported as a file, only copied to the clipboard as CSV. The
  data agent owns export; if reports should land in the zip, that is a
  cross-feature decision.
- No saved views on reports, and the period is not remembered between visits.
- The poller only runs for the open workspace while the app is open, which is
  the known consequence of approach B in the plan, not a gap in this work.
- `secret_set` is exercised only through the e2e stub and the in-memory test
  store. The real macOS keychain round trip is still unproven, as the Rust
  foundations agent also noted.
- The reports screen has not been checked at 1024 px, only at 1280. The
  two-column small multiples in "Average days in stage" are the part most likely
  to want a stacked fallback there.

### Contract changes needed

1. **Two shared test files were edited, and they are in this commit.**
   `tests/repo/migrations.test.ts` and `tests/repo/boot.test.ts` both asserted a
   hard-coded `["0000_init", "0001_search"]`, so any new migration turned them
   red. Both now read the journal through `diskMigrationSource` and compare
   against that, which means the next agent to add a migration does not have to
   come and edit them. No behaviour changed.
2. **Repository functions this feature wrote for itself, under
   `src/features/leads/lib/`, for promotion if anyone else needs them:**
   `applyLeads.ts` builds the deal and `deal_stage_events` insert statements by
   hand because `deals.ts` exposes `create` (which takes the write lock) but no
   `createStatements`, unlike `contacts.ts` and `activities.ts`. A
   `deals.createStatements` would let the poller drop that duplication, and the
   CSV import will want the same thing if deals are ever importable.
   `reportQueries.ts` is the read layer over the new views and would sit
   naturally in `src/db/repos/reports.ts`.
3. **`/settings/site` is registered by this feature as well as being exported.**
   The settings feature still registers `/settings/:section`, and the registry
   puts leads ahead of settings, so wouter's Switch matches the exact path first.
   That works, but it means the screen renders outside whatever chrome the
   settings shell puts around its other sections. Once settings mounts
   `SiteConnectionScreen` itself, the route here should be removed.
4. **Sonner's `<Toaster>` in `src/app/Shell.tsx` has no `theme` prop**, so toasts
   render light on a dark app — visible in
   `tests/e2e-mac/.cache/screens/leads/site-dark.png`. It needs
   `theme={resolvedTheme}` from the shell's appearance state. Foundations owns
   that file, so it is reported rather than changed.
5. **`--stage-6` is below the dataviz chroma floor** (0.077 against 0.1) and reads
   close to grey at small sizes. Not a blocker — it passes every separation and
   contrast check and only the two-series won/lost chart uses it — but if the
   design agent ever revisits the ramp, that is the slot with the least chroma to
   spend.

---

## 2026-09-18 — Wave 3 reconciliation agent (shared layers, cross-feature seams)

### Did

**1. Promoted the feature-local shared code and repointed every import.** The
table of what moved where is in docs/CONTRACTS.md under "Wave 3 reconciliation";
the short version:

- Six reads out of `features/today/lib/` into the repositories they belonged
  to (`deals.newLeads`, `activities.lastActivityFor`/`recentWithLinks`,
  `tasks.taskLinks`, `seed.workspaceIsEmpty`) plus `searchRows`/`recentRecords`
  into `db/repos/search.ts`, beside the `searchGrouped` they are the second
  pass over. `todayData.ts` and `searchRows.ts` are gone.
- `features/data/lib/csv.ts` → `src/lib/csv.ts`, where CONTRACTS always said it
  lived.
- The data agent's ten statement builders out of `importWrite.ts` and into the
  repository for the table each one writes; `planBatch`, `coalesceInserts`,
  `MAX_BOUND_PARAMS` and the `Statement` type into `db/repos/_base.ts`.
  `importWrite.ts` is gone and `importRun.ts` imports from five repositories.
- The whole-workspace duplicate scan: `findContactPairs` → `contacts.ts`,
  `findCompanyPairs` → `companies.ts`, the shared `DuplicatePair` shapes and
  `pairKey` → `_base.ts`. What is left in `features/data/lib/duplicates.ts` is
  the 24-hour schedule and the merge-field picker, which are screen state.
- `features/leads/lib/reportQueries.ts` → `db/repos/reports.ts`, and with it
  `features/leads/lib/periods.ts` → `src/lib/periods.ts`, because a repository
  may not import a feature.
- **`deals.createStatements`** added, and `applyLeads.ts` now uses it instead
  of building the deal and its first `deal_stage_events` row by hand.
- The two copies of the one-tap action helpers (`features/today/actions.ts` and
  `features/records/lib/{oneTap,links}.ts`) merged into **`src/lib/actions.ts`**.
  Both offer styles survived because they are two moments, not two opinions:
  `oneTap()` opens and toasts a "Log it" button (record screens), `openTel()`
  opens and hands back a `logThis` callback (Today's rows render their own).
  `tests/unit/records/links.test.ts` moved to `tests/unit/actions.test.ts`.

**2. `undoBatch` can undo a soft delete.** `_base.softDeleteRow` now logs
`before: { deletedAt: null }`. `undoBatch`'s `delete` branch tells the two kinds
of delete apart by whether `before` carries an `id`: no `id` means a soft delete
and the columns are written back (which clears `deleted_at`, keeping the row's
id, timestamps and children); an `id` means a hard delete and the row is
re-inserted. `restore()` is untouched and is still what the delete toasts call.
Three new cases in `tests/repo/records/undoFlow.test.ts` prove both paths and
that they agree. The rule is in CONTRACTS.

**3. `deals.board()`** returns one entry per live stage in stage-position order,
empty stages included. `PipelineBoard` and the `boardMoves` test helper no
longer drive the columns from `stages.list()` and look each group up. Two new
cases in `tests/repo/deals.test.ts`, including a reorder.

**4. Shell.** The sonner `<Toaster>` gets `theme` from the appearance hook
("auto" maps to sonner's "system"), so toasts are no longer light on a dark app.
The sidebar footer runs the `"switch-workspace"` command when the registry has
one — looked up at click time, so it degrades to plain text while Settings is
still being built. `FeatureModule.navProvider?: () => FeatureNavSection[]` is
new: a hook slot the shell calls every render, whose sections are spliced into
the static nav at their `order`. Today uses it for pinned saved views
(`views/pinnedNav.tsx`, order 15), so there is a real "Views" group in the
sidebar and `PinnedViewsStrip` is deleted.

**5. One search.** Cmd/Ctrl+K runs the registered `"search"` command if there is
one and opens the palette if there is not; the palette moved to
Cmd/Ctrl+Shift+K; the search dialog carries a "Commands" button back to it
(`openCommandPalette()` fires `helix:open-palette`, since the dialog renders in
its own React root). The topbar's "Search everything" button runs the same
lookup. Cmd/Ctrl+/ stays as an alias. Two e2e tests updated and one added.

**6. Harness.** `fixtures.ts`'s page-side `invoke` takes the request `options`
and reads the path out of `options.headers.path` the way plugin-fs v2 sends it,
so a `write_text_file` no longer lands under the key `"undefined"`; the payload
is decoded from bytes. New stubs for `read_dir`, `copy_file`, `remove`,
`stat`/`lstat` and `size`, all derived from the same flat `state.files` map,
with directories implied by key prefixes, plus `db_backup` registering its path
so the backups list has something to read. `playwright.config.ts` derives
`outputDir` (and the CI report folder) from `E2E_OUT`. Every spec in scope
destructures `helix`, and the rule is now in the fixture's header comment.

**7. `TIME_BUDGET_MS`** is used (someone had already fixed it); `npm run
typecheck` is clean across the repo.

**8. Saved views** are wired into Contacts, Companies, the pipeline's deals list
and Data's duplicates list. Two new pieces make that one screen's worth of work
rather than four: `views/screenState.ts` (`queryFromState`, `stateFromQuery`,
`sortIdOf` — pure, unit-tested) and `views/ViewsToolbar.tsx` (the Views popover
and Save view as one control). `ContactsScreen` is the reference implementation
and `views/README.md` documents the pattern. Pinned views land in the sidebar
group from item 4 and their `?view=<id>` deep link is applied once when the row
loads.

**9. Data's `AttachmentList`** is mounted on the contact, company and deal
pages, in the details column, as its own card below the Details panel. The AI
buttons were deliberately not mounted.

### Verified

- `npm run typecheck` — clean.
- `npm test` — 58 files, 731 tests, all passing.
- `npx vite build` — succeeds.
- `E2E_PORT=4186 E2E_OUT=dist-recon npx playwright test -c tests/e2e-mac/playwright.config.ts`
  over `{smoke,records,today,data,leads}.e2e.ts` — **37 passed** in 45.7s.
  Settings and AI were not run: that agent is still working.

### Not done

- `src/features/settings/**`, `src/features/ai/**` and their tests: another
  agent owns them and was running throughout. The AI buttons on record pages,
  the `/settings/site` duplicate route and moving `/backups` under
  `/settings/backups` are all still open, and all three need that agent to land
  first.
- `src/ui/**` and `src/styles/app.css`: the design agent owns them and was
  editing them throughout. Nothing here touched either.
- The remaining ORCHESTRATION wave-3 items that are not seams: the real Tauri
  launch, the release checklist, customer zero, the template port, the README.

### Contract changes needed

Nothing blocking. Three things the next agent should know:

1. **The e2e fs stubs are an in-memory map, not a filesystem.** A restore under
   the harness copies a placeholder string between keys in `state.files`; the
   real backup file that `DbBridge.backup()` writes to the temp directory is
   never copied over the real database. So the backups list and the restore
   *flow* can now be exercised end to end, but "the restored database has the
   old rows in it" cannot be. Making that real means giving the Node side
   (`page.exposeFunction("__helixInvoke")`, which currently throws) a small
   real-fs handler for `copyFile`/`readDir`/`stat`. Until then, restore stays on
   the manual Tauri checklist.
2. **`src/lib/actions.ts` is the one impure module in `src/lib`** — it reaches
   the OS opener, the activities repository, the query client and the toaster.
   That is deliberate and written into CONTRACTS; do not "fix" it by splitting
   it, which is what produced two copies in the first place.
3. **`navProvider` is a React hook slot.** It is called during the shell's
   render, so it must obey the rules of hooks, and the provider list has to stay
   stable — which it is, because the registry is fixed at module load. A feature
   that wants a dynamic nav section adds one; it must not call it conditionally.

Two smaller notes that were reported by wave 2 and are still open because they
belong to whoever owns the file: `contacts.updateEmail` (changing an email's
label loses the row id) and `tags.indexFor(entityType)` (the tag column on a
list walks every tag today).
