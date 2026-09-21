# LR-LA — Chief Launch Assurance Officer

TASK: LR-LA | parent: Fable (coordinator) | ATTEMPT 1 | packet REV 1
Role: independent challenge of the combined result of SEC, OPS, REV, CS and PX.
This lead implemented nothing in those phases. Base revision `a8d18c1`; final
revision `82c06fc`.

---

## VERDICT

**Ready with specific operating conditions.**

The product does what it says, at a client's scale, and fails safely in the ways
that matter. Nine conditions below are things no automated suite in this
repository can prove and that therefore have a human owner. None of them is a
defect; all of them are the edge between what a mocked harness can reach and
what a real machine does.

| # | condition | the manual step | owner |
| --- | --- | --- | --- |
| C1 | The real app on a machine that has never run Helix has not been exercised this round | `tests/RELEASE-CHECKLIST.md`, "First launch" and "Keychain and secrets": right-click Open past Gatekeeper, choose **Always Allow** at the keychain prompt (not Allow, which re-prompts, and not Deny, which lands on a boot screen) | Walker |
| C2 | The recovery key's **Copy** and **Print** have never been run on a real webview | the two named lines in the same checklist. Chromium in the harness refuses `navigator.clipboard` without a grant and has no print preview, so a pass here would be invented | Walker |
| C3 | Windows is smoke-tested, not tested | `tests/RELEASE-CHECKLIST.md`, "Windows: what is covered and what is not" — written this round. Nothing built this round (payments, Schedule, automations, Sources, bulk) has ever run on Windows. Onboard macOS clients first, or run that section by hand | Walker |
| C4 | The new CI `e2e` job has never run on a runner | first push to `main` — check the `e2e` job is green before tagging anything | Walker |
| C5 | The second backup folder is an install-day step with no in-app prompt | `docs/ONBOARDING-CHECKLIST.md`, "Backups: the second copy" — and confirm Diagnostics' "Last backup" shows a time before leaving | Walker |
| C6 | Installers are unsigned | Gatekeeper and SmartScreen warn on every install, and macOS re-prompts for the keychain after **every** update. Say so out loud on install day; the signing spend is decision D-4 in `rev.md` | Walker |
| C7 | An archived workspace whose folder was deleted reopens as a new empty one, silently | Help's "Removing a workspace for good" now warns not to reopen one. Do not reopen a removed workspace expecting old data | Walker (code fix is F-LA-7, deferred) |
| C8 | The site token is handed over by hand, once per client | `docs/OPERATIONS.md` **CL-1**, run before install day, not during it | Walker |
| C9 | Nothing in Helix records which client runs which version — there is no telemetry, by design | `docs/CLIENT-ROSTER-TEMPLATE.md`, filled the same day, per `docs/OPERATIONS.md` **CL-6** | Walker |

What I am **not** saying: that the app has been proven on a real machine, on
Windows, or on a signed build. Those are C1–C3 and C6, and they are conditions
precisely because I could not check them.

---

## MATRIX SUMMARY

`docs/LAUNCH-ACCEPTANCE.md` — rows are scenarios, columns are dataset (empty /
populated realistic), condition (normal / failure), surface (Rust / repo /
e2e-mac / e2e-win / by hand), result and evidence. Fourteen journeys, executed
here rather than read out of a previous phase's return. Every row that says
`not run here` says why, and every one of those is a condition above.

---

## JOURNEYS

**J1 Fresh install → onboarding → recovery key → second backup → Today true.**
PASS. Onboarding on the landscaping preset, the recovery-key card as Today's
first content, Confirm disabled until the key is revealed and saved, no nag
after, a second backup folder reaching `backup_mirror`, and Today dropping
"Nothing here yet" the moment records exist. Copy and Print are C2.
Evidence: `tests/e2e-mac/specs/la-w1.e2e.ts`.

