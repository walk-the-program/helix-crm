# 01. Product overview

Audience: an agent that has never seen this repository. Read this first, then
02 (architecture), 03 (features and data model), 04 (testing, CI, release).
Everything below was checked against the code at `main` 2e9fb04 (release tag
`v0.2.0` sits on 2e035c6; 2e9fb04 only adds the round record). Where a fact
could not be checked, it says "unverified" and why.

## What Helix is

Helix CRM is a desktop CRM for one owner running a trade or service business on
one computer. It keeps contacts, companies, jobs (deals), follow-ups, quotes,
invoices, payments and a schedule in a local SQLite file. There is no account,
no login, no server and no cloud. Mac and Windows only (Tauri v2 shell). It is
open source under AGPL-3.0-only (`LICENSE`, `package.json`, `Cargo.toml`).

Built by ClearPath Digital (owner: Walker Tracy). ClearPath builds websites for
small businesses; a Helix workspace can pull quote-form leads from a
ClearPath-built site. Helix is a separate codebase from the older ClearPath
prospect-pipeline tool (`docs/PLAN.md` D4: "Keep both").

The test every screen is measured against (`docs/PLAN.md` "What this is",
`docs/DESIGN.md` section 1): the owner does not want a CRM; he wants to not lose
a lead and to remember what he promised.

## Who it is for

- Solo owners in ClearPath's nine trades: landscaping, home services (plumbing,
  HVAC, electrical), dental, medical spa, wedding venue, church, restaurant,
  pilates studio, crossfit gym. A tenth preset, "Something else", takes a
  free-text trade. Verified against `src/features/onboarding/presets/index.ts`
  (`PRESETS`, `TRADE_OPTIONS`).
- Typical user: 40 to 65, on a laptop at a kitchen table or in a truck cab
  (`docs/DESIGN.md` section 1, `design/research.md`).
- One machine per install. Several businesses can run from one install as
  separate workspaces (one SQLite file each).
- Launch context (`docs/rounds/2026-09-20-launch-readiness-record.md` section 1):
  initial clients are ClearPath's own website clients, installed by hand on one
  Mac or Windows machine. Walker is customer zero (`docs/PLAN.md` D1).

## What it is not

- No accounts, organizations, roles, sessions, invitations or subscriptions.
  None of that code exists. Walker chose "Nothing now" for an app lock (D17,
  cited in the launch record section 1; D17 is not written out in `docs/PLAN.md`
  itself, unverified beyond that citation). Whoever can use the OS account can
  use Helix.
- No cloud, no sync between machines, no multi-user, no mobile builds.
- Not AI-first (`docs/PLAN.md` D2). AI is an optional, off-by-default module.
- No payment processing: Helix records payments the owner tells it about and
  never moves money (`CHANGELOG.md` "Not in v1").
- No email sending, no Gmail or Calendar integration, no map view, no telemetry
  or crash reporting, no auto-update, no signed installers (all `CHANGELOG.md`
  "Not in v1").
- Nothing runs in the background except timers inside the open app (backup,
  lead poll, duplicate scan, trash purge, invoice-schedule run, automation
  sweep). No job queue, no scheduler service (see 02 and 03).
- Helix carries no price and no billing code. The only link between a client
  and Helix is the `CRM_API_TOKEN` on the client's ClearPath site, which the
  client pastes into Helix (launch record section 1.1).

## Current version and where releases live

- Version 0.2.0. Verified equal in `package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`
  (the `helix-crm` package entry).
- Tags: `v0.1.0` (2026-09-18) and `v0.2.0` (2026-09-20, commit 2e035c6).
- Releases: GitHub Releases on `github.com/walk-the-program/helix-crm`
  (`git remote -v`). Pushing a `v*` tag runs `.github/workflows/release.yml`,
  which builds unsigned installers (macOS arm64 `.dmg`, macOS x86_64 `.dmg`,
  Windows `.msi`/`.exe`) and creates a DRAFT release. A human must publish the
  draft. Procedure in 04.
- Installers are unsigned. macOS: right-click, Open the first time; expect a
  Keychain prompt after each update (a new unsigned build is a new identity to
  macOS). Windows: SmartScreen "More info", "Run anyway". Source: `README.md`
  "Installing".
