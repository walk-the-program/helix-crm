# 06. Operations, release and support

How Helix is operated today: cutting a release, putting it on a client's
machine, what to do when something breaks, how a paying ClearPath client relates
to the app, how support works with no telemetry, and the nine conditions Walker
owns for launch. This file summarises; the procedures themselves live in
`docs/OPERATIONS.md`, `docs/ONBOARDING-CHECKLIST.md` and
`tests/RELEASE-CHECKLIST.md`. Do not restate them elsewhere; point at them.

## What "production" means

There is no server. Each install is its own deployment: one owner, one machine,
one or more local SQLite workspaces, SQLCipher-encrypted with the key in the OS
keychain. "Production" is the installer a client downloads or that Walker installs
by hand. There is no auto-update and no update check. Helix is AGPL and free; it
carries no price, plan, trial or licence, and nothing in the app checks whether a
client has paid for anything.

Two outbound integrations exist, both opt-in: the client's own ClearPath website
(polled every 5 minutes while Helix is open, bearer token) and the Anthropic API
with the owner's own key, only on a button press. No telemetry, crash reporting,
analytics or update pings.

## Releasing

Workflows (`.github/workflows/`): `ci.yml` (jobs `js`, `e2e`, `rust` on macOS and
Windows, `rust-audit`), `e2e-win.yml` (real .exe on windows-latest, four smoke
assertions, not coverage), `release.yml` (on a `v*` tag; tauri-action builds macOS
arm64, macOS x86_64 and Windows; `releaseDraft: true`). Installers are unsigned;
no signing secrets exist anywhere.

To cut a release (`docs/OPERATIONS.md` "Cut and ship a release, end to end" plus
`tests/RELEASE-CHECKLIST.md` "Before you tag"):