**J2 Import messy-3000.csv.** PASS, and the figure is confirmed rather than
repeated: **2,991 created / 0 updated / 6 skipped / 61 warnings** out of 2,997
rows, re-derived from scratch through the real import pipeline and separately
through the built UI. "Customer Name" maps to Full name; the preview says
"the first 20 of 2,997 rows"; the pre-import backup exists on disk (`existsSync`,
not a claim on screen); the undo route is reachable; search finds an imported
contact; and the import creates **exactly zero** tasks, with the two default-on
automation rules confirmed enabled first so the zero means something.
Evidence: `tests/repo/la-w1/importCounts.test.ts`, `la-w1.e2e.ts`.

**J3 Website lead → task → rule off → 401 → reconnect → site gone → disconnect.**
PASS after one fix. The whole chain holds: contact and job created, a
speed-to-lead task on Today and Schedule, the rule off stopping the next one
(count stayed at 1, not 2), a rotated token producing the owner's sentence and
not a raw error, reconnect producing no duplicate (1 deal, and 2 never 3 when a
genuinely new lead rides along), the disconnect hint appearing on the **real**
twelfth consecutive failure and not before, and Disconnect removing the address
and token while deleting nothing. The timeline line named the trigger but not
where to switch the rule off — F-LA-5, fixed.

**J4 Quote → follow-up → invoice → deposit → balance → paid → delete a payment →
statement → exports → Collected.** PASS. The follow-up fires on the delay rule,
driven through the real listener wiring rather than by calling the runner:
3 days, and asserted above an hour so "immediately" would fail. A deposit gives
"Partially paid" with the right balance on the invoice, the list, the contact
and Today; recording the rest gives "Paid"; deleting a payment goes back to
"Partially paid"; over-balance, draft and void payments are refused with nothing
written. Revenue's **Collected** was computed two ways and agreed at 120,000¢.
The real PDF's embedded-font bytes are unreadable to pdf-lib — a documented
limit, not a gap opened this round.

**J5 Visit → four surfaces → edit → .ics → DST → delete → undo.** PASS. The DST
case is the one worth naming: a 9:00 AM visit on 2026-03-01 stores
`14:00:00.000Z`; moved three weeks across the spring-forward it stores
`13:00:00.000Z` — an hour earlier in UTC, still 9:00 AM to the owner — and the
.ics carries each correctly. Evidence: `tests/repo/la-w2/scheduleDst.test.ts`
with `TZ` pinned.

**J6 Bulk: 5 contacts tagged and undone, 3 jobs moved for exactly 3 tasks, 2
trashed and restored, selected export guarded.** PASS, and it closed two holes
in the PX suite while passing: `px-c-bulk.e2e.ts` only ever proved three rows
and never touched the deals list at all. The formula guard was already unit
tested as a function; what was missing was proof the real "Export selected"
button's own codepath applies it, which it does.

**J7 Reports reconciled against the repository.** PASS, with the numbers written
out in the matrix — nineteen figures across Revenue, Deals, People, Receivables
and Sources, each compared against hand arithmetic on the same dataset, every
difference zero. Receivables shows balances and ages correctly ($300 owed on a
$500 invoice reads as $300). A $9,999.99 quote-only deal was built in as a
negative control and correctly contributed nothing.

**J8 Failure and recovery.** PASS on nine of ten; one sub-case is not reachable.
The corrupt-keychain refusal was re-proven against the **real** macOS keychain,
reading the raw item before and after to confirm it is byte-identical — the
existing test uses the in-memory store. The purge was re-proven against a real
temp directory with `existsSync`, where the existing test records calls on a
mock; all five categories (notes, tasks, payments, PDFs, search rows) are gone,
and a note shared with a surviving deal correctly stays. The crash screen's
consent copy was proven by arming `fetch`, `XMLHttpRequest` and `sendBeacon`
spies before the crash: rendering it, copying from it and resetting it touch the
network zero times. Not reachable: the Rust-layer keychain-denial branch, which
is private and needs a real OS prompt (the JS layer's message is tested and
correct).

