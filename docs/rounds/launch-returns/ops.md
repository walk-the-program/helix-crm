# LR-OPS return — Chief Reliability and Operations Officer

TASK: LR-OPS (parent: Fable coordinator) · ATTEMPT 1 · PACKET REV 1
STATUS: **submitted**
Base revision: `44d72d8`. Revision this return describes and was verified at: `6639544`.
Team: this Opus lead + 3 Sonnet workers (W1 migrations and scale, then W1b e2e; W2 lead
idempotency and timers; W3 CI and the operations manual). Every worker diff was read
against its packet before acceptance; two were corrected by the lead (below).

---

## 0. What this phase had to prove

Not that Helix works — the product phases established that — but that it can be
**operated and recovered** by Walker and by a non-technical owner when something goes
wrong, at the scale of the first handful of clients, with no new infrastructure and no
new network calls.

The shape of the problem is unusual and worth restating, because it changes what
"operations" means here. There is no server, no fleet, no dashboard and nothing to page.
Each install is its own deployment: one owner, one machine, one encrypted SQLite file
whose key exists only in that machine's keychain. So the failures that matter are not
outages. They are: the laptop dies, the disk dies, the owner clicks Deny, the owner
imports the wrong file, an old installer gets put back over a new workspace, and the
website stops answering. Each of those either has a way back or it does not, and this
phase was about finding out which.

One of them did not, and it was the largest finding of the phase: **every backup was
encrypted with a key that existed in exactly one place, so a dead laptop made thirty days
of backups unreadable and a copied workspace folder unopenable.** That is fixed.

---

## 1. Findings

Class: **Blocker** (exposing a real client would create an unacceptable failure, access,
data or core-workflow risk) · **Required** (required before paid onboarding) ·
**Follow-up** (useful, not needed for the first launch).