1. Bump the version in the three manifests that must agree: `package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. Also the two lockfiles
   (`package-lock.json`, `src-tauri/Cargo.lock`), as in the 0.2.0 bump commit
   `941ca78`.
2. Turn `CHANGELOG.md`'s Unreleased section into the new version heading.
3. Confirm `main` is green at the commit to tag: `js`, `e2e`, `rust`, `rust-audit`
   (and `e2e-win`, or accept its absence knowingly).
4. Run `tests/RELEASE-CHECKLIST.md` by hand on a machine that has never run Helix,
   on macOS and, if a Windows client is coming, Windows.
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. This is the round's
   one push (the director pushes, per 08).
6. When all three legs finish, publish the draft on the GitHub Releases page.
   It does not publish itself; a forgotten draft means installers nobody can see.
7. Tell each affected client a new version exists. Nothing else will.

Every unsigned update repeats two prompts for the client: Gatekeeper (macOS:
right-click the app, Open) or SmartScreen (Windows: More info, Run anyway), and the
Keychain access prompt. The right answer to the Keychain prompt is **Always
Allow**; "Allow" re-prompts next launch and "Deny" lands on a boot screen
(procedure 9). Signing removes both, and is Walker's decision D-4 (07).

Effort per event (`launch-returns/rev.md` §3, the minutes are the lead's
judgement): each release 10 to 15 minutes per client plus 60 to 120 minutes for
the release run; install day 45 to 75; token rotation 10 to 20; one support
contact 10 to 30; offboarding 10 to 15.

## Install day

`docs/ONBOARDING-CHECKLIST.md` is the checklist Walker runs on a client's machine,
in person or on a screen share. In order:

- **Before arriving:** run CL-1 (generate the token, set `CRM_API_TOKEN` on the
  deployed site, redeploy, two `curl` checks) before install day, not during it.
  Have the installer on hand. Add a blank roster row.
- **Before Helix opens:** explain Gatekeeper/SmartScreen; they recur on every update.
- **First launch:** three setup screens (business name and trade; the trade's
  pipeline and price list; how customers come in). Keychain prompt on the first
  secret written: choose Always Allow.
- **The recovery key:** Today opens on a card that will not go away until the key is
  revealed and copied, saved or printed. Stay for it. Print is best for a client who
  is not comfortable with computers; the key is only useful if kept somewhere other
  than the same laptop.
- **Backups:** choose a second backup folder in Settings, Backups (an iCloud Drive,
  Dropbox or OneDrive folder is fine); confirm Diagnostics shows a "Last backup" time.
  This has no in-app prompt yet.
- **Site token:** paste address and token into Settings, Website, in person, press
  Test connection.
- **CSV import** if they have one: walk the column mapping, pick a duplicate rule.
- **Automations:** read the three rules out; two ship on (call an hour after a
  website lead; follow-up three days after a quote), overdue-invoice nudge is off.
  Importing a spreadsheet fires none of them.
- **Schedule:** book one real visit; say the calendar export is one-way.
- **Before leaving:** confirm the Website banner is clean, update the roster row with
  the version actually running, tell them what support looks like.

## The thirteen procedures (`docs/OPERATIONS.md`)

Mark is the file's own: tested, inspected only, or needs access.

| # | Procedure | One line | Mark |
| --- | --- | --- | --- |
| 1 | A release build fails or ships broken | Reinstall the previous installer over the app; workspace files are untouched; an older build refuses a newer schema. | needs access (the real reinstall); the migrations it depends on are tested |
| 2 | A migration partially completes | Each file is one batch with a pre-migration backup; restore that backup, wait for a fixed release, never hand-edit `schema_migrations`. | tested |
| 3 | The client's website is down or the token rotated | 401/403 stops the timer until a new token is saved; outages retry with backoff on their own. | tested (state machine and thresholds) |
| 4 | Anthropic is down or the key revoked | Not Helix's fault; the owner pastes a new key; Helix never holds a copy. | tested |
| 5 | The lead poller applies a lead twice | It cannot: `external_id` is `<origin>:<lead id>`, checked, plus a partial UNIQUE index. A real duplicate is a bug report. | tested |
| 6 | A client imports bad data | No per-import undo; the pre-import backup named on the result screen is the answer. | tested |
| 7 | Restore from a backup | Settings, Backups; a pre-restore backup is taken first; confirm the date with the owner. | tested, except clicking Restore in a real window (needs access) |
| 8 | The laptop dies | Recovery key plus a backup file, or a second-copy folder, opens the workspace on a new machine; without the key a backup is ciphertext. | tested |
| 9 | The keychain prompt was denied | Boot screen names the real cause; relaunch and choose Always Allow. | tested |
| 10 | helix.log is needed by support | Settings, Diagnostics, Copy log; contents below. | inspected only |
| 11 | A payment was recorded in error | Owner self-serve; the payment is soft-deleted, so Trash for 30 days, then the backup. | tested |
| 12 | An automation fired when it should not have | One switch per rule in Settings, Automations; no rebuild. | tested |
| 13 | The Schedule and what a calendar export does not do | The .ics is one-way; say so once at onboarding. | inspected only |

The file's preamble says procedures 11 to 13 were added by product expansion. The
launch record described "ten incident procedures (7 tested, 1 inspected only, 1
needs Walker's machine, 1 mixed)" before 11 to 13 existed; the table above is the
current marks.

## The commercial lifecycle (CL-1 to CL-7)

Helix has no entitlement. The only link between a paying ClearPath website client
and Helix is the `CRM_API_TOKEN` on the client's site, which the client pastes into
Settings, Website. So the lifecycle is the lifecycle of one string. Both directions
are safe: "billing changed but access did not" cannot happen because nothing is
unlocked or expires, and no ClearPath action (rotating the token, taking the site
down) can lose a client's data, which lives in a file on their own machine with a key
in their own keychain. This is proved in `tests/repo/leads/lifecycle.test.ts`, not
just asserted.

| # | Procedure | Mark |
| --- | --- | --- |
| CL-1 | Issue a token and hand it over. Best is in person, straight from the site's settings to the Helix screen so it travels nowhere else. | needs access |
| CL-2 | Rotate a token (10 to 20 minutes). | tested (Helix half) |
| CL-3 | The site is deployed but no leads arrive; four cases, A to D. | tested |
| CL-4 | The website changes address; two choices, "same website at a new address" carries the cursor forward. | tested |
| CL-5 | Offboarding: rotate or remove the token; the client keeps Helix and every record. | tested (Helix half) |
| CL-6 | The client roster. | inspected only (no roster exists yet; no client yet) |
| CL-7 | How Walker learns a client's Helix is broken: he does not; see below. | no mark |

The roster (`docs/CLIENT-ROSTER-TEMPLATE.md`) is blank in the repo. Copy it out
before filling it in, because the repo is public. Recommended home:
`/Users/walker_tracy/Desktop/ClearPath Sites/HELIX-CLIENT-ROSTER.md`. Never in it:
the token value, a recovery key, the client's Anthropic key, any client CRM data.
Update "Helix version" only when the client confirms they installed it.

Website pricing is unsettled (07, D-1). What the record has: about $1,000 build with
hosting unpriced; earlier $500 plus $75 to $100 a month; a $250 a month AI cohort
(`ClearPath Sites/FOR-THE-NEXT-AGENT.md`, 2026-09-16). Do not put a price in the repo.

## Support model

There is none in the product, by design. No telemetry, no crash reporting, no
update ping, no error channel. The honest sequence (CL-7):

1. The client notices. Today shows one quiet line when lead collection has stopped.
2. The client calls or emails. Help says "Helix has no support team watching in the
   background." "Report an issue on GitHub" is in Help.
3. Walker asks two questions first: what does the banner on Settings, Website say,
   and what does "Last result" say. They identify the state and the fix.
4. If more is needed: Settings, Diagnostics, **Copy details** (a paste-ready block
   with version, OS, workspace id, encryption state, last backup, website state) and
   **Copy log**, pasted into an email.
5. Walker checks in periodically; the roster's "Last contact" column makes it a habit.

Do not add telemetry to fix this. It is the product's central promise (CL-7).

`helix.log`: macOS `~/Library/Application Support/com.clearpathdigital.helix/logs/helix.log`,
Windows `%APPDATA%\com.clearpathdigital.helix\logs\helix.log`. Rotation keeps 7 files
of at most 4 MB, older swept on launch. It records app starts, backups, website
checks (with the site's address) and errors. It does not contain the site token, the
site's response body on an authentication failure (F-SEC-6), or any customer name,
phone, email or message. A non-auth failure keeps a 200-character token-redacted
snippet in `lead_sync.last_error`, visible in Settings, Website, not in the log file.

Founder tasks that only happen if Walker remembers (OPERATIONS inventory, 14 rows):
version sync, tag, publish the draft, tell clients, token rotation, run the checklist
on both OSes, watch CI go red (there is no branch protection and no PR gate, per his
own instruction), confirm a client's backups ran, the unsigned-install cost, the
one-way calendar note, and checking the automation rules suit the client.

## The nine launch conditions (verdict: Ready with specific operating conditions)

From `launch-returns/la.md` VERDICT. All owned by Walker; none is a defect; each is
the edge of what a mocked harness can prove.

| # | Condition | Owner | Status at v0.2.0 |
| --- | --- | --- | --- |
| C1 | Real app on a never-run Mac: right-click Open, Keychain Always Allow (`RELEASE-CHECKLIST` "First launch", "Keychain and secrets") | Walker | open |
| C2 | Recovery-key Copy and Print on a real webview (the harness cannot prove either) | Walker | open |
| C3 | Windows is smoke-tested only; nothing built this round has run there. Onboard Mac clients first or run the Windows section by hand | Walker | open |
| C4 | The new CI `e2e` job must be green before tagging | Walker | cleared: green on `2e035c6` before `v0.2.0` |
| C5 | Second backup folder is an install-day step with no in-app prompt | Walker | open, every install |
| C6 | Installers are unsigned; the warnings and keychain re-prompt recur | Walker | open; decision D-4 |
| C7 | Do not reopen a removed workspace; it silently creates an empty one (F-LA-7, deferred) | Walker | open |
| C8 | Token hand-over by hand, per CL-1, before install day | Walker | open, every client |
| C9 | Keep the client roster; there is no telemetry | Walker | open |

## Conflicts and stale lines to know about

| Where | Says | Reality |
| --- | --- | --- |
| `OPERATIONS.md` inventory item 1 | all three versions read `0.1.0` "at this revision" | they read `0.2.0` |
| `OPERATIONS.md` "Cut and ship" step 2 | `main` green means `js`, `rust`, `rust-audit` | the `e2e` job is also required (`RELEASE-CHECKLIST`, F-LA-1) |
| `OPERATIONS.md` inventory item 7 | `ci.yml` uploads nothing | the `e2e` job uploads on failure only, retention 7 days (`e2e-win.yml`: failure only, 3 days) |
| `RELEASE-CHECKLIST` "Before you tag" | the `e2e` job "has not happened yet" | it ran and passed on `2e035c6` |
| `ONBOARDING-CHECKLIST` backups step | second folder "not implemented at this revision" as an inline prompt | still true; it stays a manual install-day step (C5) |

---

Verified against: `docs/OPERATIONS.md` (procedure headings and `**Mark` lines at
lines 91 to 1166; CL-1 to CL-7; founder-task inventory; "Cut and ship");
`docs/ONBOARDING-CHECKLIST.md`; `docs/CLIENT-ROSTER-TEMPLATE.md`;
`tests/RELEASE-CHECKLIST.md` lines 28 to 100; `.github/workflows/*.yml`;
`docs/rounds/launch-returns/la.md` VERDICT; `launch-returns/rev.md` §3 to §4;
`docs/rounds/2026-09-20-launch-readiness-record.md` §1.1, §6; `git show --stat 941ca78`;
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (all `0.2.0`);
at `2e9fb04`, 2026-09-28.
