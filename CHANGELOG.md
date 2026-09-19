# Changelog

## 0.1.0 - 2026-09-18

First release.

### Foundations

- Built the Tauri v2 shell with a dedicated Rust database pipe (`db_open`,
  `db_query`, `db_execute`, `db_begin`/`commit`/`rollback`, `db_batch`,
  `db_backup`) instead of the stock SQL plugin, so a long-running transaction
  can't be split across two connections.
- Stored secrets (the site token and the Anthropic key) in the OS keychain
  through a dedicated Rust command, never in the database or in `helix.json`.
- Wrote the Drizzle schema and the journal-driven JS migrator, with a backup
  taken automatically before any pending migration runs.
- Added a JS-side write lock so a long transaction (an import, a merge, a
  restore) queues other writes instead of racing them.
- Set up the design token system (`src/styles/tokens.css`) and the shared UI
  component kit (`src/ui`), built to a measured contrast and hit-target
  standard in both light and dark themes.

### Contacts, companies, and the pipeline

- Added contacts with phones, emails, addresses, tags, sources, and custom
  fields, normalizing phone numbers automatically and never rejecting an
  unparseable one.
- Added companies with linked contacts, linked deals, and a merged timeline.
- Added a pipeline with a drag-and-drop board and a list view, editable and
  reorderable stages, and a vocabulary setting so stages can read as Deals,
  Jobs, or Quotes.
- Added a timeline of notes, calls, emails, meetings, and texts on every
  contact, company, and deal, with system entries for stage changes and
  imports.
- Added tasks and follow-ups with due dates, snoozing, and one-tap
  completion from a list.
- Added quick add (Cmd/Ctrl+N) for creating a contact, company, deal, task,
  or note from anywhere in the app.
- Added undo (a ten-second toast on every create, update, and delete) and a
  trash screen with restore and permanent deletion after 30 days.
- Added one-tap calling, texting, emailing, and directions from any phone
  number, email, or address, with a one-click option to log that it
  happened.

### Today, search, and views

- Added the Today screen: what's due, new leads from the last week, jobs
  that have gone quiet, and recent activity across the whole workspace.
- Added instant search (Cmd/Ctrl+K) across contacts, companies, deals, and
  notes, backed by SQLite's full-text search and returning results in well
  under 50 milliseconds on 10,000 contacts.
- Added a command palette (Cmd/Ctrl+Shift+K) listing every registered
  action in the app.
- Added saved views: name a list's filters and sort, and optionally pin it
  to the sidebar.
- Added the gone-quiet rule, flagging an open deal with no recent activity
  against a per-stage threshold.

### Data in and out

- Added CSV import with automatic delimiter, encoding, and column-mapping
  detection, a preview step, and a choice of skip, update, or create for
  duplicate rows. Tested against real HubSpot, Zoho, Pipedrive, Google
  Contacts, and Excel exports.
- Added export of any list, or every entity as CSV inside a zip plus a full
  JSON export, with a formula-injection guard on exported cells.
- Added automatic backups (on launch and every six hours while open) using
  SQLite's `VACUUM INTO` on a second connection so the UI never waits, with
  30 days of retention.
- Added restore from backup, with a confirmation naming both the backup's
  date and today's date.
- Added duplicate detection for contacts and companies, with a merge screen,
  a ten-second undo, and a 30-day merge history with reversal.
- Added attachments: files are copied into the workspace folder with images
  showing a thumbnail, capped at 50 MB per file.

### Website leads and reports

- Added the ClearPath site leads endpoint (`GET /api/crm/leads`) and ported
  it to all eighteen ClearPath templates.
- Added the lead poller: Helix checks a connected site every five minutes
  while open, turning each new lead into a contact and a deal with the
  original message kept on its timeline.
- Added `tools/fake-site`, a zero-dependency server standing in for a real
  ClearPath site during development and testing.
- Added reports: pipeline value by stage, wins and losses over time, leads
  by source, conversion between stages, and average time in each stage, each
  as a chart with a table view and a CSV copy.

### Settings and workspaces

- Added workspace-level settings: vocabulary, stages, tags, custom fields,
  currency and locale, and the site connection.
- Added workspaces, so several businesses can run from one install, each in
  its own SQLite file, switched from the sidebar.
- Added light and dark themes and a comfortable/compact density toggle.
- Added a keyboard shortcuts sheet and a Diagnostics screen.

### Optional AI module

- Added an optional, off-by-default AI module using the owner's own
  Anthropic API key, stored in the OS keychain.
- Added paste-to-record: paste an email, text, or voicemail transcript and
  get a proposed contact and deal to review before saving.
- Added drafting a follow-up email from a deal's timeline, opened in the
  owner's mail app.
- Added summarizing a contact, company, or deal in a few sentences.
- Every AI action sends only the record on screen, and only runs when the
  owner presses a button.

### Testing and infrastructure

- Added unit and repository test suites (Vitest) covering normalization,
  CSV parsing, every repository, the migrator, and the search triggers.
- Added a macOS end-to-end suite (Playwright) against a mocked Tauri layer,
  and a Windows end-to-end suite (WebdriverIO + tauri-driver) against the
  real compiled app.
- Added GitHub Actions workflows for tests (`ci.yml`), the Windows
  end-to-end suite (`e2e-win.yml`), and unsigned release builds for macOS
  and Windows (`release.yml`).

## Not in v1

The following were considered and deliberately left out of this release:

- Sending email from Helix, or any mail integration
- Multiple users or team accounts
- Cloud sync between machines
- Mobile builds (iOS/Android)
- Quotes, invoices, and payments
- Gmail and Google Calendar integration
- A map view
- Recurring service reminders
- Importing deals from a CSV (only contacts and companies import)
- Signed and notarized installers, and auto-update (which depends on
  signing)
- Telemetry or crash reporting of any kind
- Any AI action that runs without the owner pressing a button
- Encrypted workspaces
- Email templates with merge fields
- The gone-quiet rule for contacts that have no deal
