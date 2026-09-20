# LR-CS return — Chief Customer Success Officer

TASK: LR-CS (parent: Fable coordinator) · ATTEMPT 1 · PACKET REV 1
STATUS: **submitted**
Base revision: `4d23656`. Revision this return describes and was verified at: `c37b955`.
32 commits, 53 files, +6,810 / −197. All local on `main`; nothing pushed.
Team: this Opus lead + 3 Sonnet workers (W1 the recovery key and Today's states; W2 the
imperfect import and the sample data; W3 the error strings, Help reachability, Diagnostics
and the two checklists). Every worker diff was read against its packet before acceptance;
two were corrected by the lead and one worker escalation was resolved with a scoped grant.

---

## 0. What this phase had to prove

Not that Helix works, and not that it is safe or recoverable — the three phases before this
one settled those. This phase had to answer a narrower and more awkward question: **can a
landscaper who has never seen this app get his own customers into it, understand what he is
looking at afterwards, recover from his own mistake, and get help — without Walker in the
room?**

The way to find out was not to read the code. It was to install it, badly, with a real
vendor export, and write down every place the product assumed something the owner had no
way to know. That is what `tests/e2e-mac/specs/csWalk.e2e.ts` does, and it is committed so
the measurement can be repeated rather than remembered.

Two things came out of that walk that no amount of code reading had found in four phases.
The first is that **an owner who did exactly what the product asked — import your
customers — was then told by the very next screen that there was nothing there and he
should import his customers.** The second is that **nothing in first run ever mentioned the
recovery key**, which quietly made the largest fix of the reliability phase optional.

---

## 1. The first meaningful outcome, defined

Fable proposed: *"a new owner has their real customers in Helix, sees a new lead from their
website (or an imported contact) on Today, and moves one job to the next stage or sends one
quote."* That is close, and it is one clause too generous. "Sends one quote" and "moves one
job" are not equivalent: a quote needs a priced service catalogue, and the trade presets
supply one, but a first-day owner has not decided his prices yet. Moving a job is the
smaller, truer act — it is the moment the CRM stops being a list and starts being a
pipeline.

The definition this phase measured against, and the one the walk asserts:

> **The owner's own customers are in Helix, Today is telling him something true about them,
> and he has moved one job to the next stage.**

The middle clause is the one that matters and the one Fable's wording left implicit. Rows in
a table are not an outcome. An owner who imports 52 customers and then sees a screen that
says "Nothing here yet" has not reached anything, however many rows the database holds — and
that is precisely the state this product shipped in at `4d23656`.

---

## 2. Measurement, before and after

Both runs are the same spec against a fresh workspace, importing
`tests/fixtures/hubspot-contacts.csv` (52 synthetic rows: mixed phone formats, blank cells,
embedded commas, escaped quotes, one non-ASCII name). The **before** run was taken in an
isolated copy of `4d23656` extracted with `git archive`, so three workers committing into
the shared checkout could not contaminate it. Artefacts:
`tests/e2e-mac/.cache/screens/cs/before/` and `tests/e2e-mac/.cache/screens/cs/`
(git-ignored, 30 files each: screenshots, `walk.md`, `walk.json`, and the captured text of
the mapping table, the import result, Today, Help and Diagnostics).

| | before (`4d23656`) | after (`c37b955`) |
|---|---|---|
| **Actions to the first meaningful outcome** | 18 | **21** |
| Screens crossed to it | 6 | 6 |
| Actions for the whole ten-leg walk | 29 | 32 |
| Frictions the walk recorded | **6** | **3** |
| Page errors / console errors | none | none |

**The outcome got three actions longer, deliberately.** Those three are Show recovery key →
Save to a file → I have saved it. That is the entire cost of LR-6, and it buys the only
route back from a dead laptop. Every other leg either stayed the same or lost friction; no
step was added anywhere else, and none was removed by hiding work rather than finishing it.

