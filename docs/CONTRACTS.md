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
export const writeState: {
  busy: boolean;
  label: string | null;
  queued: number;
  /**
   * Non-null while the database is closed and being reopened - a workspace
   * switch or a restore. Not a write, so it never holds the lock; the label
   * comes from src/db/client.ts (see "The closed window" below) and the shell
   * shows it as a quiet line in the top bar.
   */
  transition: string | null;
};
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
  overlays?: <QuickAddDialog/>,   // or a function; always mounted, every screen
  onBoot?: () => Promise<void>;   // e.g. start the lead poller; must be idempotent
};
```

`src/app/registry.ts` imports all six and the shell renders routes, nav, and the command
palette from them. `FeatureModule` type lives in `src/app/feature.ts`.

Sidebar order: Today 10, Contacts 20, Companies 30, Pipeline 40, Tasks 50, Reports 60,
Import 70, Settings 90.

## Design tokens

`src/styles/tokens.css` defines every colour, size, radius, shadow and duration as CSS
variables on `:root` and `[data-theme="dark"]`; `[data-density="compact"]` overrides the
type scale, spacing and heights. `src/styles/app.css` mirrors every token onto a private
`--tok-*` alias and feeds those into Tailwind's `@theme inline`, so `bg-surface`,
`text-muted` and friends resolve at use time under whatever `data-theme` is in force.
Components in `src/ui/` use only tokens; feature code uses only `src/ui/` components,
`@/ui/icons` and Tailwind utilities. No hex, `rgb()`, `rgba()` or `hsl()` outside
`tokens.css`.

Minimum window width 1024 px, design target 1280. Body text 15 px comfortable / 13 px
compact. Two self-hosted webfonts, and no third: Zilla Slab for headings, Poppins for body
(`public/fonts/*.woff2`, latin subset, OFL 1.1, declared in `globals.css`, no CDN because
the app is offline). Tabular numbers on money and counts.

The design agent owns `tokens.css`, `globals.css` and `src/ui/icons.ts`. Both the design
agent and the foundations agent use exactly these variable names (the design agent may
add more, never rename):

```
--color-bg  --color-surface  --color-surface-raised  --color-sidebar
--color-hover  --color-selected  --color-overlay  --color-tint
--color-border  --color-border-strong
--color-text  --color-text-muted  --color-text-faint  --color-text-disabled
--color-accent  --color-accent-hover  --color-accent-text  --color-accent-soft
--color-accent-ink  --color-link
--color-danger  --color-danger-soft  --color-danger-ink
--color-success  --color-success-soft  --color-success-ink
--color-warning  --color-warning-soft  --color-warning-ink
--color-info  --color-info-soft  --color-info-ink
--color-focus
--color-heading                    (the near-black headings are set in)
--stage-1 ... --stage-8            (the pipeline stage ink)
--stage-1-soft ... --stage-8-soft  (its pastel fill)
--brand-primary  --brand-secondary  --brand-accent
--brand-neutral-dark  --brand-neutral-light  --brand-primary-tint
--color-brand-primary-soft    --color-brand-primary-ink
--color-brand-secondary-soft  --color-brand-secondary-ink
--color-brand-accent-soft     --color-brand-accent-ink
--font-heading  --font-body  --font-sans  --font-mono
--text-display  --text-heading  --text-subhead  --text-body  --text-caption
--leading-display  --leading-heading  --leading-subhead  --leading-body  --leading-caption
--text-label  --text-xs  --text-sm  --text-base  --text-lg  --text-xl  --text-2xl  --text-3xl
--leading-tight  --leading-normal  --tracking-title  --tracking-label
--shadow-sticker                   (the mark's offset accent shadow)
--space-1 ... --space-10           (4 px scale)
--radius-sm  --radius-md  --radius-lg  --radius-full
--shadow-sm  --shadow-md  --shadow-lg
--sidebar-w  --topbar-h  --row-h  --control-h  --control-h-sm  --content-max
--hairline  --focus-ring-w
--dur-fast  --dur-base  --dur-slow  --ease-out  --ease-in-out  --press-scale
```

Added in revision 2 of `docs/DESIGN.md`: `--text-label` (the 11 px small-capitals section
label), `--tracking-title` / `--tracking-label`, `--color-text-disabled` (the platform grey
that may not carry text), `--color-link` and `--color-info*`, `--color-tint`, `--hairline`
and `--press-scale`. `--shadow-sm` is `none`: only a floating layer casts a shadow.

Added in revision 3 (the brand guide): the five `--brand-*` colours and
`--brand-primary-tint`; `--color-heading`; `--font-heading` / `--font-body`;
the guide's own five-step scale `--text-display|heading|subhead|body|caption` with a
matching `--leading-*` for each; the three `--color-brand-*-soft` / `-ink` tint pairs;
and `--shadow-sticker`. Nothing was renamed. What the mapping now means:

- **Every `--radius-*` is `0`.** The names survive so no call site breaks; they all
  resolve to a hard edge, which is the guide's corner language.
- **`--color-accent` is the brand primary `#97B1C3`, and it is the one saturated block a
  view gets.** Its ink is `--color-accent-text` `#141414` (8.24:1). White on the primary
  measures 2.24:1 and is never used. In practice the block is the selected sidebar row,
  plus the primary button on a screen that has a primary action.
- **`--color-selected` is a quiet tint, not the primary.** A selected table row, a
  highlighted menu item and a palette row all use it; only the sidebar paints
  `--color-accent`.
- **`--color-focus` is the brand secondary `#8B85C2`** (3.37:1 on white, over the 3:1
  non-text bar). **`--color-link` is `#5F58A6`**, the same hue darkened until it clears
  AA for 15 px text, because the pure secondary does not.
- **`--shadow-md` / `--shadow-lg` are a hairline with no blur.** `--shadow-sticker` is not
  part of that ramp: it belongs to the `Brand` lockup and at most one hero element per
  screen.
- **`--font-sans` is `--font-body`**, so every existing component picks up Poppins with no
  edit. Headings opt in to `--font-heading`.

Themes: `:root` is light, `[data-theme="dark"]` overrides colours,
`[data-density="compact"]` overrides the type scale, `--space-*`, `--row-h`, `--topbar-h`
and `--control-h*`. The shell sets both attributes on `<html>` from app-level settings.

Icons: `@phosphor-icons/react` only, imported through `src/ui/icons.ts`, which also
re-exports every Lucide name the product used so a feature migrates by changing the import
path alone. `src/ui/icons.ts` is not re-exported from `src/ui/index.ts` (it would collide
with the `Table` component). Regular weight at 18 px in lists, bold at 16 px in buttons.

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

## Clarifications made during the build (binding)

- `db_rollback` outside a transaction returns `TX_STATE`. Callers that roll back
  defensively in a `catch` must tolerate that error.
- Backup file names use dashes in the time part (`2026-09-18T19-05-03Z-<reason>.db`)
  because Windows rejects `:` in file names.
- `leads_fetch` omits the `after` query parameter entirely when the cursor is null. The
  site endpoint and the fake site treat a missing `after` as "from the beginning".
- `db_info.sizeBytes` includes the `-wal` file.
- `db_open` returns the path absolutised but not canonicalised (Windows `\\?\` prefixes
  would otherwise leak into Diagnostics).
- `reqwest` is pinned to 0.12 to match `tauri-plugin-http`.

## Wave 3 reconciliation (binding)

The five feature areas were built in parallel and each wrote what it needed inside its
own folder. Wave 3 promoted that code into the shared layers and closed the seams
between the features. Everything in this section is now the contract.

### Where the promoted code went

| Was | Is |
| --- | --- |
| `features/today/lib/todayData.ts#newLeads` | `db/repos/deals.ts#newLeads` |
| `todayData.ts#lastActivityFor`, `#recentWithLinks` | `db/repos/activities.ts` |
| `todayData.ts#taskLinks` | `db/repos/tasks.ts` |
| `todayData.ts#workspaceIsEmpty` | `db/repos/seed.ts` (the first-run check lives with the first-run seed) |
| `features/today/lib/searchRows.ts` | `db/repos/search.ts` (`searchRows`, `recentRecords`, `GROUP_HEADINGS`) |
| `features/data/lib/csv.ts` | `lib/csv.ts` |
| `features/data/lib/importWrite.ts` statement builders | the repository for the table each one writes: `contacts.ts` (`importContactStatements`, `contactEmailStatement`, `contactPhoneStatement`, `contactUpdateStatement`), `companies.ts`, `sources.ts`, `tags.ts`, `customFields.ts` |
| `importWrite.ts#planBatch`, `#coalesceInserts`, `Statement` | `db/repos/_base.ts` |
| `features/data/lib/duplicates.ts#findContactPairs` / `#findCompanyPairs` | `db/repos/contacts.ts` / `db/repos/companies.ts`; the shared `DuplicatePair` shapes and `pairKey` are in `_base.ts`. What stays in the feature is the schedule and the merge-field picker. |
| `features/leads/lib/reportQueries.ts` | `db/repos/reports.ts` |
| `features/leads/lib/periods.ts` | `lib/periods.ts` (a repository may not import a feature) |
| `features/today/actions.ts` + `features/records/lib/{oneTap,links}.ts` | `lib/actions.ts`, one module |

Two names were added rather than moved:

- **`deals.createStatements(input)`** returns `{ id, row, statements }` — the deal insert
  and its first `deal_stage_events` row, for a caller already inside a
  `withTransaction` (the lead poller, and an import if deals ever become importable).
  `position` is required, because a caller inside a transaction already knows it. The
  caller owns the change-log entry, which is why `row` comes back: it is the `after`.
- **`src/lib/actions.ts`** is the one member of `src/lib` that is not pure. A one-tap
  action is the sum of the OS opener, the activities repository, the query client and
  the toaster, and splitting it is what produced two copies. Everything else in
  `src/lib` stays pure.

### Undo and soft delete

`change_log.op` is `"delete"` for both kinds of delete. What tells them apart is whether
`before` carries an `id`:

- **Soft delete** (`_base.softDeleteRow`) logs `before: { deletedAt: null }`,
  `after: { deletedAt: <at> }` and no `id`, because the row never left. `undoBatch`
  writes those columns back, which clears `deleted_at`. The row keeps its id, its
  `created_at` and every child row.
- **Hard delete** logs the whole row, `id` included, and `undoBatch` re-inserts it.
  `purgeRow` logs no `before` at all, so a purge is not undoable — by design.

`restore(id)` is unchanged and is still what the delete toasts call: one statement
instead of a replay. Both paths now work and they agree; `tests/repo/records/undoFlow.test.ts`
proves it.

### `deals.board()`

Returns one entry per live stage of the pipeline, in stage position order, including
stages that hold nothing. A caller no longer drives the columns from `stages.list()` and
looks each group up. A deal whose stage was deleted underneath it still gets a column
rather than vanishing.

### One search, and the keys the shell binds

There is one search in the product.

- **Cmd/Ctrl+K** — the shell looks up the registered command with the id `"search"` at
  press time and runs it. Today's feature registers it, so Cmd/Ctrl+K opens the search
  dialog. With no such command registered, the same key opens the command palette, so
  the shell never depends on a feature being present.
- **Cmd/Ctrl+Shift+K** — the command palette, always. The search dialog also carries a
  "Commands" button that opens it, so neither panel is a dead end. The palette exports
  `openCommandPalette()`, which fires `helix:open-palette` on `window`, for anything
  rendering outside the shell's React tree.
- **Cmd/Ctrl+/** — an alias for search, kept because it shipped and because it still
  works on a screen where the shell is not mounted.
- The topbar's "Search everything" button runs the same lookup as Cmd/Ctrl+K.

**Superseded:** this section used to end "`FeatureCommand.shortcut` is still a
label, not a binding." It is a binding now - the shell registers every one of
them. See "The keys the shell binds" below. Everything else here still holds.

### `FeatureModule.navProvider`

```ts
navProvider?: () => FeatureNavSection[];
type FeatureNavSection = { label?: string; order: number; items: FeatureNavItem[] };
```

For sidebar items that do not exist until something has been read from the database.
`nav` is still a static array flattened once at mount; `navProvider` is called by the
shell on every render, once per feature, in registry order, and its sections are spliced
into the static items at their `order` — so a section with order 15 renders between
Today (10) and Contacts (20).

It is a React hook slot: it may call hooks, and it must obey the rules of hooks. The
registry is fixed at module load, so the set of providers never changes between renders.
Return `[]` to contribute nothing, and an empty section is not rendered.

`NAV_ORDER.views` is 15 and belongs to Today's pinned saved views, which is why the strip
at the top of the Today screen is gone.

### The workspace footer

The sidebar footer runs the registered command with the id `"switch-workspace"` if there
is one, looked up at click time. With no such command it renders the workspace name as
plain text, exactly as before.

### Saved views on a list screen

`src/features/today/views` is the library; `screenState.ts` and `ViewsToolbar.tsx` are
the adoption pattern, and `src/features/records/screens/ContactsScreen.tsx` is the
reference implementation. A screen keeps its own filter state, turns it into a
`ViewQuery` with `queryFromState(filters, defaults, sortId)`, reads one back with
`stateFromQuery(query, defaults)` and `sortIdOf(query, fallback)`, and renders
`<ViewsToolbar>` in its `PageHeader` actions. A filter equal to the screen's default is
left out of the query, so "nothing filtered" round-trips as an empty filter list. The
sort is `[{ field: <the screen's own sort id>, direction: "asc" }]` — the id is opaque to
the library, as its README says.

A pinned view is a link in the sidebar's Views group and arrives at the screen as
`?view=<id>`, which `useSavedViews` reads; the screen applies it once, when the row
loads.

## Shell seams, revision 2 (binding)

Wave 3 closed the seams between the features. This closes the seams between the
features and the shell: three mechanisms every feature invented for itself,
because the shell had no slot for them, are now the shell's job.

### The keys the shell binds

**`FeatureCommand.shortcut` is a binding, not a label.** The shell installs one
`keydown` handler on `window` and answers every registered command's shortcut
from `allCommands()`. `src/app/shortcuts.ts` is the whole mechanism and is pure
apart from the hook, so the rules are testable: `parseShortcut`,
`normaliseShortcut`, `matchesChord`, `isTypingTarget`, `shouldSkipEvent`,
`pickCommand`, `useCommandShortcuts`.

The rules:

- `mod` is Cmd on macOS and Ctrl elsewhere, and the **other** platform's
  modifier must not be held: Ctrl+Cmd+K is not Cmd+K.
- The only modifier names are `mod`, `shift` and `alt`, and Shift and Alt must
  match exactly. `"ctrl+k"` and `"cmd+k"` are refused rather than guessed at -
  `parseShortcut` returns null, the palette still prints the string, and no key
  is bound. A chord that does not parse never throws during a keypress.
- A bare key (`"?"`, `"g"`) matches on `event.key` and says nothing about Shift,
  because the browser has already applied it: `?` is Shift+/ on a US keyboard
  and its own key elsewhere.
- **Typing suppresses every shortcut.** An `INPUT`, `TEXTAREA`, `SELECT` or
  contenteditable target means the owner is typing. A command that genuinely
  needs its key inside a field opts in with **`whileTyping: true`**; a bare key
  is never bound while typing, with or without the flag, because a bare key is
  what the owner is typing.
- A key repeat, an IME composition and an already-`defaultPrevented` event are
  all ignored.
- Registry order breaks a tie, which is also the order the palette lists
  commands in, so two features claiming one key is visible rather than random.

**`mod+k` and `mod+shift+k` stay the shell's own** (`SHELL_OWN_SHORTCUTS` in
`Shell.tsx`) and the generic binder skips them, because they are lookups rather
than commands: `mod+k` runs whichever feature owns `"search"` and falls back to
the palette, and the palette is not a feature at all. Everything in the "One
search" section above is unchanged.

**Features should now delete their own bindings.** `src/features/today/search/
overlay.tsx`, `src/features/records/quickAdd/host.tsx`,
`src/features/settings/components/SettingsHost.tsx` and the AI host each bind a
key their command already declares. They still work: the shell's handler calls
`preventDefault`, `stopPropagation` **and** `stopImmediatePropagation`, and it is
registered before any of them (a feature's `onBoot` runs after the shell's first
paint), so a command runs exactly once. `stopImmediatePropagation` is the one
that does the work - two listeners on `window` are not in a propagation
relationship, so `stopPropagation` alone would not stop the second one. The
double binding is transitional; the owning agent should remove it.

`useShortcut(shortcut, run)` in `src/app/hooks.ts` survives for a key that
belongs to a *component* rather than to a command, and now shares the parser.
`isMac()` moved to `src/app/shortcuts.ts` and is re-exported from `hooks.ts`, so
every existing import still resolves.

### `FeatureModule.overlays`

```ts
overlays?: ReactNode | (() => ReactNode);
```

The dialogs that have to exist on every screen - quick add, the AI paste dialog,
the workspace switcher, the shortcuts sheet - render here, inside the shell's
providers, below the routed screen and outside `<main>`. A function is rendered
as a component (`<Overlays/>`), so it gets its own render and may use hooks; it
is not the delicate hook slot `navProvider` is.

This replaces mounting a second React root on `<body>` from `onBoot` and
rebuilding `QueryClientProvider` and `TooltipProvider` around it, which is what
four features were doing. `allOverlays()` in the registry is what the shell
reads. The slot is provided, not yet adopted: the existing hosts keep working
until the owning feature agent moves its dialog across.

### The closed window: switch and restore

A workspace switch and a restore both close the database and open another file,
and for that moment every read answers `DB_CLOSED`. `src/db/client.ts` names the
window so the shell can say so instead of sitting there:

```ts
export function beginDbTransition(label: string): () => void;  // returns the ender
export function dbTransitionLabel(): string | null;
export function subscribeDbState(listener: () => void): () => void;
```

- `beginDbTransition` marks a deliberate one; the ender is idempotent, so it is
  safe in a `finally`. Nested labels stack and the innermost wins.
- A `raw.close()` with no label in flight marks an **implicit** one, which the
  next successful `raw.open()` clears. That is what covers a restore's copy
  step, which closes the file itself before calling back into the boot path.
- `writeLock` folds the label into `writeState.transition` and republishes, so
  `useWriteState()` exposes it and the top bar renders it as a quiet muted line
  (it takes precedence over the write badge: nothing else can be true then).

`boot.openWorkspace(workspace, { label? })` labels itself "Opening the
workspace…" by default; `boot.switchWorkspace` wraps the whole close-open-migrate
sequence in "Switching workspace…" and passes `{ label: null }` inwards so the
note does not flicker between two strings. The first launch passes
`{ label: null }` too, because `BootingScreen` owns the window at that point.

### Promoted settings keys

`aiKeySuffix` (`string | null`, default null), `aiKeyState`
(`"unset" | "saved" | "rejected"`, default `"unset"`) and `aiBaseUrl` (string,
default `https://api.anthropic.com`) are in the typed registry in
`src/db/repos/settings.ts`. `aiModel`'s default is corrected to
`claude-sonnet-5`. The AI feature still reads them through its own
`defineExtraSetting` wrappers over `getRaw`/`setRaw`, which are key-agnostic and
keep working unchanged - `src/features/ai/lib/aiSettings.ts` can shrink to
`settings.get`/`settings.set` calls whenever that agent next touches the file.

### The dev server's watch list

`vite.config.ts` ignores `tests/e2e-mac/.cache/**`, `dist-*/**`, `design/**` and
`docs/**` as well as `src-tauri/**`. An e2e run, a screenshot pass or a docs edit
used to reload the dev window out from under whoever was looking at it, and a
reload mid-run is also how a Playwright spec fails for no reason.

## Status reporting

Each agent appends a dated entry to `docs/STATUS.md` when it finishes: what it built,
what it verified (commands run and results), what it did not do, and any contract change
it needs. The orchestrator reads STATUS.md before starting the next wave.