**J9 Offboarding.** PASS after three fixes, all found here. Export everything
now actually means everything — see F-LA-6. The documented removal procedure was
followed literally in a sandbox, and what remains matches the docs on two of
three counts: the folder goes, the keychain item stays (as the docs already
said), and the `helix.json` registry row stays forever pointing at a path that no
longer exists, which the docs did not mention and now do.

**J10 Claims against behaviour.** Three false or overstated claims found and
corrected: F-LA-2 (Help), F-LA-3 (README and CHANGELOG). Everything else
checked out, including the two promises most worth doubting — that the log names
no customer (every log line carries counts, a status code and the origin, and
nothing else) and that nothing leaves the machine unless the owner turns on AI
or connects a website (two outbound call sites in the whole tree; no telemetry,
analytics or update ping).

**J11 Regression against `e8e7650`.** Clean. 1,866 baseline test titles; five
absent at HEAD, each with a named successor that asserts at least as much. No
`.skip`, `.only`, `xit` or `#[ignore]` added — the only three skips are the
pre-existing env-gated PDF samples. Seventeen assertion lines removed against
1,790 added, and I read all seventeen rather than sampling thirty: sixteen are
replacements, one is a recorded relaxation. Detail below.

**J12 Performance and layout at 3,000 customers.** PASS. Today 109 ms,
Contacts 216 ms, Pipeline 259 ms, Schedule week 86 ms, Revenue 876 ms, Sources
130 ms, search 87 ms — wall clock from navigation to content, in the built
bundle, not query time. No screen overflows the 1024px floor and none paints
more than the two primary blocks DESIGN.md allows. Three of the five screens
checked had never been visited by the design walk at all (F-LA-4).

**J13 Windows.** Stated, not claimed. Four smoke assertions against a debug
build; `cargo test` does run on `windows-latest`. Everything else, including
everything built this round, is now an explicit hand-check list in the release
checklist. This is C3.

**J14 Installer.** PASS. `npx tauri build --bundles app` exits 0 at `82c06fc`;
bundle at `src-tauri/target/release/bundle/macos/Helix CRM.app`, 15 MB, version
0.1.0. Not launched.

---

## FINDINGS