"Machine seconds" in `walk.md` (4s to the outcome, 10s for the walk) are not human minutes
and are not quoted as such — they measure the app, not the owner. Against them, `rev.md`
§3's install-day estimate of **45–75 minutes** still stands as the number for Walker's
planning, and this phase did not move it: the minutes are spent on the download, Gatekeeper,
the Keychain prompt, the conversation, and the client reading the screen — not on the app
being slow. The three new actions are worth perhaps a minute of that, and the removed
confusions are worth more than a minute of support call each.

---

## 3. The walk, leg by leg

**1. First launch → "Your business."** Six actions: business name, owner name, email, phone,
trade tile, Continue. Before any of it, the owner has already had to right-click → Open past
Gatekeeper and allow a Keychain prompt, and the product says nothing about either. That is
F-CS-17, and it is a purchase (D-4), not a code change. It is now the first two lines of
`docs/ONBOARDING-CHECKLIST.md`.

**2. "How you'll track work."** One action. The landscaping preset's stages, sources, fields
and price list are already filled in and correct; the owner reads and presses Use this setup.
Nothing to fix here, and it is the best screen in the flow.

**3. "Bring your customers in."** One action. Four equal cards, no primary — correct, and
DESIGN.md §5 explicitly allows zero.

**4. The import.** Three actions: Choose a file, Continue, Import. 52 created, 46 companies,
0 skipped, in 0.1s. The mapper got First/Last/Email/Phone/Mobile/Company/City/State/Postal/
Country/Source right and skipped Record ID, Job Title, Contact owner, Lead Status, Create
Date, Last Activity Date and Website URL — every one of those defensibly. The result screen
already named the pre-import backup; it now also has a button to reach it (F-CS-8).

**5. Today.** *Before:* "Nothing here yet, and that is the right place to start", and the
three starter cards, the first of which is "Import a spreadsheet / Import a CSV". Fifty-two
customers in the file. This is F-CS-1 and it is the worst thing the walk found — not because
anything is broken, but because the product contradicts the owner about work he has just
done. *After:* a third screen state that says the customers are in and names what actually
fills Today next.

**5b (new). The recovery key.** Three actions. The card is above everything, does not
dismiss, and the confirm button stays disabled until the key has been revealed *and* copied,
saved or printed. This is LR-6 shipped.

**6. First job, and moving it a stage.** Six actions. Saving a new job from the board lands
on the job's own page rather than back on the board, so the stage move is a picker there
rather than the drag the board teaches. Recorded as F-CS-15, Follow-up: it is arguably right
(you have just made a job and will want to fill it in), it is documented in Help, and
changing it is a navigation decision that belongs with whoever owns the board.

**7. Quit and reopen.** One action, everything where it was left.

**8. A mistake, and the way back.** Six actions: open a contact, Delete, confirm, Trash,
Restore, and it is back. This works, it is obvious, and the toast offers Undo before Trash is
even needed. Nothing to fix.

**9. Export everything.** Two actions, but only because the walk knew the route. Export is
not in the sidebar — it is Settings → Export, or the command palette. Recorded as F-CS-16,
Follow-up: `settings/lib/sections.ts` puts it there deliberately, Help names it, and moving a
nav item is a CONTRACTS-adjacent decision, not a bug fix. Worth revisiting the day a client
asks how to get their data out.

**10. Help and Diagnostics.** *Before:* Help said nothing about marking an invoice paid and
nothing about the recovery key, and Diagnostics had no single copyable block — so Walker's
opening line on a support call was "read me the rows on this screen". *After:* both closed.

---

## 4. Findings

Class: **Blocker** (exposing a real client would create an unacceptable failure, access, data
or core-workflow risk) · **Required** (required before paid onboarding) · **Follow-up**
(useful, not needed for the first launch).

