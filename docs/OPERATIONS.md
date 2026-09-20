# Operations

What to do when something goes wrong with a running Helix install, and the
operational work that keeps Helix running at all. This is the manual for the
worst moment, not a design document: lead with the symptom, then the fix.

This is not `tests/RELEASE-CHECKLIST.md`. That file is what you verify by
hand on a real machine before you tag a release. This file is what you do
after a release is out and something breaks, plus the recurring jobs nobody
but Walker does today. Where the two would otherwise say the same thing, this
file points at the checklist instead of repeating it.

Each procedure below is marked exactly one of:

- **tested** — exercised here, with the command and its real result
- **inspected only** — read the code and traced the behavior, not executed
- **needs access** — needs Walker's machine, a real release, or a real client
  site; written from the code so it is ready to verify

Helix has no accounts, no server, and no second user (`docs/rounds/2026-09-20-launch-readiness-record.md`,
decision LR-2; `docs/rounds/launch-returns/sec.md` §0). Every procedure below
is scoped to one owner, one machine, one workspace file.

---

## 1. A release build fails, or ships broken

**Symptom.** After installing a new version, Helix will not open, crashes on
a normal action, or does something wrong badly enough that the client needs
the previous version back.

**What the owner sees.** A crash, a blank window, or a `BootScreens.tsx`
full-screen error. If the reinstalled build is *older* than the one that last
touched this workspace, the owner instead sees "This workspace needs a newer
Helix" (see below) — that is not a bug, it is the safety refusal working.

**What the owner does.**

1. Quit Helix completely.
2. Get the previous version's installer from the repository's GitHub
   Releases page (Walker tells them which asset).
3. macOS: right-click the app, choose Open, confirm the Gatekeeper dialog
   (unsigned build — `tests/RELEASE-CHECKLIST.md`, "First launch"). Windows:
   click SmartScreen's "More info," then "Run anyway."
4. Reinstall over the existing app. This replaces only the app bundle; the
   workspace files under Application Support (macOS) / AppData (Windows) are
   untouched.
5. Relaunch. Helix reopens the workspace it had open before.

**What Walker does.** Confirm which installer actually matches this client's
workspace schema before handing over a link — installing something *older*
than what already touched the file trips the refusal below, not a working
rollback. Reproduce the break, fix it, cut a new tagged release (see the
founder-task inventory, "Cut and ship a release").