- `CHANGELOG.md` has two entries: 0.2.0 and 0.1.0, plus a corrected "Not in v1"
  list.
- The README development section says Node 26; CI uses Node 22
  (`.github/workflows/*.yml`). Both are what the files say; there is no
  `.nvmrc` and no `engines` field. Treat the discrepancy as unresolved.

## The two opt-in integrations

Exactly two things can send data off the machine, both opt-in, both off until
the owner sets them up. Source: launch record section 1, `README.md` "Where your
data lives", `src-tauri/capabilities/default.json`.

1. A ClearPath website, polled for quote-form leads.
   - Owner enters the site address and a bearer token in Settings, Website
     connection. The token is stored in the OS keychain, never in SQLite or
     `helix.json`.
   - Rust command `leads_fetch` (`src-tauri/src/leads.rs`) does the request:
     `GET <origin>/api/crm/leads?after=<cursor>&limit=<n>` with
     `Authorization: Bearer <token>`, 15 s timeout, no redirects followed,
     response capped at 5 MiB, up to 200 leads per page. The frontend never sees
     the token and cannot aim the request at another host.
   - The poller checks every 5 minutes while the app is open
     (`POLL_INTERVAL_MS` in `src/features/leads/lib/backoff.ts`).
   - Only the open workspace polls.
2. Anthropic API, with the owner's own key.
   - Settings, AI. Key stored in the OS keychain. Model choice: Sonnet 5
     (default `claude-sonnet-5`), Opus 5 (`claude-opus-5`), Haiku 4.5
     (`claude-haiku-4-5`), from `src/features/ai/lib/models.ts`.
   - Three actions, each only when the owner presses a button, each sending only
     the one record on screen: paste an email/text/voicemail into a proposed
     contact and job; draft a follow-up email from a job's timeline (opens the
     mail app, Helix never sends); summarize a record.
   - The only host the webview may reach is `https://api.anthropic.com/*`
     (`http:default` permission in `src-tauri/capabilities/default.json`). Helix
     does not bill for AI; Anthropic bills the owner's key directly.

## The product promise about data leaving the machine