| # | class | finding | why that class | fix | evidence |
|---|---|---|---|---|---|
| **F-CS-2** | **Blocker** | **The recovery key was never surfaced in first run.** It existed only in Settings → Backups, behind a screen a trade owner has no reason to open. LR-6, carried from OPS §9 and restated by REV as F-REV-14. | This is not a new hazard, it is the discovery that the reliability phase's largest fix was optional in practice. F-OPS-1 established that a dead, stolen or wiped laptop takes every backup with it unless the owner holds the key. A fix nobody is shown is not a fix, and the failure it guards against is total and permanent. | `29aa353`, `93cefac`, `93de4f4`, `0fb6131`, `7dc0a9a`: a persistent card above everything on Today, in every workspace state, that will not go away until the owner reveals the key and copies, saves or prints it. Reveal/display/copy/save/print are one shared component with Settings → Backups, so there is one set of words and one set of logic; keeping a copy from *either* door satisfies it. No fourth onboarding screen, no wizard, no dismiss, no snooze, and nothing after. | `tests/unit/today/recoveryKeyCardGate.test.ts`; `tests/unit/today/recoveryKeyCard.test.tsx`; `tests/e2e-mac/specs/onboarding.e2e.ts` (both the completed and the skipped path, confirm-then-reload, and the one-primary-block rule); the walk's leg 5b. |
| **F-CS-1** | **Required** | **Today told an owner who had just imported 52 customers that there was nothing there, and offered to import his customers.** `useTodayIsUnstarted` reports "unstarted" until a task, an open job or a logged activity exists — none of which a contacts import creates. | The first screen after the single most important onboarding action, contradicting the owner about work he just did. The reasonable reading is that the import failed, and the likely next move is to import the file again. It is Required rather than Blocker because no data is at risk and the records really are there. | `176ba70`, `2132c63`: a third state. Empty stays exactly as it was; records-with-nothing-due says the customers are in and names what fills Today next (open a job, set a follow-up, log a call); active is unchanged. The rule itself — CPO F-LA-6, that one saved contact must not blank the screen — is untouched; it was the copy and the card set that were wrong, not the rule. | `tests/unit/today/todayScreenState.test.ts` (all four combinations); `a2b272c` rewrites the F-LA-6 regression to assert the invariant (guidance, not empty panels; work retires the guidance) instead of a heading string, which is stricter than what it replaced. Walk leg 5, before and after. |
| **F-CS-3** | Required | **The mapper sent "Customer Name" and "Co." to Skip.** Found by running a 3,000-row file through the real guesser, not by reading the rule list. | "Customer Name" is one of the commonest full-name headers a hand-kept spreadsheet uses, and a column silently on Skip is data the owner believes he imported and did not. | `c293ec8`. | `tests/repo/data/messyImport.test.ts`. |
| **F-CS-4** | Required | **The contacts import threw away the warnings on rows it accepted** — `warnings` was hard-coded to `[]`. On the 3,000-row file that hid 60 "this row has no name" and one unusable phone number. | The rows landed, so nothing looked wrong; the owner learns months later that sixty contacts have no name on them. An import that quietly drops what it noticed is worse than one that refuses. | `a87d154`. | `tests/repo/data/messyImport.test.ts`, 14 tests. |
| **F-CS-5** | Required | **The preview said "The first 20 of 20 rows" for a 2,997-row file.** It read the row count from a parse that was limited to 20, which is `min(total, 20)` by definition. | The one number on the screen that tells the owner whether Helix is reading his whole file was structurally incapable of being anything but 20. | `5c1f86c` (walks the file with no limit, keeps 20 rows in memory). | `tests/repo/data/messyImport.test.ts`; `tests/e2e-mac/specs/data.e2e.ts`. |
| **F-CS-6** | Required | **A sample job is indistinguishable from a real one on the jobs board.** Every sample row carries the Sample tag and the contacts list shows tags, but a board card is four things and no more (DESIGN.md §3), so a made-up job sits there with a real-looking customer, price and next step. | An owner can work a fake job, and the one screen where he decides what to do today is the screen that does not say which jobs Helix invented. Found by W2, escalated because DealCard was outside its ownership. | `2948af1`: mark the screen, not the card. Today's sample-data note moved into the onboarding feature beside the button it pairs with, and the board mounts the same one. It draws nothing when the example set is absent, and goes the moment the example does. | `tests/e2e-mac/specs/onboarding.e2e.ts` asserts it in both directions — present with the example, gone after "Remove sample data". |
| **F-CS-7** | Required | **"Remove sample data" never purged the `change_log` rows naming sample ids.** | The owner is told his own records stay and the example goes. Rows naming deleted sample entities are exactly the orphans the D4 check exists to catch. | `69c1c2c`. | `tests/repo/onboarding/sampleDataRemoval.test.ts`, 198 lines: proves contacts, companies, deals, activities, notes, tasks, reminders, documents, attachments, tags, sources, the FTS index and the change log all clear, and that stages, custom fields and the owner's own records survive. |
| **F-CS-8** | Required | **The result screen named the pre-import backup in a sentence and gave no way to reach it.** Restoring it is the only undo an import has (OPS F-OPS-4). | An undo the owner has to go and find on his own, at the moment he has just realised he imported the wrong file. | `5c1f86c`: a card with a "Go to Backups" button. | `tests/e2e-mac/specs/data.e2e.ts`. |
| **F-CS-9** | Required | **Diagnostics had no single copyable support block**, and never showed the workspace id at all. Walker's opening line on a call was "read me the rows on this screen", or "copy the whole log file". | Support entry is one phone call and one screen. The information needed to investigate existed and could not be handed over in one action. | `847bd6f`: a "Copy details" action producing one plain-text block — version, OS, workspace id, encryption state (workspace file and disk, keeping the existing Unknown-vs-off distinction), last backup, site connection state and last error. | `tests/unit/settings/supportBlock.test.ts`, 213 lines, including the absence of any customer record, token or key against a *populated* workspace; `tests/e2e-mac/specs/settings.e2e.ts`. |
| **F-CS-10** | Required | **Help had no section about quotes or invoices at all.** "Make a first quote" and "mark an invoice paid" — two of the seven essential workflows — were undocumented anywhere in the product. | The revenue feature ships and the product never explains it. A client who cannot work out how to mark an invoice paid phones Walker. | `f43dc75`: `HELP_INVOICES`, written from `src/features/invoices/**` with exact route paths and button labels, exported separately so the "exactly six sections" contract on `HELP_SECTIONS` still holds rather than being weakened. | `tests/unit/help/content.test.ts`. |
| **F-CS-11** | Required | **Help was reachable only from Help.** Every essential workflow was documented in a place the owner had to already know to look for. | The owner needs the answer where he is stuck, not in a manual. This is the difference between documentation and help. | `f43dc75`, `847bd6f`, `8dc9689`: `HelpLink`, one inline link to a real section id, mounted on the Contacts empty state (import), the poll-failure banner (the website), the Invoices empty states (first quote, mark paid) and the Diagnostics "no backup yet" row (backups and the key). Lead added the workspace-removal link and the import-failure link (`692d9b3`). No tour, no wizard, no coach-mark. | C2 in W3's return; `tests/e2e-mac/specs/settings.e2e.ts`. |
| **F-CS-12** | Required | **"[object Object]" in eight more places.** Tauri rejects a command with a plain `{code, message}` object, not an `Error`, so `err instanceof Error ? err.message : String(err)` shows the owner that literal string: the site-connection save, disconnect and fetch fallback; the attachment refusal; Diagnostics' database reason; and creating, switching and archiving a workspace. Renaming a workspace had no `catch` at all — a failure left the dialog open with the old name still listed, which reads as the click having missed. | This is the fifth separate discovery of one bug (F-LB-6 in the poller, F-OPS-3 in the backup banner, and three more here), on the failures that matter most: a refused keychain, a full disk, a website that would not answer. Switching a workspace is the frightening one — the message arrives at the moment the owner thinks his customer list has gone somewhere. | `f0a5069`, `17353f4`, `847bd6f`, `692d9b3`. `85dab08` then removed the cause of the recurrence: one `messageFrom` in `src/lib/errors.ts`, imported by all five former copies, so the next screen inherits the fix rather than rediscovering the bug. Every new message says what happened *and* what is still safe — "the workspace you were in is still open, so nothing is lost". | Full suite green after the consolidation; W3's inventory below. |
| **F-CS-13** | Required | **The boot and crash screens said "send us the detail" and gave no way to send anything.** | The one screen an owner reaches when the app will not start, telling him to do something the screen does not let him do. | `8dc9689`. | W3's C2. |
| **F-CS-14** | Required | **`tests/RELEASE-CHECKLIST.md` described a first launch that has never shipped** — "an empty Today screen with three starter cards … no setup wizard" (F-REV-13). | A document Walker runs by hand on release day, stating the opposite of what the product does. Whoever runs it either stops, or ticks a box they did not check. | `0d4b735`, then `d29b9da`: the whole first-launch section rewritten against `gate.ts` and `OnboardingFlow.tsx`, including the recovery-key card and the three Today states. | Quoted old and new in W3's C6. |
| F-CS-15 | Follow-up | Saving a new job from the board opens the job's own page rather than returning to the board, so the stage move is a picker there rather than the drag the board teaches. | Arguably correct — a job you have just created is a job you want to fill in — and Help documents both the drag and shift+arrow. Changing it is a navigation decision for whoever owns the board, not a fix. | — | Walk leg 6. |
| F-CS-16 | Follow-up | Export is not in the sidebar. The only routes are Settings → Export and the command palette. | `settings/lib/sections.ts` places it there deliberately and Help names it. Moving a nav item is a CONTRACTS-adjacent decision. Worth revisiting the first time a client asks how to get their data out. | — | Walk leg 9. |
| F-CS-17 | Follow-up | Gatekeeper / SmartScreen, and the Keychain prompt returning on every update. | Bought, not coded: D-4, already escalated by SEC and REV. Now the first two lines of the install-day checklist so it is at least never a surprise. | — | `docs/ONBOARDING-CHECKLIST.md`. |
| F-CS-18 | Follow-up | The duplicate preflight is contacts-only, and the contacts import path now reads the file two to three times. | Measured, not theorised: 3,000 rows still import in well under a second. Extending the preflight to companies and deals is real work for a screen those imports reach less often. | — | W2's deviations. |
| F-CS-19 | Follow-up | Nothing tells a client a new version exists. | D-5, Walker's decision, unchanged by this phase. It is a line in the install-day checklist under what still needs Walker. | — | `rev.md` §4 D-5. |
| F-CS-20 | Follow-up | **Copy** and **Print** on the recovery-key card cannot be proved by the mocked suite: the harness browser refuses `navigator.clipboard.writeText` without a permission grant, and a refused copy correctly does not satisfy the card. | Not a defect — the correct behaviour is what blocks the test. Save to a file is covered by tests; the other two are now two named hand checks on the real build. | `d29b9da`. | `tests/RELEASE-CHECKLIST.md`. |