| id | class | finding | fix | evidence | reviewer |
| --- | --- | --- | --- | --- | --- |
| F-LA-1 | Required before paid onboarding | The Playwright suite — the largest in the repo and the only automated cover the UI has — ran in **no CI job**. `ci.yml` had typecheck, vitest, npm audit and cargo; `e2e-win.yml` has four Windows smoke assertions. Every screen this round built could regress on `main` with every check green, and `release.yml` cuts the installer from that `main`. | Added an `e2e` job on `macos-latest` (Chromium only, html report kept on failure). | `cbca382`; suite green locally at 202 tests. **Its first run on a runner is C4** — I could not verify a GitHub Actions run from here and do not claim one. | — |
| F-LA-2 | Required before paid onboarding | Help's "Quotes and invoices" was written against `MarkPaidDialog`, which PX-A deleted. It told the owner to "press Mark paid and say when it came in, how, and anything worth a note" — four fields behind a button that is now one silent click dated today. And the whole of what PX-A shipped had **no answer anywhere in Help**: a deposit, a part payment, the balance that follows the customer, the statement. An owner taking a 30% deposit, which is how every trade this ships for gets paid, had nowhere to look. | Rewrote the section against the shipped screens; sentence budget 10 → 12 with the reason recorded; new test pins the copy to the buttons that exist and fails if Mark paid is ever again described as asking for details. | `0097ccc`; `tests/unit/help/content.test.ts` | — |
| F-LA-3 | Required before paid onboarding | The README and the CHANGELOG both said the owner **switches on** three automation rules. Migration 0008 seeds two of them enabled (`lead_arrived`, `quote_sent`) and one off (`invoice_overdue`). A client told he has to switch them on, who then finds tasks he did not write, has been told the wrong thing about the one feature that writes to his list by itself. | Both corrected to say which two arrive on, which waits, and that an import sets none of them off. | `0097ccc`, `103a67e`; defaults read from `drizzle/0008_automations.sql` | — |
| F-LA-4 | Follow-up | `cpoWalk.e2e.ts`'s route list — the walk that regenerates the design reference screenshots — never gained `/schedule`, `/settings/automations` or `/reports/sources`, so nobody had looked at this round's three new screens at the 1024px floor. Separately, the Help e2e test still asserted six of what are now twelve sections, so the six added since had never been proven to reach the screen. | New spec walking all five new surfaces at 1440 and 1024 with screenshots, a no-horizontal-overflow assertion and a primary-block count; plus a test for all twelve Help headings. | `2fd7f20`; shots under `tests/e2e-mac/.cache/screens/la/` | — |
| F-LA-5 | Follow-up | The timeline line a rule writes named who and why but not **where to stop it**. Raised by the CS recheck as F-CS-R-7, left open, and reconfirmed open by LA-W1. Two rules ship on, so the owner most likely to read that line is one who found a task he is sure he did not write. | `FOLLOW_UP_INTRO` now reads "Helix added a follow-up (Settings, then Automations):", pinned to Help's own follow-ups section so the two cannot drift. | `3d2ce35`; `tests/unit/la/automationIntro.test.ts` | — |
| F-LA-6 | Required before paid onboarding | "Export everything" did not. Three holes: `tasks.csv` had no column for a task's place, duration or notes, so a **booked visit exported with no address, no length and no gate code**; there was **no attachments manifest at all**, so the attachments folder — named by opaque stored names — arrived unreadable; and `deal_items` was in no exported file and in no exclusion comment either, so a **priced job that was never quoted** exported with its whole breakdown missing. `invoice_schedules` was excluded on a rationale written before recurring invoicing shipped. | Added Length/Place/Note/Source to `tasks.csv`; new `attachments.csv` (the manifest, not the files), `deal_items.csv` and `invoice_schedules.csv`. | `692145a`, `82c06fc`; `tests/repo/data/export.test.ts`, `tests/repo/la-w3/exportEverythingContent.test.ts` | **Yes** — reviewed by LA-W1, who did not write it: APPROVE WITH CHANGES, verified the SQL against a forced contact/company id collision, a soft-deleted parent and an orphaned `entity_type`, walked all fourteen column indices one by one, judged the two inverted assertions a legitimate correction, and **found the `deal_items` hole**, which the second commit closes |
| F-LA-7 | Follow-up | Opening an archived workspace whose folder the owner deleted (the documented offboarding step) **silently starts a new, empty workspace under the same name** rather than saying anything is missing — `db.rs::open` creates the directory and the file unconditionally. The `helix.json` row also stays forever, and there is no in-app way to remove it. | Documented, not coded: Help's "Removing a workspace for good" now says the row stays and warns against reopening it. The code fix (an in-app way to remove a dead entry, and a refusal rather than a silent create) needs to distinguish "first ever open" from "the file vanished", which is a boot-path change this late in a round. Deferred, same class as F-SEC-27. | `91e86b8`; section still inside its 8-sentence budget | found by LA-W3 |
| F-LA-8 | Follow-up | Owner-customised `pipelines`, `stages`, `sources` and the three `automations` rows are not exported, although `custom_fields`, `templates` and `saved_views` — the same category of owner configuration — are. Inconsistent, and predates this round. | Not fixed. Recorded for whoever owns the export feature next. | raised by LA-W1 in the F-LA-6 review | — |

Findings by class: **3 Required before paid onboarding** (F-LA-1, F-LA-2,
F-LA-6), **4 Follow-up** (F-LA-4, F-LA-5, F-LA-7, F-LA-8), **0 Blockers**.
F-LA-3 is Required on the same grounds as F-LA-2: a false statement about what
the product will do on its own is not a documentation nit when the product then
does it.

