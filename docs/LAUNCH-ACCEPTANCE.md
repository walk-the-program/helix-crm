# Launch acceptance matrix

Built by the Chief Launch Assurance Officer pass (task LR-LA) on 2026-09-20,
against `main` at `a8d18c1` plus the fixes this pass made. The verdict, the
findings and the first-client steps are in
`docs/rounds/launch-returns/la.md`; this file is the evidence table behind
them.

**How to read a row.** Every row is a scenario somebody in this pass actually
ran. "Evidence" names the artifact — a test you can run, a command, or a file
that was inspected. A row that says `not run here` says why, and that
limitation is carried into the verdict as an operating condition rather than
quietly rounded up to a pass.

**Surfaces**, in descending order of what they prove:

| surface | what it is | what it cannot prove |
| --- | --- | --- |
| Rust (`cargo test`) | the real Rust commands: keychain, file copy, the db pipe | anything above the pipe |
| repo (Vitest + better-sqlite3) | the repositories and the migrator over a real SQLite file, through the same `sqlite-proxy` callback production uses | that the Rust pipe behaves like better-sqlite3; the UI |
| e2e-mac (Playwright) | the real built frontend in Chromium, SQL underneath it real, everything Tauri stubbed | anything that is actually Rust — keychain, real files, HTTP, backup on a live connection, the window |
| e2e-win (WebdriverIO) | the real compiled app on Windows, nothing stubbed | **not run here**; CI only, and four smoke assertions (see J13) |
| by hand | `tests/RELEASE-CHECKLIST.md` on a real machine | **not run here**; owner is Walker |

**Datasets.** `empty` is a fresh workspace straight out of onboarding.
`populated` is either `tests/fixtures/messy-3000.csv` (2,997 rows), the
in-product example data, or a seeded workspace of comparable size; the row
says which.

---

## J1 — Fresh install to a true Today

| # | scenario | dataset | condition | surface | result | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| J1.1 | Onboarding completes on a trade preset (landscaping) | empty | normal | e2e-mac | PASS | `la-w1.e2e.ts` J1 |
| J1.2 | The recovery-key card is the first thing Today shows | empty | normal | e2e-mac | PASS | `la-w1.e2e.ts` J1 |
| J1.3 | The card will not clear until the key is revealed **and** kept: Confirm stays disabled before a save | empty | normal | e2e-mac | PASS | `la-w1.e2e.ts` J1, Confirm asserted disabled then enabled |
| J1.4 | Save the key to a file | empty | normal | e2e-mac | PASS | `offerSavePath` invoked, "Recovery key saved." |
| J1.5 | Copy the key | empty | normal | by hand | **not run here** | mocked Chromium refuses `navigator.clipboard` without a grant; release-checklist "Copy the recovery key, on the real build" (F-CS-20) |
| J1.6 | Print the key | empty | normal | by hand | **not run here** | no print preview in the harness; release-checklist "Print the recovery key" |
| J1.7 | No nag after the key is kept (survives a reload) | empty | normal | e2e-mac | PASS | card absent after `page.reload()` |
| J1.8 | A second backup folder is chosen and used | empty | normal | e2e-mac | PASS | `backupCopyDir` persisted, `backup_mirror` called with the chosen folder |
| J1.9 | Today stops saying "Nothing here yet" once records exist | populated (1 contact) | normal | e2e-mac | PASS | "Your customers are in Helix" shown, empty heading absent |

## J2 — Import 2,997 messy rows