**What happens to a database the newer version already migrated — the
refusal.** `src/db/migrator.ts`'s `migrate()` reads `schema_migrations`
before doing anything else. If it finds a version tag its own migration
journal does not know, it throws `NewerSchemaError` — before the
pre-migration backup, before either `PRAGMA foreign_keys` statement, before
any table is touched (`migrate()`, the `unknownVersions` check, comment: "an
older build must never touch a newer workspace"). `src/app/BootScreens.tsx`'s
`NewerSchemaErrorScreen` (wired through `BootFailure`) renders the title
"This workspace needs a newer Helix" with the exact sentence from
`newerSchemaMessage()`:

> This workspace was made by a newer version of Helix than the one running
> here. Install the latest version of Helix, then open this workspace again.
> Your data has not been changed.

Note what this means for "rollback": if the broken release included a
migration that already ran before the bug was noticed, reinstalling the
*previous* version does not work — it hits this refusal, because the file is
now one schema version ahead of that build. The only ways forward are (a)
ship a *newer*, fixed build and let it open the file as-is, or (b) restore
the `pre-migration` backup Helix took automatically right before that
migration ran (procedure 2), then install a true previous version against
that restored file. If the broken release shipped no new migration, the
previous installer opens the file with no refusal and no data question at
all.

**What recovers the data.** Nothing needs recovering in the refusal case —
it is designed to touch nothing, so the workspace sits exactly as it was
until the right build opens it. If the previous release actually needs
restoring to a pre-migration state, see procedure 2 and procedure 7.

**Mark: needs access**, for the reinstall-a-real-installer action itself,
which needs a real release asset and a real machine. The refusal mechanism
it depends on is tested: `npx vitest run tests/repo/migrations.test.ts` at
`44d72d8` — 12 passed, including "migrate() now refuses, before touching
anything, with the exact message" and "does not offer to downgrade, delete
or repair: the message only names the version problem."

**Note to the lead.** The packet described this refusal as still being
built by W1. Reading `src/db/migrator.ts` and `src/app/BootScreens.tsx` at
this revision, it is already implemented and already covered by
`tests/repo/migrations.test.ts` (`describe("older build vs. a newer
workspace (LR-OPS-W1 A1)")`). No placeholder needed — this procedure is
written against the real message and the real screen. If the wording changes
before launch, this section needs a one-line update, not a rewrite.

---

## 2. A migration partially completes

**Symptom.** After an update, Helix shows "This update could not finish."

**Mechanism.** `migrate()` takes a `pre-migration` backup once, before the
first pending migration file runs. Each pending file then runs as **one**
`raw.batch()` — the `INSERT INTO schema_migrations` row for that file is
the last statement in the same batch — so a file either commits completely
or rolls back completely. There is no state where one migration file is half
applied. If file *N* fails, files before it are already committed (that is
forward progress, not corruption) and file *N*'s statements are rolled back
as a unit. `PRAGMA foreign_keys` is restored to `ON` in a `finally` no matter
what happens.

**What the owner sees** (`MigrationErrorScreen` in `src/app/BootScreens.tsx`):

> This update could not finish. Nothing was changed: the update was rolled
> back. Your data was backed up first, and that backup is untouched. Install
> the previous version to keep working, and send us the detail below.

The pre-migration backup's path is shown on screen, and the raw error is one
click away behind "Details," with a "Copy the details" button.

**What the owner does.**

1. Note the backup path shown on screen (also findable at
   `<workspace>/backups/*-pre-migration.db` via Settings > Diagnostics >
   Reveal data folder).
2. Reinstall the previous Helix version (procedure 1) to keep working now.
3. Copy the details from the error screen and send them to Walker.

**What Walker does.** Reproduce against the named migration tag, fix the SQL,
ship a corrected release. If the client's workspace is stuck between
versions (some migration files applied, one failed), the safest path is to
restore the `pre-migration` backup from Settings > Backups so the file is
back to its state immediately before the update started, then wait for the
fixed release — do not try to hand-edit `schema_migrations`.

**What recovers the data.** The `pre-migration` backup, or simply reinstalling
the previous version: a failed batch never touched the live file in the
first place, SQLite rolled it back inside the same transaction.

**Mark: tested.** `npx vitest run tests/repo/migrations.test.ts` at `44d72d8`
— 12 passed, including `describe("partial-failure atomicity (LR-OPS-W1 A2)")`:
"a single migration whose LAST statement fails leaves no partial DDL and no
schema_migrations row" and "migration N commits and migration N+1 fails: N
stays applied, N+1 does not, and the error names N+1," plus
`describe("foreign_keys is restored after a throwing migration")`.

---

## 3. The client's website is down, or the token was rotated

**What the owner sees.** Two places, by design (`src/features/leads/components/PollNotice.tsx`'s
own header comment explains the split — the quiet line is what most owners
actually see, the full explanation lives where the fix is):

- **Today** (`PollNotice`, one quiet sentence with a link, no color, no icon):
  - Auth failure: "New leads are not coming in: your website turned the
    connection down." — linking "Check the website connection" to
    Settings > Website (`/settings/site`).
  - Network failure: "New leads are not coming in: Helix cannot reach your
    website." — same link.
- **Settings > Website** (`SiteConnectionScreen`, full banner via
  `PollBanner`):
  - Auth: "Your website turned the connection down. Check the token." /
    "New leads are not coming in until the token is right. Paste a fresh one
    below and save."
  - Network: "Helix cannot reach your website." / "Nothing has come through
    for `{N}` tries. Helix keeps trying on its own."
  - Clicking **Test connection** with a stale token shows:
    "Your website turned the token down. Check that you copied all of it."
    (`describeFetchError`, `SiteConnectionScreen.tsx`).

**The timing rules** (`src/features/leads/lib/backoff.ts`): a healthy
connection polls every 5 minutes. A network failure backs off 1, 2, 4, 8
minutes, then holds at 8 minutes forever until a poll succeeds
(`BACKOFF_MINUTES`). The banner stays silent for the first two consecutive
network failures (`FAILURES_BEFORE_BANNER = 3`) so one blip does not alarm
the owner. A 401 or 403 (`isAuthStatus`) is treated differently: the poll
timer **stops outright** rather than backing off — nothing tries again until
the owner saves a corrected token.

**What the owner does.** Settings > Website (`/settings/site`): paste the
new token into the Token field — leaving it blank keeps the token already
stored — click **Test connection**, then save.

**What Walker does.** If it is a rotation: reissue the token on the
ClearPath site side, confirm it works with a manual `Test connection` before
handing it to the client. If it is a site outage: nothing to do in Helix —
network failures keep retrying on their own and resume the moment the site
answers; only a 401/403 needs the manual fix above.

**What recovers the data.** Nothing is lost. The site is the source of
truth; Helix's poll uses a server-side cursor (`next_cursor`), not a time
window, so leads that arrived while disconnected are still on the site and
land on the next successful poll.

**Mark: tested**, for the state machine and the exact thresholds:
`npx vitest run tests/unit/leads/backoff.test.ts` at `44d72d8` — 12 passed.
The banner strings above are read directly from `PollBanner.tsx` and
`PollNotice.tsx`, not paraphrased. Seeing the banner actually appear in a
running window against a real or a `tools/fake-site` outage was not driven
in this session.

---

## 4. Anthropic is down, or the key is revoked

**What the owner sees.** The named error classes in `src/features/ai/errors.ts`,
surfaced through `aiErrorMessage()`:

- No key saved: "No Anthropic key is saved for this workspace."
- Key revoked/wrong (401): "Anthropic rejected that key. `{Anthropic's own
  detail}`" (`AiKeyRejected`).
- Rate limited (429): "Anthropic is rate limiting this key. Wait a moment
  and try again."
- Anthropic down (5xx): "Anthropic had a problem answering. Try again."
- No network at all: "Could not reach Anthropic. Check the connection and
  try again."
- A malformed answer: "The answer was not in the shape we asked for," with
  the raw model text kept on the error so nothing the owner pasted is lost
  (`AiParseError`).

Where it shows up depends on whether AI is on at all
(`src/features/ai/components/AiGate.tsx`): if the module is off, there is no
button anywhere to fail — the one honest sentence lives on Settings > AI
(`/settings/ai`). If the module is on and the key is missing or rejected,
every AI button across contacts, companies and deals stays visible but
disabled, with the reason in its tooltip and in `aria-describedby`
(`AiActionButton`, `useAi().disabledReason`) rather than repeated as body
text on every record.

**What the owner does.** Settings > AI (`/settings/ai`): click **Test key**.
A rejected or missing key shows the sentence above inline
(`AiSettingsScreen.tsx`, `keyError` / `testResult`). Paste a corrected key,
or wait out a 429/5xx and try again — both are explicitly retryable
(`AiRequestError.retryable`).

**What Walker does.** Nothing on Helix's side for an Anthropic outage — it
is Anthropic's status, not Helix's. For a revoked key, tell the client to
generate a new one from their own Anthropic console and paste it in; Helix
never has a copy of a key to hand back (read fresh from the keychain per
call, never cached — `sec.md` §1, "AI key handling").

**What recovers the data.** Nothing to recover. No AI response is ever
stored as a side effect of failing; the record it would have filled in is
simply not filled in yet.

**Mark: tested.** `npx vitest run tests/unit/ai/provider.test.ts` at
`44d72d8` — 14 passed, including "401 is AiKeyRejected and carries the API's
own message," "429 retries once, then reports AiRequestError as retryable,"
"a 500 that clears on the retry succeeds," "a dropped connection is
AiRequestError after the retry," and "malformed JSON is AiParseError and
keeps the raw text."

---

## 5. The lead poller applies a lead twice

**Symptom.** A concern to check, not something clients are expected to
report: could the same website lead ever become two deals?

**Mechanism** (`src/features/leads/lib/applyLeads.ts`). Every lead gets an
`external_id` of `<site origin>:<lead id>`. Before creating anything,
`applyLeadPage` checks `deals.findByExternalId(mapped.externalId)`; a match
means this is a re-poll of a lead already on file — the existing deal is
left alone (the owner may have edited it), and only a genuine site-side edit
writes one system activity noting what changed. A second guard,
`claimedThisPage`, catches the case `findByExternalId` cannot: two leads
sharing one id inside the *same* page, before either is committed. The whole
page applies inside one `withTransaction`, so a failure partway through
leaves nothing behind and the cursor never advances past work that did not
commit.

**This landed mid-phase, too.** `sec.md` F-SEC-28 flagged `deals.external_id`
as an ordinary index with no `UNIQUE` constraint — safe only because the
app's single write lock serializes every writer. Commits `3adc34c` and
`658c066` closed that while this task was being written: `drizzle/0005_lead_dedup.sql`
adds a partial `UNIQUE` index (`external_id IS NOT NULL AND deleted_at IS
NULL`), soft-deleting every duplicate but the oldest live deal per
`external_id` first so an existing workspace with a violation still
migrates. `applyLeadPage` now batches each lead's own statements (contact +
deal + activity) as its own unit inside the page's transaction; if the
combined batch trips the constraint, each unit retries in its own nested
savepoint, and a unit that conflicts is reclassified exactly like an
ordinary re-poll — already applied, skipped, nothing left behind — instead
of failing the whole page. So the guard described above is now backed by an
actual database constraint, not only by the write lock.

**What the owner does.** Nothing — there is nothing to fix. If a deal looks
duplicated, it was created from two genuinely different `external_id`s (for
example the client re-submitted the website form with a different email),
not from the poller re-applying the same one. The Duplicates screen
(`src/features/data/duplicates/DuplicatesScreen.tsx`) is where that gets
merged, same as a duplicate from an import.

**What Walker does.** If a client reports a duplicate that really does share
one `external_id`, that is a bug report, not routine operation — get the
two deal ids and the site origin and escalate to engineering.

**What recovers the data.** Nothing to recover; merging two legitimately
separate deals uses the existing Duplicates / merge flow, which is reversible
inside its own 30-day window (`src/db/repos/merge.ts`, `MERGE_REVERSAL_DAYS`).

**Mark: tested.** `npx vitest run tests/repo/leads/applyLeads.test.ts
tests/repo/leads/pollerRace.test.ts` at this revision — 30 passed, including
"is idempotent: the same page applied twice creates nothing the second
time," "creates exactly one deal when two leads in the same page share a
real id," "still recognises a duplicate id already committed from an
earlier page," "writes nothing at all when the re-poll repeats exactly what
is on file," and (`pollerRace.test.ts`) the forced-stale-read tests proving
a `UNIQUE` violation on `external_id` is now reclassified as skipped rather
than failing the page.

---

## 6. A client imports bad data

**Symptom.** An owner imports a CSV with the wrong mapping, garbage rows, or
a file that should never have been imported, and wants it gone.

**Is there an import undo? No.** `src/app/undo.ts` reverses one
`change_log` batch through `undoBatch`/`redoBatch`, and the stack is emptied
on every `db_open` besides. `src/features/data/lib/importRun.ts` writes
**one** `change_log` row for the *whole* import (batch id = the import's own
id) holding only the summary counts (`created`, `updated`, `skipped`,
`companiesCreated`) — not a per-row before/after. The module comment says
why: "undo for an import is 'restore the backup,' not 'walk the log.'" So
Cmd+Z cannot undo an import; `undoBatch` has nothing per-record to reverse.

**Is there a way to bulk-select what one import created? No.** Contacts,
companies and deals created by an import carry no import-run id of their own
— only `change_log`'s one summary row knows the batch id, and nothing in
`src/db/repos/contacts.ts` or the contacts list/saved-view screens filters
by it. The only thing pointing at "these rows came from this file" is
whatever the owner put in the CSV's own Source column, if anything, or the
timestamp. This is a real gap — see below.

**Is a backup taken before an import runs? Yes, as of this phase.** This
also landed while this document was being written: commit `22befc4`, "take
the backup an import is undone with, before the import." Both importers now
call `backupBeforeImport()` (`src/features/data/lib/backupsFs.ts`) before
the write lock and before the transaction open — tagged `"pre-import"`,
mirroring `"pre-restore"`. If the backup itself cannot be taken, the import
**never starts**: `BackupWriteError`, "Helix could not back up your data
before the import, so the import was not started. Nothing has been
changed." This is the same rule `migrate()` already follows, for the same
reason. The result screen (`ResultStep.tsx`) shows the backup's path with
the sentence: "Helix saved a backup before this import. If the file was
wrong, restore it from Settings, then Backups." Before this commit, an
import that updated existing contacts on a dedupe match — the ordinary case
for re-importing a second export from the same vendor — could overwrite
real data with nothing behind it but whatever the last scheduled backup
happened to be, up to 6 hours stale.

**What the owner does, today, to recover from a bad import:**

1. Settings > Backups > find the `pre-import` backup (its path is also
   shown right on the import result screen the moment the import finished)
   and Restore it (procedure 7). This is now a reliable, freshly-taken
   restore point, not "whichever scheduled backup happens to exist" — but
   it is still "go back in time," not "remove exactly the imported rows":
   anything else the owner did after the import is lost too.
2. If something has changed since and a full restore would lose real work:
   filter/sort the contact list by whatever is distinctive about the bad
   batch (a shared source, a shared tag, a creation-time window) and delete
   those records individually or via multi-select. A deleted record goes to
   Trash for 30 days (`sec.md` data map) before it is purged for good, so a
   mis-click during cleanup is itself recoverable inside that window.
3. For records the dedupe policy merged into *existing* contacts (the "Fill
   in the blanks" policy only adds missing emails/phones/notes, never
   overwrites), there is nothing to undo per record — nothing already
   filled in was touched.

**What Walker does.** Point the owner at the `pre-import` backup named on
the result screen first — it is now the reliable answer, not a hopeful one.
Fall back to the manual filter-and-trash path only when real work happened
after the bad import that a full restore would also erase.

**Is there a way to bulk-select what one import created? Still no.**
Unaffected by the backup fix above: contacts, companies and deals created
by an import still carry no import-run id of their own — only
`change_log`'s one summary row knows the batch id, and nothing in
`src/db/repos/contacts.ts` or the contacts list/saved-view screens filters
by it. This is still a real, open gap — see Findings — but it now matters
less: with a reliable `pre-import` backup, "go back in time" is a solid
answer for most cases; a `UNIQUE`/indexed import-run id would still be
needed for a real "undo this import" that spares work done afterward.

**Mark: tested.** `npx vitest run tests/repo/data/importPreBackup.test.ts`
at this revision — 3 passed, covering the pre-import backup being taken,
its path reaching the result, and the import refusing to start when the
backup itself fails. `src/app/undo.ts` (no per-import undo, unaffected by
this fix) and `ResultStep.tsx` (the new backup-path line) read directly to
confirm the rest of this procedure.

---

## 7. Restore a database from a backup

**What the owner sees and does** (`BackupsScreen.tsx`, Settings > Backups,
`/settings/backups`): each backup is listed newest-first with its date and
size; clicking **Restore** on a row opens a confirmation dialog titled
"Restore this backup?" naming both the backup's date and today's date, with
a destructive **Restore** button.

**Mechanism** (`restoreFromBackup`, `src/features/data/lib/backupsFs.ts`),
in exact order:

1. Pause the background timers (resumed in a `finally`, whatever happens).
2. Take a backup of *today's* file first, tagged `"pre-restore"` — so
   restoring an old backup never destroys the most recent state without a
   way back.
3. Close the database (checkpoints the WAL, drops `-wal`/`-shm`).
4. Copy the chosen backup file into place.
5. Reopen it and re-run the boot path, so migrations and the query cache
   re-run against the restored file.

If anything after step 3 throws, the database may be left closed; the
screen's own failure message says so rather than pretending it worked:
"Restore failed: `{message}`. Please restart Helix."

**Retention, so the owner knows what is actually available to restore**
(`src/features/data/lib/retention.ts`, `planRetention`): every backup from
the last 24 hours is kept; from 24 hours to 30 days, the newest backup of
each calendar day is kept and the rest dropped; the single newest backup on
disk is always kept regardless of age (a workspace closed for a month still
has one restore point). Automatic backups run on launch and roughly every 6
hours the app stays open (`BACKUP_INTERVAL_MS`); "Back up now" runs one on
demand.

**What Walker does.** Confirm with the owner which backup date they actually
want before they click Restore — the dialog names both dates, but the owner
is the one under time pressure. After a restore, confirm the change that
prompted it is really gone and the expected state is back, per
`tests/RELEASE-CHECKLIST.md`'s "Backup and restore" section.

**What recovers the data if the restore itself goes wrong.** The
`pre-restore` backup taken in step 2, from Settings > Backups, the same way.

**Mark: tested**, for everything except clicking Restore in a real running
app and watching the window, which still **needs access**.

What is proven, at this revision:

- `cargo test --test recovery_tests` (9 passed) covers the file-level
  assumption the whole design rests on -
  `restore_over_the_live_file_brings_the_old_rows_back`: back up, change
  something, copy the backup over the live file, reopen, and the change made
  after the backup is gone while the earlier rows are back. It also asserts
  the restored file is still encrypted.
- `npx vitest run tests/unit/data/restorePruneGuard.test.ts` (6 passed)
  covers the JS orchestration the packet found untested: that the five steps
  happen in that order (`backup:pre-restore`, `close`, `copy`, `open`, as an
  exact sequence), that a failed copy is rethrown rather than reported as a
  restore that worked, and that a scheduled prune cannot delete the file the
  restore is copying from.

What that last one is about: `pauseTimers()` only stops a NEW scheduler tick
from starting. A tick that passed its own check a moment earlier runs to the
end, and the end is `pruneBackups()`. If the backup the owner picked is the
oldest one past the retention window - which is exactly the one somebody
reaches for after a bad week - it could be deleted mid-copy. A restore now
switches pruning off for its duration (LR-OPS-W2's B4 finding, fixed in
`7e637ac`).

What still needs access: the real window. Nobody has clicked Restore in a
built app and watched it close, copy, reopen and repaint. That is
`tests/RELEASE-CHECKLIST.md`'s "Backup and restore" section, and it stays
Walker's to do on a real launch.

---

## 8. The laptop dies

**This landed mid-phase.** The packet described this as the lead's
in-flight work with a placeholder to fill in later. Commits `a5ac006` and
`a773ff3` shipped it while this task was being written — recovery key and
second-copy folder, both in Settings > Backups. What follows is the real
mechanism, not a placeholder.

**The two pieces, both in Settings > Backups (`/settings/backups`):**

1. **Recovery key** (`RecoveryKeyPanel`, `src/features/data/backups/BackupsScreen.tsx`).
   Nothing is shown until the owner clicks **Show recovery key**
   (`revealRecoveryKey()`, backed by Rust's `recovery_key_reveal` and
   `DbKey::expose_for_recovery` — the one place in the codebase this key is
   deliberately handed out in the clear). The screen's own words: "Your
   backups are encrypted with a key that is kept on this computer and
   nowhere else. If this computer is lost, stolen or replaced, that key is
   what lets you open a backup on the new one. Write it down now, while you
   still can." Once revealed, **Save to a file** writes a plain-text file
   (`recovery_key_file_contents`, `src-tauri/src/recovery.rs`) headed
   "Helix CRM recovery key," naming the workspace, formatted as
   `HLX1-XXXX-XXXX-...` (grouped in 4s so it can be read back off paper), with
   its own instructions ("Keep it somewhere that is not this computer: a
   password manager, a printed copy in a drawer, a note in a safe") and its
   own warning ("Anyone who has both this key and a copy of one of your
   backup files can read everything in your CRM. Do not email it to
   yourself and do not store it in the same place as your backups.").
2. **A second copy** (`BackupCopyFolderPanel`, same screen). The owner
   points Helix at a folder — an external drive, or a folder Dropbox,
   iCloud Drive or OneDrive already syncs — and Helix copies each new
   backup there right after it is written. Screen's own words: "Nothing is
   uploaded by Helix, and the copies are encrypted the same way, so you
   will need your recovery key to open one elsewhere." This is local
   copying to a path the owner chose, not a network call Helix makes on its
   own — whatever gets it further offsite (Dropbox syncing that folder) is
   the owner's existing service doing its own job.

**Getting a dead laptop's data onto a new machine, end to end:**

1. Before the laptop dies: the owner has clicked Show recovery key and
   saved it somewhere that is not that laptop, and ideally has a second-copy
   folder configured that already synced backups offsite.
2. Install Helix on the replacement machine.
3. Settings > Backups > **Open a backup from another machine**
   (`OpenFromAnotherMachinePanel`): choose the backup `.db` file (from the
   second-copy folder, a cloud sync, or any copy the owner has), paste the
   recovery key, name the workspace, and Helix adds it as a new workspace —
   "Helix adds it as a second workspace and leaves everything here as it
   is."
4. Rust's `adopt_backup` (`src-tauri/src/recovery.rs`) does the actual work,
   in order, refusing and leaving nothing behind at any wrong step: (a)
   prove the typed key actually opens that file, (b) prove the opened file
   looks like a real Helix database, not some other SQLite file, (c) create
   a new workspace folder, (d) copy the file in as `helix.db`, (e) write the
   key into *this* machine's keychain under the new workspace id — refusing
   outright if that id somehow already has a key, since overwriting one is
   "the worst thing this module can do" — (f) prove the copy now opens
   through that keychain entry. If step (f) or anything after (c) fails,
   both the new folder and the new keychain entry are removed again, so a
   failed recovery attempt leaves no half-adopted workspace behind.

**What Walker does.** Point the client at Settings > Backups before
anything goes wrong — this is a "the owner has to have already done it"
mitigation, same as any backup. If a laptop has already died with no
recovery key saved and no second copy configured, say so plainly: without
the key, an existing backup file recovered by any other means (a cloud
sync's own history, a drive image) is unreadable ciphertext, because the
only other copy of that key lived in that machine's keychain.

**What recovers the data.** The recovery key plus any one backup file —
`adopt_backup` needs both and nothing else; it does not need the original
machine, its keychain, or Helix to have been open recently.

**Mark: tested.** `cargo test --test recovery_tests` at this revision — 9
passed, including `a_backup_opens_on_a_machine_that_has_never_seen_it`
(the exact new-machine scenario above, at the Rust level), `a_wrong_key_writes_nothing`,
`a_missing_file_is_refused`, `a_database_that_is_not_helix_is_refused`, and
`two_adoptions_of_one_backup_do_not_collide`. `npx vitest run
tests/unit/data/recoveryKey.test.tsx` — 10 passed, covering the panel UI
described above.

---

## 9. The keychain prompt was denied

**This improved mid-phase.** Commit `a5ac006` (the same recovery-key change
that landed procedure 8) added `is_access_refusal`/`access_refused` to
`src-tauri/src/secrets.rs`, specifically to tell a denied prompt apart from
a broken keychain. What follows is that current behavior, not the packet's
premise.

**What actually happens when a keychain read or write fails**
(`src-tauri/src/secrets.rs`):

- A **denied prompt**, sniffed by `is_access_refusal` from
  `keyring::Error::NoStorageAccess` or from the OS's own wording (`"denied"`,
  `"canceled"`, `"not authorized"`, `"user interaction"`, or the raw Security
  framework codes `-128`/`-25293`) — the comment names this as macOS in
  practice, since Windows Credential Manager has no prompt to deny — now
  gets its own message, `access_refused()`, from both `raw_get` and
  `raw_set`:

  > This machine's keychain turned Helix down, so Helix cannot reach this
  > workspace's key. Quit Helix, open it again, and choose Always Allow when
  > the keychain asks. Nothing on disk has been changed. (`{OS detail}`)

- Any **other** keychain fault (not a denial — the item is missing, the
  service is unreachable, disk trouble) still gets the older, plainer
  messages: "Can't read from the keychain: `{e}`" / "Can't save the key
  securely on this machine: `{e}`" / "Can't reach the keychain for `{user}`:
  `{e}`".
- A bundle that exists but will not **parse** (data corruption, a different
  failure from either of the above) is refused outright with the one
  message this module treats as load-bearing — unchanged by this phase:

  > This workspace's saved keys are on this machine but Helix could not read
  > them. Helix will not replace them, because writing a new database key
  > over the old one would make this workspace's file unreadable for good.
  > Restore the keychain entry "helix" for this workspace from a Time
  > Machine or keychain backup, or open a different workspace.

**This closed completely while this document was being written.** Commit
`d084392` — landing after the paragraph above was drafted around
`access_refused()` alone — gave `SECRET_ERROR` its own class end to end.
`src/db/client.ts` now has `SecretStoreError extends DbError`; `src/app/boot.ts`
re-throws it before the generic `if (err instanceof DbError) throw new
DbOpenError(...)` catch-all can fold it into a file-open failure; and
`src/app/BootScreens.tsx`'s new `SecretStoreErrorScreen` gives it its own
title, **"Helix needs permission to use this computer's keychain,"** with
the body:

> This machine's keychain turned Helix down, so Helix cannot reach this
> workspace's key. Quit Helix, open it again, and choose Always Allow when
> the keychain asks. Nothing on disk has been changed. (`{OS detail}`)
>
> Your workspace is encrypted, and the key that opens it is kept in the
> keychain. Helix cannot read your data without it, and nothing on disk has
> been changed.

with a **Try again** button (the right move here — the prompt reappears)
and **Show the workspace folder**. The old, wrong headline — "Helix can't
open your data... Another copy of Helix may have it, or the folder may not
be writable" — no longer shows for this cause at all. The commit's own
message names exactly why: on an unsigned macOS build the Keychain prompt
reappears after every rebuild, so a denied prompt "is the single most
likely way an owner ever sees a boot failure at all," and the old screen
sent him looking for a second copy of Helix that does not exist.

**What the owner sees and does.** The screen above, headed with the word
"keychain." Quit and reopen Helix; on the next prompt, click **Always
Allow** rather than Deny or Allow Once. An unsigned build re-prompts on
every rebuild regardless (`tests/RELEASE-CHECKLIST.md`, "Keychain and
secrets"), but a normal relaunch of the same build should only ask once per
item — then **Try again** on the screen itself.

**What Walker does.** If the denial repeats after a clean relaunch with
Always Allow chosen, this stops being "the owner clicked the wrong button"
and becomes a real keychain problem — check whether the keychain entry
itself needs restoring (procedure 8's "getting a dead laptop's data onto a
new machine" covers the adjacent case of no entry at all), or escalate.

**What recovers the data.** Nothing was written, so nothing needs
recovering — `db_key`'s critical section (`KEY_CREATE`, a shared `Mutex` as
of this phase) means a failed read never mints and writes a replacement key
over a real one, and both the new screen and the Rust message say plainly
that nothing on disk has changed.

**Mark: tested.** `npx vitest run tests/unit/app/bootFailure.test.ts` at
this revision — 9 passed, including "sends a refused keychain to its own
screen, not to the file-locked one," which asserts the heading contains
"keychain," the body contains "choose Always Allow," and the two wrong
causes ("Another copy of Helix," "may not be writable") are both absent.
`is_access_refusal`/`access_refused` themselves (the Rust functions that
decide denial-vs-fault) remain untested directly — both are private,
triggered only by a real OS response, and `cargo test` runs against the
in-memory secret store — but the JS-visible behavior this procedure
actually describes is exercised end to end.

---

## 10. helix.log is needed by support

**What to ask the client for.** Have them open **Settings > Diagnostics**
(`/settings/diagnostics`) and click **Copy log** — this reads the whole log
file and puts its text on the clipboard, so they can paste it straight into
an email with no need to find the file themselves. If more is needed (a
specific backup file, an attachment, the raw `helix.db`), **Reveal data
folder** on the same screen opens the workspace folder in Finder/Explorer.

**Where it lives.**

- macOS: `~/Library/Application Support/com.clearpathdigital.helix/logs/helix.log`
- Windows: `%APPDATA%\com.clearpathdigital.helix\logs\helix.log`

(`src-tauri/src/lib.rs`: `app_data_dir().join("logs")`, file name `helix`.)

**What it does and does not contain.** Rotation keeps 7 files
(`RotationStrategy::KeepSome(7)`) capped at 4 MB each (`MAX_LOG_BYTES`), with
anything older swept on launch (`sweep_old_logs`). Per Diagnostics' own
footnote and `sec.md`'s data map: it records when Helix started, backed up,
checked the connected website, or hit an error, plus the connected website's
address (its origin, not a customer's data). As of F-SEC-6 it does **not**
contain the site's bearer token or the site's raw response body on an
authentication failure — both used to leak into this file and into
`lead_sync.last_error` before that fix; a non-auth failure still keeps a
200-character, token-redacted snippet of the site's reply in
`lead_sync.last_error` (visible in Settings > Website), but not in the log
file itself. It never contains a customer's name, phone number, email, or
message. Verified: `npx vitest run tests/unit/leads/pollerLogRedaction.test.ts`
at `44d72d8` — 3 passed, asserting the token-bearing text lands in the
database field but is explicitly absent from the log.

**How to read it.** It is plain text (`tauri-plugin-log`'s default line
format: timestamp, level, target, message), one line per event — no special
tool needed, `cat`, a text editor, or pasting into an email all work as-is.

**The Diagnostics screen** (`src/features/settings/components/DiagnosticsScreen.tsx`,
`/settings/diagnostics`) shows, read-only, in five groups: this copy of
Helix (version, workspace name, write-queue state, whether the keychain is
reachable), the database (file path, size, SQLite version, FTS5 status,
applied migration, last backup time), encryption (whether the workspace file
itself is encrypted, and separately whether the OS's own full-disk
encryption — FileVault/BitLocker — is on, each answering "Unknown" rather
than a false negative when the build cannot tell), website leads (connected
site origin, last checked, last error), and files (app data path, log file
path with the "what it does and does not contain" sentence above printed
right on the screen). It has exactly two actions: Copy log and Reveal data
folder — everything else on the screen only reads.

**Mark: inspected only.** Read `DiagnosticsScreen.tsx`, `src/features/settings/lib/diagnostics.ts`,
and the log configuration in `src-tauri/src/lib.rs`; ran the redaction test
above for the log-content claim. Did not operate a live Diagnostics screen
or read a real `helix.log` off disk in this session.

---

# Commercial lifecycle

Helix is free and AGPL. There is no Helix price, plan, trial, subscription or
licence, and nothing in the app checks whether a client has paid for anything
(`docs/rounds/2026-09-20-launch-readiness-record.md` §1.1). What ClearPath
sells is the **website**. The only thing that connects a paying website client
to Helix is the `CRM_API_TOKEN` on their site, which they paste into
Settings > Website.

So the whole commercial lifecycle is the lifecycle of one string:

```
site sold -> site deployed with CRM_API_TOKEN -> token handed over
          -> client installs Helix and pastes it -> leads flow
          -> rotated / the site changes / the arrangement ends
          -> the client keeps Helix and every record in it; leads stop
