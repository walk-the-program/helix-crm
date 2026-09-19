# Helix CRM: build contracts

Every agent working on this repo reads this file and `docs/PLAN.md` first. The plan says
what to build and why. This file pins the interfaces between the parts so that several
agents can build in parallel without stepping on each other. If you need to change a
contract, stop and report to the orchestrator; do not change it unilaterally.

## Repo layout and ownership

```
helix-crm/
  docs/                 PLAN.md, CONTRACTS.md, DESIGN.md (design agent), STATUS.md
  src-tauri/            Rust shell. Owner: foundations agent only.
    src/db.rs           the database pipe
    src/secrets.rs      keyring commands
    src/leads.rs        leads_fetch
    src/files.rs        copy_in
    capabilities/       permission JSON
  src/
    main.tsx            boot sequence (foundations)
    app/                shell: router, sidebar, registry, boot, query client (foundations)
    db/                 client.ts (Drizzle over the pipe), schema.ts, migrator.ts,
                        writeLock.ts, changeLog.ts, repos/<entity>.ts (foundations)
    lib/                pure helpers: phone.ts, email.ts, csv.ts, dates.ts, ids.ts
    ui/                 shared components built on the design tokens (design agent
                        defines tokens; foundations agent builds primitives)
    styles/             tokens.css, globals.css (design agent)
    features/
      records/          contacts, companies, deals, pipeline, timeline, tasks, quick add,
                        undo, trash
      today/            Today screen, search palette, saved views, one-tap actions,
                        gone-quiet
      data/             CSV import, export, backup/restore, duplicates/merge, attachments
      leads/            website lead poller, site settings, reports
      ai/               AI module, AI settings
      settings/         settings screens, workspaces, diagnostics
  drizzle/              generated SQL migrations + meta/_journal.json (foundations)
  tests/
    unit/               vitest, pure logic
    repo/               vitest against better-sqlite3 through the proxy callback
    e2e-mac/            Playwright + mockIPC
    e2e-win/            WebdriverIO + tauri-driver
    fixtures/           CSV exports and malformed files
  tools/
    fake-site/          Node server implementing the ClearPath leads endpoint for dev/e2e
    import-clearpath-crm.mjs   one-time export of Walker's 19 prospects to CSV
  .github/workflows/    ci.yml (test), release.yml (tauri-action matrix)
```

Rules:
- A feature agent edits only its `src/features/<area>/` folder, its tests, and its
  fixtures. To add a route or sidebar item it exports from its feature `index.tsx`; the
  registry in `src/app/registry.ts` is the single shared touch point and lists every
  feature. Foundations creates the registry with all six entries pointing at stub
  modules, so feature agents never edit it.
- Shared files (`package.json`, `src/app/*`, `src/db/*`, `src/ui/*`, `src-tauri/*`,
  `vite.config.ts`, `tsconfig*.json`, `tailwind` config, `drizzle/*`) belong to the
  foundations agent. If a feature needs a new repository function or a new shared
  component, it writes it inside its own feature folder first and reports it; the
  orchestrator promotes it.
- Never run `npm install <pkg>` in a feature agent. All dependencies are installed up
  front. If something is missing, report it.
- Never `pkill`, never kill a PID you did not start. Ports: Vite dev 1420, fake site
  4711, Playwright preview 4173.
- Commit only your own files with `git add <paths>`, never `git add -A`. Message prefix:
  `feat(records): ...`, `feat(today): ...`, `chore(foundations): ...`, `design: ...`,
  `test: ...`.

## Rust command contract (the database pipe)

All commands are `#[tauri::command(async)]`. Errors are returned as
`{ code: string, message: string }` (serialised `DbError`). Codes: `DB_CLOSED`,
`DB_OPEN_FAILED`, `SQL_ERROR`, `TX_STATE`, `BACKUP_FAILED`, `IO_ERROR`, `SECRET_ERROR`,
`NET_ERROR`, `HTTP_STATUS` (with `status` in message), `FTS_MISSING`.