Nothing new was found in LA-W2's whole area (payments, the Schedule, bulk
actions, reports) or in LA-W1's (onboarding, import, leads). Both workers said
so plainly rather than manufacturing a finding, and I checked their evidence
rather than their conclusions.

---

## CLAIMS CORRECTED

1. **Help, "Quotes and invoices"** — described the deleted `MarkPaidDialog`;
   silent on deposits, part payments, balances and the statement. Rewritten.
2. **README, "Automations"** — "switch on" three rules; two ship on. Rewritten,
   and it now also says an import sets none of them off.
3. **CHANGELOG, Unreleased, automations** — the same error. Rewritten.
4. **`tests/RELEASE-CHECKLIST.md`, "Before you tag"** — named `js`, `rust` and
   `rust-audit` as the gate; there is now an `e2e` job too, and `e2e-win` is
   named for what it actually is.
5. **Help, "Removing a workspace for good"** — silent on the registry row that
   survives, and on what reopening a removed workspace does. Corrected by LA-W3.

Claims checked and found **true**, which is worth recording because they are the
ones a client is relying on: the log names no customer; nothing leaves the
machine but the two opt-in integrations; attachments and exports are plain files
and both the Backups screen and Help say so; undo is twenty deep; backups keep
thirty days; search returns well under a tenth of a second at scale; and
CHANGELOG's "Not in v1" list is accurate.

---

## REGRESSION CHECK

**Baseline `e8e7650`** (2,102 unit/repo, 41 Rust, 164 e2e) versus final
`82c06fc` (2,798 unit/repo, 125 Rust, 202 e2e).

*Every baseline test still exists.* 1,866 baseline test titles extracted from
the git tree and compared against HEAD. Five are absent, each with a successor:
`leads.e2e.ts` four tabs → five; `leads/overview.test.ts` four groups → five;
`invoices/csvExport.test.ts` "decimal amount" → "decimal balance";
`help/content.test.ts` six sections → the whole screen; and `today.e2e.ts`'s
"the starter cards survive the first contact", rewritten as "one contact gets
guidance, not empty panels" because F-CS-1 deliberately changed that behaviour —
the replacement asserts more than the original, not less. All five justified.

*Every baseline test still passes.* Full vitest green.

*No skips added.* `git grep` for `it.skip`, `test.skip`, `describe.skip`, `xit`,
`xdescribe` and `.only` across `tests/`, `src/` and `src-tauri/` at both
revisions returns the same three lines: the env-gated
`it.skipIf(!process.env.HELIX_PDF_SAMPLE)` PDF samples, unchanged since baseline.
No `#[ignore]` in Rust.

*Loosened assertions.* `git diff e8e7650..HEAD -- tests/` removes 17 lines
containing `expect(` or `assert` and adds 1,790. Seventeen is small enough to
read completely, so rather than sampling thirty I read all of them.

- **One genuine relaxation, recorded.** `tests/unit/help/content.test.ts`
  replaced a flat six-sentence budget with a per-section `budgetFor(id)`, and ten
  of twelve sections now carry an above-default budget. That is a lower bar per
  section. It arrived with the change that **doubled the rule's reach** — the
  quality rules previously ran over six sections while the screen rendered ten,
  so nearly half of Help was held to no standard at all — and every exception is
  argued in the file. Net coverage up, per-section bar down, deliberately. I
  raised one of those budgets again myself (10 → 12, F-LA-2) and recorded why.
- **Sixteen replacements, not removals.** `markPaid`'s rejection tests went with
  `markPaid`'s dialog (PX-A). The poller's `lastError` assertion is still exact
  and now pins the shorter string F-SEC-6 requires, because a 401 body commonly
  echoes the credential it rejected. `applyLeads`' `toHaveLength(1)` became a
  filtered length **plus** a new assertion that the speed-to-lead rule wrote
  exactly one line beside it. `leads.e2e.ts`'s "cannot reach your website" became
  the shape error's own sentence, a more accurate subject for a malformed page.

