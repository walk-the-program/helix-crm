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

---

## 2026-09-18 — UI polish agent (`src/ui`, the component kit)

### Did

**Held every primitive in `src/ui/**` against `docs/DESIGN.md` and fixed 33
defects.** The kit was written in parallel with the design direction, before
`--control-h`, `--control-h-sm`, `--color-accent-ink`, `--color-hover`,
`--color-selected`, `--color-sidebar`, `--color-overlay` and the `-ink` semantic
tokens existed, so it had drifted in three systematic ways. Every finding, the
measurement or screenshot that caught it, and the fix is in
`design/ui-review.md`.

1. **The accent was in the chrome, in five places.** The sidebar's active item,
   every dropdown and select highlight, the selected table row, the active tab,
   and the checkbox/switch "on" fill were all `--color-accent` or
   `--color-accent-soft`. That is the defect `design/review.md` finding 1 fixed
   in the comps, shipped again in the kit: with the sidebar and the menus
   carrying it, the accent was on screen at all times and stopped meaning "this
   needs you". All five are now `--color-selected` or ink.
2. **Accent-coloured *text* used `--color-accent`** (4.44:1, fails AA) on
   `Badge`, and every semantic tone used its fill colour as its label colour.
   All tones are now `-soft` fill with `-ink` label — the feature code had
   already worked around this from outside in `TaskRow.tsx`.
3. **No control used the control tokens.** Every height came off the *spacing*
   scale: buttons were 48 px where the contract says 36, small buttons 40 where
   it says 32, and inputs, selects, tabs and nav items 48. Checkboxes were a
   15 px hit target in compact. Everything now uses `--control-h` /
   `--control-h-sm`, every button carries `flex: none`, and body type is
   `--text-base` rather than 14 px.

Also: `--color-overlay` for the dialog scrim (it was `--color-text` at 40 %
opacity), resting surfaces off `--color-surface-raised`, `--color-sidebar` on
the rail, radii onto their assigned steps, no all-caps labels, "Required" as a
word, `--color-danger-ink` for error text with the 16 px alert icon, one shared
focus ring at `--color-focus` / 1 px offset, tokenised durations plus
`motion-reduce:transition-none`, `loadingLabel` on `Button`, non-dismissing
error toasts with "Copy details", `data-numeric` on right-aligned cells, sticky
`THead`, a `TFoot` totals row, and `TD primary` / `TD muted`.

**`src/styles/app.css`: the Tailwind 4 `@theme` block.** `bg-surface`,
`text-muted`, `border-strong`, `text-accent-ink` and the whole semantic set
(including the stage ramp) now exist. Tailwind's colour namespace *is*
`--color-*`, which collides with the token names, so each token is mirrored onto
a private `--tok-*` alias that `@theme inline` reads; the aliases are declared on
`:root` and on `[data-theme]` so a scoped theme re-derives them. Verified in the
built CSS that the layer order still puts `tokens.css` (base) above the theme
block, so the ~400 existing `bg-[var(--color-surface)]` usages across the
features are untouched.

**`design/ui-screens/gallery.html`** — 174 specimens across 22 sections,
generated from the real components by `tests/unit/ui/gallery.test.ts`, with a
theme/density toggle and `?theme=&density=` parameters. Four full-page
screenshots at 1280 (light, dark, and both compact) and four contrast audits sit
beside it.

**`tests/unit/ui/`** — 32 tests: Dialog focus trap and Escape, DropdownMenu
keyboard, VirtualList windowing over 10 000 rows, Field error wiring, Button
disabled/loading semantics, and the gallery generator's own assertions.

### Verified

- `npm run typecheck` — clean.
- `npm test` — 59 files, 738 tests, all passing.
- `npx vite build --outDir dist-ui` — succeeds; `dist-ui` deleted.
- `design/contrast-audit.js` against the gallery in all four modes —
  **408 text elements measured per mode, 0 failures.**
- Measured in the browser: 162 buttons, every one exactly 32 or 36 px
  comfortable (28/32 compact); **0** interactive elements under the 32 × 32 /
  28 × 28 hit-target floor; the same page 22 % shorter in compact with body type
  unchanged at 15 px.
- 0 console errors and 0 failed requests on all four gallery loads.
- Screenshots looked at, not just captured: the first pass is what caught the
  totals row covering the column header and the 47-character name wrapping a
  table row to two lines.

### Did not do

- No feature screen was touched. Several changes are visible in feature UI
  (buttons and inputs are 36 px rather than 48, the sidebar's active item is
  blue-grey rather than orange, tables get sentence-case headers), but no call
  signature changed and no prop was renamed — everything added is additive and
  optional.
- Did not run the e2e suites; other agents were using them. Some e2e screenshot
  baselines will have moved.
- Did not touch `tokens.css`, `globals.css`, `vitest.config.ts` or
  `package.json`. The test files are `*.test.ts` with their JSX in `.tsx`
  helpers precisely so `vitest.config.ts` did not have to change.

### For other owners

1. **`<Toaster>` in `src/app/Shell.tsx` needs `position="bottom-left"` and
   `visibleToasts={3}`** to match `DESIGN.md` §9. `src/ui/toast.ts` can set
   durations and actions but not placement or stack depth. (The missing `theme`
   prop on the same element is already reported by the leads agent above.)
2. **`src/features/records/components/TaskRow.tsx:130`** carries a
   `className="text-[var(--color-accent-ink)]"` override that patched the Badge
   defect from outside. It is redundant now.
3. **Feature tables should adopt `TD primary` / `TD muted` and `TFoot`.** `TD`
   still defaults to full-strength ink rather than the muted default §9 asks
   for, because defaulting to muted would have greyed the name column in every
   table already built.
4. No contract change is needed. No token was added or renamed.

---

## 2026-09-18 — Settings and AI agent

Scope touched: `src/features/settings/**`, `src/features/ai/**`,
`tests/unit/{settings,ai}/**`, `tests/repo/{settings,ai}/**`,
`tests/e2e-mac/specs/{settings,ai}.e2e.ts`, this file. Nothing else.

### Did

**Settings (`src/features/settings/`)**

`index.tsx` registers nine routes — `/settings` (the index), `/settings/workspace`,
`/vocabulary`, `/tags`, `/fields`, `/appearance`, `/shortcuts`, `/workspaces`,
`/diagnostics` — the Settings nav item at order 90, and four commands:
`open-settings` (mod+,), `toggle-theme`, `switch-workspace`, `show-shortcuts` (?).
`lib/sections.ts` is the single list the index grid and the section rail both
read, including the four rows other agents own and this feature only links to
(`/pipeline` for stage management, `/settings/site`, `/backups`, `/trash`).

- **Overview**: a two-column index of every section, each with one line saying
  what it is for.
- **Workspace**: the business name — written to both the settings table and
  `helix.json`, because the workspace list reads it while that file is closed —
  plus currency, locale and default phone region, each with a live sample built
  from `src/lib/money` and `src/lib/dates` so the choice is legible before it is
  made.
- **Vocabulary**: Deals / Jobs / Quotes, saved on selection, with a preview
  driven by the radio's own state so it updates before the query round-trips.
- **Tags**: create with a colour from the stage ramp or a neutral, rename,
  recolour, delete behind a confirm that names the tag and its usage count.
- **Custom fields**: per entity type; create (text, number, date, choice with
  options), rename, reorder, delete behind a confirm naming the number of stored
  values. Kind is locked on edit: changing it would orphan the values.
- **Appearance**: theme and density through `appSettings`, live, no Save button.
- **Shortcuts**: every command in the registry, grouped, plus the shortcuts the
  shell owns, as both a screen and a sheet on `?`.
- **Workspaces (E7)**: the list from `helix.json` with each one's last poll and
  last backup; create (new uuid, `<workspacesDir>/<uuid>/helix.db`, then
  `switchWorkspace`), rename, switch, archive and unarchive. Switching is
  refused with a sentence while a write holds the lock. Archiving deletes that
  workspace's `anthropic` and `site` secrets and never touches a file, and the
  confirmation says exactly that.
- **Diagnostics**: version, data path, DB size, SQLite version, FTS5, migration
  version, last backup, site origin, last poll and last poll error, the write
  queue, whether the keychain answers, Copy log and Reveal data folder. Every
  reader returns a value or a stated reason instead of throwing, which is why
  the screen renders in full under the e2e stubs.

**AI (`src/features/ai/`)**

- `provider.ts`: `AiProvider` — `extractRecord`, `draftFollowUp`, `summarize`,
  `testKey` — over `POST <baseUrl>/v1/messages` with `x-api-key`,
  `anthropic-version: 2023-06-01`, an explicit `max_tokens`, and structured
  output through `output_config.format = { type: "json_schema", schema }`. Model
  ids, the wire shape and the two traps below come from the `claude-api` skill,
  read on the day, not from memory: `temperature` is removed on the Claude 5
  models and 400s if sent, and `output_config.effort` is rejected by Haiku 4.5,
  so it is only sent for the models that take it. Default model
  `claude-sonnet-5`, with `claude-opus-5` and `claude-haiku-4-5` offered.
- The fetch is injectable. By default it is `fetch` from
  `@tauri-apps/plugin-http`, so the request is made in Rust and the CSP stays
  `connect-src 'self'`; under the e2e build it falls back to the browser's fetch,
  the same way `boot.ts` swaps the database driver.
- Named errors: `AiKeyMissing`, `AiKeyRejected` (401/403, carrying the API's own
  message), `AiRequestError` (429 / 5xx / network, retried once, and a model
  refusal marked not-retryable), `AiParseError` (keeps the raw text, which the
  paste dialog shows under "What it actually said").
- `/settings/ai`: the on/off switch (`aiEnabled`, default false), a write-only
  key field that goes straight to `secret_set` and is never read back, the model
  picker, "Test key" (one tiny request), and a plain-language block on what is
  sent and when. A `KeychainError` on save shows the plan's sentence and leaves
  AI off.
- The three actions are exported components, documented with their props in
  `src/features/ai/README.md`. Each is visible but disabled, with a one-line
  reason and a link to settings, when AI is off or the key is missing or
  rejected. `PasteToRecordDialog` is also mounted by this feature on
  `mod+shift+v`, so paste-to-record works in v1 without any Records change.
  Confirm writes the contact and the deal in one transaction under one batch id.

### Verified

```
$ npm run typecheck
(no output)

$ npm test
 Test Files  59 passed (59)
      Tests  738 passed (738)

$ npx vite build --outDir dist-settings
✓ built

$ E2E_PORT=4185 E2E_OUT=dist-settings npx playwright test -c tests/e2e-mac/playwright.config.ts \
    tests/e2e-mac/specs/settings.e2e.ts tests/e2e-mac/specs/ai.e2e.ts
  17 passed (12.4s)
```

48 of those unit and repo tests are new: the provider against an injected fetch
(success, the header and body shape, 401, 429 with its retry, a 500 that clears
on the retry, a dropped connection, malformed JSON, JSON of the wrong shape, a
refusal, an empty paste that never reaches the network, and a sweep proving the
key appears in no console line, no URL, no request body and no error object);
the masked suffix; the shortcuts grouping; the settings keys this feature adds;
and `createFromProposal` (both rows, the stage event, one batch id, position,
currency, and nothing written when the workspace has no stages).

The 17 e2e cover: the index listing every section including the four another
feature owns; vocabulary changing the preview and the stored setting; theme and
density setting the `<html>` attributes and reaching `helix.json`; creating a tag
and a custom field and finding them in the database through the bridge;
Diagnostics rendering under the stubs; creating a second workspace and proving
the open SQLite file actually changed (`bridge.info().path`), with `helix.json`
listing both; archiving it, with `secret_delete` recorded for both kinds; `?`
opening the sheet; AI off showing the disabled reason; saving a key and proving
only the last four reach the database; "Test key" arriving at a local fake on
127.0.0.1:4795 with the right headers; paste-to-record extracting, editing and
confirming into real rows; and a 401 producing AiKeyRejected and disabling the
actions. Both specs screenshot their screens at 1280 in light and dark into
`tests/e2e-mac/.cache/screens/settings/` (22 images).

Four things the screenshots caught and this agent fixed: the settings column was
capped at `--content-max` (a prose measure) and squeezed the tables; the async
screens flashed a bare spinner, which §8 does not want and which reads as a
broken screen (now a quiet "Reading…" line); the radio controls painted their
selection in the accent, which §5 reserves for "this needs you" (now ink); and
the paste dialog ran its footer off the bottom of a short window, because the
shared `DialogContent` is centred and unbounded (capped and scrolled locally —
see the note for `src/ui` below).

One app bug the e2e suite found and this agent fixed: switching workspaces left
the mounted list showing the workspace the owner had just left as the open one.
Every `db_open` calls `resetQueryCache()` (`queryClient.clear()`), which removes
the registry query outright, so the `invalidateQueries` that followed the switch
had nothing to mark stale. `lib/queries.ts` now exposes `refetchRegistry`, which
`fetchQuery`s the key back into the cache, and the screen bumps a state counter
so the mounted observer rebuilds against it. Asserted in the archive test.

### Not done

- **The sidebar footer still does not open the switcher.** It shows the open
  workspace's name, which is where a switcher belongs, but `src/app/Shell.tsx`
  belongs to foundations. The picker is reachable from the palette
  ("Switch workspace") and from Settings > Workspaces. The change is one
  `onClick` — see below.
- **No stage management screen.** The Stages row links to `/pipeline`, where the
  records agent owns the dialog, exactly as briefed.
- **The keychain is only ever exercised against the e2e stub.** `secret_*` is
  Rust; the real macOS and Windows stores are still unproven from this side, and
  the foundations agent reported the same gap. It needs a manual first-run check.
- **The provider has never spoken to the real Anthropic API.** Every test drives
  a local fake. The wire shape is from the `claude-api` skill and the fake mirrors
  it; the first real call is a manual step.
- **No `draftFollowUp` or `summarize` e2e.** Both are unit-tested against the
  injected fetch and both components are built, but nothing in v1 mounts them
  yet, so there is no screen to drive them from. They are one import away
  whenever Records wants them (README documents the props).
- **`ai_base_url` has no field on the AI screen.** It is a settings row the e2e
  suite points at its fake; exposing it to the owner would be a footgun, so it
  stays a row.
- **No Windows e2e.** Workspace switching is in the plan's Windows list, and this
  agent cannot run it.

### Contract changes needed

1. **Promote three settings keys into `src/db/repos/settings.ts`**: `aiKeySuffix`
   (`string | null`, default null), `aiKeyState` (`"unset" | "saved" | "rejected"`,
   default "unset") and `aiBaseUrl` (string, default
   `https://api.anthropic.com`). They are declared with zod and read and written
   through `getRaw`/`setRaw` in `src/features/settings/lib/extraKeys.ts` until
   then. Note also that the plan's `ai_enabled` and `ai_base_url` are the
   repository's `aiEnabled` and `aiBaseUrl`: the registry is camelCase.
2. **`settings.aiModel`'s default is `claude-sonnet-4-5`, which is not a current
   model id.** `readAiConfig` substitutes `claude-sonnet-5` for any id the
   provider does not know, so nothing breaks, but the registry default should be
   corrected at the source.
3. **`deals.createStatements`** does not exist. Paste-to-record has to write a
   contact and a deal in one transaction, the write lock is not reentrant, and
   `contacts.createStatements` already exists for the CSV import — so the deal
   half is built in `src/features/ai/lib/proposal.ts`, mirroring `deals.create`
   exactly (row plus the first `deal_stage_events` entry). Promote it and delete
   the local copy.
4. **`customFields.valueCount(fieldId)`** does not exist; "delete this field" has
   to say how many values it would take with it. Written in
   `src/features/settings/lib/counts.ts`, along with a read of
   `schema_migrations` for Diagnostics that probably belongs in the db layer.