| # | class | finding | why that class | fix | evidence |
|---|---|---|---|---|---|
| F-OPS-1 | **Blocker** | **No recovery key existed.** Every workspace and every backup of it is SQLCipher-encrypted with a key held only in that machine's keychain. A dead, stolen or wiped laptop therefore took every backup with it, and a workspace folder copied to a new machine could not be opened at all. Nothing in the product said so, and Settings → Backups implied the backups were the way back. | For a one-laptop trade owner this is the most likely real-world total-loss incident in the product, and the app was silently promising a recovery that could not happen. That is a data risk created by exposing a real client. | `a5ac006`, `a773ff3`: a `HLX1-` recovery key the owner can show, save and print, and a matching "Open a backup from another machine" path that adopts a backup into a new workspace on a machine with an empty keychain. Rust owns the format, the parser, the proof and the rollback. | `cargo test --test recovery_tests` 9 passed, including `a_backup_opens_on_a_machine_that_has_never_seen_it`; `tests/unit/data/recoveryKey.test.tsx` 10 passed; `tests/e2e-mac/specs/backups.e2e.ts` 6 passed. |
| F-OPS-2 | **Required** | **Backups were only ever written next to the live database.** One failed SSD lost the original and all thirty days of copies together. With F-OPS-1 that meant disaster recovery was not merely hard, it was arithmetically impossible. | Required rather than Blocker only because the recovery key is what makes a second copy worth having; on its own it is the difference between "backup" and "same disk". Both had to land, and both did. | `804482b`: `backup_mirror` makes a folder the owner chooses — an external drive, or a folder Dropbox/iCloud Drive/OneDrive already syncs — match the workspace's own backups folder. No new network call: Helix writes a file and stops, and what the sync provider sees is the same ciphertext. | `src-tauri/src/backups.rs` 5 tests; `tests/unit/data/backupCopyOut.test.ts` 6 passed; e2e covers the folder persisting and `backup_mirror` being called with it. |
| F-OPS-3 | **Required** | **Every real backup failure told the owner "[object Object]."** `reasonOf` used `String(err)`, and Tauri rejects a command with a plain `{code, message}` object. A disk-full backup failure produced a red banner saying "Helix could not save a backup: [object Object]". | The one banner whose whole job is to tell the owner their backups have stopped was unreadable, and a backup that has silently stopped is how a recoverable incident becomes an unrecoverable one. | `804482b` (found by the copy-out tests, not by inspection). | `tests/unit/data/backupCopyOut.test.ts`, "quotes what Rust said rather than [object Object]". |
| F-OPS-4 | **Required** | **No backup was taken before an import.** `importRun.ts` writes one `change_log` row per file rather than one per contact and says in its own comment that "undo for an import is restore the backup, not walk the log". The reasoning is right and the backup did not exist. An import that updates existing contacts on a dedupe match — the normal case for a second export out of the same vendor — overwrote real data with nothing behind it but the last scheduled backup, up to six hours old. | Importing a client's existing records is the first thing that happens at onboarding, and getting it wrong is the most likely early support call. The product documented an undo it did not implement. | `22befc4`: both importers take a `pre-import` backup before the write lock and refuse to start if they cannot, which is the rule `migrate()` already follows. The path comes back in the result and the result screen names the way back. | `tests/repo/data/importPreBackup.test.ts` 3 passed, including "stops the import when it cannot be taken, and writes nothing". |
| F-OPS-5 | **Required** | **A refused keychain prompt got a screen that invented the wrong cause.** On an unsigned macOS build the prompt reappears after every rebuild, so Deny is the most likely boot failure this product has. `SECRET_ERROR` was wrapped into `DbOpenError` and shown under "Helix can't open your data — another copy of Helix may have it, or the folder may not be writable." Both causes wrong; both send the owner looking for a second Helix that is not running. | Exactly the class of invented cause F-LC-10 fixed once already, on the one failure a client is most likely to hit, with an actionable fix (Always Allow) that the screen did not mention. | `d084392`: `SecretStoreError` passes through `openWorkspace` untouched to its own screen, whose body is the sentence `secrets.rs` now writes — quit, reopen, choose Always Allow. `a5ac006` wrote that sentence and taught `secrets.rs` to tell a refusal apart from a fault. | `tests/unit/app/bootFailure.test.ts` 9 passed, asserting the new heading and the absence of both wrong causes. |
| F-OPS-6 | **Required** | **`restoreFromBackup`'s orchestration had no test, and a Rust test comment claimed it did.** The five steps — pre-restore backup, close, copy, reopen, re-boot — are a safety ordering, and nothing held them to it. | Restore is the procedure a client is most likely to need and the one whose ordering is load-bearing: a copy before the close writes under an open connection, and a close before the pre-restore backup leaves no way back from a restore the owner did not mean. | `6639544`: the sequence is now asserted exactly, along with a failed copy being rethrown rather than reported as a restore that worked. The Rust comment names the file that does it. | `tests/unit/data/restorePruneGuard.test.ts` 6 passed. Caught by W3, not by the lead. |
| F-OPS-7 | **Required** | **A scheduled prune could delete the file a restore was copying from.** `pauseTimers()` stops a new scheduler tick; a tick that passed its own check a moment earlier runs to the end, and the end is `pruneBackups()`. If the chosen backup was the oldest one past the retention window — exactly the one somebody reaches for after a bad week — it could be deleted mid-copy. | Narrow window, serious outcome: a corrupted or failed restore at the moment the owner needs one. Rust's `backup_guard` serialised the two database operations correctly; nothing coordinated the two pieces of JS that touch the backups folder. | `7e637ac`: a restore switches pruning off for its duration. A prune skipped costs a few stale files for six hours; a prune that races a restore costs the restore. | `tests/unit/data/restorePruneGuard.test.ts`, "deletes nothing while a restore is copying from the folder", plus the two resume cases. Found by W2. |
| F-OPS-8 | **Required** | **An older Helix opened a workspace a newer Helix had already migrated, and carried on.** There is no auto-update, so reinstalling an older installer over a migrated workspace is a thing that happens. `migrate()` only ever asked "is this tag done yet", so a future version's `schema_migrations` row was invisible and the old build read and wrote a schema it does not understand. | Silent, and the damage compounds: the old build writes rows the new schema's constraints were added to prevent. The correct behaviour is to refuse, which costs nothing. | `6c58005`, `90f43bf`: `NewerSchemaError`, thrown before the backup and before either PRAGMA, with its own full-screen refusal that offers no downgrade, no delete and no repair. | `tests/repo/migrations.test.ts` (current behaviour pinned first, then the refusal and its exact wording); `tests/repo/boot.test.ts` on a real file-backed workspace; `tests/unit/app/bootFailure.test.ts`. |
| F-OPS-9 | **Required** | **`deals.external_id` had an index but no UNIQUE constraint** (carried in from SEC as F-SEC-28). Lead idempotency was a read-then-write, correct only because the single write lock happened to serialise every writer. | A poller that applies a lead twice creates a duplicate job for a real customer. The existing protection was a property of an unrelated component, not a rule the data enforced. | `3adc34c`: `drizzle/0005_lead_dedup.sql`, a partial UNIQUE index, preceded by a de-duplication of any pre-existing violation — oldest live row survives, later duplicates go to Trash, nothing hard-deleted and nothing merged. `658c066`: a UNIQUE violation on apply is reclassified as "already have this one", not a poll failure with a banner. | `tests/repo/leads/dealExternalIdMigration.test.ts` (two- and three-way pre-existing collisions, controls untouched, index live afterwards); `tests/repo/leads/pollerRace.test.ts`; `tests/repo/leads/applyLeads.test.ts`. |
| F-OPS-10 | **Required** | **The purge sweep's `tick()` had no self-overlap guard.** `startPurgeSweep` guarded only the start, so a long sweep could be re-entered. | It deletes rows and files. Two concurrent sweeps over the same expired list is the one place in the product where a re-entrant timer touches the filesystem. | `2f9632d`: a `sweeping` flag, plus tests for the `timersPaused()` skip and throw-then-reschedule on both timers. | `tests/repo/data/purgeSweep.test.ts`. |
| F-OPS-11 | **Required** | **No dependency audit ran anywhere** (SEC's §7 requests). `cargo audit` had never been run against the Rust tree at all, on any machine. | An unaudited dependency tree in an app that holds a client's whole customer list. Free to fix and read-only. | `63753c9`: `npm audit --omit=dev --audit-level=high` in the `js` job, and `rustsec/audit-check@v2` against `src-tauri` in a new `rust-audit` job with `checks: write` and nothing else. | YAML parsed with `npx --yes js-yaml`; `working-directory` confirmed as a real input by fetching `action.yml` from the pinned `v2` ref, after the lead challenged it. |
| F-OPS-12 | **Required** | **`withTransaction`'s nesting shortcut lets an unrelated concurrent writer skip the write lock.** `txDepth` is a module-level counter, not per-holder. Its comment says "already inside a transaction held by this same lock holder", which is true for a genuinely nested call and false for a concurrent one. While a long import holds the lock inside a transaction, any other `withTransaction` caller — creating a deal, a task, a document, a merge — sees `txDepth > 0`, skips `withWrite` entirely, and writes its statements **into the import's transaction**. If the import then fails and rolls back, the owner's work disappears with it, with no error shown. | Silent data loss on a plausible sequence (an owner clicking around during a long import) with no diagnostic. It is Required rather than Blocker because the window needs a long-running transaction, and the first client's imports are seconds not minutes. | **NOT FIXED. Escalated — see §8.** I attempted an empirical probe of whether any call site genuinely relies on the shortcut; the edit to `src/db/writeLock.ts` was refused by this session's permission classifier as a shared-resource change, and I did not work around it. That is the right outcome: changing the semantics of the central write lock deserves its own verified pass, not a late experiment behind three other workstreams. | Mechanism read directly in `src/db/writeLock.ts` lines 155–170; the hazard is documented in `drizzle/0005_lead_dedup.sql`'s header by W2, who found it. `tests/repo/leads/pollerRace.test.ts` shows the poller's own two callers are *not* affected, because both enter at `txDepth === 0`. Proposed fix in §8. |
| F-OPS-13 | Follow-up | The two new audit jobs run on `push`/`pull_request` only, so an advisory published against an unchanged dependency is uncaught until the next commit. | A `schedule` trigger would close it, but it changes `rustsec/audit-check`'s behaviour — on a scheduled run it opens GitHub issues, which is a decision about issue noise on Walker's repo, not a mechanical CI addition. | — | W3's F-OPS-W3-4 in `docs/OPERATIONS.md`. |
| F-OPS-14 | Follow-up | Nothing enforces that a version bump is followed by a tag, or that a tag's draft release is ever published. `release.yml` sets `releaseDraft: true` deliberately, so a forgotten draft means the installers exist and nobody can see them. | Pure process, no in-repo data to check against, and a wrong automation here publishes something Walker did not mean to publish. | Turned into the written release procedure in `docs/OPERATIONS.md` and a "Before you tag" section in `tests/RELEASE-CHECKLIST.md`. | — |
| F-OPS-15 | Follow-up | F-SEC-29: poller backoff state is a module variable, so a broken site is polled once hard at every launch. | Bounded at one request per launch against a site the owner owns. Persisting it means a schema change and new wiring for a cosmetic win. Agreed with W2's recommendation. | — | — |
| F-OPS-16 | Follow-up | `deals.goneQuiet()` has no `LIMIT`. At 5,000 deals it returned 644 rows in single-digit milliseconds as part of a ~10 ms Today, so it is bounded by realistic deal volume — but unlike `receivables.outstandingRows()` it has no self-limiting property, since deals stay open indefinitely. | Measured, not theorised. `deals.board()` already carries an explicit `LIMIT 5000` and is the precedent to follow when it matters. | — | `tests/repo/perf/scale.test.ts`. |
| F-OPS-17 | Follow-up | Invoices, Receivables, Trash, Recurring, Templates and Duplicates do not use `VirtualList`; Contacts, Companies and Tasks do. | Inspection only. Their queries are fast at realistic scale and their row counts are bounded by document volume, which for a solo trade business is small. Worth revisiting if invoice volume grows. | — | W1's inspection, recorded in `docs/OPERATIONS.md`. |
| F-OPS-18 | Follow-up | There is no auto-update and no update check, so a client can sit on a fixed bug forever without knowing a fix shipped. | By design: an update check is a network call the product promises not to make. The answer is a procedure, not code. | Written into the founder-task inventory. | — |
| F-OPS-19 | Follow-up | Nothing catches red CI on `main`. Commits land straight on `main` with no PR gate, per Walker's own standing instruction. | A status check with nothing to block against does not enforce anything. Recorded honestly rather than papered over with a badge. | — | — |
| F-OPS-20 | Follow-up | An import still cannot be undone as *this import* — only by going back in time to the pre-import backup, which also discards anything done since. | The pre-import backup (F-OPS-4) closes the data-loss hole. A true per-import undo needs a bulk-select of what one `batchId` created, which is a feature, not a control. | — | `docs/OPERATIONS.md` procedure 6. |

**Not applicable here, by design**, restated so nothing is assumed missing: no deployment
pipeline to roll back (the artefact is an installer a person double-clicks), no hosted
monitoring, no error reporting, no alert routing, no health checks, no queue, no retries
across process restarts. Observability in this product is local logs, the Diagnostics
screen and in-app status, and that is what was used.

---

## 2. Incident procedures

All ten live in `docs/OPERATIONS.md`, each with what the owner sees, what they do, what
Walker does, and what recovers the data.

| # | procedure | mark | evidence |
|---|---|---|---|
| 1 | A release build fails, or ships broken | needs access | The rollback's dangerous half — an older app on a newer workspace — is now a refusal, tested (`tests/repo/migrations.test.ts`, 12 passed). Reinstalling a real installer needs a real machine. |
| 2 | A migration partially completes | tested | Single-file last-statement failure and the multi-file case both leave no partial DDL and no `schema_migrations` row; `foreign_keys` is restored to ON after a throwing migration; every statement in the real `drizzle/000*.sql` files is transaction-safe, asserted by an allow-list test rather than by a one-off grep. |
| 3 | The client's website is down, or the token was rotated | tested | `tests/unit/leads/backoff.test.ts` 12 passed; the banner strings are quoted from `PollBanner.tsx` / `PollNotice.tsx`, not paraphrased. |
| 4 | Anthropic is down, or the key is revoked | tested | `tests/unit/ai/provider.test.ts` 14 passed. |
| 5 | The lead poller applies a lead twice | tested | `tests/repo/leads/applyLeads.test.ts` + `pollerRace.test.ts`, 30 passed, against the UNIQUE index that landed this phase. |
| 6 | A client imports bad data | tested | `tests/repo/data/importPreBackup.test.ts` 3 passed. The procedure names all three ways back — trash, the pre-import backup, an older backup — and says plainly that a per-import undo does not exist. |
| 7 | Restore a database from a backup | tested, except the real window (needs access) | `cargo test --test recovery_tests` 9 passed for the file-level mechanism; `tests/unit/data/restorePruneGuard.test.ts` 6 passed for the five-step order and the prune race. Clicking Restore in a built app remains Walker's, in `tests/RELEASE-CHECKLIST.md`. |
| 8 | The laptop dies | tested | The honest answer changed this phase: it used to be "the data is gone". `cargo test --test recovery_tests` 9 passed, `tests/unit/data/recoveryKey.test.tsx` 10 passed. |
| 9 | The keychain prompt was denied | tested | `tests/unit/app/bootFailure.test.ts` 9 passed against the new screen. |
| 10 | `helix.log` is needed by support | inspected only | Code and the Diagnostics screen read directly; the redaction claim is backed by `tests/unit/leads/pollerLogRedaction.test.ts` 3 passed. No live app was run, per the standing rule. |

`tests/RELEASE-CHECKLIST.md` and `docs/OPERATIONS.md` were reconciled: the checklist is
"what you verify by hand before tagging" and gained a "Before you tag" section (version
strings across the three manifests, CHANGELOG, CI green); the release/tag/publish/notify
lifecycle lives only in OPERATIONS.md. Neither duplicates nor contradicts the other.
`tests/README.md`'s stale claim that the checklist was "not written yet" is fixed.

---

## 3. Founder-task inventory

Eleven items, in full in `docs/OPERATIONS.md`, each with how often, what breaks, and what
it became. In summary:

- **Became a checklist line:** keeping the three version strings in sync; running the
  manual checklist on both macOS and Windows.
- **Became a written procedure:** cut and ship a release end to end (sync, green CI,
  checklist, CHANGELOG, tag, publish the draft, tell the clients); rotating or handing
  over a client's site token; asking a client to read Diagnostics when you need to know
  whether their backups are running.
- **Became a CI check:** keeping the npm and Rust dependency trees clean (F-OPS-11).
- **Nothing catches this today, stated as such:** a version bump that is never tagged; a
  tag whose draft release is never published; a client who is never told a version
  exists; a red CI run on `main`. Three of the four are consequences of deliberate
  choices — no phone-home, no PR gate — so the honest answer is a procedure, not a
  mechanism.
- **Checked and found to need nothing:** purging stale GitHub artifacts. The only
  workflow that uploads one is `e2e-win.yml`, already `if: failure()` with three-day
  retention. Nothing this phase added uploads anything.

---

## 4. Realistic-scale evidence

Before this phase the only scale evidence was the 100k-row CSV import test. A repo-layer
pass now seeds **20,000 contacts / 5,000 deals / 10,000 activities** (plus 3,000
companies, 1,500 tasks, 2,500 documents) into a real file-backed database and times the
queries behind the screens:

| Query | ms | budget |
|---|---|---|
| Contacts list, first page | 4.7 | 200 |
| Contacts list, deep page (offset ~19,900) | 32.1 | 200 |
| Search (FTS `searchRows`) | 0.6 | 300 |
| Search, pre-keystroke `recentRecords` | 5.7 | 300 |
| Today (goneQuiet + newLeads + tasks.today + recentWithLinks) | 9.7 | 500 |
| Reports: overview | 8.4 | 500 |
| Reports: deals | 3.3 | 800 |
| Reports: people | 9.3 | 500 |
| Reports: revenue | 10.9 | 800 |
| Receivables aging | 0.7 | 300 |

Budgets are deliberately loose: the job is to catch an unbounded query, not to police
milliseconds on a loaded laptop. Three queries have no `LIMIT`; each was measured and its
bound stated rather than assumed (F-OPS-16, plus `search.recentRecords` bounded by total
live rows across three tables, and `receivables.outstandingRows` self-limiting to sent
invoices). `deals.board()` already carries an explicit `LIMIT 5000`.

---

## 5. Acceptance

**B1 — findings numbered, classified, reasoned; all Blocker/Required fixed with tests.**
Pass, with one exception carried openly: 20 findings in §1. One Blocker and ten Required;
nine of the eleven are fixed with tests. F-OPS-12 (the write-lock shortcut) is Required
and **not fixed** — the edit was refused by this session's permission classifier and I did
not work around it; it is escalated in §8 with a proposed fix. F-OPS-6 and F-OPS-7 were
found by workers reviewing each other's ground, not by the lead.

**B2 — restore proven end to end, including on a simulated new machine.** Pass.
`src-tauri/tests/recovery_tests.rs`, 9 tests, all against temp workspaces:
`restore_over_the_live_file_brings_the_old_rows_back` (back up, change something, copy the
backup over the live file, reopen, the change is gone and the earlier rows are back, and
the file is still encrypted) and `a_backup_opens_on_a_machine_that_has_never_seen_it` (a
workspace id this process has never minted a key for — which is exactly what a fresh
install looks like to `secrets.rs` — adopts the backup with the recovery key and reads
every row, then holds the key for the next launch). Every refusal — wrong key, plaintext
file, foreign database, missing file — leaves no folder and no keychain entry behind. The
JS orchestration is covered by `tests/unit/data/restorePruneGuard.test.ts`. Walker's live
workspace was never touched and the installed app was never launched.

**B3 — migration behaviour proven.** Pass. Partial-failure atomicity across one file and
across two; `schema_migrations` and the schema itself both asserted; the pre-migration
backup path carried on the error; `foreign_keys` restored to ON after a throw; and a test
that every statement in the real migrations is one SQLite can run inside a transaction,
so the atomicity claim cannot rot. Older-app-on-newer-schema is refused before anything
runs, with a message that names the real action and offers no downgrade, delete or
repair.

**B4 — `docs/OPERATIONS.md`.** Pass. Ten procedures, each marked; the founder-task
inventory turned into procedures and checks; the release checklist reconciled. §2 above.

**B5 — CI.** Pass. Both audit steps added; the workflows stay free for a public repo and
upload nothing; `working-directory` verified against the pinned `v2` ref's own
`action.yml` after I challenged it rather than trusting the first read; YAML parsed
mechanically with `js-yaml` and read twice by eye. The three jobs CI runs — typecheck,
vitest, cargo test — are green locally at this revision.

**B6 — verification.** Pass. §6.

**B7 — design contract.** Pass. Every new user-facing string is in DESIGN.md voice: the
point first, the action named, no apology, no exclamation mark, no emoji (swept across
every file this phase touched). No colour literal, `rgb()` or `hsl()` in any changed UI
file; no native date or time input; tokens throughout, including `--color-bg` for the
recovery-key block after `--color-surface-sunken` turned out not to exist. One primary
per screen is preserved — the Backups header keeps "Back up now" and all three new panels
are secondary.

---

## 6. Verification

All at `6639544`, on this machine, macOS. Walker's live workspace under
`~/Library/Application Support/com.clearpathdigital.helix` was never touched; the
installed app was never launched.

```
npm run typecheck                 clean, exit 0
npx vitest run                    177 passed | 1 skipped (178 files)
                                  2284 passed | 3 skipped | 0 failed
                                  (baseline at 44d72d8: 2221 passed | 3 skipped)
cd src-tauri && cargo test        85 + 8 + 10 + 11 + 9 = 123 passed, 0 failed
                                  (baseline 102; recovery_tests, backups and
                                   recovery unit tests are the growth)
npm run build                     built in 796ms, exit 0
                                  (only the pre-existing chunking advisories)
E2E_PORT=4270 E2E_OUT=dist-ops npm run e2e:mac -- data settings smoke backups
                                  44 passed (1.7m), 0 failed
npx --yes js-yaml .github/workflows/ci.yml    valid, both new steps present
git status                        clean
```

`dist-ops` removed. No server, no `tools/fake-site`, no Playwright process and no agent
left running. All 22 commits are local on `main`; **nothing pushed** — Fable pushes.

Three fixes were found by a test rather than confirmed by one, which is worth recording
because it is the difference between a check and a formality: F-OPS-3 (the
"[object Object]" banner) was found by the copy-out tests while they were being written
for something else; F-OPS-7 (the prune race) was found by W2 while proving the timer
guards, in a file W2 did not own and correctly refused to edit; F-OPS-6 (the untested
restore orchestration) was found by W3 refusing to take a Rust test comment's word for
what existed.

---

## 7. Deviations and risks

1. **F-OPS-12 is open.** The single largest unfixed item, escalated in §8. Everything
   else Required is fixed.
2. **W1's first three commits (`6c58005`, `90f43bf`, `ce85a6d`) are missing the
   `Co-Authored-By: Claude Sonnet 5` trailer.** Caught on review. Not amended: rewriting
   shared history is forbidden by the standing rules and the trailer is not worth
   breaking that for. W1 added it to every later commit.
3. **`applyLeadPage` now batches per lead rather than per page.** The common case is still
   one round trip; only a UNIQUE conflict triggers the per-unit retry in nested
   savepoints. This is a real structural change to the poller's hot write path, made to
   stop one conflicting lead taking a whole page down with it. The pre-existing "writes
   nothing at all when one lead fails" behaviour was checked and is intact.
4. **The de-duplication rule in `0005_lead_dedup.sql` is a judgement call.** Pre-existing
   duplicate `external_id` rows are resolved by keeping the oldest live deal and
   soft-deleting the later ones into Trash. Nothing is hard-deleted and nothing is merged,
   because a merge means choosing which edits and which timeline survive and that is a
   product decision. The owner keeps every record and can restore one by hand. Flagged
   rather than assumed.
5. **The recovery key is a deliberate narrowing of a security invariant SEC hardened.**
   D18 said the key never crosses the IPC boundary; it now may, for the open workspace, on
   the owner's explicit press. A key an owner can write down is a key an attacker can find
   written down — and the copy that already exists, in the keychain, is exactly as
   available to anyone who can unlock that Mac. The screen and the saved file both say so.
   `secret_set`/`secret_get`/`secret_delete` still refuse the kind `"dbkey"`, so the only
   path is the one command. Written into `docs/CONTRACTS.md` as an amendment, not a
   footnote.
6. **`backup_mirror` deletes files in a folder the owner chose.** Only `.db` files, only
   directly inside `<chosen folder>/Helix backups/<workspace id>`, only when the source no
   longer has them, never recursively, and never anything else the owner keeps there —
   tested. The alternative, a mirror that only accumulates, fills an iCloud Drive quietly
   and nobody notices.
7. **Nothing in this phase was verified on Windows.** `cargo test` runs there in CI and
   the new Rust tests are gated by it, but the recovery key, the second copy and the
   adopt path have not been exercised against Windows Credential Manager or a Windows
   path. The e2e-win suite does not cover them.
8. **Procedure 10 is inspected only** and procedures 1 and 7 keep a needs-access
   component. None can be closed without launching the app, which the standing rules
   forbid this session.

---

## 8. Escalations for Fable / Walker

1. **F-OPS-12, the write-lock shortcut — needs its own verified pass.** `withTransaction`
   treats a module-level `txDepth > 0` as "I am nested inside my own outer transaction",
   which is false for a concurrent caller. During a long import, another writer's
   statements land inside the import's transaction and vanish if it rolls back.

   **Proposed fix, for a dedicated task:** stop inferring nesting. Make
   `withTransaction` always go through `withWrite`, and give genuinely nested callers an
   explicit opt-in (`withTransaction(fn, label, { join: true })`). The repository rule
   already says the lock is not reentrant and that a repository write must never call
   another repository's write function, so the shortcut may have no legitimate caller at
   all — which is checkable in one run: make the shortcut throw, run `npx vitest run`, and
   every genuine nested call site will name itself. If none do, delete the shortcut. I
   attempted exactly that probe; the edit to `src/db/writeLock.ts` was refused by this
   session's permission classifier as a shared-resource change and I did not work around
   it. That is the right outcome for a late, unreviewed change to the central write path,
   but it does mean the finding leaves this phase unproven in either direction.

2. **`docs/CONTRACTS.md` was changed by the lead**, and one of the changes narrows a rule
   the security phase deliberately hardened. New section "Recovery and the second backup
   copy" in `21f73af`: the three new commands, the prove-then-write order the adopt
   follows, the one place allowed to delete a `dbkey` entry, and the replacement for D18's
   "the key never crosses the IPC boundary". Flagged because CONTRACTS is shared and
   because this one deserves a second opinion rather than a merge.

3. **Windows has not seen any of this** (deviation 7). It needs either a real Windows pass
   on the recovery key and the second copy, or an explicit decision that the first clients
   are Macs. This is Walker's machine access, not a code gap.

4. **F-OPS-13, a scheduled dependency audit**, is a decision about issue noise on Walker's
   repo: `rustsec/audit-check` opens GitHub issues on a scheduled run and never on
   push/PR. Left unmade rather than made unilaterally.

5. **Unsigned installers** remain the background cost behind F-OPS-5 and behind one item in
   the founder inventory. Already escalated by SEC as a spending decision; restated here
   because the keychain-denial screen is a mitigation, not a cure.

Nothing in this phase needed Walker's keychain, and nothing added a network call, a paid
service or a dependency.

---

## 9. Handoff

Nothing running: no servers, no background processes, no fake-site instance, no agents.
`dist-ops` and the workers' `dist-ops-w1` removed along with their Playwright caches.
Working tree clean at `6639544`. All 22 commits are local on `main`; nothing pushed.

For whoever comes next:

- `docs/OPERATIONS.md` is the operating manual and is written to be read at the worst
  moment. It is accurate as of this revision and says so.
- The two marks that can only be cleared on Walker's machine are procedure 1's reinstall
  and procedure 7's real click-through. Both are already lines in
  `tests/RELEASE-CHECKLIST.md`.
- F-OPS-12 is the one Required finding still open, with a fix proposed and a one-command
  way to find out whether it is safe.
- The recovery key changes what onboarding has to say. A client who installs Helix and
  never opens Settings → Backups has no recovery key saved anywhere, which makes the
  whole of F-OPS-1 optional in practice. Getting that into the first-run flow belongs to
  the customer-success phase, and it is the single highest-value thing that phase could
  carry from this one.

---

# Recheck after product expansion (LR-OPS-RECHECK)

TASK: LR-OPS-RECHECK (parent: Fable) · ATTEMPT 1 · PACKET REV 1
STATUS: **submitted**
Base: `e11279d`. Revision this section describes and was verified at: `a2e05a2`
(HEAD moved under me repeatedly during the pass — other rechecks were landing —
so every number below names the revision it was taken at).
No Sonnet children; done by the lead.

## What changed under the operations work

Product expansion added migrations 0006–0009, payments as records with a
backfill, a Schedule module, follow-up automations with a sweep registered on
boot, and bulk actions. The question for this pass was not whether those
features work — their leads proved that — but whether the operational
guarantees from LR-OPS still hold with them in place: forward migration,
restore, the background beats, and the write lock.

Most of them do. Two did not, and one of those was a promise the product was
making on a screen while the code did something else.

## Findings

| # | class | finding | fix | evidence |
|---|---|---|---|---|
| F-OPS-R-1 | **Required** | **The daily follow-up sweep ran once per launch, not once per day.** `startAutomations()` called `automationSweep()` at boot and nothing rescheduled it. On a Mac an owner shuts the lid rather than quitting, so a Helix left open for a fortnight swept for overdue invoices on the first morning and never again — while Settings went on calling it the daily follow-up and the rule's own description promised a task when an invoice goes past its due date. | `65093df`: the same 24-hour beat `purgeSweep` already uses, with its three rules inherited — never fatal, never competes for the write lock, never overlaps itself. | `tests/unit/data/automationSweepTimer.test.ts`, 7 passed: runs again a day later with no relaunch, does not run twice a day, skips while paused and returns in a minute, survives throwing, one listener and one timer however often it is started, stops when told. |
| F-OPS-R-2 | **Required** | **The sweep respected none of the background-job rules.** No `timersPaused()` check, so it could start during an import or a restore; no self-overlap guard; and its only error handling was a `try/catch` at the boot call site. | Same commit. It now skips while an import or a restore holds the write lock and looks again in a minute, rather than queueing a few hundred task inserts behind a 100k-row import. | Same test file. |
| F-OPS-R-3 | Verified, no fix needed | **F-OPS-12's fix holds under the new write paths.** Automations create ordinary tasks, and the sweep opens its own transaction, so "a rule fires while an import is running" stopped being hypothetical. The removed `txDepth` shortcut means it queues. | — | `tests/repo/data/automationQueuesBehindImport.test.ts`: the rule does not write until the import finishes, and its task **survives the import rolling back**. Before the F-OPS-12 fix that assertion is the one that would have failed, silently, in production. |
| F-OPS-R-4 | Follow-up | **`withTransaction`'s own comment overstates what a nested call now does.** It says such a caller "fails loudly at `raw.begin()` (TX_STATE from the pipe)". It does not: the inner call never reaches `raw.begin()`, because `acquire()` on a non-reentrant lock never resolves. It deadlocks, and the only thing that says so is the 10-second "has waited 10s behind another write" console warning. | Not fixed: `src/db/writeLock.ts` is not this pass's to edit. Either correct the comment or add a fail-fast re-entrancy check; the warning already exists, so correcting the comment is the honest minimum. | Reproduced while writing the test above — the case timed out at 30 s with the warning in stderr. The test was removed rather than kept, because pinning a deadlock costs 10 s of suite time; the reasoning is in that file's tail comment. |
| F-OPS-R-5 | Follow-up | **Restoring a backup NEWER than the running Helix copies it over the live database before discovering it cannot be opened.** `restoreFromBackup` copies, then reopens, then migrates — and the migrator refuses a newer schema (F-OPS-8). The workspace is then a file this build will not open, and the data it replaced is gone from that path. | Not built. A pre-copy version check means opening the backup while the live database is still open. Documented instead, in procedure 7: the `pre-restore` backup taken in step 2 is exactly the file that was there a moment earlier, which is why that step runs before the close. | Ordering read directly in `src/features/data/lib/backupsFs.ts`; the four-step order is pinned by `tests/unit/data/restorePruneGuard.test.ts`. |
| F-OPS-R-6 | Near-miss, resolved by Fable mid-pass | **`drizzle-kit generate` had produced `0010_vengeful_iron_lad.sql`, a duplicate of everything 0006–0009 do**, and the journal listed it at idx 10. Applying the chain on a fresh workspace would have failed at `CREATE TABLE payments` — no workspace could be created or opened. It was gone from the journal by the time I re-read it. | None needed; recorded because the sequence that produced it will recur: the snapshots for 0006–0008 were missing, so drizzle-kit diffed `src/db/schema.ts` against `0005_snapshot.json` and re-emitted the whole chain. | Nothing would have shipped: `tests/repo/migrations.test.ts`'s "applies every journal entry once" builds a workspace through the real migrator, so a duplicated `CREATE TABLE` fails that test and every repo test behind it. CI was the guard and it worked. Only `0009_snapshot.json` exists now; the next `drizzle:generate` diffs against that. |
| F-OPS-R-7 | Follow-up | **The Schedule feed has two unranged reads.** `listInvoices` and `listInvoiceSchedules` take no range and are filtered in JavaScript, so the cost grows with the workspace's total invoices rather than with the window asked for. | Not changed. The bound, stated: at 2,500 invoices a month of Schedule costs 5.6 ms. It would need roughly 250,000 invoices to reach half a second, which is two orders of magnitude past a solo trade business. | `tests/repo/perf/scale.test.ts`, measured on the 20k/5k/10k dataset. |

## Recheck items

**(1) Migrations 0006–0009.** Forward apply on a populated 0005 workspace, the
backfill's one-payment-per-paid-invoice result, and 0007's `tasks.source`
backfill are all already proven by Lead A's and Lead B's own tests, so this
pass covered only what neither is about. New file
`tests/repo/migrationsPxRecheck.test.ts`, 5 passed:

- the chain applies once on a populated workspace, and a second `migrate()` —
  which is what every morning's launch does — applies nothing and leaves the
  payment and automation counts unchanged. The backfill is an `INSERT … SELECT`
  with no guard of its own, so `schema_migrations` is the thing that stops it
  doubling the owner's Collected figure, and that is what is now asserted;
- 0008's three seeded rules survive a deliberate replay of just that file's
  INSERTs, which is the shape of thing that gets done during a support call;
- the newer-schema refusal, rechecked against the real scenario rather than a
  fabricated tag: a v0.1.0 build whose journal stops at 0005, opening a
  workspace this build took to 0009. It names all four versions, and "your data
  has not been changed" is asserted rather than assumed;
- transaction safety: `migrations.test.ts` walks the journal dynamically, which
  is right and also means its coverage of the new chain is invisible. The four
  tags are now named out loud and their statements checked against both the
  implicit-commit pattern and the allow-list.

**(2) The automation sweep.** F-OPS-R-1, R-2 and R-3 above. One thing worth
stating plainly because the packet assumed otherwise: the sweep was not
registered beside the purge sweep as a timer. It was a single call at boot.
It is a timer now.

**(3) Backup and restore with the new tables.** A backup taken before 0006 and
restored into the current app is migrated forward during the restore —
`openWorkspace` runs the migrator on the restored file exactly as at launch —
so the payments backfill runs then, and every money figure reads the same
afterwards as it did before. That is the same code path
`migrationsPxRecheck.test.ts`'s first case exercises. A backup taken after 0009
restores unremarkably. The recovery-key adoption path is unaffected: it checks
only for `schema_migrations` or `contacts`, both of which predate this chain,
and `cargo test --test recovery_tests` is still 9 passed. The one new hazard is
F-OPS-R-5.

**(4) Performance.** The 20k/5k/10k dataset now also carries a payment per
already-paid invoice, a third of its tasks as timed visits, and a source on
most deals — otherwise the new screens would have been measured against empty
tables. On the same run:

| Query | ms | budget |
|---|---|---|
| Schedule, one week | 5.2 | 400 |
| Schedule, one month | 5.6 | 600 |
| Payments: one customer's statement | 0.2 | 300 |
| Reports: leads by source | 0.7 | 400 |
| Reports: revenue (now joining payments) | 15.2 | 800 |
| Receivables aging (now joining payments) | 1.1 | 300 |
| Reports: overview | 10.1 | 500 |
| Contacts, deep page | 35.4 | 200 |

The payments join costs the money reports about a third more than before
(revenue 10.9 → 15.2 ms, aging 0.7 → 1.1 ms) and they remain an order of
magnitude inside budget. The file also prints its measurements as one line
instead of `console.table`, which the default reporter swallowed — the numbers
it exists to produce were invisible unless it was run by hand.

**(5) Operations documentation.** `docs/OPERATIONS.md` gains procedures 11–13:
a payment recorded in error (correct, remove with a ten-second Undo, or Mark
unpaid; every figure is a sum over the payments table so nothing lags), an
automation firing unexpectedly (delete the task, switch the rule off, plus what
will *not* happen — an import never fires a rule, and no rule fires twice for
the same subject), and the Schedule's calendar export (one-way, forever, and
re-exporting replaces rather than duplicates). Procedure 7 gained the two
restore facts above. The founder-task inventory gains three rows: saying the
export is one-way at onboarding, checking the three automation rules suit the
client before handover, and the honest note that nothing tells Walker a
client's overdue sweep is not running. `tests/RELEASE-CHECKLIST.md` gains a
"Product-expansion screens" section holding only what a mocked Tauri layer
cannot answer — chiefly whether a real calendar application swallows the `.ics`
and replaces the entry on a second export.