*Two assertions inverted by this pass*, and I am flagging them myself rather than
leaving them to be found: LA-W3 wrote `expect(taskHeaders).not.toContain("Place")`
and `expect(Object.keys(zip.files)).not.toContain("attachments.csv")` to
**document** the F-LA-6 gap, with a comment saying so. When the gap was fixed
those became false, and they were flipped. An independent reviewer who did not
write the fix judged this a legitimate correction and noted the replacements are
stricter than the originals (they assert exact values, not header presence).

---

## WHAT COULD NOT BE CHECKED

- **The real app on a fresh machine.** Gatekeeper's right-click-Open, the
  keychain prompt and Always Allow, and the recovery key's Copy and Print on a
  real webview. The harness has no clipboard grant and no print preview. C1, C2.
- **Windows, anything.** macOS cannot run WebView2. C3.
- **A signed build**, because there is no signing. C6.
- **The CI `e2e` job on a runner**, because I cannot run GitHub Actions. C4.
- **The Rust keychain-denial branch.** `is_access_refusal` / `access_refused` are
  private and only reachable from a real OS denial. The JS layer's message is
  tested and correct.
- **The shipping PDF's byte-level text.** It embeds subset fonts through
  fontkit, which pdf-lib cannot read back. The data pipeline and the renderer's
  output are tested with the standard-font fallback — the same limit PX-A
  recorded, not one opened here.
- **A real ClearPath site's responses.** The harness proves Helix's reaction to
  each status, not that a site emits it. `tools/fake-site` covers that on the
  release checklist.
- **Concurrent use by two people**, which is not a thing this product has.

---

## VERIFICATION

All at `82c06fc`, after every worker's changes landed.

| command | result |
| --- | --- |
| `npm run typecheck` | clean, exit 0 |
| `npm test` | **235 files passed, 1 skipped; 2,798 tests passed, 3 skipped** |
| `cd src-tauri && cargo test` | **125 passed, 0 failed** across 8 binaries |
| `E2E_PORT=4330 E2E_OUT=dist-la npm run e2e:mac` | **202 passed** (9.3 min) |
| `npx tauri build --bundles app` | exit 0; `src-tauri/target/release/bundle/macos/Helix CRM.app`, 15 MB, v0.1.0 — **not launched** |
| `git status --short` | clean |
| ports 4330–4333, 4711 | nothing listening |

`dist-la` and its Playwright output removed. Three committed design reference
PNGs were rewritten in place by the suite's own screenshot tests during the run
and restored to their committed bytes. `~/Applications/Helix CRM.app` was never
launched and `~/Library/Application Support/com.clearpathdigital.helix` was never
touched, by this lead or by any of its three workers.

---

## FIRST-CLIENT STEPS

The practical order, reconciled with `docs/ONBOARDING-CHECKLIST.md` and
`docs/OPERATIONS.md` CL-1. Nothing here is new process; it is the existing
process in the order the evidence says it has to happen.

**A week before, at your desk**

1. Cut the release you will install. Confirm the versions agree in
   `package.json`, `tauri.conf.json` and `Cargo.toml`; move CHANGELOG's
   Unreleased into a version heading; confirm `main` is green including the new
   **`e2e`** job (C4).
2. Run `tests/RELEASE-CHECKLIST.md` by hand on a Mac account that has never run
   Helix. This is C1 and C2, and it is the only place they get done. If the
   client is on Windows, also run the "Windows: what is covered and what is not"
   section — nothing built this round has run there (C3).
3. Run `docs/OPERATIONS.md` **CL-1** end to end: generate the token, set
   `CRM_API_TOKEN` on the client's deployed site, redeploy, and confirm both
   `curl` checks. Before install day, not during it.
