# Changelog

## 0.2.0 - 2026-09-20

- Changed the body font from Poppins to Lato at Walker's request. Self-hosted
  as `lato-400.woff2`, `lato-700.woff2`, and `lato-400italic.woff2` in
  `public/fonts/`; headings stay Zilla Slab. Lato ships at 400/700 only, so
  `font-medium`/`font-semibold` now render 400/700 instead of the old
  Poppins 500/600.
- Fixed the 30-day trash purge to also remove a purged quote or invoice's own
  generated PDF, when Helix is the one that saved it (a PDF the owner saved
  somewhere else through the save dialog is left alone, because that path is
  the owner's own choice, not Helix's file to delete).
- Bounded how long `change_log` (the data behind Cmd+Z) keeps a deleted or
  changed record's field values: 90 days, well past both the 30-day merge
  reversal window and the fact that undo itself never survives closing and
  reopening the app. Rows used to be kept forever.
- Corrected several claims that no longer matched what the app does: the
  "Not in v1" list here (see below), the Help screen's "nothing you type is
  sent anywhere, ever" (true only with the AI module and the website
  connection both off), and added copy telling the owner, at the point
  Diagnostics offers the log or Backups explains what it covers, that
  attachments and exports are plain, unencrypted files and that the log does
  not name a customer. Added "Removing a workspace for good" to Help, since
  archiving a workspace never deletes it and there was nowhere that said so.
- Added a recovery key. Settings, then Backups, can show the key that
  encrypts your workspace and every backup of it, formatted to copy, save as
  a file, or print; a card on Today stays until you've kept a copy one of
  those ways. The key otherwise lives only in this computer's keychain, so
  it's the only way to open your files again on a new machine after this
  one dies, is stolen, or is wiped.
- Added a second backup copy. Pick a folder in Settings, then Backups (an
  external drive, or one already synced by Dropbox, iCloud Drive, or
  OneDrive), and Helix keeps it matching your own backups folder after every
  backup. It matches rather than piles up, so the folder can't grow without
  bound.
- Added a backup before every import, taken automatically before anything
  is written; if it can't be taken, the import stops rather than risk your
  existing records. The import result screen now names that backup and adds
  a button straight to it.
- Fixed a Keychain access prompt you deny (expected after every rebuild of
  an unsigned build) showing a screen that guessed the wrong cause. It now
  says plainly what happened and that choosing Always Allow next time is
  the fix, instead of pointing you at a second copy of Helix or a folder
  that isn't writable.
- Fixed an older build of Helix silently reading and writing a workspace a
  newer build had already upgraded. It now refuses to open one, with its
  own screen naming the problem.
- Fixed several website-connection failures that named the wrong cause or
  gave no way back: a site with no lead endpoint blamed on your internet, a
  bad cursor that looped forever with nothing to do about it from inside
  the app, Test connection checking the token already saved instead of the
  one you'd just pasted, and changing a site's address duplicating your
  whole pipeline. Pasting a token now trims quotes, line breaks, and the
  placeholder every template ships with, before it's ever saved.
- Fixed the CSV importer: "Customer Name" and "Co." columns no longer
  default to Skip, a row's warnings (a missing name, an unusable phone) are
  kept instead of thrown away, and the preview's row count now reflects the
  whole file instead of always reading 20.
- Fixed Today asking you to import customers you had just imported. It now
  tells an empty workspace apart from one with customers in it but no work
  started yet, and the second case says what fills Today next instead of
  repeating the import prompt.
- Added a "Copy details" block to Diagnostics: one block you can paste into
  an email with the version, OS, workspace id, encryption state, last
  backup, and website-connection state, so a support call doesn't start
  with reading rows off the screen.
- Added payments. Record a deposit, a partial payment, or the full amount
  against an invoice, each with its own date, method, and reference. An
  invoice's status (sent, partially paid, paid) is worked out from its
  payments rather than a single paid flag, and Collected everywhere is now
  the sum of what actually came in. Added a Statement PDF for a contact or
  company, listing every invoice and payment for a period.
- Added Schedule: your week or day, gathering booked visits, jobs' expected
  start dates, reminders, and invoice and bill due dates from the records
  you already keep. A visit is a task with a time, a place, and a length,
  and any one of them can be added to your own calendar as a standard .ics
  file.
- Added automations: three switches in Settings, of which two arrive
  already on — a call reminder an hour after a website lead arrives, and a
  follow-up three days after a quote is sent. The third, a nudge on an
  overdue invoice, waits until you switch it on. Any pipeline stage can
  carry a follow-up of its own as well. Each one just creates an ordinary
  task, so it shows up and behaves like anything you'd have typed yourself,
  and the customer's own history names the rule that wrote it and where to
  switch it off. Importing a spreadsheet sets none of them off.
- Added a leads-by-source report: how many leads each source sent, how many
  you won, what they were worth, and how long they took to close.
- Added bulk actions: select a run of rows on Contacts or the deals list
  and tag, retag a company, move stage, or trash them together, in one step
  and one undo.

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
- Payment processing (Helix records the payments you tell it about; it
  never moves money itself)
- Gmail and Google Calendar integration
- A map view
- Signed and notarized installers, and auto-update (which depends on
  signing)
- Telemetry or crash reporting of any kind
- Any AI action that runs without the owner pressing a button
- The gone-quiet rule for contacts that have no deal

Corrected since first publishing this list (SEC audit, launch round
2026-09-20): quotes and invoices, recurring service reminders, importing
deals from a CSV, encrypted workspaces, and templates with merge fields were
all listed above as absent from v1. All five shipped in 0.1.0 and are
documented in the README's "What it does" list ("Services, quotes and
invoices", "Reminders", "CSV import", "Templates") and in
"Where your data lives" (encryption). This list exists so a client can rely
on what it says is NOT there, so a stale entry here was not a small mistake.