## Verification

At `a2e05a2`, macOS, this machine. Walker's live workspace was never touched
and the installed app was never launched.

```
npm run typecheck                 clean, exit 0
npx vitest run                    226 passed | 1 skipped (227 files)
                                  2765 passed | 3 skipped | 0 failed
cd src-tauri && cargo test        85 + 8 + 10 + 11 + 9 = 123 passed, 0 failed
npm run build                     built in 906ms, exit 0 (pre-existing
                                  chunking advisories only)
E2E_PORT=4270 E2E_OUT=dist-ops npm run e2e:mac -- \
  settings px-c-automation px-b-schedule px-a-payments data smoke
                                  49 passed (2.0m), 0 failed
```

`dist-ops` removed; nothing left running. Commits, all local: `e1bd17b`,
`65093df`, `a66d3e8` (mock typing), `4ac5331`, `a2e05a2`.

Two failures seen mid-pass were other agents' in-flight edits on a shared
branch, not mine, and both were gone by the final run: a `renderTemplate`
assertion while `src/db/repos/automations.ts` was open in another session, and
`importDoesNotAutomate` failing in a full run while passing alone. Recorded
because "I saw it red once" is worth writing down even when it is green now.

## Escalations

1. **F-OPS-R-4** needs one line changed in `src/db/writeLock.ts` — a comment
   that describes a loud failure the code does not produce. Not mine this pass.
2. **F-OPS-R-5** is a real trap with a documented way out. Building the guard
   means reading a backup's `schema_migrations` before copying it, which needs
   a Rust read-only open while the live database is still open. Worth doing
   before a client is ever told to downgrade; not before the first client.
3. **The drizzle snapshot chain** (F-OPS-R-6) is Fable's to close. Only
   `0009_snapshot.json` exists; 0006–0008 are absent. That is harmless to the
   migrator, which reads the journal and the `.sql` files, and it is exactly
   what caused the duplicate migration, so the next person to run
   `drizzle:generate` should check what it emits before committing it.
4. **`docs/ONBOARDING-CHECKLIST.md`** should carry the one-way-calendar
   sentence (founder-task 12). Not this pass's file.

## Handoff

Nothing running. All work committed locally; nothing pushed. The tree carries
other agents' uncommitted design screenshots, which are not mine and were left
alone.