4. Add the client's row to the roster (`docs/CLIENT-ROSTER-TEMPLATE.md`, kept
   outside this repository).
5. Put the installer on the machine you are installing from. Do not depend on
   their connection.

**On the machine, with the client**

6. Get past the OS first and say why: right-click → Open on macOS, or More info
   → Run anyway on Windows. Tell them it happens on every update too (C6).
7. Let first launch run its three setup screens — business name and trade, the
   trade's pipeline and price list, how customers come in.
8. At the first keychain prompt, choose **Always Allow**. Not Allow, which
   re-prompts; not Deny, which lands on a boot screen.
9. **Stay with them through the recovery key.** It is the one step that cannot
   be repaired later. Print is the right answer for a client who is not
   comfortable with a computer; a copy pasted into a note on the same laptop is
   not a second copy of anything.
10. Settings → Backups: choose a second backup folder (C5), then check
    Diagnostics reads a time for "Last backup", not "No backup has run yet".
11. Settings → Website: paste the address and the token, in person, and press
    **Test connection** before you call it done.
12. If they have a spreadsheet, import it together — walk the column mapping
    rather than accepting the guesses, and choose the duplicate rule before you
    start. 2,997 messy rows import in one step with a backup taken first.
13. Settings → Automations: read the three rules out. Two are on. Say the three
    things that stop it being spooky — whatever a rule creates is an ordinary
    task, the customer's history names the rule and where to switch it off, and
    **importing a spreadsheet sets none of them off**. If they say they want
    none of it, switch both off while you are sitting there.
14. If they book visits, open Schedule and book one real one from their own
    diary, so they have done it once with someone in the room.
15. Before you leave: confirm the website banner says nothing is wrong, fill the
    roster row completely (install date, the version actually running, how the
    token was handed over, which setup choice they made), and tell them what
    support looks like — Help's "Something's wrong?", Diagnostics' copy button,
    and no in-app support channel by design.

**Afterwards, and only you can do these**

16. Tell them when a new version exists. There is no auto-update and no in-app
    notice, by design, so it does not happen unless you do it.
17. Keep the roster current. It is the only record of who runs what; there is no
    telemetry to ask instead (C9).

---

## HANDOFF

Final revision `82c06fc` on `main`, local only, **not pushed** — Fable pushes.
Seven commits from this lead (`2fd7f20`, `cbca382`, `0097ccc`, `3d2ce35`,
`c733a59`, `103a67e`, `1041b6e`, `692145a`, `82c06fc`) and three from its
workers (`d6ce55f` LA-W1, `f3ae2de` LA-W2, `91e86b8` LA-W3).

For the next agent:

- **F-LA-7 is the one real piece of deferred code.** Opening an archived
  workspace whose folder is gone silently creates an empty one. The fix needs
  `helix.json` to record that a workspace has been opened before, so boot can
  tell "first run" from "the file vanished" and refuse rather than create. It
  touches the boot path, which is why it was not done in the last hour of a
  round. F-SEC-27 (no in-app way to remove a registry row) is the same area and
  should be done with it.
- **F-LA-8**: owner-customised pipelines, stages, sources and automation rules
  are still not exported although custom fields, templates and saved views are.
- **C4 is live.** The `e2e` CI job has never run on a runner. If its first run
  is red for an environment reason, fix the job — do not tag around it.
- The design walk (`cpoWalk.e2e.ts`) still does not visit `/schedule`,
  `/settings/automations` or `/reports/sources`. `la-j12.e2e.ts` covers them
  now, but if the reference screenshots are regenerated for a design review,
  those three routes should be added to `STATIC_ROUTES` so they land in the same
  set as everything else.
- The suite's own screenshot tests write into committed `design/` files. Expect
  three PNGs to show as modified after a full e2e run; they are byte churn from
  re-rendering, not a change.