```

Two consequences worth stating once, because both come up in support calls:

- **There is no entitlement to drift.** "Billing changed but access did not"
  cannot happen here, because access is not a thing the app has. Nothing is
  unlocked, nothing expires, and no ClearPath action reaches inside a client's
  Helix.
- **The reverse cannot lose data either.** Taking a client's website down,
  deleting the token, or rotating it stops new leads arriving and does nothing
  else. Everything already in Helix is in a SQLCipher file on the client's own
  machine, its key is in that machine's keychain, and neither Walker nor
  ClearPath has any path to either. This is proved rather than asserted:
  `tests/repo/leads/lifecycle.test.ts` counts the deals before and after a
  disconnect, after a site that has been unreachable twelve times running, and
  after the whole site is gone.

---

## What the owner sees in every state, and what Walker does

The owner-facing words all come from one module,
`src/features/leads/lib/pollMessages.ts`, so the banner on Settings > Website,
the quiet line on Today and the "Last result" row cannot disagree with each
other or with this table. Each one is asserted in
`tests/repo/leads/lifecycle.test.ts`.

| State | What the owner sees | What Helix does | What Walker does |
|---|---|---|---|
| **Connected** | "Everything came through." and a "Last checked" time | Polls every 5 min while open, plus once at start | Nothing |
| **Token rotated (401/403)** | "Your website turned the connection down. Check the token." / "New leads are not coming in until the token is right. Paste a fresh one below and save." | **Stops the timer outright.** Nothing retries until the settings change | CL-2 below |
| **No lead endpoint (404)** | "Your website is not set up to send leads yet." / "Helix reached the site, but there is no lead connection on it. Ask ClearPath to switch it on. Nothing is wrong with this computer." | Keeps retrying, so it heals by itself the moment the endpoint ships; banner at once, not after three tries | CL-3 case A |
| **Site cannot read the marker (400)** | "Your website could not read where Helix left off." / "Helix is starting again from your first lead. Nothing will be duplicated, and nothing you have edited will be overwritten." | Drops the cursor once and starts again from the first lead | Usually nothing; CL-3 case D if it repeats |
| **Site error (any other status)** | "Your website answered with an error (503)." / "New leads are not coming in. Helix keeps trying on its own. If it stays this way, tell ClearPath." | Backs off 1, 2, 4, 8 min; banner at once, because the site did answer | CL-3 case C |
| **Site unreachable (no answer)** | Silent for two tries, then "Helix cannot reach your website." / "Nothing has come through for N tries. Helix keeps trying on its own." | Backs off 1, 2, 4, 8 min and holds at 8 forever | Nothing; it resumes on its own |
| **Site gone for good** | The same, plus, from the twelfth failure: "If the site is gone for good, you can disconnect it below. Every lead already in Helix stays." | Same as above; it never gives up on its own and never deletes anything | CL-5 below |
| **Keychain refused the token** | "Helix could not read your website token from this computer." / "Your keychain turned Helix down. Paste the token below and save it again, and allow the keychain prompt when it appears." | Stops the timer | Procedure 9 above |
| **Disconnected** | "Not connected". Poll now and Test connection are both off | Timer off, token deleted from the keychain, address forgotten, **every record kept** | Nothing |

**Mark: tested.** `npx vitest run tests/repo/leads/lifecycle.test.ts` - 17
passed, one describe block per state above.
`npx vitest run tests/unit/leads/pollMessages.test.ts` - 13 passed, pinning
every string in the table. E2E, through the real screen:
`E2E_PORT=4280 E2E_OUT=dist-rev npx playwright test -c tests/e2e-mac/playwright.config.ts leads settings`
- 40 passed, including the 404 banner, the Disconnect click and the refused
placeholder token. Not exercised: a real ClearPath site over a real network.

---

## CL-1. Issue a token and hand it over

**When.** Once per client, on the day their site goes live, before install day.

1. Generate it on the site, never by hand: `openssl rand -base64 32`. That is
   44 characters and 256 bits, which is the value every template's
   `.env.example` documents and the only generator this process uses. Do not
   shorten it, do not reuse one client's token on another client's site, and do
   not use anything memorable.
2. Set it as `CRM_API_TOKEN` in that site's environment (Replit Secrets, or
   `.env` for a local run) and redeploy. Until it is set, `GET /api/crm/leads`
   answers 401 to everything, which is the template's deliberate default.
3. Confirm it yourself before it goes anywhere:
   `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <token>" https://<site>/api/crm/leads`
   must print `200`, and the same call with no header must print `401`.
