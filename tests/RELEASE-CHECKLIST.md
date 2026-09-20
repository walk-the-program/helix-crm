# Release checklist: the real app, by hand

`tests/unit`, `tests/repo`, and `tests/e2e-mac` run against a mocked
database and a mocked Tauri layer. `tests/e2e-win` runs the real app, but
only in CI, on a fresh Windows VM, and only covers a smoke test today. None
of them prove the actual, unsigned build behaves correctly on a machine that
has never run Helix before, with a real keychain, a real filesystem, and a
real window.

This checklist covers exactly what those suites can't. Run it on both
macOS and Windows before tagging a release. Each line names what you're
checking and what should happen. If it doesn't, don't ship.

A real launch on this Mac has already confirmed the backend half of the
first few items (workspace created, migrations applied, seed data present,
backups written) — see `docs/ORCHESTRATION.md`. Screen recording permission
was not available for that run, so nothing about the actual window has been
looked at yet. Check every box below regardless; a passing backend doesn't
mean the window drew correctly.

This file is what you verify by hand *before* tagging a release. For what
to do when something goes wrong *after* a release is out — a broken build,
a partial migration, a bad import, a denied keychain prompt, and the rest —
see `docs/OPERATIONS.md`. The two do not repeat each other: this file never
says what to do about a failure, and `docs/OPERATIONS.md` never re-states
these by-hand checks.

## Before you tag

- [ ] `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
      all report the same version number. Tauri's build reads its own
      `tauri.conf.json`; a mismatch here means the installer's version and
      what Diagnostics' "This copy of Helix" row reports can disagree with
      each other and with what `CHANGELOG.md` says shipped.
- [ ] `CHANGELOG.md`'s Unreleased section has been turned into the new
      version's heading.
- [ ] `main` is green at the commit you are about to tag: `js`, `rust`, and
      `rust-audit` all passing in GitHub Actions.

Tagging, pushing, publishing the resulting draft release, and telling
clients it exists are process steps, not hand-verification — see
`docs/OPERATIONS.md`'s founder-task inventory, "Cut and ship a release, end
to end."

## Setup

- [ ] Build the real app (`npm run tauri dev` for a dev check, or a built
      release artifact for the final pass) on a machine, or a user account,
      that has never run Helix before, so first-run really is first-run.

## First launch

- [ ] **macOS: double-clicking the app is refused.** Right-click the app
      and choose Open; confirm the dialog, and the app launches.
- [ ] **Windows: SmartScreen warns.** Click "More info," then "Run
      anyway"; the app launches.
- [ ] On first launch, a workspace is created automatically and the app
      opens straight into the three-screen setup flow (no login): business
      name and trade, then the trade's pipeline/sources/fields, then how
      customers come in (import a spreadsheet, connect a website, load a
      week of example data, or start empty). "Skip for now" is on every
      screen and never traps you - it lands on Today the same as finishing
      screen 3 does. This replaces an earlier, incorrect version of this
      line that said first launch shows an empty Today screen with no
      wizard (F-REV-13); the wizard is what first launch actually shows,
      and always has (`src/features/onboarding/gate.ts`,
      `OnboardingFlow.tsx`, README "First run").
- [ ] **Verify with the lead before release:** whichever way setup ends
      (a choice on screen 3, or Skip), Today's first content is the
      recovery-key card - one primary block, un-dismissable - until you
      reveal the key and confirm you copied, saved or printed it. Only
      after that does Today show its regular sections, with the three
      ways to start (import a CSV, add a contact, connect a website) as
      README describes them. This line depends on LR-CS-W1's work
      (`src/features/today/sections/RecoveryKeyCard.tsx`), landed in this
      checkout but not yet confirmed accepted at the time this checklist
      was written.
- [ ] `helix.json` exists in the app data folder (macOS:
      `~/Library/Application Support/com.clearpathdigital.helix/`; Windows:
      `%APPDATA%\com.clearpathdigital.helix\`) and lists the new workspace.
- [ ] The workspace's `helix.db` file exists under `workspaces/<uuid>/` in
      that same folder.

## Keychain and secrets

- [ ] Entering a site token or an Anthropic key triggers an OS Keychain (or
      Windows Credential Manager) access prompt, since the build is
      unsigned. Allow it.
- [ ] Quit the app fully and relaunch it. The stored token or key still
      works (the site connection still tests successfully, or the AI
      module still runs) without being re-entered, confirming the secret
      actually round-tripped through the keychain rather than only living
      in memory for that session.
- [ ] On macOS, rebuilding the app (a new dev build) reprompts for
      Keychain access on next use, this is expected for an unsigned build
      and is documented in `CONTRIBUTING.md`, not a bug to fix.

## Site connection and lead poll

- [ ] Start `tools/fake-site` locally (`npm run fake-site -- --seed 5`).
- [ ] In Settings → Site connection, enter `http://127.0.0.1:4711` and the
      fake site's token (`dev-token` by default). Click **Test
      connection**, it succeeds.
- [ ] Wait for a real poll (the five-minute interval, or trigger it from
      the site connection screen) and confirm the seeded leads appear as
      contacts and deals in the first pipeline stage, each with the
      original message on its timeline.
- [ ] Post a new lead to the fake site
      (`curl -X POST http://127.0.0.1:4711/api/leads -d '...'`, see
      `tools/fake-site/README.md`) and confirm the next poll picks it up.
- [ ] Enter a wrong token and confirm the banner says to check it, rather
      than failing silently.

## Backup and restore

- [ ] Trigger a backup (Settings/Backups → "Back up now," or wait for the
      automatic one after first launch) and confirm a new `.db` file
      appears on disk under the workspace's `backups/` folder.
- [ ] Make a visible change (add a contact), then restore an older backup.
      The confirmation dialog names both the backup's date and today's
      date. After restoring, the change you made is gone and the earlier
      state is back, confirming the database file itself was actually
      replaced, not just the in-memory view.

## Workspace switch

- [ ] Create a second workspace from the sidebar. Add a contact to it.
- [ ] Switch back to the first workspace and confirm the second
      workspace's contact is not visible there, and vice versa.
- [ ] Confirm only the open workspace polls for leads, check the other
      workspace's `last_polled_at` does not advance while it's not open.

## Attachments

- [ ] Add a file to a contact, company, or deal. Confirm it appears in
      that workspace's `attachments/` folder on disk under a generated
      name, not the original filename.
- [ ] Add an image and confirm a thumbnail renders in the app rather than
      a generic file icon.
- [ ] Try a file over 50 MB and confirm it's refused with a clear message.

## Export

- [ ] Export a list, and separately export everything. Confirm the OS save
      dialog appears, and the resulting file (CSV, or the zip plus JSON)
      actually exists on disk afterward and opens correctly.

## Opener actions

- [ ] Tap a phone number and confirm the OS's phone/FaceTime/dialer
      handling opens.
- [ ] Tap an email address and confirm the default mail app opens a new
      message addressed correctly.
- [ ] Tap an address and confirm it opens in the default maps app or
      browser.

## Appearance

- [ ] Switch between light and dark mode from the topbar and confirm every
      screen redraws correctly, with no leftover light-mode elements (for
      example, toasts).
- [ ] Switch between comfortable and compact density and confirm layouts
      hold up, especially tables and the pipeline board.

## Window behavior

- [ ] Try to resize the window smaller than 1024×700. Confirm it stops
      there rather than shrinking further.
- [ ] Quit the app completely (not just close the window) and relaunch it.
      Confirm your workspace, its data, your theme, and your density
      setting are all exactly as you left them.