| # | scenario | dataset | condition | surface | result | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| J2.1 | "Customer Name" is mapped to Full name, not Skip | messy-3000 | normal | e2e-mac + repo | PASS | `la-w1.e2e.ts` J2; `tests/repo/la-w1/importCounts.test.ts` |
| J2.2 | The preview says "the first 20 of 2,997 rows", not "20 of 20" | messy-3000 | normal | e2e-mac | PASS | asserted present, and the false string asserted absent |
| J2.3 | **2,991 created / 0 updated / 6 skipped / 61 warnings**, arithmetic closing against 2,997 | messy-3000 | normal | repo + e2e-mac | PASS — independently re-derived, agrees with CS's figure | `importCounts.test.ts` "EXACT counts"; warnings 60 name + 1 phone |
| J2.4 | A pre-import backup exists on disk | messy-3000 | normal | e2e-mac | PASS | path read off the result screen, `existsSync` confirmed |
| J2.5 | The undo path is reachable from the result screen | messy-3000 | normal | e2e-mac | PASS | "Go to Backups" navigates |
| J2.6 | Search finds a named imported contact | messy-3000 | normal | e2e-mac + repo | PASS | "Dubé" finds François Dubé on both surfaces |
| J2.7 | The import creates **zero** automation tasks, with the two default-on rules confirmed enabled | messy-3000 | normal | repo | PASS — exactly 0 | `importCounts.test.ts`; also `tests/repo/onboarding/importDoesNotAutomate.test.ts` |

## J3 — The website lead lifecycle

| # | scenario | dataset | condition | surface | result | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| J3.1 | A lead creates a contact and a job | empty | normal | e2e-mac | PASS | `la-w1.e2e.ts` J3 |
| J3.2 | A speed-to-lead task lands on Today and on Schedule | empty | normal | e2e-mac | PASS | both surfaces asserted |
| J3.3 | The timeline line names the rule **and where to switch it off** | empty | normal | e2e-mac + unit | PASS after fix F-LA-5 | was partial (named the trigger, not the screen); `tests/unit/la/automationIntro.test.ts` |
| J3.4 | Switching the rule off stops the next lead's task | empty | normal | e2e-mac | PASS — count stayed at 1, not 2 | `la-w1.e2e.ts` J3 |
| J3.5 | A rotated token 401s with the owner-facing sentence, not a raw error | populated | failure | e2e-mac | PASS | "Your website turned the connection down. Check the token."; stored `LeadPollAuthError: HTTP 401` with no echoed body |
| J3.6 | Settings keeps its connection state after a 401 rather than silently reverting | populated | failure | e2e-mac | PASS | banner shown, state retained |
| J3.7 | Reconnecting with a new token creates no duplicates | populated | normal | e2e-mac + repo | PASS — 1 deal / 1 contact, and 2 (never 3) when a genuinely new lead rides along | `la-w1.e2e.ts`; `tests/repo/la-w1/siteGoneForever.test.ts` |
| J3.8 | A site gone for good eventually suggests disconnecting, on the real threshold | populated | failure | repo | PASS — false through failure 11, true on the 12th | `siteGoneForever.test.ts` against the real poller and `FAILURES_BEFORE_DISCONNECT_HINT` |
| J3.9 | Disconnect removes the address and the token and deletes nothing else | populated | normal | e2e-mac + repo | PASS — deal and contact counts unchanged | `la-w1.e2e.ts` J3 |
| J3.10 | A real ClearPath site emits these statuses | — | — | by hand | **not run here** | the harness proves Helix's reaction, not the site's behaviour; `tools/fake-site` covers it on the release checklist |

## J4 — Money: quote to deposit to paid to statement

Run by LR-LA-W2, independently of the PX-A return, and inspected by the lead.