4. Record the issue date in the roster (CL-6). **Never the value.**

**Handing it over.** In order of preference, and the reason the order is this
way: the token is a read key to that one site's lead list - eight fields per
lead, no admin access, no money, no access to Helix itself - so the risk is
bounded, but it is a real client's incoming enquiries.

- **Best: it never travels.** Paste it into Helix yourself on install day, in
  person or on a screen share, straight from the site's environment settings
  into Settings > Website. Then no copy of it exists outside the site and the
  client's keychain. This is the default and it costs nothing, because install
  day already has Walker in front of the machine.
- **If the client self-installs:** send it through whatever channel the client
  already uses for business (their phone's messages, a chat app), in a message
  that contains the token and nothing else - not the site address, not
  "this is your CRM token", not their business name. A message with only a
  random string in it is worth far less to anyone who finds it later.
- **Plain email is the honest fallback, with the risk stated.** An emailed
  token sits in at least two mailboxes forever, gets backed up, and follows the
  client to whatever provider they move to. If it goes by email, say so in the
  roster's "handed over how" column and rotate it (CL-2) once the client
  confirms Helix is connected. Rotating turns a permanent copy into a copy of
  something that no longer works.
- **Never** paste it into a shared document, a ticket, a spreadsheet, or the
  roster file.

**Mark: needs access.** The generation and the two `curl` checks are the
templates' own documented process (`templates/CRM-ENDPOINT-PORT.md`, the
"Optional live smoke" section, run for real on `home-services-classic` on
2026-09-18); the hand-over policy is new here and has never been run with a
real client.