```
db_open(path: string) -> { path: string }        opens (creating if absent), sets
                                                  journal_mode=WAL, foreign_keys=ON,
                                                  busy_timeout=5000; closing any previous
db_close() -> void                                waits for in-flight backup, runs
                                                  PRAGMA wal_checkpoint(TRUNCATE), closes
db_query(sql: string, params: unknown[]) -> { rows: unknown[][] }
                                                  rows are arrays in select order
db_execute(sql: string, params: unknown[]) -> { changes: number }
db_begin() -> void                                error TX_STATE if already in a tx
db_commit() -> void                               error TX_STATE if not in a tx
db_rollback() -> void
db_batch(statements: { sql: string, params: unknown[] }[]) -> { changes: number }
                                                  autocommit: BEGIN ... COMMIT
                                                  in a tx: SAVEPOINT ... RELEASE
                                                  any error: ROLLBACK (or ROLLBACK TO +
                                                  RELEASE) then the error
db_backup(reason: string) -> { path: string }     read-only second connection,
                                                  VACUUM INTO <dir>/backups/<iso>-<reason>.db.tmp,
                                                  rename to .db; dir derived from the open
                                                  db path; JS never supplies a path
db_info() -> { path, sizeBytes, fts5: boolean, sqliteVersion }
```

Param binding: JS sends `null | number | string | boolean | Uint8Array`; booleans bind as
0/1. Dates are ISO 8601 strings. Money is integer cents.

Other commands:

```
secret_set(workspaceId: string, kind: "anthropic" | "site", value: string) -> void
secret_get(workspaceId, kind) -> { value: string | null }
secret_delete(workspaceId, kind) -> void
   keyring service "helix", user "<workspaceId>:<kind>"

leads_fetch(cursor: string | null, limit: number) -> { leads: Lead[], nextCursor: string | null }
   reads settings.site_origin from the open DB and the "site" secret for the open
   workspace; GET <origin>/api/crm/leads?after=<cursor>&limit=<n> with
   Authorization: Bearer <token>; 15 s timeout; HTTP_STATUS error carries the status.
   Lead = { id: string, createdAt: string, name: string|null, email: string|null,
            phone: string|null, service: string|null, message: string|null,
            pageUrl: string|null }

copy_in(src: string) -> { storedName: string, bytes: number, mime: string }
   copies into <workspaceDir>/attachments/<uuid>.<ext>; refuses > 50 MB (IO_ERROR)

app_paths() -> { appData: string, workspacesDir: string }
```

## TypeScript database layer

`src/db/client.ts` exports:

```ts
export const raw: {
  query(sql: string, params?: unknown[]): Promise<unknown[][]>;
  execute(sql: string, params?: unknown[]): Promise<number>;
  batch(stmts: { sql: string; params?: unknown[] }[]): Promise<number>;
  begin(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>;
  open(path: string): Promise<void>; close(): Promise<void>;
  backup(reason: string): Promise<string>;
  info(): Promise<DbInfo>;
};
export const db: DrizzleSqliteProxy<typeof schema>;   // drizzle-orm/sqlite-proxy
export function setDriver(driver: RawDriver): void;   // tests and e2e-mac swap the driver
```

`RawDriver` is the interface above without Drizzle. Production driver calls Tauri
`invoke`. The test driver (`tests/repo/driver.ts`) wraps `better-sqlite3`. The e2e-mac
driver forwards to `page.exposeFunction`.

`src/db/writeLock.ts`:

```ts
export function withWrite<T>(fn: () => Promise<T>): Promise<T>;      // queues
export function withTransaction<T>(fn: () => Promise<T>): Promise<T>; // begin/commit/rollback under the lock
export function pauseTimers(): () => void;                            // returns resume
export const writeState: { busy: boolean; label: string | null };     // for UI "queued behind the import"
```

`src/db/changeLog.ts`:

```ts
export function logChange(entry: { entityType, entityId, op: "create"|"update"|"delete"|"restore"|"merge", before?, after?, batchId? }): Promise<void>;
export function undoBatch(batchId: string): Promise<void>;
```

Repository conventions (`src/db/repos/<entity>.ts`):

```ts
create(input: NewX): Promise<X>            // validates with zod, stamps id/timestamps, logs change
update(id, patch: Partial<NewX>): Promise<X>
softDelete(id): Promise<void>; restore(id): Promise<void>; purge(id): Promise<void>
get(id): Promise<X | null>; list(filter: XFilter, page?): Promise<{ rows: X[]; total: number }>
```

Every repo uses `withWrite` for writes. Joins alias every column. Never `SELECT *` in a
join.

## Schema