### What does not apply, recorded rather than built

Invitations, teammates, roles, safe support access with permissions, and account closure.
Helix is one owner on one machine: there is no second person to invite, no role to scope, and
no account to close. "Leaving" is Export plus the documented workspace-removal procedure
(Help, `HELP_WORKSPACE_REMOVAL`), which archives, then has the owner delete the folder
Diagnostics names, and says plainly that the keychain entry may outlive it. Nothing was built
to satisfy any of these, per decision LR-2.

---

## 5. Imperfect import: the fixture and what it actually did

`tests/fixtures/messy-3000.csv` (committed) and its deterministic generator
`tests/fixtures/gen-messy-3000.mjs` (committed). Entirely synthetic: invented names,
`.example` domains, 555 numbers. It carries a UTF-8 BOM and CRLF throughout, headers a person
would write rather than a vendor ("Customer Name", "Cell", "E-mail Address", "Co.",
"Notes/Comments"), one "First Last" column instead of a split, phones with letters and
extensions, emails with spaces and mixed case, exact and near-duplicate rows, a row with only
a company, empty rows and comma-only rows, `$1,200.00`-style currency, three date formats in
one column, embedded commas, escaped quotes and a non-ASCII name.

Through the real import code (`tests/repo/data/messyImport.test.ts`, 14 tests) and the mocked
UI (`tests/e2e-mac/specs/data.e2e.ts`):