---

## CL-2. Rotate a client's token

**When.** After the token went by email; when a client's machine is lost or
sold; when anyone who should not have it might; or on request.

1. Set the new `CRM_API_TOKEN` on the site and redeploy. **The old one stops
   working the moment the new one is live** - there is no overlap window, and
   the client's Helix will start showing the banner within five minutes.
2. Verify the new token with the two `curl` calls from CL-1 before telling
   anyone.
3. Get it to the client (CL-1's hand-over order).
4. The client: Settings > Website, paste it into Token, **Save**. Leaving the
   Token box empty keeps the stored one, which is how they change only the
   address. Test connection is off until they save, because it checks what is
   saved rather than what is typed.
5. Confirm with them that the banner is gone and "Last result" says
   "Everything came through."
6. Record the rotation date in the roster.

**What it costs the client: nothing.** The site is the source of truth and
Helix's poll uses the site's own cursor, not a time window. Every lead that
arrived while the token was wrong is still on the site and lands on the first
successful poll after the new token is saved. Helix resumes from the cursor it
had before the 401 - it does not start over, and it does not skip.

**Mark: tested**, for the Helix half: `tests/repo/leads/lifecycle.test.ts`,
"resumes from the cursor once the new token is saved, losing no lead" - the
failed poll leaves the cursor untouched and the next request carries it. The
site half (setting the variable and redeploying) needs a real site.

---

## CL-3. The site is deployed but no leads arrive

Four different causes, four different fixes. The owner's screen already names
which one it is, so the first question on a support call is always: **what does
the banner on Settings > Website say?**

**A. "Your website is not set up to send leads yet" (404).** The site has no
`/api/crm/leads`. Either that template never got the CRM block, or the route
was registered after the `/api/{*rest}` catch-all, which makes it dead
(`templates/CRM-ENDPOINT-PORT.md`, "Things that have already bitten"). All
eighteen templates have it as of 2026-09-18
(`templates/CRM-ENDPOINT-STATUS.md`), so on a current site this means the
client's site was built from an older copy. *Walker:* port the block, run that
template's four gates, redeploy. The client does nothing - Helix keeps
retrying and picks it up on its own within eight minutes.

**B. "Your website turned the connection down" (401) on a brand-new install.**
Two causes that look identical. Either `CRM_API_TOKEN` is not set on the
deployed site at all - the endpoint's own default is to refuse everything -
or the token does not match. *Walker:* check the variable is set **on the
deployed environment**, not only in a local `.env`; the commonest version of
this is a token set on a Replit dev run and never added to the deployment's
Secrets. Then run CL-1 step 3. If the site is right, the paste was wrong:
Helix now strips a pasted `CRM_API_TOKEN=`, surrounding quotes and a paste a
mail client wrapped, and refuses the literal `replace-with-a-long-random-string`
placeholder by name, so a client who copied the wrong line out of
`.env.example` is told so instead of getting a 401.

**C. "Your website answered with an error (5xx)."** The site is up but the
handler or the store behind it is not - most often a `DATABASE_URL` that is
set but not reachable. *Walker:* fix the site. *The client:* nothing; Helix
keeps trying and recovers on its own. A 429 lands here too, which on a
one-client site means something other than Helix is calling that endpoint
(the template allows 60 requests a minute per token and Helix uses one every
five minutes).

**D. "Your website could not read where Helix left off" (400).** By the site
contract a 400 means exactly one thing: the `after` marker Helix sent could not
be decoded. Helix drops the marker and reads from the first lead again, which
is safe because a re-read creates nothing (`deals.external_id` carries a
partial UNIQUE index, `drizzle/0005_lead_dedup.sql`). *Walker:* nothing, unless
it repeats - a 400 on a request with no marker at all is a site bug.

**E. An `http://` or staging address.** Helix refuses to save a plain `http://`
address unless it is `localhost` or `127.0.0.1`, in Rust and again in the UI,
and says why: "The address has to start with https://. Plain http:// only
works for a test site on this computer." A staging site served over plain HTTP
cannot be connected, by design - the token would cross the network in clear.
*Walker:* connect Helix to the live HTTPS site, not to staging.

**Mark: tested** for what the owner sees in A, B, C and D
(`tests/repo/leads/lifecycle.test.ts`, `tests/e2e-mac/specs/leads.e2e.ts`) and
for E (`tests/unit/leads/siteOrigin.test.ts`). **Needs access** for every
site-side fix.

---

## CL-4. The website changes address

**When.** Staging to live, apex to www, or a rebrand onto a new domain.

Helix keeps one place-in-the-list per address, and a lead's identity is
`<address>:<lead id>`. So a new address is, to everything downstream, a new
website. Saving one without saying what it means used to re-read the whole
site and turn the client's pipeline into a second copy of itself.

The screen now asks. When the address in the box differs from the saved one, a
picker appears above Save:

- **"The same website, at a new address"** (the default, and the right answer
  for every domain move): the old address's cursor moves to the new one, the
  site resumes where it stopped, and no lead is read twice.
- **"A different website"**: the new address is read from its first lead,
  which is what a genuinely different site needs.

*Walker:* tell the client which one to pick before they change it, and update
the roster's "Site address" column. A client who already picked wrong and
duplicated their pipeline merges the copies on the Duplicates screen; that is
reversible for 30 days (`src/db/repos/merge.ts`, `MERGE_REVERSAL_DAYS`).

**Known limitation.** Choosing "the same website" carries the cursor but does
not rewrite the `external_id` of leads already on file, so a lead the old
address already delivered would come in again if the site ever re-sent it from
before the cursor. Re-keying the old ids needs a migration and is recorded as a
follow-up in `docs/rounds/launch-returns/rev.md`.

**Mark: tested.** `tests/repo/leads/lifecycle.test.ts`, "state 3c" - the
cursor carries, a genuinely different site starts from the beginning, and an
address Helix already follows is never rewound.

---

## CL-5. Offboarding: the site arrangement ends

**What actually happens.** The client stops paying, Walker takes the site down
or rotates its token, and the client's Helix starts failing. From the twelfth
consecutive failure the banner offers Disconnect. Nothing else changes.

*Walker:*

1. Rotate or remove `CRM_API_TOKEN` on the site, or take the site down. Either
   ends the lead flow. Removing the variable is cleaner than leaving a live
   token on a site nobody is watching.
2. Tell the client plainly what they keep, because they will assume they lose
   it: Helix is theirs, it is free, it is not going to stop working, and every
   customer, job, invoice, note and file in it is on their machine. Point them
   at **Settings > Website > Disconnect**, which removes the address and the
   token and deletes nothing.
3. Set the roster row to offboarded, with the date and what was done to the
   token. Keep the row. They still have Helix and may still call.

**What Walker must not do.** There is no remote off switch and there must never
be one. Do not ask a client to delete their workspace, and do not treat a
Helix install as leverage in a billing conversation - it is AGPL software the
client is entitled to keep running.

**If the client wants their data gone**, that is their own action, not
Walker's: Help > "Removing a workspace" has the steps (archive, quit, delete
the folder). Diagnostics names the exact folder.