The tables are in `docs/PLAN.md` under "Data model". `src/db/schema.ts` is the Drizzle
source of truth. Migration `0000_init.sql` creates all tables and indexes; migration
`0001_search.sql` is the custom FTS5 migration (`search_docs`, `search_index`, and the
triggers). Custom migration text lives in `drizzle/0001_search.sql` with a matching
journal entry.

Vocabulary: the DB always says `deals` and `stages`. Labels come from
`settings.vocabulary` (`"deals" | "jobs" | "quotes"`), read through `useVocabulary()` in
`src/app/vocabulary.ts`, which returns `{ one: "Deal", many: "Deals" }` etc.

## Feature module contract

```ts
// src/features/<area>/index.tsx
export const feature: FeatureModule = {
  id: "records",
  routes: [{ path: "/contacts", element: <ContactsScreen/> }, ...],
  nav: [{ label: "Contacts", to: "/contacts", icon: Users, order: 20 }],
  commands: [{ id: "quick-add", label: "Quick add", shortcut: "mod+n", run: () => ... }],
  onBoot?: () => Promise<void>;   // e.g. start the lead poller; must be idempotent
};
```

`src/app/registry.ts` imports all six and the shell renders routes, nav, and the command
palette from them. `FeatureModule` type lives in `src/app/feature.ts`.

Sidebar order: Today 10, Contacts 20, Companies 30, Pipeline 40, Tasks 50, Reports 60,
Import 70, Settings 90.

## Design tokens

`src/styles/tokens.css` defines every colour, size, radius, and shadow as CSS variables
on `:root` and `[data-theme="dark"]`; `[data-density="compact"]` overrides spacing.
Tailwind config maps utilities to those variables. Components in `src/ui/` use only
tokens; feature code uses only `src/ui/` components and Tailwind utilities. No hex
colours outside `tokens.css`.

Minimum window width 1024 px. Body text 16 px. System font stack. Tabular numbers on
money and counts.

The design agent owns `tokens.css` and `globals.css`. The foundations agent ships a
placeholder `tokens.css` with neutral values so the app runs before the design lands.
Both use exactly these variable names (the design agent may add more, never rename):

```
--color-bg  --color-surface  --color-surface-raised  --color-border  --color-border-strong
--color-text  --color-text-muted  --color-text-faint
--color-accent  --color-accent-hover  --color-accent-text  --color-accent-soft
--color-danger  --color-danger-soft  --color-success  --color-success-soft
--color-warning  --color-warning-soft  --color-focus
--stage-1 ... --stage-8            (the pipeline stage ramp)
--font-sans  --font-mono
--text-xs  --text-sm  --text-base  --text-lg  --text-xl  --text-2xl  --text-3xl
--leading-tight  --leading-normal
--space-1 ... --space-10           (4 px scale)
--radius-sm  --radius-md  --radius-lg  --radius-full
--shadow-sm  --shadow-md  --shadow-lg
--sidebar-w  --topbar-h  --row-h
```

Themes: `:root` is light, `[data-theme="dark"]` overrides colours, `[data-density="compact"]`
overrides `--space-*`, `--row-h`, and `--text-base`. The shell sets both attributes on
`<html>` from app-level settings.

## Site endpoint contract (ClearPath templates)

```
GET /api/crm/leads?after=<cursor>&limit=<n>
Authorization: Bearer <token>
200 { leads: [{ id, createdAt, name, email, phone, service, message, pageUrl }],
      nextCursor: string | null }
401/403 on bad token. limit capped at 200. Ordered by (createdAt, id).
cursor = base64url("<createdAt>|<id>") of the last lead returned; null when caught up.
Rate limit: 60 requests per minute per token.
```

`tools/fake-site` implements exactly this with an in-memory list and a `POST /api/leads`
that mirrors the template's form handler, so the poller can be developed and tested
without a real site.

## Testing

- `npm test` runs unit + repo suites (Vitest). Both must pass before any commit.
- `npm run typecheck` (`tsc --noEmit`) must pass before any commit.
- `npm run e2e:mac` runs Playwright against `VITE_E2E=1 vite preview`.
- Repo tests get a fresh in-memory better-sqlite3 database with all migrations applied
  through the same migrator code used in production.

## Status reporting

Each agent appends a dated entry to `docs/STATUS.md` when it finishes: what it built,
what it verified (commands run and results), what it did not do, and any contract change
it needs. The orchestrator reads STATUS.md before starting the next wave.