- **3,000 rows** in the file; **2,997** reach the importer (3 comma-only rows are absorbed as
  blank lines, which is right).
- **2,991 created. 6 skipped**, every one of them an email duplicate, named as such.
- **61 warnings** on rows that were accepted: 60 "no name", and one
  `"801.555.CALL" is not a phone number Helix can dial. It will be saved exactly as typed.`
  **Before F-CS-4 the owner saw none of these.**
- 4 of the 5 ragged phone formats normalise to E.164; the fifth is the one warned about.
- The pre-import backup was taken and verified on disk, and restoring it is one click from
  the result screen.

**Templates.** "Download an example" covers all four import types — contacts, companies,
deals and services — and each generated file now round-trips through the real importer with
nothing on Skip and every row accepted, asserted rather than assumed (`620474a`,
`tests/repo/data/importExamples.test.ts`).

---

## 6. Error strings changed

W3 enumerated rather than sampled: 85 `toast.error`/`toast.warning`, 17 `role="alert"`,
`EmptyState` across 34 files, 17 `throw new Error(`, 44 `reason:` fields, plus the boot and
crash screens. The great majority were already good and were deliberately left alone — the
SEC, OPS and REV phases did this work on their own surfaces and their wording is better than
a rewrite would be.

| where | before | after |
|---|---|---|
| `SiteConnectionScreen` save | `[object Object]` on any rejected command | the real message, with what to do next |
| `SiteConnectionScreen` disconnect | same | same |
| `SiteConnectionScreen` fetch fallback | same | same |
| `AttachmentList` oversized/refused file | same | names the file and the limit |
| `diagnostics.ts` `reason()` | same, as the database-size "reason" | the real message |
| `WorkspacesScreen` create | `String(err)` | "Helix could not create that workspace. Nothing changed, and the workspace you were in is still open." |
| `WorkspacesScreen` switch | `String(err)` | "Helix could not open *name*. The workspace you were in is still open, so nothing is lost. Try again, and if it keeps failing, check Diagnostics for where that file is." |
| `WorkspacesScreen` rename | **nothing at all** | "Helix could not rename that workspace. Its records are untouched; try again." |
| `WorkspacesScreen` archive | `String(err)` | "Helix could not archive *name*. Nothing was removed and nothing was deleted; try again." |
| `WorkspacePicker` switch | `String(err)` | as the switch message above |
| `WorkspacesScreen` removal note | named a Help section in prose | links to it |
| `ImportScreen` parse failure | no route to Help | "What Helix expects a file to look like" |
| import mapping, nothing to file | said what was wrong | says what to do about it |
| `ResultStep` backup notice | one sentence, no route | a card with "Go to Backups" |
| `PreviewStep` duplicates | the policy with no context | how many rows it actually affects |
| boot / crash screens | "send us the detail", no way to | a way to report it |