| # | scenario | dataset | condition | surface | result | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| J4.1 | Job → quote built from a catalogue service | empty | normal | repo | PASS | `tests/repo/la-w2/paymentsJourney.test.ts` |
| J4.2 | Send the quote | empty | normal | repo | PASS | same |
| J4.3 | A follow-up task appears after the delay rule — not immediately, not never | empty | normal | repo | PASS — 3 days ± 5 s, and asserted > 1 hour to rule out "immediate" | driven through the real listener wiring (`startAutomations()` → `documents.onDocumentStatusChanged` → `runQuoteSent`), not by calling the runner |
| J4.4 | Accept the quote → an invoice is created | empty | normal | repo | PASS | same |
| J4.5 | Record a **deposit** → "Partially paid", balance right on the invoice, the list, the contact and Today | populated | normal | e2e-mac + repo | PASS | `la-w2.e2e.ts`; `money.invoiceBalanceCents` / `customerBalanceCents` |
| J4.6 | Record the balance → "Paid" | populated | normal | e2e-mac + repo | PASS | same |
| J4.7 | **Delete** a payment → back to "Partially paid" with the right balance | populated | failure | e2e-mac + repo | PASS | same |
| J4.8 | Refusals: a payment over the balance, against a draft, against a void — nothing written | populated | failure | repo | PASS | new test; overpayment-with-flag also checked |
| J4.9 | Statement PDF: the rows and figures | populated | normal | repo + unit | PASS | `statementRows()` → `renderStatement()`, `tests/repo/payments/statement.test.ts`, `tests/unit/invoices/statementPdf.test.ts` |
| J4.10 | Statement PDF: byte-level text of the **real** app-generated file | populated | normal | — | **not run here** | the shipping PDF embeds subset fonts via fontkit, which pdf-lib cannot read back as text — the same documented limit as the invoice PDF, not a new gap |
| J4.11 | Payments appear in exports | populated | normal | repo | PASS | `buildEntityCsv("payments")` |
| J4.12 | Revenue "Collected" equals the sum of the payments rows | populated | normal | repo | PASS — raw SQL sum 120,000¢ = `reports.revenueMoney(...).totals.collectedCents` 120,000¢ | both computed in the test, not asserted equal to each other by construction |

## J5 — The calendar, across a DST boundary

`TZ=America/New_York` pinned; 2026 spring-forward is 2026-03-08.

| # | scenario | condition | surface | result | evidence |
| --- | --- | --- | --- | --- | --- |
| J5.1 | Book a visit with a time, a place, a length and a note | normal | e2e-mac | PASS | `px-b-schedule.e2e.ts`, re-run by W2 rather than taken from the PX return |
| J5.2 | It appears on the Schedule week, the day, Today and Tasks | normal | e2e-mac | PASS | same |
| J5.3 | Edit the time and the place; all four surfaces follow | normal | e2e-mac | PASS | same |
| J5.4 | Before the boundary (2026-03-01, EST): stored instant | normal | repo | PASS | `dueAt` = `2026-03-01T14:00:00.000Z`, offset −5 confirmed independently via `Intl`, label "9:00 AM" |
| J5.5 | Moved three weeks across the boundary (2026-03-22, EDT), same local time | failure-adjacent | repo | PASS | `dueAt` = `2026-03-22T13:00:00.000Z` — **one hour earlier in UTC**, same "9:00 AM" local, read back by raw SQL |
| J5.6 | The feed places it on the post-boundary week, not the pre-boundary one | failure-adjacent | repo | PASS | `scheduleItems()` |
| J5.7 | .ics DTSTART/DTEND correct on both sides of the boundary | normal | repo | PASS | `20260301T140000Z`/`...153000Z`, then `20260322T130000Z`/`...143000Z` |
| J5.8 | .ics escaping and line folding (a comma in the address) | normal | e2e-mac | PASS | `px-b-schedule.e2e.ts` |
| J5.9 | Delete the visit → undo restores it | normal | e2e-mac | PASS via the suite's existing undo coverage | W2 did not re-derive this itemised; recorded as covered rather than re-proven |

## J6 — Bulk actions, through the real controls

| # | scenario | dataset | surface | result | evidence |
| --- | --- | --- | --- | --- | --- |
| J6.1 | Select 5 contacts → add a tag → undo restores the exact prior state | populated | e2e-mac | PASS | `la-w2.e2e.ts` — five, where `px-c-bulk.e2e.ts` only ever proved three |
| J6.2 | Select 3 jobs → move to a stage with a follow-up rule → **exactly 3** tasks | populated | e2e-mac | PASS | through the real "Move to stage" control on the deals list, which `px-c-bulk.e2e.ts` never touched |
| J6.3 | Trash 2 contacts → restore from the Trash screen | populated | e2e-mac | PASS | via the Trash screen's Restore, not the undo toast |
| J6.4 | Export selected as CSV, formula guard on `=`, `+`, `-`, `@`, TAB, CR, LF | populated | e2e-mac | PASS | through the real "Export selected" button, file written and read back; the pure-function matrix was already in `exportCsvHostile.test.ts` — what was missing was proof the button's own codepath applies it |