5. **The shell binds no command shortcuts.** It binds `mod+k` and the palette,
   and draws every other command's `shortcut` in the palette without registering
   it, so `mod+,` and `mod+shift+v` would be decorative. This feature binds its
   own from an overlay host. The shell binding `allCommands()` centrally would
   remove that whole mechanism.
6. **`FeatureModule` has no slot for an always-mounted overlay.** The shortcuts
   sheet, the workspace picker and the paste dialog have to exist on every
   screen, so `src/features/settings/lib/overlayHost.tsx` mounts a second React
   root on `<body>` sharing the app's QueryClient, from `onBoot`. An
   `overlays?: ReactNode[]` field on `FeatureModule` would make that a one-liner
   and keep everything in one tree.
7. **The sidebar footer should open the workspace picker.** In `Shell.tsx`, make
   the footer a button whose `onClick` runs the `switch-workspace` command (or
   imports `workspacePicker.open` from
   `@/features/settings/components/SettingsHost`).
8. **`src/ui/Dialog.tsx`'s `DialogContent` is centred with no height bound**, so
   a form taller than the window runs its footer off-screen and unreachable —
   the paste dialog hit exactly that, and e2e caught it as "element is outside of
   the viewport". It is capped locally with `max-h-[85vh] overflow-y-auto`; the
   shared component should do it for everyone.
9. **Observation for whoever owns the leads path**: `src-tauri/src/leads.rs`
   reads `settings.site_origin`, while the TypeScript settings registry stores
   that key as `siteOrigin`. Nothing this agent owns depends on it, but the two
   spellings cannot both be right.

---

## 2026-09-19 — Redesign agent (Apple-like minimalist direction)

Walker looked at the build and said the design was still sloppy, and asked for a
truly Apple-like one. The previous direction — light-first, one equipment-orange
accent, dense ledger tables — is rejected and superseded.

### Did

**`docs/DESIGN.md`** — rewritten as revision 2 and re-issued as the contract.
The reference is the software already on the owner's Mac: a translucent grey
sidebar against white content, one hairline between them, a selected row marked
by a soft blue tint and heavier text, grouped inset lists, 11-to-28px system
type, and a lot of air. Twelve sections with concrete values, a do/don't list,
one paragraph per component type, and a **Superseded** section at the bottom
naming what was rejected and the five specific reasons, so it is not rebuilt by
accident. The audience research, the two sentences the product is measured
against, the no-dark-patterns rule and the token architecture all carried over.

**`src/styles/tokens.css`** — rewritten.
- Canvas `#FBFBFA`, surfaces `#FFFFFF`, sidebar `#F7F6F3`, hairlines
  `rgba(0,0,0,0.06)` and `rgba(0,0,0,0.13)`. Dark is true Apple greys: `#1E1E1E`
  canvas, `#2A2A2A` surface, `#323232` raised, white hairlines at 8%.
- Ink `#1D1D1F` / `#56565A` / `#6E6E73`. Apple's own label greys measure 2.57:1
  and 3.62:1 on white and cannot carry text, so the ramp ships the accessible
  cousins and `#A1A1A6` survives only as `--color-text-disabled`.
- `--color-accent` is now the near-black primary fill (`#111111`), inverting to
  `#F5F5F7` in dark. There is no coloured accent in the product any more.
  System blue does three things: the focus ring (`#007AFF`), link text
  (`#0B62D6`, because `#007AFF` fails AA at 15px), and the 10% selected tint.
- Every tag, badge, stage and semantic state is a muted pastel with its own dark
  ink partner, measured and documented inline. The eight-stage ramp is pale
  slate / blue / lavender / teal / green / red / clay / yellow, and keeps its
  identity across themes.
- Type: system stack, no serif, body 15px comfortable / 13px compact on 1.5,
  titles 20-28px semibold at -0.01em, and a new `--text-label` (11px, uppercase,
  0.05em) which is the only capitals in the product.
- One shadow, `0 2px 8px rgba(0,0,0,0.04)`, and only a floating layer wears it.
  `--shadow-sm` is `none`.
- Sidebar 240px, top bar 48px, rows 40/32, controls 32/28, radius 6 on controls
  and 10 on containers, motion 150-200ms ease-out with a `scale(0.98)` press.

**`globals.css` / `app.css`** — heading scale re-pointed, a `.section-label`
rule added, links set in the interactive blue, `kbd` rebuilt as a flat system-sans
chip, scrollbars quietened. The `--tok-*` mirror and the `@theme inline` block in
`app.css` were extended with the new names (`--color-text-disabled`,
`--color-link`, `--color-tint`, `--color-info*`) and the `@source inline` list
updated, so the Tailwind utility names keep working under a scoped `data-theme`.