---

## 7. Independence after onboarding, and what still needs Walker

**A client can run a week alone.** Daily work, import, export, backups and restore, Trash and
restore, the duplicate review, vocabulary, templates, invoices, the recovery key, and
workspace removal are all reachable, documented in Help from where the owner gets stuck, and
covered by tests. Nothing expires, nothing phones home, and no ClearPath action can reach
inside the workspace (proved in `rev.md` §5 F-REV-F).

**Four things still need Walker**, and all four are now lines in
`docs/ONBOARDING-CHECKLIST.md`:

1. **The site token.** Only Walker can issue, hand over or rotate it (OPERATIONS.md CL-1,
   CL-2). There is no self-service path and there should not be — CL-1's best case is that
   the token never travels, because Walker pastes it in himself.
2. **Getting past Gatekeeper / SmartScreen, and the Keychain prompt** — on install and again
   on *every* update, because the builds are unsigned (D-4).
3. **Telling the client a release exists**, and walking them through reinstalling (D-5).
4. **Anything the banner state table does not already answer** — for which the client now
   sends one Diagnostics block instead of reading rows down the phone (F-CS-9).

**The "Getting started" decision: in the product, as a Help section, not a printable.**
Reason: a separate sheet is a second thing to keep in step with the product, and the first
question a stuck owner asks is asked in front of the computer, not in front of a filing
cabinet. Help is one sidebar row from every screen and now deep-links from the places people
get stuck, which a sheet of paper cannot do. The one exception is deliberate and is in the
install-day checklist instead: **the recovery key is the thing worth printing**, because its
whole purpose is to survive the computer.

---

## 8. Acceptance