## J7 — Reports reconciled against the repository, same dataset

Every figure known by construction, kept as hand arithmetic in the test, then compared. No mismatch anywhere.

| report | figure | report says | by hand | diff |
| --- | --- | --- | --- | --- |
| Revenue | Invoiced | $4,200.00 | $4,200.00 | 0 |
| Revenue | Collected | $700.00 | $700.00 | 0 |
| Revenue | Outstanding | $3,500.00 | $3,500.00 | 0 |
| Deals | New / Won / Lost | 9 / 3 / 1 | 9 / 3 / 1 | 0 |
| Deals | Won value | $4,000.00 | $4,000.00 | 0 |
| People | Contacts / Companies | 3 / 2 | 3 / 2 | 0 |
| Receivables | current | 1 / $1,200.00 | 1 / $1,200.00 | 0 |
| Receivables | 1–30 | 0 / $0 | 0 / $0 | 0 |
| Receivables | 31–60 | 1 / $300.00 | 1 / $300.00 | 0 |
| Receivables | 61–90 | 0 / $0 | 0 / $0 | 0 |
| Receivables | 90+ | 1 / $2,000.00 | 1 / $2,000.00 | 0 |
| Receivables | total | $3,500.00 | $3,500.00 | 0 |
| Receivables | **balance, not total** on a part-paid row | $300 balance shown against a $500 invoice | correct | 0 |
| Sources | Website leads / won / value | 5 / 2 / $2,500.00 | 5 / 2 / $2,500.00 | 0 |
| Sources | Referral leads / won / value | 3 / 1 / $1,500.00 | 3 / 1 / $1,500.00 | 0 |
| Sources | Unknown leads | 1 | 1 | 0 |

A negative control was built in: a $9,999.99 quote-only deal, never invoiced and never received, contributed nothing to Revenue or Receivables and only to the Deals "new" count. Evidence: `tests/repo/la-w2/reconciliation.test.ts`.

## J8 — Failure and recovery

Run by LR-LA-W3.

| # | scenario | surface | result | evidence |
| --- | --- | --- | --- | --- |
| J8a | A corrupt keychain item is refused, and the item is **byte-identical** afterwards | Rust | PASS — against the **real** macOS keychain, not the in-memory store | `src-tauri/tests/la_w3_tests.rs::j8a_real_keychain_unreadable_bundle_is_refused_and_byte_identical` reads the raw item via `keyring::Entry` before and after the refusal; a `Drop` guard cleans up, residual entries confirmed zero |
| J8b | A lost keychain entry is reported, and no new key is minted over the data | Rust | PASS | `encryption_tests.rs::a_lost_keychain_entry_is_reported_and_no_new_key_is_minted` |
| J8c | A denied keychain prompt at boot names the actual cause | unit (JS) | PASS at the JS layer | `tests/unit/app/bootFailure.test.ts`, 9 assertions, heading contains "keychain" and both wrong causes are absent |
| J8c′ | The same, at the Rust layer | Rust | **not run here** | `is_access_refusal`/`access_refused` are private and only reachable from a real OS denial, which needs an interactive prompt; pre-existing, already noted in `sec.md` |
| J8d | An older app refuses a newer-schema workspace, naming the versions | repo | PASS | `tests/repo/migrations.test.ts` |
| J8e | Restore from a backup via the **recovery key**, onto a keychain namespace that never held its key | Rust | PASS | `src-tauri/tests/recovery_tests.rs::a_backup_opens_on_a_machine_that_has_never_seen_it` |
| J8f | A pre-0006 backup migrates forward, payments-derived status correct | repo | PASS | `tests/repo/migrationsPxRecheck.test.ts` |
| J8g | A migration that fails partway leaves the prior version, not a half-applied schema | repo | PASS | `tests/repo/migrations.test.ts` partial-failure suite |
| J8h | A concurrent write during an import survives the import's rollback | repo | PASS | `tests/repo/data/automationQueuesBehindImport.test.ts` (F-OPS-12's regression test) |
| J8i | The 30-day purge removes notes, tasks, payments, **PDFs on disk** and search rows | repo | PASS — independently re-proven | new `tests/repo/la-w3/purgeFilesystemProof.test.ts`: a real temp directory and real `existsSync`/SQL after a real `sweepExpiredTrash()`, rather than the existing suite's call-recording mock. All five confirmed gone; a second case proves a note shared with a surviving deal keeps the note |
| J8j | The crash screen's consent copy matches behaviour | unit | PASS — independently re-proven | new `tests/unit/la-w3/crashScreenConsent.test.ts`: renders the real `AppErrorBoundary`, pins the sentence, and arms `fetch`/`XMLHttpRequest`/`sendBeacon` spies before the crash — rendering, Copy and reset never touch the network |