**Mark: tested** for the Helix half: `tests/repo/leads/lifecycle.test.ts`,
"state 5" and "state 6" - the token is really gone from the keychain, the poll
refuses to run, and the deal count is identical before and after. **Needs
access** for the site-side half.

---

## CL-6. The client roster

Helix has no telemetry, no licence server and no account, so nothing anywhere
knows which client runs it, on what, connected to which site, since when. The
only record is one Walker keeps.

- The blank template is `docs/CLIENT-ROSTER-TEMPLATE.md` in this repository.
- **Copy it out before filling it in.** This repository is public. The
  recommended home is
  `/Users/walker_tracy/Desktop/ClearPath Sites/HELIX-CLIENT-ROSTER.md`, a
  folder that is not a git repository at its top level and already holds the
  other cross-client notes.
- Four things never go in it: the token value, a recovery key, the client's
  Anthropic key, and any of the client's CRM data.

Fill the whole row on install day; anything left blank then stays blank.
Update "Helix version" only when a client confirms they installed it, not when
the link was sent - a column that records intent is worse than no column.
Update it on every rotation, every support contact and at offboarding.

**Mark: inspected only.** The template is written and committed; no roster has
been kept yet, because there is no client yet.

---

## CL-7. How Walker learns a client's Helix is broken