**`src/ui/**`** — every primitive restyled to the contract. Button gained a
text-only `destructive` variant (with `solid` for a dialog's confirm) and the
press scale; Input gained a `search` form; Table lost its zebra-era header,
row rails and second type size and gained small-capitals column labels; Card
became a grouped inset list with `CardRow` and `CardGroupLabel`; Badge became a
muted pastel pill; EmptyState is centred with no glyph; Nav, Kbd, Checkbox,
Switch, Tooltip, DropdownMenu and Select all moved to the new tokens. Every
export name and prop is unchanged; `Button.solid`, `Input.search`, `CardRow`,
`CardGroupLabel` and two new `styles.ts` fragments are additions.

**`src/ui/icons.ts`** (new) — the Lucide-to-Phosphor map. All 86 Lucide names
the product used are re-exported under both their Phosphor name and their old
spelling, so a feature migrates by changing the import path alone. 18px regular
in lists, 16px bold in buttons. `src/ui` and `src/app` are clear of
`lucide-react`. It is deliberately not re-exported from `src/ui/index.ts`
(`Table`, `Check` and `X` would collide with components).

**`Shell.tsx` / `CommandPalette.tsx` / `BootScreens.tsx`** — the sidebar is the
240px tint with a hairline right edge and a small grey workspace name in the
footer; the toolbar is 48px white with a hairline bottom, a macOS-style soft grey
rounded search field, and a monochrome theme toggle; the palette is a Spotlight
panel held 14% down the window.

**Fixed, from item 8 of the previous entry:** `DialogContent` is now
height-bound — capped at `100vh - 2 × 48px`, one internal scroll box, and the
header and footer stick to its top and bottom. All 14 dialog call sites in
`src/features` get the fix without changing a line, and it is asserted in
`tests/unit/ui/dialog.test.ts` because the gallery harness neutralises
`position` and cannot show it.

### Evidence

`design/apple/review.md` — ten defects with the screenshot that caught each and
the fix. Gallery regenerated with three new specimens and screenshotted full-page
at 1280 in light, dark, comfortable and compact
(`design/apple/gallery-1280-*.png`, plus 32 per-section crops in
`design/apple/sections/`). `design/contrast-audit.js` run in all four modes:
**0 failures, 428 text elements measured in each**
(`design/apple/contrast-*.json`). Console clean, two requests per load.

`npm run typecheck` clean. `npm test` 59 files / 739 tests green.
`npx vite build --outDir dist-redesign` succeeds; the directory was deleted.

### For the feature sweep agents

1. Change `from "lucide-react"` to `from "@/ui/icons"`. Nothing else. Every old
   name is re-exported; the icon takes `size` and `weight`, not `strokeWidth`.
   18 regular in a list, 16 bold in a button, one weight per cluster.
2. Delete every local colour. `--color-accent` is black now, not orange: a
   feature that painted "needs you" orange must convey it by position and
   weight instead. Anything that used `--color-accent-soft` as an attention tint
   wants a muted pastel (`--color-info-soft` and friends) or nothing.
3. Drop `shadow-[var(--shadow-sm)]` wherever it appears: it resolves to `none`.
4. Sizes moved. Body is 15px, rows are 40px, controls are 32px. A hard-coded
   `h-[40px]`, `text-[16px]` or `w-[18px]` breaks compact — use the tokens.
5. Table headers, group labels and nav section labels are the 11px small-caps
   style; nothing else in a feature screen is uppercase.
6. Empty states pass a title, one sentence and one primary button. The `icon`
   prop still compiles and is not drawn.
7. No new hex. `tokens.css` is still the only file in the repo with a colour in
   it.

### Notes for whoever comes next

1. **`src/features` is untouched by this pass** and is currently a mix of the old
   orange-era classes and the new tokens. It will look inconsistent until the
   three sweep agents land.
2. **The gallery cannot photograph an overlay's geometry.** Its harness forces
   `position: static` on portalled content, so dialog, popover and select
   specimens show their close buttons and sticky edges in the wrong place. That
   is the harness, not the kit; anything positional has to be asserted in a test.
3. **`Shell` and `CommandPalette` have no gallery specimen** because the gallery
   imports only from `src/ui`. Adding one means pulling in the registry and the
   router, which is a bigger change than it looks.
4. **`--color-accent` is a misleading name now** that it is a neutral fill rather
   than an accent. It is kept because `docs/CONTRACTS.md` fixes the name and
   every feature reaches for it; renaming it is a repo-wide change for a word.

---

## 2026-09-19 — Shell seams agent (`src/app`, `src/db`, `src/lib`, vite config)

Scope touched: `src/app/**`, `src/db/**`, `vite.config.ts`, `tests/unit/app/**`,
`tests/repo/**`, `docs/CONTRACTS.md`, this file. Nothing in `src/features`,
`src/ui`, `src/styles`, `src-tauri` or `package.json` — three design sweep agents
were editing features throughout. The redesign agent's visual work in
`Shell.tsx`, `CommandPalette.tsx` and `BootScreens.tsx` is untouched: every
change here is behaviour.

This closes the seams between the features and the shell. Three mechanisms every
feature had invented for itself, because the shell had no slot for them, are now
the shell's job.

### Did

**1. The shell binds every command's shortcut.** `src/app/shortcuts.ts` is new
and is the whole mechanism; everything in it but the hook is pure, with no
runtime import beyond React, so the rules are unit-testable without a DOM and
without pulling the registry — and therefore every feature — into a test.
`Shell` calls `useCommandShortcuts(allCommands(), { reserved: SHELL_OWN_SHORTCUTS })`
and one `keydown` listener answers the lot. The rules, all of them now in one
place instead of four:

- `mod` is Cmd on macOS and Ctrl elsewhere, and the **other** platform's
  modifier must not be held: Ctrl+Cmd+K is not Cmd+K. Shift and Alt match
  exactly.
- The only modifier names are `mod`, `shift` and `alt`. `"ctrl+k"` and
  `"cmd+k"` are refused rather than guessed at — `parseShortcut` returns null,
  the palette still prints the string, nothing is bound, and a bad string can
  never throw during a keypress.
- A bare key (`"?"`, `"g"`) matches on `event.key` and says nothing about Shift,
  because the browser has already applied it: `?` is Shift+/ on a US keyboard
  and its own key elsewhere.
- **Typing suppresses every shortcut.** An `INPUT`, `TEXTAREA`, `SELECT` or
  contenteditable target means the owner is typing. A command that genuinely
  needs its key inside a field opts in with the new
  **`FeatureCommand.whileTyping`**; a bare key is never bound while typing, with
  or without the flag, because a bare key is what the owner is typing.
- Key repeats, IME composition and an already-`defaultPrevented` event are
  ignored. Registry order breaks a tie, which is also the palette's order, so
  two features claiming one key is visible rather than random.

`mod+k` and `mod+shift+k` stay the shell's own and the generic binder skips
them: they are lookups, not commands (`mod+k` runs whichever feature owns
`"search"` and falls back to the palette). So "One search" is unchanged.

**The features' four overlay hosts still work and do not double-fire.** On a
match the handler calls `preventDefault`, `stopPropagation` **and**
`stopImmediatePropagation`. The last one is what actually does the work: two
listeners on `window` are not in a propagation relationship, so `stopPropagation`
alone would not stop the second one. It is correct only because the shell
registers first — a feature's `onBoot` runs after the shell's first paint — and
because the hook's effect deps are stable, so a re-render never re-registers the
listener behind a feature's. Both facts are commented at the code.

`useShortcut` survives for a key that belongs to a *component* rather than to a
command, and now shares the parser instead of carrying a second copy of it.
`isMac()` moved next to the parser and is re-exported from `hooks.ts`, so every
existing import still resolves.

**2. `FeatureModule.overlays?: ReactNode | (() => ReactNode)`.** Rendered by the
shell inside its own providers, on every screen, below the routed screen and
outside `<main>`. A function is rendered as a component (`<Overlays/>`), so it
gets its own render and may use hooks — it is not the delicate hook slot
`navProvider` is. `allOverlays()` in the registry is what the shell reads; it is
a `.ts`, so it reaches for `createElement`.

The slot is **provided, not adopted**: migrating quick add, the AI paste dialog,
the search dialog and the settings host off their second React roots is the
owning agents' call, and they were all busy. Each of those is now a one-line
change (`overlays: <QuickAddDialog/>`) plus deleting the host.

**3. The sidebar footer** already ran the `"switch-workspace"` command — the
reconciliation agent wired it, and it holds up: `findCommand` is called at click
time, and with no such command the footer is plain text. Now proved by
`tests/unit/app/shellFooter.test.ts` rather than by reading it.

**4. Three AI settings keys promoted** into the typed registry in
`src/db/repos/settings.ts`: `aiKeySuffix` (`string | null`, null),
`aiKeyState` (`"unset" | "saved" | "rejected"`, `"unset"`) and `aiBaseUrl`
(string, `https://api.anthropic.com`). The AI feature's `defineExtraSetting`
wrappers read and write through `getRaw`/`setRaw`, which are key-agnostic, so
nothing in `src/features` had to change and nothing there broke.
`src/features/ai/lib/aiSettings.ts` can shrink to `settings.get`/`settings.set`
whenever that agent next opens the file. **`aiModel`'s default is corrected** to
`claude-sonnet-5`: the old `claude-sonnet-4-5` is not a model id, the string
appeared nowhere else in the repo, and nothing asserted it.

**`deals.createStatements` confirmed present** in `src/db/repos/deals.ts` (the
reconciliation added it) and `applyLeads.ts` uses it for the deal and its first
`deal_stage_events` row. Nothing to do. The duplicate in
`src/features/ai/lib/proposal.ts` is still there and is the AI agent's to delete.

**5. `vite.config.ts` watch ignores** `tests/e2e-mac/.cache/**`, `dist-*/**`,
`design/**` and `docs/**` as well as `src-tauri/**`. An e2e run, a screenshot
pass or a docs edit used to reload the dev window out from under whoever was
looking at it — and a reload mid-run is also how a Playwright spec fails for no
reason.

**6. The closed window has a name.** A workspace switch and a restore both close
the database and open another file, and for that moment every read answers
`DB_CLOSED`. That used to be invisible: the screen stopped, and a slow migration
on the new file looked like a hang. `src/db/client.ts` now owns the window —
`beginDbTransition(label)` returns an idempotent ender, labels nest, and a
`raw.close()` with no label in flight marks an *implicit* one that the next
successful `raw.open()` clears, which is what covers a restore's copy step
(`backupsFs.ts` closes the file itself several steps before it calls back into
the boot path). `writeLock` folds the label into `writeState.transition` and
republishes, so `useWriteState()` exposes it and the top bar renders it as a
quiet muted line with `role="status"`, taking precedence over the write badge
because nothing else can be true at that moment.
`boot.switchWorkspace` wraps the whole close-open-migrate sequence in
"Switching workspace…" and passes `{ label: null }` inwards, so the note does not
flicker between two strings; `openWorkspace` labels itself "Opening the
workspace…" by default, and the first launch passes `{ label: null }` because
`BootingScreen` owns the window then.

**7. No typecheck or test noise** was left in `src/app`, `src/db` or `src/lib`:
both were already clean and still are. Nothing to fix there.

`docs/CONTRACTS.md` gained a "Shell seams, revision 2 (binding)" section
covering all of the above, the sentence in "One search" that said a shortcut is
"still a label, not a binding" is explicitly marked superseded, the
`FeatureModule` snippet shows `overlays`, and the `writeState` shape in the
database-layer section shows `transition`.

### Verified

```
$ npm run typecheck
(no output)

$ npx vitest run tests/repo tests/unit
 Test Files  64 passed (64)
      Tests  799 passed (799)

$ npx vite build --outDir dist-shell
✓ built in 586ms          (directory deleted)
```

Typecheck was clean across the whole repo on the final pass. It was not for most
of this agent's run: two of the sweep agents had `src/features` mid-edit, so the
working rule here was `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v
"^src/features"`, which was empty throughout. See contract note 4 below.

55 of those tests are new, in four files:

- `tests/unit/app/shortcuts.test.ts` — the parser and the matcher, pure: every
  chord shape and every unbindable string; mod detection on both platforms and
  the other-platform-modifier rejection; exact Shift and Alt; the bare-key rule
  both ways; the typing guard including `whileTyping` and the rule that a bare
  key is never bound while typing even with it; reserved shortcuts compared
  normalised rather than literally; registry order breaking a tie.
- `tests/unit/app/commandShortcuts.test.ts` — the hook as mounted, in jsdom,
  with real `KeyboardEvent`s: fires once, marks the event handled, binds Ctrl
  instead of Cmd when `mac` is false, stays silent for a keystroke inside an
  `<input>`, skips a reserved chord, unbinds on unmount, and — the one that
  matters for the transition — a listener registered *after* mount never sees a
  matching chord, which is the mechanism keeping the features' own bindings from
  firing a second time.
- `tests/unit/app/shellFooter.test.ts` — the footer runs `switch-workspace` once
  per click, looks the command up at click time, and degrades to plain text with
  no button when nothing registers it; plus the `overlays` slot rendering inside
  the shell. It `vi.mock`s `@/app/registry`, deliberately, so the test never
  loads the feature registry — that is what keeps it green while three agents
  are editing features.
- `tests/repo/dbTransition.test.ts` — the label at rest, in flight, mirrored onto
  `writeState`, published to `subscribeWriteState`, cleared by an ender that is
  safe to call twice, nesting and un-nesting, and the implicit transition around
  a real `raw.close()` / `raw.open()` through the repo harness.

Two agents (Sonnet) did the settings-key promotion and the tests; the binder, the
overlay slot, the transition plumbing and the contract text were written here.

### Not done

- **The four overlay hosts are still mounted** and still bind their own keys.
  They are harmless — the shell wins the keystroke — but they are two React roots
  and two listeners more than the product needs. Removing them is one line each
  plus `overlays:` in the feature's `index.tsx`, and it belongs to whoever owns
  the folder: `features/today/search/overlay.tsx`,
  `features/records/quickAdd/host.tsx`,
  `features/settings/components/SettingsHost.tsx`,
  `features/settings/lib/overlayHost.tsx` and the `AiHost` in
  `features/ai/index.tsx`.
- **No command declares `whileTyping` yet.** The flag exists and is tested;
  nothing in the product needed it.
- **No e2e run.** Briefed not to, and the three sweep agents were mid-edit.
  Nothing here changes a selector or a route, but the keys are now bound in one
  place instead of four, so `smoke`, `settings`, `ai`, `records` and `today` are
  the specs worth re-running once features land — particularly the `?` sheet and
  `mod+shift+v`.
- **The dev server on 1420 was left alone**, so the new watch-ignore list has not
  been observed working; it is a config change, read at server start.
- **Nothing in `src/lib` needed touching**, so it is in the commit only as scope.

### Contract changes needed

Nothing blocking. Four things for whoever comes next:

1. **`src/features/ai/lib/proposal.ts` still carries its own copy of the deal
   insert.** `deals.createStatements` exists and `applyLeads` uses it; the AI
   feature's copy predates it and should be deleted in favour of the repository's
   (STATUS 2026-09-18 settings+ai, contract change 3 — half done, and the half
   that is left is inside a feature).
2. **`customFields.valueCount(fieldId)` and the `schema_migrations` read** are
   still in `src/features/settings/lib/counts.ts` (that entry's item 4). Both
   belong in `src/db`, but promoting them means editing the feature's imports,
   which was not this agent's file to edit while the settings sweep was running.
3. **The `site_origin` / `siteOrigin` spelling clash is still open** (that entry's
   item 9): `src-tauri/src/leads.rs` reads `settings.site_origin`, the TypeScript
   registry stores `siteOrigin`. Nothing here depends on it and it is a Rust
   change, so it stays on the list. It is worth a real check before release —
   `leads_fetch` with no origin looks exactly like "no site connected".
4. **Two in-flight breakages in `src/features` were visible from here** while
   this agent worked, both since fixed by their owners:
   `SettingsLayout.tsx` had lost its `SettingsBlock` and `DataRow` exports while
   four screens still imported them (which failed `vite build` repo-wide for
   about ten minutes), and `features/leads/components/charts.tsx` was missing
   `CHART_GRID_STROKE`. The final verification above ran clean. Worth knowing
   that a half-landed sweep breaks the bundle for everyone, not just the sweeper.
5. **The footer's *button-ness* is not reactive, only its command lookup is.**
   `hasWorkspaceSwitcher` is computed in `Shell`'s render body, so a
   `switch-workspace` command registered after the shell's first render with
   nothing else triggering a re-render would leave the footer as plain text —
   while a *click* always re-resolves the command, which is the part the
   reconciliation contract promises. It cannot bite today, because the registry
   is fixed at module load and every command exists before the shell mounts. It
   would bite the moment commands become dynamic.
   `tests/unit/app/shellFooter.test.ts` asserts the current behaviour rather than
   the assumption, so a change here fails a test instead of surprising someone.

## 2026-09-19 — Settings + AI sweep (System Settings idiom)

Scope: `src/features/settings/**`, `src/features/ai/**`,
`tests/e2e-mac/specs/{settings,ai}.e2e.ts`, `tests/unit/{settings,ai}/**`, plus
two route mounts under `/settings`. Full write-up with the per-screen reasoning
and what each screenshot caught: `design/apple/sweep-settings.md`.

### Did

1. **Rewrote `SettingsLayout.tsx` into the row vocabulary every settings screen
   is now built from**: `SettingsNav`, `SettingsScreenFrame`, `SettingsMount`,
   `SettingsGroup`, `SettingsRow`, `SettingsChoiceRow`, `SettingsValueRow`,
   `SettingsLoading`, `SettingsNotice`. `SettingsBlock` and `DataRow` are gone;
   nothing outside this feature imported them.
2. **Gave settings a left section list** (224px, four groups under 11px labels,
   built from the shell's own `NavItem`/`SidebarSection`) so the index is no
   longer the only way in. The decision and the 1024px arithmetic behind it are
   in the sweep doc and in the file's own header comment.
3. **Restyled every screen to grouped inset lists**: index, workspace,
   vocabulary, tags, custom fields, appearance, the shortcuts screen and its "?"
   sheet, workspaces, the switcher dialog, diagnostics, AI settings, and the
   paste, draft and summary sheets.
4. **Mounted `SiteConnectionScreen` at `/settings/site` and `BackupsScreen` at
   `/settings/backups`**, both wrapped in `SettingsMount` so the section list
   survives the jump, and both listed in the index's "Data" group.
5. **Swapped every `lucide-react` import for `@/ui/icons`** across both features
   and moved every icon to `size`/`weight` (18 regular in a list, 16 bold in a
   button). `Sparkles` has no Phosphor alias in the map and became `Sparkle`.
6. **Two new e2e tests**: the section list lists every section, marks exactly one
   row current and navigates without the index; and the AI screenshot test now
   drives the paste flow through to a saved record so the summary and draft
   sheets have a real record to talk about.

### Verified

- `npm run typecheck` clean; `npm test` 64 files / 799 tests green.
- `E2E_PORT=4189 E2E_OUT=dist-sweep-settings` over `settings.e2e.ts` and
  `ai.e2e.ts`: 18 passed. `npx vite build --outDir dist-sweep-settings` succeeds;
  the directory was deleted.
- `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(|lucide-react|shadow-\[var\(--shadow-sm\)\]"`
  over both features returns nothing.
- 34 screenshots at 1280, light and dark, in
  `tests/e2e-mac/.cache/screens/sweep-settings/`, reviewed and re-captured after
  the seven defects listed in the sweep doc were fixed.

### Contract changes needed

1. **`src/features/leads/index.tsx` should drop its own `/settings/site`
   route.** Settings now registers that path (wrapped in `SettingsMount`), but
   leads sits earlier in the registry, so wouter's `Switch` matches the bare
   leads registration first and the website connection renders without the
   settings section list. One deleted line in a file this agent does not own
   fixes it; the settings-side route is already correct.
2. **`src/ui/icons.ts` has no `Sparkles` alias** even though the map is meant to
   carry every Lucide name the product used. `Sparkle` is exported and is what
   the AI feature now imports, but the next feature to migrate will hit the same
   gap.
3. **Row hairlines and wrapper elements.** `CardRow`'s `last:border-b-0`
   resolves against its parent, so a row wrapped in a `<label>`, `<Link>` or
   `<button>` loses every hairline rather than just the last one. The features
   work around it by putting the border on the wrapper. If `src/ui` ever grows a
   `CardRow` variant that takes the hairline as a prop, three files here can drop
   the workaround.

## 2026-09-19 — Records + Today sweep (Apple-like minimalist direction)

Scope: `src/features/records/**`, `src/features/today/**`,
`tests/e2e-mac/specs/{records,today}.e2e.ts`, `tests/unit/{records,today}/**`,
and the AI buttons mounted on the three record pages. Contract:
`docs/DESIGN.md` revision 2. Full write-up, per screen and per screenshot:
`design/apple/sweep-records.md`.

### What changed

Five defects were on every screen and are the reason the first pass read as a
web form in a window:

1. A `variant="primary"` black button on **every row** of Today's New leads and
   Gone quiet. Row actions are `ghost` now, the one that matters is `secondary`,
   and a record page's only filled control is the phone number.
2. `className="min-h-[44px]"` on 31 controls, which broke compact outright.
   Every height is a token; the hit-target floor is `--control-h-sm`, per §6,
   and a bare glyph is wrapped in `IconButton`.
3. Attention drawn in colour — a 3px accent rail on overdue rows, a filled black
   count pill, "No next step" in `--color-accent-ink`, an accent badge on
   website leads. All gone. Position and weight carry it, and the one tint left
   is a muted pastel that spells out the number of days.
4. `shadow-[var(--shadow-sm)]` on six panels, where the token is now `none`.
5. List rows set at `--text-lg` against `--text-sm`. One size down a column,
   weight and colour do the hierarchy.

Structurally: Today's sections moved to the `--text-xl` heading step with more
air between them; the two list screens got a one-line toolbar, `--row-h` rows
and an 11px column-header strip; the three record pages lost their bordered
summary card for a `PageHeader` in open air with the phone as the one black
button and the details column rebuilt as grouped inset lists; the pipeline
board's columns lost their boxes and fills for a dotted header on one hairline
with hairline cards under it; the timeline became a quiet log on a hairline
rail; the search dialog became the Spotlight panel from §9.

`DraftFollowUpButton` is mounted on the deal page and `SummarizeButton` on the
contact, company and deal pages — on each record's own action row rather than in
the page header, because `AiActionButton` renders its disabled sentence beside
itself and two of them in a header printed the same sentence twice.

### Verification

- `npm run typecheck` clean; `npm test` 64 files / 799 tests passing.
- `E2E_PORT=4187 E2E_OUT=dist-sweep-records` on `records.e2e.ts` and
  `today.e2e.ts`: 19 tests passing. No assertion was changed — only the
  screenshot plumbing (output folder, a `shootCompact` helper, three added
  captures).
- `npx vite build --outDir dist-sweep-records` succeeds; directory deleted.
- `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(|lucide-react|shadow-\[var\(--shadow-sm\)\]"`
  over both features returns nothing, and so does a grep for `min-h-[44px]`.
- 41 screenshots at 1280 in `tests/e2e-mac/.cache/screens/sweep-records/` —
  every screen light and dark, plus Today, the contact page and the pipeline
  board in compact — reviewed and re-captured three times. The 13 defects only
  a screenshot could show are listed in the sweep doc; the ones worth naming
  here are ragged row titles on Today (the tag column had no fixed width), a
  1900px empty timeline, a Spotlight panel stretched to the window, doubled
  hairlines under every filter toolbar, and the stage manager printing its three
  column labels eighteen times.

### Contract changes needed

1. **`AiActionButton` should not repeat its reason per button.** A page that
   mounts two AI actions prints "AI is off. Turn it on in Settings." twice.
   The deal page hides the duplicate with a CSS selector on the feature's own
   `data-testid="ai-disabled-reason"`; the right fix is a grouping component in
   `src/features/ai` that renders the sentence once for a cluster.
2. **`TD primary` needs a width hint to be usable.** It is `max-w-0 truncate`,
   which is correct for truncation but gives the column almost nothing in an
   auto-layout table — the pipeline list truncated a 23-character deal title to
   120px until percentage widths were put on the `TH`s. Either `TD primary`
   should carry a sensible default share or `Table` should document that the
   header row owns the widths.
3. **`EmptyState` is very tall inside a narrow panel.** Its `--space-10` padding
   is right for a full pane and makes a 300px-tall box out of one sentence
   inside a 380px details column. A `compact` prop would let a panel opt down.

## 2026-09-19 — Data + leads sweep (Apple-like minimalist direction)

Scope: `src/features/data/**`, `src/features/leads/**`,
`tests/e2e-mac/specs/{data,leads}.e2e.ts`, `tests/unit/{data,leads}/**`.
Contract: `docs/DESIGN.md` revision 2. Full write-up, per screen and per
screenshot: `design/apple/sweep-data.md`.

### Route ownership

- `src/features/leads/index.tsx` no longer registers `/settings/site`; it still
  exports `SiteConnectionScreen`, which the settings feature now mounts.
- `src/features/data/index.tsx` no longer registers `/backups` and now exports
  `BackupsScreen` for the settings feature to mount at `/settings/backups`.
  There was no backups nav item to remove — Import is the data feature's only
  nav row. `data.e2e.ts` navigates to the new path; nothing inside either
  feature linked to the old ones.

### What changed

The import wizard is the headline: it now reads as a macOS setup assistant. The
four tinted step pills (one of them green) became four step names joined by
hairlines, with weight and ink carrying where you are; the navigation is a
`secondary` **Back** and one black **Continue** together at the bottom right,
and the preview step's button keeps the real verb, **Import**. The 40px
spreadsheet glyph left the drop zone, the mapping badges and the yellow
deal-columns box became sentences, and the duplicate policy became a grouped
inset list under a small-capitals label.

Elsewhere: export's six SaaS cards became two grouped lists; the duplicates
list stopped putting a black button on all fifty-two rows and stopped painting
all fifty-two match badges yellow; the merge dialog marks the surviving record
with the selected tint instead of an accent border and lost the one stray
`uppercase tracking-wide` label in this scope; backups, attachments and the
website connection became grouped inset lists; and every semantic `-ink` token
replaced the bare fill token wherever it was carrying text.

Reports: every chart colour and axis style now lives in
`features/leads/components/charts.tsx` as `var(--token)` strings. Bars are ink
(`--color-text`, with `--color-text-faint` for a second series) **except** where
the category is a pipeline stage, which keeps the stage's own muted colour —
so "Leads by source", "Conversion between stages" and won/lost stopped being
blue, teal, green and red. There are no gridlines, no value axis and no axis
line anywhere on the screen: every bar carries its own figure at the end of it.
`ReportCard` stamps `data-report="<title>"`, which is how the e2e now scopes to
one card.

### Verified

- `npm run typecheck` clean; `npm test` 64 files / 799 tests passing.
- `E2E_PORT=4188 E2E_OUT=dist-sweep-data` on `data.e2e.ts` and `leads.e2e.ts`:
  19 tests passing (13 before; the six added ones cover the running panel, the
  backups list and its restore dialog, the three empty screens and the
  attachments panel).
- `npx vite build --outDir dist-sweep-data` succeeds; directory deleted.
- `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(|lucide-react|shadow-\[var\(--shadow-sm\)\]"`
  over both features returns nothing. The recharts colour props read tokens
  through CSS variables, not literals.
- 44 screenshots at 1280 in `tests/e2e-mac/.cache/screens/sweep-data/` — 22
  screens, light and dark — reviewed and re-captured four times. The ten defects
  only a screenshot could show are in the sweep doc; the ones worth naming here
  are `TD primary` truncating every name in the preview to three characters,
  preview rows doubling in height when a contact had two phone numbers, the
  second record in a duplicate pair starting at a different x on every row, and
  a doubled hairline under the last row of every table.

### Not done

- The running panel cannot be photographed at real speed (1,500 rows import in
  ~200ms), so `data.e2e.ts` holds each batched write for 600ms through the
  `window.__helixDb` bridge and then asserts the progress bar is *still* visible
  after both captures, so a screenshot cannot silently be of the next screen.
- A real restore is still not exercised. The dialog is opened, photographed and
  cancelled: the harness's backup file is a placeholder and restoring it would
  prove nothing.

### Contract changes needed

1. **The e2e fixture writes backup files the product cannot read.**
   `DbBridge.backup` in `tests/e2e-mac/fixtures.ts` builds the name from
   `new Date().toISOString()` with every `:` and `.` replaced by a dash, which
   leaves the milliseconds in it (`2026-09-19T00-48-08-123Z-manual.db`).
   `parseBackupName` and Rust agree on `<date>T<HH-MM-SS>Z-<reason>.db`, so
   every backup the harness writes is invisible to `listBackups`, and until this
   is fixed no e2e can see a backup it just took. `data.e2e.ts` seeds two
   correctly named files into the stub's file map to get a list to photograph.
   Owner: whoever owns `tests/e2e-mac/fixtures.ts`.
2. **`TD primary` needs a width hint** — the records sweep raised this already
   and this sweep hit it independently. `max-w-0 truncate` gave the name column
   three characters in a seven-column preview table. Both features now put
   percentage widths on the `TH`s; the kit should either carry a default or say
   in `Table.tsx` that the header row owns the widths.
3. **`CardRow` has no `asChild`.** A grouped-list row that is really one control
   (a radio row, a row that navigates) has to nest a `<label>` or `<button>`
   inside the row, so the hit target is the child rather than the row. A
   Radix-style `asChild` would let the grouped-list pattern carry a real
   control.
4. **`EmptyState` is very tall inside a narrow panel** (raised by the records
   sweep; confirmed here). The Files panel on a record page passes
   `className="py-[var(--space-5)]"` to bring a 300px box down to something a
   380px column can hold. A `compact` prop would be the honest fix.

---

## 2026-09-19 — Privacy scrub

`tests/fixtures/clearpath-prospects.csv` is a synthetic fixture (invented Utah
landscaping businesses, `.example` emails, fictional 801-555-01xx/385-555-01xx
phone numbers). It never held Walker's real prospects in this repo; earlier
entries above describing `tools/import-clearpath-crm.mjs` writing "Walker's"
prospects into this fixture predate this change and are left as-is for
history, but are no longer accurate. The real ClearPath export now lives
outside the repo at `/Users/walker_tracy/Desktop/ClearPath Sites/crm/data/helix-import.csv`,
and `tools/import-clearpath-crm.mjs` defaults its `--out` there instead of
into `tests/fixtures/`. All fixture rows across `tests/fixtures/`,
`tools/fake-site/`, `tests/e2e-mac/`, `tests/unit/`, and `tests/repo/` that
used real consumer email domains (gmail.com, yahoo.com, outlook.com,
hotmail.com, comcast.net, icloud.com, aol.com, msn.com, live.com) were moved
to the same local part under the reserved `.example` TLD (e.g.
`gmail.example`), matching duplicates across fixture files preserved.

---

## 2026-09-19 — Brand sweep: records, Today, data

The brand guide (`assets/brand/guide/helix-crm-brand-guide.html`) applied to
`src/features/records`, `src/features/today` and `src/features/data`, in
parallel with the foundation pass that rewrote the tokens, the fonts and the
component kit. Full write-up, including the primary block chosen for every
screen: `design/brand/sweep-records-today-data.md`.

- **Radius 0.** 38 `rounded-[var(--radius-*)]` utilities removed from 23 files.
  The stage dots and the timeline dot are squares now, on purpose.
- **Type.** Heading elements carry no type utilities at all any more —
  `globals.css` sets `h1`–`h6` in Zilla Slab at the brand's steps. The two
  non-heading headings (the import drop zone's lead line, the import result's
  four figures) keep the `font-[family-name:var(--font-heading)]` utility. The
  two list column strips, the stage manager's header row and the search
  dialog's group label moved to the `.section-label` class.
- **One primary block per view.** Timeline's Save and the attachments panel's
  Add a file were both primary inside a record page that already had one, and
  are now secondary. The deal page had no primary at all, so the deal value is
  now a flat primary block. Today's panels view gained one: the Due now count,
  filled, and drawn only when something is actually due (`Section` takes a new
  `emphasis` prop; only Due now passes it).
- **Accent.** `--shadow-sticker` on exactly three hero elements: Today's
  first-run Import a CSV, the import drop zone's Choose a file, the deal value.
  Nothing else in these features is yellow.
- **Voice.** 13 strings changed across the three features — mostly error
  messages that said "That did not save." where they could name the thing, and
  two phone-failure toasts that now give the number to dial by hand. None was
  asserted on by a spec.

Screens captured at 1280 light/dark (plus compact on Today, the contact page,
the pipeline board and the import mapping step) into
`tests/e2e-mac/.cache/screens/brand-a/`.

Verified: typecheck clean, `npm test` 799 green, the three e2e specs 26 passed
on port 4194, `vite build` succeeds, and the no-literals grep over the three
features returns only `font-[family-name:var(...)]` utilities.

---

## 2026-09-19 — Brand foundation: tokens, fonts, component kit

The brand guide (`assets/brand/guide/helix-crm-brand-guide.html`) turned into
the foundation the three feature sweeps built on. `docs/DESIGN.md` is now
revision 3, "Brand guide", with revision 2 kept under **Superseded**. Full
write-up of what the screenshots caught: `design/brand/review.md`.

- **Fonts, self-hosted.** Zilla Slab 600/700 and Poppins 400/500/600 as
  latin-subset woff2 in `public/fonts/`, OFL 1.1 texts beside them, declared in
  `globals.css` with `font-display: swap`, and the two faces the first frame
  needs preloaded from `index.html`. Verified as real woff2 (`wOF2` magic) with
  `OS/2.usWeightClass` matching each filename. No CDN: the built app requests
  `/fonts/zilla-slab-700.woff2` and `/fonts/poppins-400.woff2` and nothing off
  the machine.
- **Tokens added, none renamed.** The five `--brand-*` colours plus
  `--brand-primary-tint`; `--color-heading`; `--font-heading` / `--font-body`;
  the guide's five-step scale `--text-display|heading|subhead|body|caption`
  with a `--leading-*` for each; three `--color-brand-*-soft` / `-ink` tint
  pairs; `--shadow-sticker`. Every `--radius-*` is now `0`, `--shadow-md` is a
  hairline with no blur, and `--font-sans` resolves to `--font-body` so the
  whole kit picked up Poppins without an edit. `docs/CONTRACTS.md` "Design
  tokens" records the new names and what the mapping means.
- **The one confident block.** `--color-accent` is the brand primary `#97B1C3`
  with `#141414` ink (8.24:1, the guide's own pairing — white measures 2.24:1
  and is never used). It is the selected sidebar row on every screen, plus the
  primary button where a screen has a primary action. `--color-selected` stayed
  a quiet tint so menus, palette rows and table rows do not each become a
  block. The primary does not invert in dark mode.
- **Kit.** New `src/ui/Brand.tsx` lockup — the mark in a hard square with the
  accent sticker shadow and "Helix" in Zilla Slab — used in the sidebar header
  and on every boot screen. `PageHeader`, `CardTitle`, `DialogTitle` and
  `EmptyState` titles moved to the slab; `Badge` gained the three brand tint
  tones; `NavItem`'s active row became the block. Every prop and export name is
  unchanged.
- **Accessibility.** `--color-text-faint` was darkened from `#6A7278` to
  `#646B71` after the audit caught four real failures at 4.45:1 (three kbd
  glyphs and a sidebar group label on the tint). Rendered-contrast audit now
  reports **439 elements checked, 0 failures** in all four theme × density
  combinations.

Gallery captured at 1280 in light, dark and compact, plus 14 sections in both
themes, into `design/brand/`. Verified: typecheck clean, `npm test` green
(15 new tests for Brand, NavItem and Badge), `vite build` succeeds, zero
console messages and zero failed requests.

---

## 2026-09-19 — Brand sweep: leads, settings, AI, and the four documents

The supplied brand guide (`assets/brand/guide/helix-crm-brand-guide.html`)
applied to `src/features/{leads,settings,ai}`, their three e2e specs, and
`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `tests/RELEASE-CHECKLIST.md`.
Built on the foundation agent's `42e2bc6` (tokens and self-hosted fonts) and
`fa221ab` (component kit, lockup, shell). The per-screen record — which element
carries the primary on each view, what changed, and what the screenshots caught
— is `design/brand/sweep-leads-settings-ai.md`.

**What changed**

- **One block of primary per view.** Two screens were painting more than one.
  The settings **section list** was built from `NavItem`, whose selected row is
  the shell's block of primary by design, which put two blocks on every settings
  screen and three wherever the screen also had a primary button; it is now a
  local `SettingsNavRow` with the same geometry and the quiet `--color-selected`
  tint. **Workspaces** rendered its header button and its empty-state button at
  the same time when the list was empty; the header one is now conditional, the
  rule Tags and Custom fields already followed.
- **Charts on the brand.** The leading series is `--brand-primary` and a second
  is `--brand-secondary`; stage-coloured bars keep the stage ramp. Bar caps are
  square. Axis ticks, value labels and the legend are the caption step in
  `--font-body`, so SVG text matches the HTML around it. The accent is
  deliberately **not** used as a bar fill: it is a pale yellow, and on the
  near-white report canvas it is a shape the owner cannot read.
- **Radius 0 and no literals.** Every rounded-corner utility is gone from the
  three folders, including the tag colour swatches, which are squares now. The
  verification grep over the three features returns nothing.
- **Voice pass** on every string in the screens and on the four documents.

**Two real defects found by the screenshot pass**

1. `font-[var(--font-mono)]` is not a Tailwind utility and had silently never
   resolved, so the database paths on **Diagnostics** and the raw-answer dump in
   the **AI paste sheet** were never monospace. Both are
   `font-[family-name:var(--font-mono)]` now. Worth grepping for elsewhere.
2. **Every dark-mode screenshot of a dialog was a lie.** The `shoot()` helpers
   in `settings.e2e.ts` and `ai.e2e.ts` set `data-theme` and captured in the
   same tick; every control in the kit carries `transition-colors`, so the
   captured frame still held the light colours and each dark sheet photographed
   with white text fields. A computed-style probe confirmed it —
   `--color-surface` already read the dark value while `background-color` was
   still white. Both helpers now wait for the canvas colour to change and give
   the slowest transition 250ms to land. `leads.e2e.ts` already waited, which is
   why only its captures were trustworthy. The same white fields are in the
   pre-brand captures under `.cache/screens/sweep-settings/`, so any other
   spec that flips `data-theme` and shoots immediately has the same problem.

**Verified**: `npm run typecheck` clean; `npm test` 67 files / 815 tests green;
`E2E_PORT=4195 E2E_OUT=dist-brand-b` over `leads`, `settings` and `ai` — 30
passed; `npx vite build --outDir dist-brand-b` succeeded and the folder was
deleted. Screens at 1280 in both themes are in
`tests/e2e-mac/.cache/screens/brand-b/` (42 images, gitignored).

**Not done / for someone else**

- The stage ramp is still revision 2's eight hues, which `tokens.css` says is
  deliberate because the guide is silent on it. In light mode a stage-coloured
  bar is noticeably more saturated than a brand-primary one sitting two cards
  above it. It reads as two kinds of bar, which is defensible, but if the ramp
  is ever re-derived against the brand the Reports screen is where it will show.
- `docs/STATUS.md` and `design/brand/sweep-records-today-data.md` both contain
  the literal text `rounded-[var(--radius-*)]`, which Tailwind's scanner picks
  up out of the markdown and then warns about while optimising the CSS ("Unexpected
  token Delim('*')"). Harmless, but it is two lines of noise on every build.

---

## 2026-09-19 — Windows e2e: a WebDriver session that actually starts

`.github/workflows/e2e-win.yml` built the debug app fine but never got a
WebDriver session: every run died after `msedgedriver`'s 60-second wait with
`session not created: DevToolsActivePort file doesn't exist` (run 35476491615).

The cause is not in this repo. WebView2 runtime **150+ ignores every
`WEBVIEW2_*` environment variable when the host process is elevated**
(hardening; those variables are user-writable —
MicrosoftEdge/WebView2Feedback#5645, #5640). `msedgedriver` passes
`--remote-debugging-port` to a WebView2 app through exactly that mechanism, and
finds the port file through `WEBVIEW2_USER_DATA_FOLDER`. GitHub's Windows
runner process is elevated and its image now carries WebView2 152.0.4191.66, so
the app launched with no debugging port at all and the session could never come
up. The same failure is tracked in tauri-apps/wry#1782 and
actions/runner-images#14738.

The fix, which is what wry's maintainers publish for GitHub Actions: run the
`wdio` process at medium integrity with `gsudo`, so the whole chain it spawns
(`tauri-driver` → `msedgedriver` → `helix-crm.exe` → `msedgewebview2.exe`) is
de-elevated and the environment variables work again. `icacls` grants the
workspace to the de-elevated token, whose Administrators membership is
deny-only. Pinning the job to `windows-2022` (WebView2 131, pre-hardening) would
also be green and was rejected: it would test a runtime no user has.

Because a de-elevated process is not guaranteed to inherit the caller's
environment, `tests/e2e-win/wdio.conf.ts` no longer resolves anything from
`PATH`: it finds `tauri-driver` in `CARGO_HOME`/`~/.cargo/bin`, falls back to
`.drivers/msedgedriver.exe` when `MSEDGEDRIVER_PATH` is unset, fails naming the
missing binary instead of waiting 60s for a generic session error, waits for
tauri-driver's port to accept a connection rather than sleeping 1s, and keeps
tauri-driver's output in `.output/tauri-driver.log` for the CI artifact.
`connectionRetryCount` dropped 3 → 1, since each retry costs the full 60s
browser-start timeout and tells you nothing new.

The workflow now also prints the WebView2 runtime version, both driver
versions, the `target/debug` contents and the integrity level it runs at, and
tails `%APPDATA%\com.clearpathdigital.helix\logs` after the suite — the app's
own log is the only place a startup failure inside the process shows up.
It runs on `push` to `e2e-win/**` as well as `main`, because these failure
modes cannot be reproduced on a Mac.

Green on runs 35477415312 and 35477806014: three smoke assertions against the
real window (title, sidebar "Today", Today heading) in 1.2-1.6s, with
`Helix 0.1.0 starting` in the app's own log from
`%APPDATA%\com.clearpathdigital.helix\logs\helix.log`.

---

## 2026-09-19 — Encryption at rest: SQLCipher, keys in the keychain, disk check

D18 landed. Every workspace database is now SQLCipher-encrypted on disk, keyed by
32 random bytes per workspace held in the OS keychain, with a one-time migration
for the plaintext workspaces that exist today and a Diagnostics reading of
whether the OS's own full-disk encryption is switched on. The reference is
`docs/CONTRACTS.md` "Encryption at rest (binding)"; the flow diagram is in the
module doc at the top of `src-tauri/src/db.rs`.

- **Build.** `rusqlite` moved from `bundled` to
  `bundled-sqlcipher-vendored-openssl`, which statically links SQLCipher and
  builds OpenSSL from source, so no platform needs a system library. This Mac
  links **SQLCipher 4.14.0 community on SQLite 3.51.3, FTS5 compiled in** —
  checked with `sqlite_compileoption_used('ENABLE_FTS5')`, not assumed, because
  the whole search feature rests on it. No `SQLCIPHER_*` build env was needed.
  `getrandom` was added for the OS CSPRNG. **No workflow changes were needed**:
  `openssl-src` falls back to `no-asm` when NASM is absent on MSVC, and the Perl
  its configure script needs ships on `windows-latest`. CI proved it — the
  `rust (windows-latest)` job built SQLCipher and OpenSSL from source and passed
  with `ci.yml` untouched.
- **The key.** A third keychain kind, `dbkey`, under `<workspaceId>:dbkey` in
  service `helix`. 32 bytes from the OS CSPRNG as 64 lowercase hex characters,
  created on first open and stable after. Reading and creating are one critical
  section under a mutex — see the bug CI caught, below. Its Rust type has no `Display`, a
  `Debug` that prints `DbKey(<redacted>)`, and a buffer it zeroes on drop, so it
  cannot reach a log by accident. `secret_set`, `secret_get` and `secret_delete`
  all **refuse** the kind with `SECRET_ERROR`, which is enforced in Rust rather
  than documented: that is what stops workspace archiving — which clears
  `anthropic` and `site` — from deleting the key and making an archived
  workspace permanently unreadable.
- **Open.** `PRAGMA key = "x'<hex>'"` before any other statement, then one read
  to prove the key was right (SQLCipher accepts any key and only finds out at
  page 1), then the existing WAL/foreign-keys/busy-timeout pragmas. The raw-key
  form is deliberate: no PBKDF2 on open. A wrong or missing key gives
  `DB_OPEN_FAILED` and the sentence "The saved key does not open this workspace
  (<path>)…" rather than SQLite's "file is not a database". `db_open` can now
  also answer `SECRET_ERROR` when the keychain itself refuses; `src/app/boot.ts`
  already wraps that into a `DbOpenError`, so the boot screen shows the message
  unchanged.
- **`cipher_memory_security` stays OFF** (the SQLCipher 4 default). It was not
  needed: 10,000 single-row inserts in one `db_batch` take **47 ms in a debug
  build** against the 2-second budget, so there was no performance argument for
  reaching for the pragma, and what it defends against — an attacker already
  reading this process's memory or swap — is not the threat D18 is about.
- **Migration.** A file whose first 16 bytes are `SQLite format 3\0` is
  converted on open, under the same backup guard `db_backup` holds: attach
  `<path>.enc` with the key, `sqlcipher_export`, detach, checkpoint, prove the
  copy opens and carries the same schema objects, move the plaintext original to
  `backups/<iso>Z-pre-encryption.db`, then move the encrypted file into place. A
  failure at the last step puts the original back, so the next launch retries.
  The set-aside copy uses the ordinary backup naming scheme deliberately, so the
  Backups screen lists it and the 30-day policy clears it — a plaintext copy
  kept forever beside the encrypted one would give back everything the
  encryption was for.
- **Backups.** The read-only backup connection is keyed before `VACUUM INTO`, so
  the copy is written through the cipher. A test reads the first 16 bytes of a
  backup, confirms they are not the plaintext header, and then opens it with the
  workspace key.
- **Restore is unchanged** and still a plain file copy, because the key belongs
  to the workspace and not to the file. One consequence is now written into the
  contract: a backup cannot be opened *in place* from `backups/`, since the
  workspace id is the name of the folder holding `helix.db`. The existing
  `backup_produces_valid_db_and_close_waits_for_it` test was reading a backup in
  place; it now copies it into a workspace first, which is what
  `restoreFromBackup` does.
- **`disk_encryption_status()`** → `{ platform, encrypted: boolean|null, detail }`.
  `fdesetup status` on macOS, `manage-bde -status <SystemDrive>` on Windows with
  a `Win32_EncryptableVolume` WMI fallback, 5-second timeout, no console window.
  It returns the struct directly rather than a `Result`, so it can never fail the
  app; `encrypted` is `null` when the check could not run or could not be parsed,
  never a guess. On this Mac `fdesetup status` prints "FileVault is On." and the
  command reports `{ platform: "macos", encrypted: true, detail: "FileVault is
  on." }`.
- **`cargo test` never touches a real keychain.** `secrets::use_in_memory_store()`
  points the store at a process-lifetime map; it is compiled out of release
  builds (`cfg(debug_assertions)`) and a dev run can opt in with
  `HELIX_INSECURE_KEY_STORE=memory`. This is the dev-only in-memory store PLAN.md
  already promised. The release arrangement was proved to compile by inverting
  the `cfg` and running `cargo check --lib`, rather than by a release build (disk
  is tight on this machine).

### What Diagnostics should show

`db_info()` gained `encrypted: boolean` and `cipherVersion: string`. Both are
**optional** on the `DbInfo` type in `src/db/client.ts`, because the e2e bridge
and the unit-test driver are plain better-sqlite3 with no cipher — render
"Unknown" when they are `undefined` rather than "Not encrypted". Two lines belong
on the screen:

```
Workspace file    Encrypted (SQLCipher 4.14.0 community)  <- db_info().encrypted, .cipherVersion
Disk encryption   FileVault is on.                        <- disk_encryption_status().detail
```

`disk_encryption_status()` is a fresh command, not part of `db_info`; call it
alongside the other Diagnostics readers and treat `encrypted: null` as "Could not
tell", with `detail` as the explanation. It never throws.

### Verified

```
$ cargo build
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.82s

$ cargo test
test result: ok. 26 passed; 0 failed   (lib: db, disk, files, leads, secrets)
test result: ok. 10 passed; 0 failed   (tests/db_tests.rs)
test result: ok.  8 passed; 0 failed   (tests/encryption_tests.rs)
(five consecutive runs, no flake)

$ cargo clippy --all-targets
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.62s
    (no warnings, no errors)

$ npm test
 Test Files  69 passed (69)
      Tests  873 passed (873)
```

Tests added: 8 in `src-tauri/tests/encryption_tests.rs` (key creation is
idempotent; key creation survives a race; a fresh workspace has no plaintext
header; plaintext is detected and migrated with the original set aside; FTS
survives the migration; a backup is encrypted and opens with the same key; the
wrong key is refused with a readable message; 10k inserts in one batch), 9 parser
tests in `src-tauri/src/disk.rs`, and 5 in `src-tauri/src/secrets.rs`.

### What CI proved, on both runners

Run for the encryption commit `b23e56f`:
<https://github.com/walk-the-program/helix-crm/actions/runs/35478831801> (e2e-win) and
<https://github.com/walk-the-program/helix-crm/actions/runs/35478831807> (CI).
Run for the fix on top, `890bf8e`, all three jobs green:
<https://github.com/walk-the-program/helix-crm/actions/runs/35479424653>.

- `rust (windows-latest)` and `rust (macos-latest)` both built SQLCipher and OpenSSL
  from source and ran the whole Rust suite, with `ci.yml` untouched. No NASM step
  and no Perl step was needed.
- `e2e-win` **passed on `b23e56f`**, which is the strongest evidence here: that job
  compiles the real Tauri app on Windows and drives it through WebView2. It proves
  the Windows binary links the static OpenSSL, that `db_open` created and read a
  `dbkey` from Windows Credential Manager in a real launch, and that the app
  reached the Today screen on a freshly encrypted workspace. The app log from that
  run carries no `SECRET_ERROR` and no `DB_OPEN_FAILED`.
- The Windows link step emits a wall of `LNK4099: PDB 'ossl_static.pdb' was not
  found` warnings from the vendored OpenSSL objects. They are debug-info warnings
  only, the link succeeds, and they are expected for a statically vendored
  OpenSSL. Not worth silencing.
- `e2e-win` then went red on `890bf8e`
  (<https://github.com/walk-the-program/helix-crm/actions/runs/35479424651>), and it
  is not this work: the build step passed and the suite failed waiting for `nav`
  and `h1*=Today`, which is the onboarding feature that landed in `106aafc`
  ("industry-first setup, trade presets, sample data") now showing its flow on a
  fresh workspace instead of Today. `tests/e2e-win/specs/smoke.e2e.ts` needs to
  either complete or skip onboarding before it looks for Today. That is outside
  this agent's scope and is left for whoever owns onboarding.

### The bug CI caught

The first push went red on `rust (macos-latest)` while Windows and the JS job
went green. `secrets::db_key` read the keychain and then created a key as two
separate steps, so two threads that both found no entry each minted one and the
second `set` won — leaving the file the first thread had already written with the
losing key unreadable for good. Ten parallel `cargo test` threads sharing one
workspace id found it on the runner; this Mac had been scheduling them in a lucky
order and passed every time, which is the worst way for a bug like this to
behave.

The fix is a mutex around the read-then-create in `db_key`, and
`key_creation_survives_a_race` is the regression test: eight threads ask for one
workspace's key at once and must all get the same one, and the stored key must be
that one too. Confirmed by removing the lock again — the test fails on all three
runs without it and passes with it — and the whole Rust suite was then run five
times in a row with no flake. The cross-process version of the race is not closed
and does not need to be: the single-instance plugin means there is only ever one
Helix running.

### Not done, and one thing to know

- Walker's live workspace
  `~/Library/Application Support/com.clearpathdigital.helix/workspaces/01a0b839-…/helix.db`
  is **still plaintext** (header checked read-only, nothing written). It migrates
  itself on the first launch of a build that includes this change, and the
  plaintext original will be sitting in that workspace's `backups/` folder as
  `<iso>Z-pre-encryption.db` afterwards.
- **The unsigned-macOS Keychain gotcha now bites harder, and E5 matters more.**
  Until this change, a denied or missed Keychain prompt cost the AI key or the
  site token. Now it costs the workspace: `db_open` cannot open the file without
  the `dbkey` entry, so it answers `SECRET_ERROR` and the boot screen shows it.
  A dev rebuild changes the binary's identity, so macOS asks again — click
  **Always Allow**, not Allow, on the first prompt after a rebuild.
  `HELIX_INSECURE_KEY_STORE=memory` is not a workaround for this: it mints a
  fresh key each run, so an existing encrypted workspace will not open under it.
  It is for scratch workspaces and tests only.
- Nothing under `src/features/**`, `src/ui` or `src/styles` was touched. The
  Diagnostics line is the orchestrator's to mount; nothing new is exported from
  this work.
- `tests/e2e-mac/fixtures.ts` was not touched and still runs on plain
  better-sqlite3. It never sees the cipher, which is why the two new `DbInfo`
  fields are optional.
- The `npm test` and `npm run typecheck` numbers above were taken before the
  onboarding, recurring, templates and help features started landing in the same
  working tree. Re-running them later in the session showed two failures and
  several type errors, all from that in-flight work sitting uncommitted beside
  this change: `src/features/onboarding/sample/index.ts` imports industry preset
  files that are not written yet, `src/app/boot.ts` is missing the
  `showOnboarding` field another agent added to `BootResult`, and
  `src/features/templates/components/SendSplitButton.tsx` imports a `lib/hooks`
  that does not exist. None of it is committed, so the committed tree is
  unaffected — proved by stashing this change's only front-end edit (the two
  optional `DbInfo` fields) and re-running the two failing files, which fail
  identically without it, and by CI, which is green on this commit.

---

## 2026-09-19 — Onboarding agent (first run, trade presets, sample data)

Decisions D16 and D19 built: a workspace with nothing in it opens on setup
rather than on an empty shell, the setup is the owner's own trade already
filled in, and "Show me an example" is one click to remove again.

- **The gate.** `src/features/onboarding/gate.ts` answers one question: setup
  has never been finished or skipped, AND the workspace holds no contacts and
  no deals. `boot()` calls it once and puts the answer in
  `BootResult.showOnboarding`; `App.tsx` renders the flow full-window (brand
  lockup, no sidebar) instead of `ShellRoot` until the flow says it is done. A
  gate that throws answers "no" — it must never be why the app will not start.
  Feature `onBoot` hooks are held back until the shell shows, because four
  overlay roots and a lead poller have nothing to do behind a first-run screen.
  Those are the only two edits outside `src/features/onboarding/`.
- **Three screens, four clicks.** "Your business" (name prefilled from the
  workspace, owner name, email, phone, and a grid of the nine ClearPath trades
  plus "Something else" with a free-text line), "How you'll track work" (the
  trade's preset — the word for the work with one line saying why, the stages
  with quiet days, the sources, the two or three extra details — every row
  renameable, removable and addable inline), and "Bring your customers in"
  (import / connect the site / show me an example / start empty). "Skip for
  now" is on all three and writes `onboarding.skippedAt`. Reopenable at
  `/setup` and from the command "Set up your business".
- **One transaction.** "Use this setup" replaces the stages, replaces the
  sources, creates the custom fields, writes `settings.vocabulary` and writes
  `onboarding.completedAt` in a single `withTransaction` + `raw.batch`, with a
  `change_log` row for every one of them. No repository write function is
  called from inside it (the write lock is not reentrant); every change is a
  statement built from `insertStatement` and the repositories' own builders.
  `planBatch` is deliberately **not** used: it moves every non-insert to the
  end of the batch, which would delete the stages the same batch just inserted.
  On a workspace that already has records the apply turns additive — existing
  stages and sources stay, because `deals.stage_id` is ON DELETE RESTRICT and
  because a setup screen does not get to throw away data.
- **Ten presets and ten sample sets.** `presets/<trade>.ts` and
  `sample/<trade>.ts`, written from Walker's own
  `ClearPath Sites/templates/INDUSTRIES.md`. Vocabulary per trade: jobs for
  landscaping and home services, quotes for dental, medical spa, wedding venue
  and restaurant, deals for church, Pilates and CrossFit, where nothing is
  quoted and nothing is a job. Church deals carry no money at all except the
  two things the building actually charges for. No trademarks and no health
  information anywhere in the shipped data: a dental field asks about insurance
  and interest, never a condition.
- **Sample data, and getting rid of it.** 12 to 20 contacts, 6 to 10 companies
  where the trade has them (none for the spa, the studio and the gym), 8 to 12
  deals across the preset's stages, 15 to 25 activities and 6 to 10 tasks with
  two already late. Every row — including the tasks and the activities, which
  nothing else in the product tags — carries a link to one tag, "Sample", plus
  the setting `sample.loadedAt`. Removal purges every tagged row, drops the
  tag and clears the setting in one transaction. Invented names, `.example`
  emails, 801-555-01xx phones, relative dates only, so a set is as current in a
  year as it is today.

**For the orchestrator.** `src/features/onboarding/index.tsx` exports
`RemoveSampleDataButton` — mount `<RemoveSampleDataButton />` in Settings'
Workspace section and on Today's first-run card. It renders **nothing** when
the workspace has no sample data, so it is safe to mount unconditionally and
needs no prop. The confirm dialog behind it is mounted by this feature through
the shell's `overlays` slot, and the command `remove-sample-data` opens the
same dialog from anywhere.

**Two things for other owners.**

1. `src/features/onboarding/lib/settings.ts` holds nine keys outside the typed
   registry in `src/db/repos/settings.ts` (`onboarding.completedAt`,
   `onboarding.skippedAt`, `business.name`, `business.trade`,
   `business.tradeOther`, `owner.name`, `owner.email`, `owner.phone`,
   `sample.loadedAt`) and a `settingStatement(key, value)` that duplicates the
   repository's upsert so it can go in a batch. Both want promoting into
   `settings.ts`, the same way the AI keys were.
2. The sidebar's pipeline row is the static string "Pipeline"
   (`src/features/records/index.tsx`), although the comment above it says the
   label follows the vocabulary. After setup for a landscaping business the
   Pipeline **screen** reads "Jobs" and the sidebar still reads "Pipeline".
   That is the records feature's to fix; the e2e asserts the screen, not the
   sidebar.

**Harness change (tests/e2e-mac/fixtures.ts).** Every existing spec starts from
an empty workspace and expects the shell on its first `goto("/")`, which is
exactly the shape the gate fires on. The gate's state cannot be arranged as a
real settings row — the `settings` table does not exist until the app runs its
first migration, which happens after the page has loaded — so the fixture gained
an `onboarding` option, defaulting to `"skip"`, which sets
`window.__helixSkipOnboarding`. The gate reads that flag only under
`import.meta.env.VITE_E2E`, so it is dead code in a shipped build.
`onboarding.e2e.ts` declares `test.use({ onboarding: "show" })`. No existing
spec was edited.

Verified: `npm run typecheck` clean; `npm test` 1163 green in 77 files (191 of
them new: preset and sample invariants for all ten trades, and the repo tests
for the apply transaction, the sample load and the purge);
`onboarding.e2e.ts` 2 passed and `smoke.e2e.ts` + `today.e2e.ts` 12 passed on
port 4196; `npx vite build --outDir dist-onb` succeeds (deleted after); the
forbidden grep (`#hex|rgb|hsl|rounded-|lucide-react`) returns nothing in the
feature folder or its tests. All three screens captured at 1280 in light and
dark into `tests/e2e-mac/.cache/screens/onboarding/` and read against
`docs/DESIGN.md`: one primary block per screen ("Continue", "Use this setup",
and none at all on screen 3, where the four cards are equals),
`--shadow-sticker` only on the lockup, no radius, the accent never a
background, "Skip for now" in `--color-link`.

---

## 2026-09-19 — Depth agent (reminders, templates, calendar, week summary, help)

Walker's D19: recurring service reminders, message templates with merge fields,
Add to calendar, a one-line week summary on Today, and an in-app Help page.

### Did

**Schema and migration.** `recurring_rules` and `templates` added to
`src/db/schema.ts`, with `drizzle/0003_recurring_templates.sql` and
`drizzle/meta/0003_snapshot.json` generated by
`npx drizzle-kit generate --name recurring_templates`. **Deviation from the
brief, on purpose:** the brief said `--custom`, which writes an empty SQL file
and a snapshot that is a copy of 0002. Both tables are in `schema.ts`, so a
stale snapshot would make the next `generate` try to create them again. The
plain generate produces the same file name and journal entry with real SQL and
an honest snapshot; a header comment explaining both tables was added by hand.
The migration tests read the journal and still pass with the fourth entry.

**Recurring reminders.** `src/db/repos/recurring.ts` owns the rules and the
interval arithmetic. There is no timer: a rule is a row with `next_due_on` on
it and "what is due" is a query against today, so a workspace that was closed
for a month is correct the moment it opens. Month and year steps clamp to the
end of the target month (31 Jan + 1 month is 28 Feb, 29 in a leap year) rather
than rolling into the next one, because a reminder that drifts ends up in the
wrong season. "Done" advances *past* today rather than by one step, so a
fortnightly rule missed for two months does not come back due yesterday, and it
writes the system timeline entry; "Skip this one" advances the date and leaves
`last_completed_on` untouched, which is the honest record of a cancelled visit.
Screens: `/recurring` ("Reminders", sidebar order 55) with pause, resume, edit
and delete, and a "Remind me every..." panel on the contact and company pages.
Today gained a "Coming up" section directly under Due now, showing anything due
inside seven days plus anything already past.

**Templates.** `src/db/repos/templates.ts` plus
`src/features/templates/lib/merge.ts` (pure renderer) and `values.ts` (the
database half). Merge fields render in one pass, so a value containing braces
is inserted as text and never expanded again; a known field with no value
renders as nothing and the gap it leaves is closed; an unknown field is left
exactly as typed and the editor warns about it. Editor at
`/settings/templates`, reached today from the caret on a contact's Text or
Email button and from the command palette. Four starters are seeded on first
use, inside one `withWrite` so the two pickers on a contact page cannot
double-seed, and the check counts soft-deleted rows so they never come back
after the owner throws them away. On a contact, Text and Email are split
buttons: the left half is the old plain action, the caret renders a template
for that customer and opens `sms:` or `mailto:` with the message in it, then
offers the same one-click "Log this text".

**Add to calendar.** `src/lib/ics.ts` builds a VCALENDAR with CRLF endings,
75-octet folding that never splits a multi-byte character, RFC 5545 TEXT
escaping and an exclusive all-day DTEND. `AddToCalendarButton` saves it through
the dialog and fs plugins and opens it with the OS opener, so Calendar or
Outlook imports it; Helix owns no calendar and asks for no account. The button
is on a task row with a due date and on a meeting in the timeline, and it fills
LOCATION from the contact's or company's address when there is one.

**Week summary.** One sentence under the Today title — "This week: 3 new leads,
2 jobs won ($4,300.00), 5 calls logged" — computed from
`reports.leadsBySource`, `reports.wonLost` and `activities.list` over a Monday
to now range, with the deal noun from the vocabulary setting. A part with
nothing in it is left out rather than printed as a zero, and a week with
nothing in it renders nothing.

**Help.** `/help` (sidebar order 95, command `open-help`, no shortcut — "?"
belongs to the shortcuts sheet). Six sections plus "Something's wrong?", copy
as data in `lib/content.ts` so it is unit-testable, every fact taken from the
feature code rather than invented.

### Verified

- `npm run typecheck` clean.
- `npm test`: 77 files / 1165 tests passing, migrations included.
- `E2E_PORT=4198 E2E_OUT=dist-depth`: `depth.e2e.ts` 11 passing, and
  `today.e2e.ts` + `records.e2e.ts` 19 passing with no regressions.
- `npx vite build` succeeds; the output directory was deleted.
- The no-literals grep (`#hex`, `rgba()`, `hsl()`, `lucide-react`,
  `rounded-[`) over all six new folders returns nothing.
- Screens at 1280 light and dark in `tests/e2e-mac/.cache/screens/depth/`:
  Reminders, Templates, Help, and Today with both new sections. Two defects the
  screenshots caught and that are now fixed: the Reminders "About" column said
  "Open the contact" instead of the customer's name (the repository grew
  `listWithWho`, one join shared with Today's section), and the date and
  interval columns wrapped onto two lines until the header row carried widths.

### Contract changes needed

1. **Settings' sub-navigation should link Templates.**
   `src/features/settings/lib/sections.ts` needs a row
   `{ id: "templates", title: "Templates", description: "The text messages and
   emails you send again and again.", to: "/settings/templates", icon: Article,
   group: "general" }`. The route is registered by the templates feature and
   the screen already draws `SettingsScreenFrame`, so the row is the only thing
   missing; until it exists the section list renders beside the screen with
   nothing highlighted.
2. **Trash does not know about the two new tables.** `TrashEntityType` in
   `src/db/repos/trash.ts` covers eight types; a deleted reminder or template is
   soft-deleted with a ten-second Undo but never appears in Trash and is never
   purged. For templates that is load-bearing today (it is what stops the
   first-use seed from resurrecting deleted starters), so adding them needs the
   seed's "has this workspace ever had templates" test to move to a settings
   key at the same time.
3. **`src/lib/actions.ts` was extended, additively.** `smsHref`/`openSms` take
   an optional `body`, and both `mailto:` and `sms:` query values are now
   percent-encoded with `encodeURIComponent` instead of `URLSearchParams` —
   the latter encodes a space as `+`, which a mail client shows the customer as
   a literal plus sign in every gap of the message. The `sms:` form is
   `?&body=`, which is the only separator both macOS/iOS Messages and Android
   accept; it is documented in the function and pinned by a test.

### Not done

- No reminder reaches the owner when Helix is closed. That is the design (no
  background timer, no notifications), and the seven-day window on Today is
  what covers it.
- The week summary counts calls by scanning the newest 1000 activities rather
  than with a date filter on `ActivityFilter`; past that ceiling the line reads
  "1000+". A `from`/`to` on the activities filter would be the honest fix and
  belongs to whoever owns that repository.

---

## 2026-09-19 — Final integration before 0.1.0

The seams every parallel agent left, then a full verification. Three Sonnet
agents ran under this one (the e2e theme waits plus the Windows smoke spec; the
forbidden-pattern sweep over `src/ui` and `src/app`; Trash for reminders and
templates), and a fourth pass by the same agents for voice. Everything below was
reviewed here.

### Settings, Today and the two mounts

- **Three rows added to `src/features/settings/lib/sections.ts`.** Templates
  (general, `Article`, `/settings/templates`) closes the depth agent's contract
  item 1 — the templates screen was drawing the section list with nothing
  highlighted. Reminders (records group, linked to `/recurring`). "Run setup
  again" (general, linked to `/setup`). The setup row wanted to read "Set up your
  business again", which is what the command says, and it does not fit: the
  section list beside every settings screen is 240px and truncated it to "Set up
  your busines…". The description carries the rest. `OverviewScreen`'s
  `EXTERNAL_HINTS` gained "Opens reminders" and "Opens setup".
- **`<RemoveSampleDataButton />` is mounted twice**, as the onboarding agent
  asked. In Settings it is a third group on the Workspace screen, drawn only when
  the example is actually loaded — the button renders nothing on its own, and a
  group label over nothing is an empty box, so the onboarding feature now also
  exports `useHasSampleData()`. On Today it is a footer under the content column,
  deliberately **outside** the empty/not-empty branch: loading the example fills
  the workspace, so the first-run screen is gone by the time the owner wants the
  example gone, and a button reachable only by emptying the workspace first is no
  button at all.

### Diagnostics: the two encryption readings

A fifth group, "Encryption", with the two lines the encryption agent specified.

- **Workspace file.** `db_info().encrypted` and `.cipherVersion` are optional, so
  the screen renders "Unknown" when they are absent — never "Not encrypted",
  which under the e2e harness and the unit driver (plain better-sqlite3) would be
  a lie about the owner's data. The sentence is "Your workspace file is encrypted
  on this computer." plus the cipher version in muted ink. It says *workspace
  file*, not *data*: SQLCipher covers the database, and attachments sit beside it
  on disk relying on the OS.
- **Disk encryption.** A new reader, `readDiskEncryption()`, invokes
  `disk_encryption_status` and answers null on any refusal. `encrypted: null` is
  "Could not check" with the command's own `detail` under it, never "off"; when it
  is genuinely off the row names the switch (FileVault or BitLocker) and gives one
  sentence saying where to turn it on. `tests/e2e-mac/fixtures.ts` gained the stub
  `{ platform: "e2e", encrypted: null, detail: "" }`, so the harness exercises the
  degraded path rather than the default rejection.

### The Pipeline row follows the vocabulary

`FeatureModule.nav` is a static array the shell flattens once, before the
database is open, so it could never carry a label read from `settings.vocabulary`
— which is why the sidebar said "Pipeline" on a landscaping workspace whose
pipeline screen said "Jobs". The records feature contributes the row through
`navProvider` now, which the shell calls on every render and which may therefore
use `useVocabulary()`. The route is unchanged.

That needed one change in the shell. `Shell.tsx` used to give every dynamic
section its own `SidebarSection`, which would have cut the sidebar into three
blocks to make one row dynamic. An **unlabelled** section now merges into the run
of static rows around it, in order; a labelled one ("Views") still gets its own
group. An unlabelled group is by definition not a visual group, so this is the
behaviour the slot should always have had.

### Promotions

- `src/features/onboarding/lib/settings.ts`'s nine keys are in the typed registry
  in `src/db/repos/settings.ts`, the same way the AI keys were, plus
  `templates.seededAt`. `settingStatement` moved with them and is re-exported from
  the feature so its call sites read as before.

### Trash, and the templates seed guard

`TrashEntityType` covers `recurring_rule` and `template`, with the screen's two
new tabs. That could not land until the templates seed guard moved off "count
every row, soft-deleted included" — the moment Trash can purge a starter, a row
count says "never seeded" and the four come back. The guard is the settings key
`templates.seededAt` now, written inside the same `withWrite` and `raw.batch` as
the inserts. A workspace that seeded before the key existed is handled once: a
non-empty table with no key is prior evidence of a seed, so the key is written and
nothing is inserted, and every later call answers from the key alone. Eight repo
tests, including the regression that purging all four starters does not bring
them back.

### One React tree

Four features mounted their own React roots on `<body>` from `onBoot`, each
rebuilding the providers by hand, because the shell had no slot: quick add, the
search dialog, the settings host (shortcuts sheet + workspace picker) and the AI
paste sheet. All four are `FeatureModule.overlays` now and the two mounting
modules are gone — `src/features/records/quickAdd/host.tsx` deleted,
`src/features/settings/lib/overlayHost.tsx` reduced to `createOpener` and renamed
`opener.ts`, `src/features/today/search/overlay.tsx` reduced to the component.
Their keydown bindings went with them: the shell binds every registered command's
shortcut centrally, so `mod+n`, `mod+,`, `mod+shift+v` and the bare `?` are one
handler now instead of four. The only key a feature still binds for itself is
`mod+/`, search's alias, which is not a `FeatureCommand.shortcut` — and it is a
binding inside the shell's tree rather than a second root, which is the point.
Every one of those shortcuts is exercised by the e2e suite and green.

### The stage ramp, re-derived from the brand

Sweep B left this open: a stage-coloured bar on Reports was visibly more
saturated than a brand-primary bar two cards above it, so the screen read as two
kinds of bar. The ramp now sits under the brand instead of beside it. One OKLCh
chroma for all eight (0.062, and 0.020 for the neutral), which is under the
loudest brand bar — the secondary measures 0.0903 — where revision 2 ran 0.045 to
0.148 with four entries above it. Hues come from the brand where the brand has
one: the neutral dark's hue at near-zero chroma, the primary's, the secondary's,
and one beside the accent; teal, green, red and clay are the four a five-colour
brand cannot supply.

With chroma fixed, lightness carries the separation, and it is solved rather than
chosen: a hill climb maximising the smallest pairwise ΔE2000 across normal vision
and the three dichromat simulations (Viénot, Brettel & Mollon 1999, in linear
light — the method `design/review.md` used for the first ramp), subject to every
contrast bar. It is better on the axis that matters:

```
smallest pairwise ΔE2000      normal  protan  deutan  tritan
  revision 2, light             10.2     2.1     2.0     1.9
  this ramp,  light              8.8     5.7     5.5     5.6
  revision 2, dark              11.2     4.8     0.7     1.5
  this ramp,  dark               9.1     5.0     4.9     5.0
```

Revision 2's dark ramp had a green and a red a deuteranope could not separate at
all (ΔE 0.7), which nobody had measured since the ramp was written. The lightness
band is deliberately narrow (0.450–0.530 light, tighter than revision 2's
0.437–0.542): a wider band buys more separation — 0.41–0.53 reaches 6.9 — and it
is not worth it, because these are bar fills as well as inks and the wide band
puts a near-black bar beside a mid one, so the chart reads as five weights rather
than five categories. Every contrast bar DESIGN.md sets still passes, worst case
4.75:1. The numbers and the method are in the comment blocks in `tokens.css`;
`docs/DESIGN.md` §5 is updated and no longer says "Unchanged". The tag colour
names in `TagsScreen` were two revisions stale — "Mauve" sat on a red, "Moss" on
a yellow — and are now the current eight.

Verified with `design/contrast-audit.js` over the regenerated gallery: **439
elements checked, 0 failures** in all four theme × density combinations, same as
the brand foundation's baseline. `design/ui-screens/gallery.css` was rebuilt from
a real vite build and the four gallery captures recaptured.

### The sweeps

- **Screenshot theme waits.** `depth`, `onboarding`, `today` and `records` flip
  `data-theme` and capture, and did it in the same tick, which is how sweep B's
  dark captures photographed light controls. All four wait for the canvas colour
  to change plus 250ms now. `data` and `leads` already waited for the colour and
  gained the 250ms.
- **Windows smoke.** `tests/e2e-win/specs/smoke.e2e.ts` failed on main because
  onboarding (106aafc) shows on a fresh workspace and the spec waited for Today.
  It detects which screen came up and, when it is setup, drives the flow with
  defaults and "Start empty" before asserting Today — so the run proves the
  first-run flow on a real WebView2 rather than skipping it. Roles and text, no
  ids. It cannot be run from this Mac; the GitHub job is the proof.
- **Forbidden patterns.** 32 `rounded-[var(--radius-*)]` utilities removed from 21
  files in `src/ui` and `src/app` (the feature sweeps had cleared `src/features`;
  the kit and the shell still carried them). Every `--radius-*` is 0, so this is a
  text change with no visual change. `lucide-react` removed from `package.json`
  and the lockfile — nothing imported it. `font-[var(--font-*)]`,
  `shadow-[var(--shadow-sm)]` and colour literals outside `tokens.css`: no hits.
  The six remaining hex strings in `src/ui` are all inside comments documenting a
  token's measured value.
- **Voice.** Three strings, all real: the one remaining bare "That did not
  finish." on the onboarding apply now names setup; the Diagnostics sentence was
  narrowed from "Your data" to "Your workspace file" because SQLCipher does not
  cover the attachments beside it; and a grammar slip in a starter template.

### What the screenshots caught

Two defects, both fixed:

1. **Today painted overdue yellow.** `DueNow` drew a late task with
   `<Badge tone="warning">` and an alarm glyph. DESIGN.md §5 "What has no colour"
   names the word "overdue" explicitly, and `TaskRow` already followed it — this
   section was the last place in the product putting an attention colour on a
   screen §5 says has none. Neutral now; the words and the section's own count do
   the work.
2. **The setup row truncated** in the settings section list, as above.

### Verified

```
npm run typecheck                                        clean
npm test                                    77 files / 1173 tests
npx vite build --outDir dist-final                    succeeds (deleted)
E2E_PORT=4199 E2E_OUT=dist-final-e2e playwright test    73 passed
design/contrast-audit.js over the gallery   439 checked / 0 failures × 4
```

The e2e run was one sequential pass over every spec on port 4199. 73 includes a
temporary `final-screens.e2e.ts` that captured the release screens and was then
deleted; the repo's own nine specs are the other 71. Two failures on the first
pass were this pass's own doing — the sidebar row is named "Deals" now, not
"Pipeline" — and `records.e2e.ts` was corrected. No flakes.

Release screens at 1280 in light and dark in
`tests/e2e-mac/.cache/screens/final/` (18 images, gitignored): Today empty and
populated, a contact page, the pipeline board, the Settings index, the Workspace
screen, Diagnostics, onboarding screen 1 and Reports. Read against
`assets/brand/guide/helix-crm-brand-guide.html`: one primary block per view
(the selected sidebar row, plus the one primary button where the screen has a
primary action), `--shadow-sticker` only on the lockup, no radius anywhere, the
accent never a background, dark mode with no light controls left in it.

### Left open

(Windows is now proved, and is no longer open — see the addendum below.)
- **Three large empty panels stack up on a populated Today** — Coming up, New
  leads and Gone quiet each draw a full-height empty state on a workspace that has
  plenty in it. Each one is correct on its own and each is asserted by a spec;
  together they are most of the screen. Worth a look before 0.2.0, not worth
  changing under a release.
- **The pipeline board clips its seventh column at 1280.** DESIGN.md's target is
  six columns at 1440; a seven-stage trade preset scrolls horizontally. Expected,
  recorded here because the landscaping preset makes it the default experience.
- **`--stage-7` is the one bar that still reads heavier than its neighbours**
  (L* 0.451 against 0.530 for its two neighbours). The solver spends lightness
  where it must to keep the dichromat separation; narrowing further costs more
  than it buys.

### Addendum — both GitHub jobs green

`CI` and `e2e-win` were both green on the push
(<https://github.com/walk-the-program/helix-crm/actions/runs/35482334063> and
<https://github.com/walk-the-program/helix-crm/actions/runs/35482334061>),
after one fix on top.

The first e2e-win run got through the onboarding branch and then failed typing
into the business name field: `invalid element state` on `clear`.
`aria/What is the business called?` matched the **`<label>`**, not the input it
points at — `src/ui/Field.tsx` renders the label beside a control it clones the
same id onto, so both answer to that accessible name, and msedgedriver returned
the one that cannot be cleared. The spec reads the label's `for` and matches the
input by id now, which is still text-driven (the id is never written down, it is
read off the label the owner sees) and can only resolve to the control; XPath
rather than `#id`, because React's `useId` puts characters in the id that a CSS
id selector cannot carry unescaped.

The green run drives the whole first-run flow against a real WebView2 — trade
tile, "Use this setup", "Start empty" — and then asserts the three original smoke
assertions: 3 passing in 2.8s, with `Helix 0.1.0 starting` in the app's own log.
This is the first time the setup flow has been proved on Windows.

---

## 2026-09-20 — Body font: Poppins to Lato

Walker changed his mind on the body face. Headings stay Zilla Slab.

- **Fonts.** Replaced the three self-hosted Poppins weights with `lato-400.woff2`,
  `lato-700.woff2`, and `lato-400italic.woff2` (latin subset, OFL 1.1) in
  `public/fonts/`; deleted the Poppins woff2 files and `Poppins-OFL.txt`, added
  `Lato-OFL.txt`. `globals.css`'s `@font-face` blocks and `index.html`'s preload
  now point at Lato; `tokens.css`'s `--font-body` is `"Lato", …`.
- **Weight mapping.** Lato ships at 400 and 700 only, not the 400/500/600 Poppins
  had. `src/styles/app.css` overrides Tailwind's `--font-weight-medium` (500 → 400)
  and `--font-weight-semibold` (600 → 700), so every existing `font-medium` /
  `font-semibold` utility renders a real face instead of a browser-synthesised
  weight. `globals.css`'s literal `font-weight: 600` rules that inherit the body
  face (`.section-label`, `b`/`strong`, `th`) moved to 700 for the same reason.
  `font-synthesis-weight: none` still holds.
- **Docs.** `docs/DESIGN.md` §4 and its Superseded note, `docs/CONTRACTS.md`,
  `CHANGELOG.md`, `public/fonts/README.md`, and the `design/brand/*.md` sweep
  records updated to say Lato. `assets/brand/guide/helix-crm-brand-guide.html`
  is untouched — it is Walker's original brand guide document and still shows
  Poppins, which is now a historical record rather than the shipped choice.
- **Verified:** `npm run typecheck` and `npm test` green, `npx vite build`
  succeeds with no `poppins` string in the output and `lato-400.woff2` preloaded,
  and the regenerated `design/ui-screens/gallery.css` / `gallery.html` carry Lato,
  not Poppins.

---

## 2026-09-19 — Import: deals, companies and services, and example files

The import wizard used to be the contacts import with a wizard around it. It
now asks what is in the file before it asks for the file, and it can read four
things. Contacts is untouched: same guesser, same mapping step, same write
path, same tests.

- **What are you importing?** A radio list on step 1 — Contacts (default),
  Companies, Deals, Services — in the same grouped-inset shape the duplicate
  question uses one step later. Everything downstream follows from it: which
  aliases the guesser knows, which columns the preview shows, which duplicate
  question is worth asking, and what the result screen counts.
- **Field definitions.** `src/features/data/import/fields/<type>.ts` is now the
  single description of a type: key, label, required, aliases, parser and
  writer per field, plus the three example rows. `parsers.ts` holds one total
  parser per kind (text, money, date, phone, email, choice, tags) — every one
  of them returns a warning rather than throwing, because an import must never
  stop on a bad cell.
- **Deals.** Title is the only required column. The stage is matched to the
  workspace's stage names ignoring case, and a name Helix does not have lands
  in the first stage with a warning instead of a failure. The contact is
  matched on email, then phone, then an unambiguous exact full name, and
  created when nobody matches. The company and the source are matched by name
  or created. Notes become a note on the deal's timeline; tags are linked.
  A won or lost date closes the deal and, when the stage column is blank, puts
  it in the won or lost stage. Money follows `drizzle/0004_revenue.sql`:
  `value_cents` is the derived ANNUAL value, so a file with Upfront and Monthly
  columns is read from those two and the total recomputed, and a row whose own
  total disagrees with its own split says so.
- **Services.** The catalog landed mid-flight (`feat(revenue)`), so the
  services import shipped with it rather than as a TODO: name, description,
  price, billing (One-time / Monthly / Yearly, mapped onto `kind` + `interval`)
  and taxable, matched by name.
- **Download an example.** A secondary button top right of the Import screen,
  one menu entry per type plus "All examples (zip)". Every file is generated at
  click time from the field definitions, so the header row is always exactly
  what the mapper reads back, and the deals example carries this workspace's
  real stage names so the file downloads directly importable.
  `tests/unit/data/importExamples.test.ts` proves the round trip: every
  example's headers come back 100% auto-mapped, with nothing on Skip.
- **The result screen** now shows per-type counts and, under them, the rows
  Helix had to decide something about — unknown stage, contact created,
  unreadable money — with "Save warnings as CSV" beside the existing "Save
  skipped rows as CSV".
- **Deals have no natural key**, so their duplicate question is narrower than
  a person's: skip a row whose deal name and customer already match a deal you
  still have open, or import anyway. A won deal from last year never blocks
  this year's renewal.
- **Fixtures.** `hubspot-deals.csv` and `pipedrive-deals.csv` (30 rows each)
  and `hubspot-companies.csv` (25), all invented Utah trade data, documented
  row by row in `tests/fixtures/README.md`. Each deal file carries exactly one
  unknown stage and one unreadable amount, and reuses contact emails from the
  contacts fixtures so the "import the deals after the people" path is real.
- **Verified:** `npm run typecheck` and `npm test` green (1,478 tests),
  `tests/e2e-mac/specs/data.e2e.ts` green on port 4206, `npx vite build`
  succeeds, and no colour literal appears anywhere under `src/features/data`.

## 2026-09-19 — UI fixes: macOS title bar, a filled window, and the font switch

Walker reviewed the running app in dark mode and asked for five things. All
five are in, plus the font switch they turned into.

- **The macOS title bar is integrated.** `titleBarStyle: "Overlay"` with
  `hiddenTitle` in `src-tauri/tauri.conf.json` — both are macOS-only keys that
  Tauri ignores elsewhere, so the Windows window keeps its native bar and the
  config stays in one file. The web view now starts at the very top of the
  window. `applyPlatform()` (`src/app/appSettings.ts`, called from `boot()`)
  puts `data-platform="macos"` on `<html>` from the user agent; the sidebar's
  brand slot pays `--titlebar-inset` (38px) under that attribute so the lockup
  clears the traffic lights, and the toolbar and that same slot carry
  `data-tauri-drag-region`, which is what makes the window drag and
  double-click-zoom. The e2e harness is Chromium on a Mac with no Tauri under
  it, so `isMacOS()` returns false whenever `VITE_E2E` is set and every
  screenshot stays comparable to the ones before this change.
- **The shell fills the window.** `html`, `body` and `#root` are all 100% tall,
  so the shell's `h-full` is a definite viewport height instead of "as tall as
  the content". `<main>` is the only scroller. Before this, a short screen left
  the sidebar and the canvas stopping at the content's own height with the bare
  window showing underneath — obvious in dark mode — and a long screen scrolled
  the body, dragging the chrome off the top with it. Checked at 1280×900 and
  1280×1400, light and dark, on Today, a contact page and Settings.
- **Nothing clips in a dialog.** The workspace switcher's row was a raw
  `<button>`, and a bare button comes out of the webview with
  `white-space: pre`, which nothing reset for plain text: the backup line
  refused to wrap, stretched the row past the panel, and pushed the check mark
  and "Open" off the edge. `whitespace-normal` plus `min-w-0` and `truncate`
  on both lines fixes it, and the name now carries a `title` like every other
  row in the app. `DialogContent`'s scroll box also takes `overflow-x: hidden`
  as a backstop. Every `DialogContent` call site was read; the only other one
  at risk is `MergeDialog.tsx:170`, whose `grid-cols-[9rem_1fr_1fr]` should be
  `minmax(0,1fr)` tracks — left for the data feature's owner.
- **The sticker shadow is an outline.** `--shadow-sticker` was a solid 4px slab
  of accent yellow; it is now two layered hard shadows — `--sticker-gap` inset
  1.5px painted over `--sticker-outline` at full size — so what shows is a
  1.5px ring with the surface visible through a 2.5px gap. `--sticker-outline`
  is the brand neutral the canvas is not (#FAFAFF dark, #4E555A light), and
  `--sticker-gap` defaults to `--color-bg` with the sidebar setting its own,
  because the lockup stands on the sidebar rather than the canvas. It applies
  everywhere the token was already used: the lockup, Today's first-run button,
  the deal page's money block, the import file picker. No accent-yellow fill
  is left on a button or a control anywhere; badges keep their pastel tints.
  Screenshots in `design/brand/sticker-outline/`.
- **Date and time inputs take the app's ink.** `input[type=date|time]` and the
  nine WebKit `::-webkit-datetime-edit-*` pseudo-elements are styled in
  `globals.css`, with the faint ink for an empty field, the disabled ink for a
  disabled one, a filtered calendar indicator, and `color-scheme` following
  `[data-theme]` so the native picker popup — the one thing CSS cannot reach —
  is dark in dark mode. No more UA blue in a near-black window.
- **Fonts are a switch.** `src/styles/fonts.css` is new and declares every
  family the app ships — Zilla Slab, DM Sans, Lato, Poppins — each under its
  own `--family-*` name. Which two the app wears is two lines at the top of
  `tokens.css` under a `FONT SWITCH` banner. Headings moved to **DM Sans**,
  body stays Lato. `--tracking-title` went from -0.01em to **-0.02em**, because
  a geometric sans opens up at the display and heading steps where a slab did
  not; headings stay at 700. The `index.html` preloads are derived from the
  switch (dm-sans-700, lato-400) and say so. Poppins was re-added at 400/500/700
  after the Lato pass removed it, so all four families are switchable. Nothing
  outside `fonts.css` names a family any more, in code or in a comment.

**Verified:** `npm run typecheck` clean, `npm test` green (1,441 passed, 1
skipped), `npx vite build` succeeds, and the full macOS e2e suite on port 4202
is green at 72 passed — the one failure, `revenue.e2e.ts`, is the revenue
agent's own in-flight spec and untracked. `cargo build` (debug) validates the
Tauri config. The debug app was **not** launched: `tauri dev` runs under the
same bundle identifier as the installed app and would open against Walker's
real workspace folder. Screenshots at 1280 in light and dark — Today empty and
populated, Tasks, a contact page, Settings, the workspace switcher (including a
name long enough to truncate) and onboarding screen 1 — are in
`design/brand/uifix/`.

---

## 2026-09-19 — Revenue (catalog) agent

D20: a deal is priced from a services catalog with one-time and monthly
pricing, its value is always shown as the breakdown, and MRR and ARR are
reported.

### The schema, first and on its own

`drizzle/0004_revenue.sql` plus the journal entry and the snapshot, committed
before any UI so the invoices agent could build against it:

- **`products`** — the price list. `kind` is `one_time` or `recurring`;
  a recurring row carries `interval` `month` or `year` and a one-time row
  leaves it NULL. The price is the *suggested* price.
- **`deal_items`** — one line per service on a deal, copying the product's
  name, kind, interval and price rather than reading through the reference,
  because a price list changes and a deal agreed at last year's price is still
  that deal. `product_id` is ON DELETE SET NULL for the same reason.
  `suggested_unit_cents` is what the catalog said, `actual_unit_cents` is what
  is being charged, and the gap between the two totals is the discount.
- **`deals`** gains `one_time_cents`, `recurring_monthly_cents`,
  `recurring_started_on`, `recurring_ended_on` and `suggested_total_cents`,
  all nullable with a 0/NULL default because they arrive on a table that
  already holds rows. **`value_cents` keeps its meaning as the deal's one
  stored number and is now defined as the annual value**: upfront plus twelve
  months of recurring. Everything that already sorts, filters, sums or charts
  on it keeps working.
- **`documents`, `document_items`, `document_sequences`, `invoice_schedules`**
  — written for the invoices agent, to its spec: quotes and invoices in one
  table with a per-kind status set, a per-kind unique number handed out by a
  counter row rather than `max(number) + 1`, and tax in basis points so no
  float touches money.
- **Settings**, typed in `src/db/repos/settings.ts`: `business.address`,
  `business.taxId`, `business.paymentInstructions`, `invoices.prefix` ("INV"),
  `quotes.prefix` ("QUO"), `invoices.taxRateBp` (0), `invoices.dueDays` (14).

**One deviation, deliberate.** The brief said `drizzle-kit generate --custom`.
I ran a plain `drizzle-kit generate --name revenue` instead, which produces the
same `drizzle/0004_revenue.sql` and journal entry **and** an honest
`drizzle/meta/0004_snapshot.json`. A custom migration leaves the snapshot
describing the old shape, so the next agent to run `generate` would emit
`CREATE TABLE products` a second time. `0003_recurring_templates.sql` says in
its own header that it was generated for exactly this reason.

### The money, in one place

`src/db/repos/dealItems.ts` owns it. `recompute(dealId)` is the only writer of
the four derived columns, and every write in the file runs it in the same
transaction as the change that caused it, so a deal whose lines and whose value
disagree cannot exist. The write lock is not reentrant, so the internal path is
`recomputeStatements` and the caller batches it; `recompute` is the same thing
with the transaction around it, for the two places a stage change happens (the
deal page's stage picker and a drop on the board's Won column).

- A yearly line is normalised to monthly **per line**, rounded half up, so
  `recurring_monthly_cents` is one number MRR can sum with no CASE in it, and
  the rows on the deal page add up to the total printed under them.
- The value math is pure and exported, which is what lets the rounding, the
  normalisation and the discount be tested without a database.

### What the owner sees

- **`/settings/services`** — the catalog, in three groups that are the same
  three answers the dialog asks for (charged once, every month, every year),
  reorderable, with a Taxable and an Inactive badge. Delete deletes a service
  nothing references and deactivates one a deal already uses, because that
  deal's price has to survive.
- **The deal page** gets a Services panel above the timeline: add from the
  catalog (searchable) or a custom line, each line with its quantity, the
  read-only suggested price and the editable actual price, then
  "Suggested $3,300 / Actual $3,000 / -$300" and the breakdown
  "Upfront $1,200 + $150/mo". Winning a deal that has recurring lines stamps
  `recurring_started_on`; "End recurring" stamps the end date and leaves the
  lines alone, because what was sold is history and history does not change.
- **The board and the list** read the breakdown rather than one total, and
  both column totals say "Upfront $X · $Y/mo" in tabular figures. A deal with
  nothing recurring on it still reads as its own value, so a workspace that
  never touches the catalog looks exactly as it did.
- **`/reports/revenue`** — MRR now, ARR, MRR by month for twelve months as a
  line with direct labels and no value axis, new and churned this month,
  upfront won this month, quarter and year, and the table of active recurring
  deals. Churn is muted ink, not red: a plan ending on schedule is a fact, not
  an alarm.
- **Onboarding** — every trade preset carries three to five real services,
  inserted in the same transaction as the rest of setup, and only for a
  genuinely new workspace.

### Decisions worth knowing

- **MRR boundaries.** A plan counts from the day it starts and on the day it
  ends: "ended on the 30th" means the 30th was paid for. Both are tested.
- **The current month is read as of today**, not as of its last day, because a
  chart whose final point is a month that has not happened yet always looks
  like a collapse.
- **Upfront revenue is counted on `closed_at` and on `one_time_cents`**, not on
  `value_cents`: the annual value of a monthly plan is not money that arrived
  this month.
- **`formatMoneyTrim`** (new in `src/lib/money.ts`) drops ".00" when there is
  none, so a price list reads in the round numbers it was written in. The deal
  page's hero figure moved to it too, so one screen does not print the same
  number two ways.

### Verified

- `npm run typecheck` clean.
- `npm test`: 97 files, 1511 passing, 1 skipped.
- `tests/e2e-mac/specs/revenue.e2e.ts` (new) passes, and so do `records.e2e.ts`
  (10) and `leads.e2e.ts` (12), all on `E2E_PORT=4203 E2E_OUT=dist-rev`. The
  revenue spec walks the whole decision: build a two-service catalog, price a
  deal from it with an overridden price, read the suggested/actual/discount and
  the breakdown off the panel AND out of the database, see the same breakdown
  on the board card, the column total and the list row, win the deal, and find
  it counted on the revenue report.
- Eight screenshots at 1280, light and dark, in
  `tests/e2e-mac/.cache/screens/revenue/`. I looked at all eight against
  DESIGN.md. Two things they caught, both now fixed: the Services screen was
  rendering its primary "Add a service" button in the page header and again
  inside the empty state, which is two blocks of the brand primary on one view;
  and a line's price field kept whatever had been typed into it, so a saved
  "1200" sat beside a saved "150.00" on the same panel.

### One thing fixed that was not mine

`tests/e2e-mac/fixtures.ts` had no stub for `plugin:event|listen`, so three
`leads.e2e.ts` tests failed on an uncaught page error. The cause is
`src/app/menu.ts` (commit a19dcd3, the menu bar): `installMenuBridge()`
subscribes at boot whenever `isTauri()` is true, and `isTauri()` only asks
whether `__TAURI_INTERNALS__` is present, which the harness always installs -
so the bridge runs under the harness too, contrary to that file's own comment.
I added the stub, because the harness stubs every other Tauri command and this
one was simply missed, and leads is 12/12 again. **The deeper question belongs
to whoever owns `src/app/menu.ts`**: either the bridge should be guarded by
something stronger than `isTauri()`, or the harness should keep answering it.
I did not touch `src/app`.

### Not done, on purpose

- Today: nothing, as briefed.
- The deal page's Value field is now read-only once the deal has services on
  it, because `recompute` would silently overwrite anything typed there. A deal
  with no services keeps the inline editor exactly as it was, so a workspace
  that never opens the catalog is unchanged.

---

## 2026-09-20 — Invoices agent (quotes, invoices, recurring billing, AR aging, the PDF)

D21 and D22, built on the catalog agent's `0004_revenue` migration. Full local
invoicing with a branded PDF, statuses marked by hand, AR aging and overdue on
Today; a quote is a document whose acceptance converts to an invoice; a
schedule bills monthly services on won deals. No online payments, nothing
leaves the machine.

### The model

- **`src/db/repos/documents.ts`** — quotes and invoices, one table, two kinds.
  - **Numbering** is `<prefix>-<year>-<0001>` from `document_sequences`, a
    counter row per kind, read and bumped inside the same transaction that
    writes the document. A counter rather than `max(number)+1` because the
    number is text with a prefix in it and because a voided invoice must never
    hand its number back out. Ten creates fired at once through the write lock
    produce ten consecutive numbers; the test does not await them in turn, so
    if the sequence read ever escapes the transaction the unique index on
    `(kind, number)` fails the build rather than quietly duplicating.
  - **Tax is rounded once over the whole taxable subtotal**, not per line.
    Three lines of $3.33 at 8.25% are 82 cents, not 81 — per-line rounding
    puts an invoice a cent away from the customer's own arithmetic.
  - **Status is a table, not a pile of ifs.** `canTransition(kind, from, to)`
    is the one rule, and the document page asks the same function before it
    draws a button — so the screen never offers a move the repository will
    refuse. Editing lines is draft-only.
  - **Accepting a quote creates its invoice in the same transaction**, linked
    by `converted_to_id`. Only the one-time lines cross over: a recurring line
    is what the schedule bills, and invoicing it here as well would charge the
    first month twice. A recurring-only quote therefore accepts without an
    invoice and answers `invoice: null`, which is deliberate and tested.
- **`src/db/repos/invoiceSchedules.ts`** — "bill this deal every month".
  `next_issue_on` is the only state and nothing runs in the background to keep
  it honest, the same design `recurring_rules` uses: a workspace closed for a
  quarter is correct the moment it opens. `issueDue` catches up one draft
  invoice per missed period, each dated to the period it belonged to, rather
  than one lump the owner cannot explain. Month arithmetic clamps to the end of
  a short month, so billing on the 31st means 28 February and not 3 March.
  Each schedule is its own transaction so a deal that lost its services does
  not take the rest of the run down with it; failures are collected and logged.
  **Everything it raises is a draft — nothing is sent to a customer by a timer.**
- **`src/db/repos/receivables.ts`** — AR aging in five buckets, `bucketFor`
  pure and exported. Outstanding means exactly `kind='invoice' AND
  status='sent' AND deleted_at IS NULL`: a draft is not money anyone owes yet,
  and paid and void are settled. The bucketing is done in TypeScript rather
  than a SQL `CASE` over `julianday`, because SQLite's date functions are UTC
  and this product's due dates are local calendar days.

### Where the schedule comes from

`ensureForWonDeals()` runs on boot and finds every won deal with recurring
lines and no schedule. It is deliberately not hooked to the deal page's stage
change: a deal can also be won by an import, by an undo, or by a drag on the
board, and one query that asks "which won deals are missing a schedule" cannot
forget a call site.

### The PDF

`src/features/invoices/pdf/` with pdf-lib. US Letter, the business name large
with the Helix mark small beside it (it is the customer's invoice, not Helix's
advertisement), a line table that breaks after 18 rows and repeats its header,
and the total row as the one flat `#97B1C3` block with `#141414` ink on it.
`brand.ts` is the single file holding colour literals, with a comment saying
why a PDF is the one place DESIGN.md's rule cannot apply.

Saved through the dialog and fs plugins as `<number>.pdf`, defaulting to the
workspace's own `documents/` folder and storing `pdf_path`, then opened with
the OS opener. The default folder is not a convenience:
`src-tauri/capabilities/default.json` scopes fs writes to app data and
`opener:allow-open-path` to `$APPDATA/workspaces/**`, so inside the workspace
is the one place the app may both write the file and then open it. Saving
elsewhere still works; the open is caught and reported rather than thrown.

**Rendering it and looking at it caught a defect no assertion would have:** the
first line of the business address ran straight through the bottom edge of the
logo. The info block now clears whichever of the name and the mark reaches
lower. `HELIX_PDF_SAMPLE=1 npx vitest run tests/unit/invoices/pdfSample.test.ts`
regenerates the sample; the run is skipped in a normal `npm test` because it
writes a file and asserts nothing.

### Screens

`/invoices` (nav "Invoices", order 58) with Unpaid / Paid / Quotes / All,
status pills, the outstanding money as the screen's one primary block and one
specific sentence beside it — "3 unpaid, $4,150 outstanding, 1 overdue by 12
days". `/invoices/:id` with the lines editable while it is a draft, Send
(which marks it sent and opens the PDF), a Mark paid dialog with date, method
and note, Void behind a confirm, and Download PDF. `/invoices/new` from
scratch. `/reports/receivables` with the aging block and every invoice behind
it. `/settings/invoices` for prefixes, tax rate, terms and payment
instructions, with Address and Tax ID added to the Workspace screen so a value
printed on every invoice has one place it is edited.

Two pieces live on other features' screens and are whole components in this
folder with one mount line at the call site, so two agents never edit the same
region: `DealInvoicesPanel` on the deal page ("Create quote", "Create invoice",
and "Create this month's invoice" when a schedule exists) and
`UnpaidInvoicesSection` on Today (overdue first with the days out loud, then
due within seven days, each with Mark paid and Open). `AgingBlock` is mounted
on the catalog agent's `/reports/revenue` the same way.

**Today's section carries no emphasis and no colour.** Today's one primary
block is the Due now count and it is already spent; DESIGN.md §5 lists the word
"overdue" under "What has no colour", so the badge is neutral and the wording
does the work. Every screen here spends its primary on the money rather than on
a button, which is why "New invoice", "Send" and "Create invoice" are all
secondary.

### What the screenshots caught

Three defects, all fixed, none of which an assertion would have found:

1. **The line table's totals row was one column short.** `colSpan` was 3 on a
   five-column table, so "Subtotal" and "Total" put their figures under Tax and
   left Amount empty. It is four in both modes now, with a named constant and a
   comment, because the editable table's sixth column is the remove button and
   that is exactly the off-by-one that produced this.
2. **The document page said the total three times** — the primary block, the
   table footer, and again in the Details card. The Details card keeps who,
   when and how it was paid; the money is stated where it is being worked out.
3. **The All tab summed a quote, a draft and a paid invoice into one figure.**
   That number is of nothing. Unpaid, Paid and Quotes still total, because
   every row on those means the same thing; All counts and does not sum.

And in the PDF, the first line of the business address ran through the bottom
of the logo (above).

### Verified

```
npm run typecheck                                      clean
npm test                                 94 files / 1483 tests, 1 skipped
npx vite build                                      succeeds (deleted)
E2E_PORT=4204 E2E_OUT=dist-inv playwright test
  invoices.e2e.ts + today.e2e.ts + records.e2e.ts       25 passed
forbidden-literal grep over the feature and its repos  clean
```

The skipped test is `pdfSample.test.ts`, which is opt-in by design. The
forbidden-literal grep covers colour literals, `rounded-*`, `shadow-sm`,
gradients, hard-coded px font sizes and heights, and emoji across
`src/features/invoices`, `src/db/repos/{documents,invoiceSchedules,receivables}.ts`
and both test folders. `src/features/invoices/pdf/brand.ts` is the one
deliberate exception and says so at the top.

Screens at 1280 in light and dark in `tests/e2e-mac/.cache/screens/invoices/`
(10 images, gitignored), plus `sample-invoice.pdf` and `sample-invoice.png`.

### Contract change needed

**`@pdf-lib/fontkit` is not installed and is not in the lockfile.** pdf-lib
cannot embed a TTF without it, so the PDF currently renders in Helvetica. The
Zilla Slab and Lato TTFs are downloaded, committed with their OFL files, and
bundling correctly (Vite emits all four), and `renderDocument` already tries
`@pdf-lib/fontkit` behind a dynamic import and falls back cleanly when it is
absent. One `npm install @pdf-lib/fontkit` switches the brand faces on with no
code change. A feature agent may not add a dependency (docs/CONTRACTS.md), so
this is the orchestrator's call.

### Left open

- **The brand faces, per the above.** The sample PDF in the screens folder is
  the Helvetica fallback, not what will ship.
- **"Add from your services" on `/invoices/new` is hidden.** The catalog
  feature exports no picker yet. The button is behind a dynamic import and a
  `typeof === "function"` check, so it appears by itself the day one lands; if
  their props differ from the shape assumed there, that render needs a look.
- **Three shared files carry one mount line each and are NOT in this commit**
  — `src/features/records/screens/DealPage.tsx` (`<DealInvoicesPanel dealId={id} />`),
  `src/features/settings/lib/sections.ts` (the Invoices row) and
  `src/features/leads/screens/RevenueScreen.tsx` (`<AgingBlock />`). All three
  also hold the catalog agent's uncommitted work, and committing them would
  sweep that in. They are in the working tree and green; whoever commits the
  catalog work should carry them.
- **A transient `plugin:event|listen` stub gap.** One `today.e2e.ts` run
  mid-session failed three tests on "no stub for Tauri command
  `plugin:event|listen`". It did not reproduce: `today.e2e.ts` alone passed
  10/10 immediately after, and the final three-spec run passed 25/25. Worth
  knowing about if it comes back, since `tests/e2e-mac/fixtures.ts` rejects
  anything unstubbed by design.
- **`npx vite build` prints four CSS parse warnings** from a Tailwind
  arbitrary-value class written inside a comment in `src/ui/Kbd.tsx`. Not new
  and not this feature's, but it puts a dead rule in the shipped stylesheet.