## J9 — Offboarding and data disposition

| # | scenario | surface | result | evidence |
| --- | --- | --- | --- | --- |
| J9.1 | Export everything (CSV + JSON + ZIP), opened for real | repo | PASS | `tests/repo/la-w3/exportEverythingContent.test.ts` loads the zip with JSZip rather than trusting the builder's return value |
| J9.2 | The export contains payments | repo | PASS | payments.csv and the JSON dump, with the reference and the invoice number |
| J9.3 | The export contains a scheduled visit **whole** — its place, its length, its note | repo | PASS after fix F-LA-6 | was failing: `tasks.csv` had no such columns at all |
| J9.4 | The export contains a manifest of attachments | repo | PASS after fix F-LA-6 | was failing: no attachments sheet existed, so the folder of stored names arrived unreadable |
| J9.5 | The export contains an unquoted job's priced service lines | repo | PASS after fix F-LA-6 (second pass) | found by the independent reviewer of the first fix; `deal_items` was in no file and in no exclusion comment |
| J9.6 | The export contains recurring-billing configuration | repo | PASS after fix F-LA-6 (second pass) | `invoice_schedules` had been excluded on a rationale written before recurring invoicing shipped |
| J9.7 | The documented workspace-removal procedure, followed literally | by hand, in a sandbox | PASS | a sandbox under `/private/tmp` with its own `helix.json`, workspace folder and a keychain entry under a distinct service name; torn down and confirmed gone |
| J9.8 | **What remains**, against what the docs say | by hand | the folder (db, backups, attachments, PDFs) is **gone**, as promised; the keychain item **stays**, as the docs already say; the `helix.json` registry row **stays forever**, which the docs did not mention | doc corrected in the same round (see F-LA-7) |

## J10 — Claims against behaviour

| # | claim | source | result | evidence |
| --- | --- | --- | --- | --- |
| J10.1 | Every README "What it does" bullet | README | PASS after fix F-LA-3 | one false bullet found: automations described as three switches the owner turns on, when 0008 seeds two enabled |
| J10.2 | Undo reverses the last twenty things | README | PASS | `UNDO_LIMIT = 20`, `src/app/undo.ts:59` |
| J10.3 | Thirty days of backup history | README, Help | PASS | `src/features/data/lib/retention.ts`, applied by `pruneBackups` |
| J10.4 | Search returns in well under a tenth of a second at scale | README | PASS | repo `perf/scale.test.ts` at 20k; UI wall clock 87 ms at 3,000 (`la-j12.e2e.ts`) |
| J10.5 | Every Help section statement | `src/features/help/lib/content.ts` | PASS after fix F-LA-2 | "Quotes and invoices" described `MarkPaidDialog`, deleted by PX-A, and never mentioned deposits, part payments, balances or the statement |
| J10.6 | Help renders every section it exports | Help screen | PASS after new coverage | twelve sections plus the trouble block, `la-j12.e2e.ts`; the old e2e asserted six |
| J10.7 | "The log does not name a customer" | Help, Diagnostics | PASS | every `pollLog` call carries counts, a status code and the origin only; `tests/unit/leads/pollerLogRedaction.test.ts` |
| J10.8 | "Attachments and exports are plain, unencrypted files" | Backups, Help, README | PASS | copy present on the Backups screen and in Help; matches `backupsFs.ts` and the attachments path |
| J10.9 | "Nothing leaves your computer unless you turn on the AI module or connect a website" | README, Help, Getting started | PASS | two outbound call sites only (`leads.rs`, `src/features/ai/lib/http.ts`); no telemetry, analytics or update ping in the tree |
| J10.10 | CHANGELOG "Not in v1" | CHANGELOG | PASS after fix F-LA-3 | list itself accurate; the automations entry carried the same "switch on" error as the README |
| J10.11 | Design rules: no colour literal outside `tokens.css`, no native date/time input, no raw `<select>` | DESIGN.md §12 | PASS | static sweep clean; the only `rgb()` outside tokens is pdf-lib's, which is not CSS |