**He does not.** There is no telemetry, no crash reporting, no update ping and
no error channel, by design (`docs/DESIGN.md` §2.10, `CHANGELOG.md` "Not in
v1"), and nothing in this round added one. A client whose lead sync has been
broken for a month looks exactly like a client having a quiet month.

The honest support model, in the order it actually runs:

1. **The client notices.** Today shows one quiet line when lead collection has
   stopped, on the screen they open every morning. That is the only automatic
   prompt that exists, and it only fires if they open Helix.
2. **The client calls or emails.** There is no in-app support channel. Help
   says so in as many words: "Helix has no support team watching in the
   background."
3. **Walker asks two questions before anything else:** what does the banner on
   Settings > Website say, and what does "Last result" say. Those two answers
   identify the state in the table above and therefore the fix, usually without
   a log.
4. **If more is needed, ask for the log.** Procedure 10 above: Settings >
   Diagnostics > **Copy log**, pasted into an email. It carries app starts,
   backups, poll results and errors, and the connected site's address; it does
   not carry the token, the site's response body, or any customer's name,
   phone, email or message.
5. **Walker asks, periodically.** Nothing else will tell him. A short check-in
   after install and then occasionally is the whole monitoring story, and the
   roster's "Last contact" column is what makes it a habit rather than a
   memory.

**Do not add telemetry to fix this.** It is the product's central promise, the
clients are solo owners whose customer lists are the asset, and a phone-home
would be the one network call Helix makes that the owner did not ask for.

---

# Founder-task inventory

Everything below only happens today if Walker remembers it. For each: how
often, what breaks if it is missed, and what this phase turns it into — a
written procedure (here), a checklist line (`tests/RELEASE-CHECKLIST.md`),
a CI check, or an honest "nothing catches this today."

| # | Task | How often | What breaks if missed | What this phase does about it |
|---|---|---|---|---|
| 1 | Keep the three version strings in sync (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` — all three read `0.1.0` at this revision) | Every release | The build still runs, but Diagnostics' "This copy of Helix > Version" row and the installer's own file metadata can disagree with each other and with what CHANGELOG says shipped | Added a checklist line, `tests/RELEASE-CHECKLIST.md`, "Before you tag" |
| 2 | Tag `vX.Y.Z` and push it | Every release | Nothing — no installer is ever built. `ci.yml` runs regardless of tags, so this can silently never happen while every other check stays green | Documented below; no code check exists for "did a tag ever follow a version bump," and adding one is out of this task's ownership (`release.yml` is not mine to edit) |
| 3 | Publish the draft release on GitHub (`release.yml` sets `releaseDraft: true` deliberately, so tauri-action never publishes on its own) | Every release | The tag exists, CI is green, installers are built and attached — and none of it is visible on the public Releases page until the draft is published by hand | Documented below; genuinely nothing catches a forgotten draft today |
| 4 | Tell each client a new version exists | Every release with a client-facing fix | There is no auto-update and no in-app "a new version is available" check (confirmed: `README.md`'s Installing section, no update-check code anywhere in `src-tauri` or `src/app`) — a client can sit on a fixed bug forever without knowing a fix shipped | Documented below; nothing catches this today, by design (no phone-home) |
| 5 | Rotate or hand over a client's site token when asked | As needed, not scheduled | Until rotated, the old token keeps working (not urgent by itself); if it IS rotated on the site side without telling the client's Helix, leads silently stop until the owner notices the Today banner (procedure 3) or Walker asks | Procedure 3 above covers the fix once noticed; nothing proactively notifies Walker — there is no telemetry, by design |
| 6 | Run `tests/RELEASE-CHECKLIST.md` on **both** macOS and Windows before tagging, not just the machine at hand | Every release | `e2e-win.yml` only runs an automated smoke subset on a fresh Windows VM; the full manual checklist (SmartScreen wording, path handling, WebView2 quirks) has no automated equivalent | No code check possible for a manual step; the checklist itself already says this explicitly — left as-is, cross-referenced from here |
| 7 | Purge stale GitHub Actions artifacts | — | Checked: nothing to purge. The only workflow that ever uploads an artifact is `e2e-win.yml`, and it already runs `if: failure()` with `retention-days: 3` — self-cleaning by design. `ci.yml` (this phase's changes included) uploads nothing | Nothing to do; confirmed by reading all three workflow files |
| 8 | Notice when CI goes red on `main` | Every push | Commits land straight on `main` with no PR gate (per Walker's own standing instruction — no branch protection was found or added), so a red `js`, `rust`, or the new `rust-audit` job has no automatic consequence beyond the Actions tab | No code check added — a status check with nothing to block against does not enforce anything; noted honestly rather than papered over |
| 9 | Confirm a client's backups are actually being written | Occasional, when something feels off | No telemetry reaches Walker; the only way to know is to ask the client to open Settings > Diagnostics and read "Last backup," or to read `helix.log` (procedure 10), which logs every backup event | Documented in procedure 10 and here; this is the existing Diagnostics screen doing the job, nothing new needed |
| 10 | Keep the Rust and npm dependency trees free of new advisories between releases | Continuous | `ci.yml`'s new `npm audit` and `rust-audit` jobs (part A of this task) only run on `push`/`pull_request` — a newly published advisory for a dependency that has not changed sits uncaught until the next commit touches the repo | **Finding, class Follow-up** (below) — a `schedule`-triggered audit workflow would close this, but adding one was outside this task's explicit scope and changes `rustsec/audit-check`'s behavior (it opens GitHub issues on a scheduled run, never on push/PR) — a decision for the lead, not made unilaterally here |
| 11 | Unsigned installers re-prompt for keychain access on every rebuild, and clients see a Gatekeeper/SmartScreen warning on every first run | Every release, forever, until TODO E5 (code signing) | Nothing breaks — it is a known, accepted cost documented in `sec.md`'s escalations and in `tests/RELEASE-CHECKLIST.md`'s "Keychain and secrets" section, restated here so it is not mistaken for a new bug during support | Already tracked as TODO E5, a spending decision; not re-litigated here |

### Cut and ship a release, end to end (procedure, for task 1-4 above)

1. Sync the version in `package.json`, `src-tauri/tauri.conf.json`, and
   `src-tauri/Cargo.toml` (checklist line added, see below).
2. Confirm `main` is green: `js`, `rust`, and `rust-audit` all passing on the
   commit about to be tagged.
3. Run `tests/RELEASE-CHECKLIST.md` in full, on both macOS and Windows.
4. Update `CHANGELOG.md`'s Unreleased section into the new version heading.
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. This triggers
   `release.yml`'s matrix build (macOS arm64, macOS x86_64, Windows).
6. Once all three legs finish, open the repository's Releases page and
   publish the draft `release.yml` created — it does not publish itself.
7. Tell each affected client the new version is out and, if the release
   notes matter to them, what changed.

---

# Findings

| # | class | finding | why |
|---|---|---|---|
| F-OPS-W3-1 | Resolved during this phase | `deals.external_id` had no `UNIQUE` constraint (F-SEC-28); the poller's idempotency (procedure 5) was correct only because the single write lock serialized every writer. Flagged while writing procedure 5, then closed by commits `3adc34c`/`658c066` before this document was finished: a partial `UNIQUE` index plus graceful per-lead retry on conflict. | Restated here for the record, not as an open item — `deals.external_id` is now safe against a second write path too, not only against the write lock. |
| F-OPS-W3-2 | Resolved during this phase | No pre-import backup (procedure 6): `runImport()` had no call into `backupsFs.ts`, while `restoreFromBackup` did take a `"pre-restore"` backup — a real asymmetry, not an intentional one. Flagged while procedure 6 was being drafted; closed by commit `22befc4` before this document was finished, under the lead's own "LR-OPS, F-OPS-4" (again a different numbering sequence — see Deviations). | Restated for the record. `npx vitest run tests/repo/data/importPreBackup.test.ts` — 3 passed. The remaining gap (no bulk-select of what one import created, so a full restore is still "go back in time," not "undo exactly this") is unaffected and still open — see procedure 6. |
| F-OPS-W3-3 | Resolved during this phase | The keychain-denial boot screen (procedure 9) showed the generic "Helix can't open your data / another copy may have it, or the folder may not be writable" headline for a `SECRET_ERROR`. Flagged twice while procedure 9 was being drafted (once after `a5ac006` improved only the Details text, restated as still-open) and closed both times: `d084392` gave `SECRET_ERROR` its own `SecretStoreError` class, its own re-throw in `boot.ts`, and its own `BootScreens.tsx` screen headed "Helix needs permission to use this computer's keychain," landing under the lead's own finding number (their commit and `tests/unit/app/bootFailure.test.ts` cite it as "LR-OPS F-OPS-5" — a different numbering sequence from this one; see Deviations for why this document's findings are prefixed `F-OPS-W3-`). | Restated for the record. `npx vitest run tests/unit/app/bootFailure.test.ts` — 9 passed, asserting the new heading contains "keychain" and the two wrong causes are both absent. |
| F-OPS-W3-4 | Follow-up | No scheduled dependency-audit run; `npm audit`/`rust-audit` (this task's A1/A2) only run on push/PR, so an advisory published against an unchanged dependency is not caught until the next commit. | Adding a `schedule` trigger changes `rustsec/audit-check`'s own behavior (it creates GitHub issues on a scheduled run, never on push/PR) — a product decision about issue-spam, not a mechanical CI addition, left for the lead. |
| F-OPS-W3-5 | Follow-up | Nothing enforces "a version bump was followed by a tag" or "a tag was followed by publishing the draft release" (founder-task inventory, items 2–3). | Both are pure process gaps with no in-repo data to check against (task 2) or check against a page this repo does not control (task 3, the Releases UI). Documented as procedure, not automated. |
| F-OPS-W3-6 | Closed by the lead | `src-tauri/tests/recovery_tests.rs` claimed in a comment that "the JS side is covered by its own tests" for `restoreFromBackup`, and no such test existed. Correct catch. | Both halves fixed: `tests/unit/data/restorePruneGuard.test.ts` now covers the five-step orchestration and the prune race, and the Rust comment points at it by name instead of at nothing. Procedure 7 moved to **tested** except for the real window. |

---

# Deviations from the packet

- The packet describes the "newer Helix" refusal (procedure 1) as something
  the lead and W1 are still adding, with an ask to leave a placeholder for
  the final message text. Reading `src/db/migrator.ts` and
  `src/app/BootScreens.tsx` at this revision, it is already fully
  implemented and covered by `tests/repo/migrations.test.ts`
  (`describe("older build vs. a newer workspace (LR-OPS-W1 A1)")` and
  `describe("partial-failure atomicity (LR-OPS-W1 A2)")`). No placeholder
  was left; procedures 1 and 2 are written and marked against the real code
  and cite a real test run. Flagging this so the lead knows W1's work landed
  ahead of this packet being written, in case the packet's other assumptions
  about in-flight work need the same check.
- The packet asked procedure 8 to carry a placeholder for the lead's
  in-flight recovery-key and second-backup-copy design, and procedure 9 to
  carry a proposed message rewrite for the lead to apply. Both landed as
  real commits partway through this task, ahead of the packet's assumption,
  in two waves: `a5ac006`/`a773ff3` shipped the recovery key, the second
  copy, and a better *message* for a keychain denial; `d084392`, landing
  after that, gave the denial its own screen entirely. Procedure 8 is
  rewritten against the shipped feature and marked **tested** (`cargo test
  --test recovery_tests`, `npx vitest run tests/unit/data/recoveryKey.test.tsx`).
  Procedure 9 went through two drafts in this session — first marked
  **inspected only** against `access_refused()` alone, noting the headline
  gap as F-OPS-W3-3, then rewritten and remarked **tested** once `d084392`
  closed that gap too (`npx vitest run tests/unit/app/bootFailure.test.ts`).
  Its own commit and test name the fix as the lead's own "LR-OPS F-OPS-5" —
  a different, lead-owned numbering sequence from this document's findings.
  To avoid two documents' findings colliding under the same `F-OPS-N` label
  during integration, every finding in this document is prefixed
  `F-OPS-W3-` (this task's id) instead of the bare `F-OPS-` the packet's
  own template suggested.
- Procedure 7 also gained real supporting evidence mid-phase
  (`src-tauri/tests/recovery_tests.rs`'s `restore_over_the_live_file_...`
  test, from the same commit) even though the packet's own end-to-end
  restore test was not what produced it. Procedure 7 stays marked **needs
  access** — the JS orchestration around the file copy is still untested and
  a live click-through was not done here — but now cites that evidence
  rather than carrying an empty placeholder. See F-OPS-W3-6 for a discrepancy
  found while checking this.
- F-SEC-28 (the missing `UNIQUE` index on `deals.external_id`, restated here
  as F-OPS-W3-1 while procedure 5 was being written) was closed by commits
  `3adc34c` and `658c066`, landing after F-OPS-W3-1 was drafted and before this
  document was finished. F-OPS-W3-1 and procedure 5 were both updated to
  describe the fix rather than the gap; this is the third instance this
  phase of a concurrent worker resolving something between this document
  noticing it and being committed — this branch is under active, fast
  parallel work, and every "as of this revision" statement in this document
  means the revision it was actually checked against, not necessarily the
  one this file is finally committed at.
- F-OPS-W3-2 (procedure 6, no pre-import backup) went through the same cycle
  as F-OPS-W3-1: seen mid-edit as uncommitted changes to `importRun.ts`,
  `backupsFs.ts`, `typedImportRun.ts`, `importResultView.ts`, and
  `ResultStep.tsx` while this document was still open, then landed as commit
  `22befc4` before hand-off. Procedure 6 and F-OPS-W3-2 were both rewritten
  against the committed code, not the in-progress diff, and cite
  `tests/repo/data/importPreBackup.test.ts` (3 passed). This is the fourth
  finding in this document that a concurrent worker closed between being
  noticed and this file being committed — see the note above about what
  "as of this revision" means here.