From `README.md` "Where your data lives" and `CHANGELOG.md` 0.2.0: everything
stays on the machine. Nothing leaves unless the owner turns on the AI module or
connects a website, and even then only what those features need, and only when
asked (AI) or on the 5-minute poll (website). No telemetry, crash reporting,
analytics or update pings exist (checked: launch record section 1 "External
services"; `src-tauri/Cargo.toml` has no telemetry dependency).

Two qualifiers Helix states in its own copy, and any new copy must keep:

- Workspace database files and every backup are encrypted at rest (SQLCipher,
  key in the OS keychain). The attachments folder, exported CSV/JSON/zip files,
  and saved PDFs (quotes, invoices, statements) and `.ics` files are plain
  files, not encrypted by Helix.
- "Nothing you type is sent anywhere" is true only with the AI module and the
  website connection both off (`CHANGELOG.md` 0.2.0 correction to the Help
  screen).

If the website relationship ends, the owner keeps everything already in Helix;
Settings, Website, Disconnect removes the address and token and deletes nothing.

## Brand and voice (binding for UI and copy)

Authority: `docs/DESIGN.md` (revision 3). Short form:

- Fonts: Zilla Slab for headings, Lato for body (Poppins was replaced by Lato in
  0.2.0; fonts self-hosted in `public/fonts/`, no CDN). Only 400 and 700 exist
  for Lato.
- Palette: primary `#97B1C3`, secondary `#8B85C2`, accent `#EDF0A3`, neutral
  dark `#4E555A`, neutral light `#FAFAFF`. The primary is used once per view
  (selected sidebar row and the one primary button). The accent is a detail,
  never a background.
- Shape: radius 0 everywhere; no gradients; no blurred shadows; the sticker
  shadow is retired (`--shadow-sticker` resolves to `none`).
- Hex/rgb/hsl colors may appear only in `src/styles/tokens.css`.
- Voice: direct, specific, warm. Buttons name what will happen; errors say what
  went wrong and what to do; toasts are past tense; no exclamation marks, no
  emoji anywhere including comments.

## Screen-by-screen tour

Every route below is registered by a feature module (44 routes in total,
counted with `grep -c 'path: "'` across `src/features/*/index.tsx`). The sidebar
groups, from `NAV_GROUPS` in `src/app/feature.ts`, are:
(Today) / (Contacts, Companies) / (Deals-or-Jobs-or-Quotes, Services, Invoices,
Reports) / (Schedule, Tasks, Reminders) / (Import) / (Trash) / (Settings, Help).
Pinned saved views appear as a "Views" group between Today and Contacts (nav
order 15). The pipeline row is contributed through `navProvider` so its label
follows the workspace vocabulary.

### Today and search

- `/` and `/today`: Today (`src/features/today/TodayScreen.tsx`). The first
  screen after boot. Sections in fixed order: Due now, New leads (last week),
  Gone quiet, Recent activity; plus Coming up (reminders due within
  `COMING_UP_DAYS = 7`), today's schedule, a week summary line, an outstanding
  invoices line, a connect-your-website card, and the recovery-key card. An
  empty workspace gets a starter screen (import a CSV, add a contact, connect a
  website) instead of empty panels.
- Search (no route): Cmd/Ctrl+K opens a dialog over an FTS5 index of contacts,
  companies, deals and activities (`src/features/today/search/`). Cmd/Ctrl+Shift+K
  opens the command palette.

### Records (`src/features/records`)

- `/contacts`: virtualized list, live search, sort, tag and source filters,
  saved views, bulk actions (tag, retag company, trash).
- `/contacts/:id`: one person. Phone as a real control (call, text, email,
  directions, then "log this"), next step, tags, company link, address, custom
  fields, notes, timeline, tasks, money strip, reminders, attachments, statement
  PDF.
- `/companies`, `/companies/:id`: the same shape for a business: its people, its
  open and closed jobs, one merged timeline.
- `/pipeline` (label Deals, Jobs or Quotes): board with drag between stages, or
  a list with the full bulk bar. Stage manager: rename, reorder, recolor,
  per-stage gone-quiet limit and follow-up.
- `/deals/:id`: one deal. Stage picker (won and lost are stage flags; a lost
  stage asks for a reason), priced service lines, its money strip, its quotes
  and invoices, payments, expected start date.
- `/tasks`: every task grouped Overdue, Today, Next 7 days, Later, Done. A visit
  (task with a time, place, length) appears here too.
- `/trash`: everything soft-deleted, per type, restore or purge; entries purge
  automatically after 30 days.

### Money (`src/features/invoices`, `src/features/catalog`)

- `/services`: the price list (one-time, monthly, yearly), reached from the
  sidebar; also drawn at `/settings/services` inside Settings.
- `/invoices`: quotes and invoices list. `/invoices/new`: create a document from
  a deal or from scratch. `/invoices/:id`: the document page: lines, totals,
  status actions, payments card, PDF.
- `/reports/receivables`: who owes what and how late (aging).
- `/settings/invoices`: numbering prefixes, tax rate, payment terms, printed
  details.

### Reports (`src/features/leads`)

- `/reports`: overview. `/reports/revenue`: quoted, won, invoiced, collected,
  outstanding. `/reports/deals`: new, win rate, time to win. `/reports/sources`:
  leads by source with win rate and value. `/reports/people`: contacts and
  companies. `/reports/receivables` (registered by invoices) completes the tab
  strip.

### Time (`src/features/schedule`, `src/features/recurring`)

- `/schedule`: week view (Monday start, always). `/schedule/day/:date`: one day.
  Reads visits, tasks, jobs' expected dates, reminders and invoice due/issue
  dates from existing tables; nothing is copied. A visit can be exported as a
  standard `.ics` file.
- `/recurring` (label Reminders): rules like "spring cleanup every year" or
  "filter change every 3 months". The next-due date shows on Today a week ahead.

### Data (`src/features/data`)

- `/import`: CSV import wizard. Four types: Contacts, Companies, Deals,
  Services. Choose skip, update or create on duplicates.
- `/export`: export any list as CSV, or everything as a zip plus JSON.
- `/duplicates`: candidate duplicate pairs and the merge history (30-day
  reversal). It has no sidebar item; the only in-app link found by grep is the
  import result screen (`src/features/data/import/ResultStep.tsx`). Whether a
  second entry exists is unverified.

### Settings (`src/features/settings`, plus screens owned by other features)

- `/settings`: index of sections in four groups (General, Your records, Data,
  Advanced). Sections: Workspace, Vocabulary, Appearance, Templates, Invoices,
  Keyboard shortcuts, Run setup again, Stages, Reminders, Automations, Services,
  Tags, Custom fields, Website connection, Backups, Export, Trash, AI,
  Workspaces, Diagnostics (from `SETTINGS_SECTIONS`).
- Routes: `/settings/workspace`, `/settings/vocabulary`, `/settings/automations`,
  `/settings/tags`, `/settings/fields`, `/settings/appearance`,
  `/settings/shortcuts`, `/settings/workspaces`, `/settings/diagnostics`,
  `/settings/site` (website connection), `/settings/backups` (settings feature);
  `/settings/ai` (ai); `/settings/services` (catalog); `/settings/invoices`
  (invoices); `/settings/templates` (templates).
- Backups screen also holds the recovery key, "Open a backup from another
  machine", and the second backup copy folder.
- Diagnostics: paths, sizes, encryption state, disk-encryption state, log, and a
  "Copy details" block for support.

### First run, help

- `/setup`: three-screen onboarding (business name and trade; the trade's
  stages, sources, fields, price list; how customers come in: import, connect a
  website, load example data, or start empty). Shown automatically only when
  setup was never finished or skipped and the workspace has no contacts or
  deals (`src/features/onboarding/gate.ts`). "Skip for now" is on every screen.
- `/help`: in-app help (content in `src/features/help/lib/content.ts`),
  including "Removing a workspace for good" and "Report an issue on GitHub".

### Shell commands with no screen

Registered commands (palette, menu, shortcuts): undo, redo, toggle sidebar,
refresh, search, quick add (Cmd/Ctrl+N), new deal, add a task, schedule a visit,
new invoice, open settings, switch light/dark, switch workspace, keyboard
shortcuts (`?`), paste into a record (AI, Cmd/Ctrl+Shift+V), import a CSV,
export everything, edit services, edit message templates, open reminders, open
schedule, open help, run setup, remove sample data. Shortcut table: `README.md`
"Keyboard shortcuts"; grammar and rules in `docs/CONTRACTS.md` "The keys the
shell binds".

## Where to read more (existing docs)

- `docs/PLAN.md` decisions D1 to D15 and original scope; later decisions D16 to
  D22 are recorded in `docs/STATUS.md` build notes, not in PLAN's table: D16 and
  D19 (onboarding, reminders, templates, calendar), D18 (encryption at rest,
  also in CONTRACTS), D20 (services catalog with one-time and monthly pricing),
  D21 and D22 (quotes, invoices, recurring billing). D17 appears only in the
  launch record (no app lock).
- `docs/CONTRACTS.md`: binding interface contracts.
- `docs/DESIGN.md`: brand contract.
- `docs/OPERATIONS.md`: incident procedures and founder tasks.
- `docs/rounds/2026-09-20-launch-readiness-record.md`: the launch round record.
  Its verdict: ready with operating conditions, no blockers. Open decisions for
  Walker (website pricing, whether Helix is bundled, install model, code-signing
  budget, opt-in update check, where the client roster lives) are listed in its
  section 6.
- `docs/LAUNCH-ACCEPTANCE.md`: scenario matrix J1 to J14 with the surface that
  proved each row.

Verified against: `README.md`, `CHANGELOG.md`, `docs/PLAN.md`, `docs/DESIGN.md`,
`docs/CONTRACTS.md`, `docs/STATUS.md` (D-number lines), launch record sections 1
and 6, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`src-tauri/capabilities/default.json`, `src/features/*/index.tsx`,
`src/app/feature.ts`, `src/app/registry.ts`,
`src/features/onboarding/presets/index.ts`,
`src/features/settings/lib/sections.ts`, `src/features/leads/lib/backoff.ts`,
`src/features/ai/lib/models.ts`, `git remote -v`, `git tag`.