## J11 — Regression against the round's baseline `e8e7650`

| # | check | result | evidence |
| --- | --- | --- | --- |
| J11.1 | Every baseline test still exists | PASS with 5 justified renames | 1,866 baseline test titles → 5 absent at HEAD, each with a successor: four/five tabs, four/five groups, "decimal amount"/"decimal balance", six/twelve Help sections, and the Today starter-card test rewritten as "one contact gets guidance, not empty panels" (F-CS-1, asserts more) |
| J11.2 | Every baseline test still passes | PASS | full vitest green, 226 files / 2,765 passed / 3 skipped at the start of this pass |
| J11.3 | No `it.skip`, `test.skip`, `xit` or `.only` added this round | PASS | the only skips are the three pre-existing `it.skipIf(!process.env.HELIX_PDF_SAMPLE)` in `pdfSample.test.ts`, unchanged since baseline; no `#[ignore]` in Rust |
| J11.4 | No assertion loosened this round | PASS with one recorded relaxation | 17 assertion lines removed against 1,790 added — the complete set, not a sample, and every one read. See the note below. |

**The one relaxation, recorded rather than waved through.** `tests/unit/help/content.test.ts` replaced a flat six-sentence budget with a per-section `budgetFor(id)`, and ten of the twelve sections carry a budget above the default with a written reason. That is a relaxation. It came with the change that doubled the rule's reach — the quality rules previously ran over six sections while the screen rendered ten — so coverage went up far more than the per-section bar went down, and each exception is argued in the file rather than implied. Recorded as a deliberate trade, not a finding.

The other sixteen are replacements, not removals: `markPaid`'s rejection tests went with `markPaid`'s dialog (PX-A); the poller's `lastError` assertion is still exact and now asserts the shorter string F-SEC-6 requires (the 401 body is deliberately not carried through, because a rejection body commonly echoes the credential); `applyLeads`' `toHaveLength(1)` became a filtered `leadEntries` length **plus** a new assertion that the speed-to-lead rule wrote exactly one line beside it; and `leads.e2e.ts`'s "cannot reach your website" became the shape error's own sentence, which is a more accurate subject for a malformed page.

## J12 — Performance and layout at realistic scale

3,000 contacts, 400 jobs, 120 tasks. Wall clock from `goto` to the screen's own content being visible, in the real built bundle.

| screen | measured | budget | result | evidence |
| --- | --- | --- | --- | --- |
| Today | 109 ms | 6,000 ms | PASS | `la-j12.e2e.ts` |
| Contacts (3,000) | 216 ms | 8,000 ms | PASS | asserts a row is painted, not just the heading |
| Pipeline | 259 ms | 8,000 ms | PASS | |
| Schedule, one week | 86 ms | 6,000 ms | PASS | |
| Reports: Revenue | 876 ms | 8,000 ms | PASS | the slowest screen, and still under a second |
| Reports: Sources | 130 ms | 6,000 ms | PASS | |
| Search (Cmd+K to a result) | 87 ms | 4,000 ms | PASS | |

The repo layer separately times every query behind these at 20k/5k/10k
(`tests/repo/perf/scale.test.ts`, worst case 32 ms). These numbers are the
other half: React mounting the list, not SQLite answering.