| # | criterion | result |
|---|---|---|
| **D1** | Findings F-CS-n with class and reason; Blocker/Required fixed with tests | **pass.** 20 findings: 1 Blocker, 13 Required, 6 Follow-up. Every Blocker and Required is fixed and has a named test above. |
| **D2** | First meaningful outcome defined, measured before/after (steps, minutes, screens), screenshots under `tests/e2e-mac/.cache/screens/cs/` (not committed), written narrative | **pass.** §1, §2, §3. Before 18 actions / 6 screens, after 21 / 6; frictions 6 → 3. Screenshots and logs in `.cache/screens/cs/before/` and `.cache/screens/cs/`, both git-ignored; the tree is clean. Minutes are reported as the app's own time and reconciled against `rev.md` §3's 45–75 install-day estimate rather than replacing it. |
| **D3** | LR-6 shipped: a fresh workspace cannot reach a steady state without having been shown the key and confirming it is saved, with tests | **pass.** F-CS-2. Both onboarding exits, the confirm gate, the never-again rule across a reload, and the key's absence from the DOM before a press. Also satisfied from Settings → Backups, so an owner who complies there is not nagged. |
| **D4** | Imperfect-import fixture committed (synthetic) and its run documented: rows accepted/skipped/why, duplicates, undo | **pass.** §5. Fixture and generator committed; 2,991 created, 6 skipped, 61 warnings, pre-import backup verified, undo one click away. Sample data is unmistakable (F-CS-6) and removes with no orphans (F-CS-7). |
| **D5** | Error strings audited, with the list of changed strings | **pass.** §6. Enumerated, not sampled; 16 changed, the rest inspected and left alone with that stated. |
| **D6** | Diagnostics support block exists and is tested | **pass.** F-CS-9, with the absence of customer data and secrets asserted against a populated workspace. |
| **D7** | `docs/ONBOARDING-CHECKLIST.md` and the RELEASE-CHECKLIST fix committed | **pass.** `8ec73cd`, `0d4b735`, `d29b9da`. The checklist points at OPERATIONS.md CL-1/CL-6 rather than restating them, and cites `rev.md` §3's effort table rather than duplicating its numbers. |
| **D8** | typecheck clean, vitest green, cargo green, e2e green on this phase's port, build clean, tree clean, nothing running | **pass.** §9. |
| **D9** | DESIGN.md compliance for every new string and component | **pass.** No hex outside `tokens.css` in any file this phase touched (`grep -nE "#[0-9a-fA-F]{3,8}"` clean); no native date or time inputs added; radius 0 throughout; tokens for every colour, space and type value; the vocabulary hook used for the job/deal/quote word on the new Today state; one primary block per view, asserted by e2e across the card's appearance and disappearance. The regenerated `design/round3/*.png` are the visual record. |

---

## 9. Verification

Every command below was actually run, at `c37b955`, by the lead, after integration:

| command | result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run` | **186 files passed, 1 skipped · 2,373 tests passed, 3 skipped** (2,102 at the round's baseline) |
| `cd src-tauri && cargo test` | **123 passed, 0 failed** (85 + 8 + 10 + 11 + 9) |
| `E2E_PORT=4290 E2E_OUT=dist-cs npx playwright test -c tests/e2e-mac/playwright.config.ts` on `onboarding`, `data`, `today`, `settings`, `leads`, `backups`, `records`, `smoke` | **115 passed** |
| the walk: same config, `csWalk.e2e.ts`, before in an isolated `git archive` of `4d23656` and after at `c37b955` | both passed; no page errors, no console errors in either |
| `npm run build` | clean (`built in 824ms`; the two pre-existing dynamic-import advisories are unchanged from the baseline) |
| `git status --short` | clean |

There is no dedicated `help.e2e.ts`; Help is covered by `tests/unit/help/content.test.ts` and
exercised through `onboarding`, `smoke` and `depth`. `dist-cs` and the three workers'
`dist-cs-w1/2/3` were removed. Nothing is running: no servers, no fake-site instance, no
background processes, no agents.

**What was not verified, and cannot be here:** anything that is actually Rust or actually
macOS — the real keychain, the real save dialog, the clipboard and the print preview on the
shipped webview (F-CS-20), and Gatekeeper. All four are lines in
`tests/RELEASE-CHECKLIST.md`, which is where they belong.

---

## 10. Deviations

- **The first meaningful outcome got three actions longer, on purpose.** LR-6 is new required
  work. Stated rather than hidden, and it is the only step this phase added.
- **W1's shared "Show recovery key" button is secondary, not primary**, matching the Backups
  convention it now shares code with. Before the key is revealed the card therefore shows no
  primary at all; "I have saved it" is the card's one primary once it appears. Accepted:
  DESIGN.md §5 allows zero primaries per view (CustomersScreen is the precedent), and two
  divergent treatments inside one shared component would be worse.
- **The five `messageFrom` copies were consolidated** (`85dab08`) rather than a sixth added.
  This touches `poller.ts`, which is lead-critical, for no behavioural change; it is covered
  by the full suite and the leads e2e, both green. Called out because it is the one change in
  this phase that is cleanup rather than a fix.
- **F-CS-6 was fixed by marking the screen, not the card.** W2 proposed rendering the Sample
  tag on `DealCard`. A board card is four things and no more (DESIGN.md §3), and surfacing
  tags there would have needed a tag join in `deals.board()`. The note on the board is smaller
  and honest.
- **One worker escalation changed a test that was forbidden to it.** W1 found that F-CS-1's
  trigger was structurally identical to the CPO F-LA-6 regression's scenario, stopped rather
  than guessing, and the lead granted a narrow, named edit to that one test — rewritten to
  assert the invariant it actually protects (guidance rather than empty panels) instead of a
  heading string. That is stricter than what it replaced; no test was weakened anywhere in
  this phase.

---

## 11. Escalations

1. **D-3, unchanged and now costed: does Walker install in person, or does the client
   self-install?** LR-6 improves the self-install case substantially — the recovery key is no
   longer a step Walker has to remember, because the product will not settle until it is
   done. It does **not** remove the reason to be there: CL-1's best hand-over is the one where
   the token never travels, and `docs/ONBOARDING-CHECKLIST.md` is written for in-person as
   the default. Walker's call; nothing is blocked on it.
2. **D-4, code signing.** The single largest remaining friction in the whole walk, and the
   only one this phase could not touch. It is a purchase. Already escalated by SEC and REV;
   restated here because it is now the *first* thing a new client meets and the *only*
   remaining friction on leg 1.
3. **No CONTRACTS.md change was needed.** LR-4 already narrowed the key-crossing-IPC rule for
   the recovery key, and nothing this phase built went beyond it. F-CS-16 (Export in the
   sidebar) would be a CONTRACTS-adjacent change and is deliberately left as a Follow-up
   rather than decided here.

---

## 12. Handoff

Working tree clean at `c37b955`. All 32 commits local on `main`; nothing pushed. Nothing
running.

For the phases that come next:

- **`tests/e2e-mac/specs/csWalk.e2e.ts` is the measurement, not a regression test.** Re-run it
  after any change to onboarding, Today or import and read `walk.md`. It records friction
  rather than asserting against it, and it only fails if the app itself throws. It is the
  cheapest way to find out whether a change made the first day better or worse.
- **`docs/ONBOARDING-CHECKLIST.md` is Walker's install-day script** and is accurate at this
  revision. Its two unavoidable manual steps are the Gatekeeper/Keychain dance and the token
  hand-over; everything else the client can now do or undo alone.
- **The recovery-key card is the one thing in the product that will not let the owner past
  it.** If a later phase changes Today's structure, that card has to stay above the branch,
  in all three states. `tests/unit/today/recoveryKeyCardGate.test.ts` and the two onboarding
  e2e tests are what will catch it if it does not.
- **F-CS-20 leaves two hand checks on release day**: Copy and Print on the real build. They
  are in `tests/RELEASE-CHECKLIST.md` under First launch.
- Product expansion should know that Today now has **three** states, not two, and that the
  third one (`records`, nothing yet to chase) is the screen a brand-new paying client will
  spend his first afternoon looking at.