| screen | 1440×900 | 1024×700 | primary blocks | evidence |
| --- | --- | --- | --- | --- |
| Schedule, week | PASS | PASS, no overflow | 2 (sidebar row + "Schedule a visit") | `screens/la/schedule-week-{1440,1024}.png` |
| Schedule, day (`/schedule/day/:date`) | — | PASS, no overflow | ≤2 | `screens/la/schedule-day-1024.png` |
| Settings → Automations | PASS | PASS, no overflow | ≤2 | `screens/la/settings-automations-{1440,1024}.png` |
| Reports → Sources | PASS | PASS, no overflow | ≤2 | `screens/la/reports-sources-{1440,1024}.png` |
| Contacts + BulkBar, 2,999 selected | PASS | PASS | ≤2 | `screens/la/contacts-bulkbar-{1440,1024}.png` |

Screenshots live under `tests/e2e-mac/.cache/screens/la/` and are not
committed. Three of these five screens had never been visited by
`cpoWalk.e2e.ts`, the walk that regenerates the design reference shots, so
before this pass nobody had looked at Schedule, Automations or Sources at the
1024 floor at all.

## J13 — Windows

**Not run here.** macOS cannot run WebView2. What exists, read from the spec
and the workflows rather than assumed:

| | |
| --- | --- |
| `tests/e2e-win` | one file, `smoke.e2e.ts`, four assertions. Walks the three onboarding screens (business name + Landscaping, "Use this setup", "Start empty") then checks: the window title is "Helix CRM", the sidebar renders a Today item, the Today heading is on screen. |
| Build under test | the **debug** app, not the `.msi`/`.exe` a client installs |
| Trigger | push to `main`, pull requests, `workflow_dispatch`, and pushes to `e2e-win/**` |
| Also on Windows | `ci.yml`'s `rust` job runs `cargo test` on `windows-latest`, so the Rust unit tests do cover Windows |
| Covered by nothing | the installer, SmartScreen, Credential Manager (first prompt, denial, post-update reprompt), Copy/Print on real WebView2, backup and restore against real Windows paths, attachments, workspace switching and removal — **and everything this round built**: payments, Schedule, automations, Sources, bulk actions |

Written up as hand checks in `tests/RELEASE-CHECKLIST.md`, section "Windows:
what is covered and what is not". The honest statement today is that Helix is
verified on macOS and smoke-tested on Windows.

## J14 — The installer

| # | check | result | evidence |
| --- | --- | --- | --- |
| J14.1 | `npx tauri build --bundles app` succeeds on this machine at the final revision | PASS, exit 0 | bundle at `src-tauri/target/release/bundle/macos/Helix CRM.app`, 15 MB (binary 15,063,936 bytes), version 0.1.0. An earlier attempt failed only because `beforeBuildCommand` runs `tsc --noEmit` and two concurrent workers had in-flight type errors in their own new test files |
| J14.2 | The bundle was not launched | held | `~/Applications/Helix CRM.app` never launched; `~/Library/Application Support/com.clearpathdigital.helix` never touched by this pass or any of its workers |

## Tenancy analogues (the prompt's role/org items, answered for this product)

Helix has no accounts, sign-up, sessions, invitations, roles, teams, tenants,
subscriptions, billing state or webhooks. Those are **not applicable, by
design** — one owner, one machine, one or more local SQLite files, and a
product that is free. They are not scored as passes. What this product has
instead, and what was therefore tested:

| prompt item | this product's analogue | result | evidence |
| --- | --- | --- | --- |
| Tenant isolation | two workspaces on one install | PASS | `la-workspaces.e2e.ts`: from inside the second workspace, Today, Contacts, Deals, Tasks and search all come back empty of the first's customer, job and note, while the first keeps every row and switching back finds them intact |
| Provisioning and entitlement | the site token lifecycle | PASS | J3, plus `docs/OPERATIONS.md` CL-1..CL-7 |
| Access change on cancellation | token rotation and revocation | PASS | J3.5–J3.9; no ClearPath action can remove a client's data, which is on their machine |
| Data disposition on closure | export everything, then the documented workspace removal | see J9 | |
| Roles, teammates, billing-state changes | none exist | not applicable, by design | no auth, session, role or billing code in the tree |
