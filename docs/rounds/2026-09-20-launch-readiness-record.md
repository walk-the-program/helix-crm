# Launch-readiness record (2026-09-20)

Coordinator and integration owner: Fable (main session). Prompt: `2026-09-20-launch-readiness-prompt.md`.
Protocol: `/parallel-delivery` (loaded). Budget: 3 Opus leads + 9 Sonnet workers, one global pool.
Standing rules for every agent: commit only with `git commit -m "…" -- <paths>`; never `git add -A`,
never `git reset`, never `--amend`, never rewrite shared history; local commits only (Fable pushes once
at the end); no real prospect data in the repo (`tests/fixtures/*.csv` is synthetic); no paid APIs;
do not launch the installed app against Walker's live workspace; never weaken a test to pass.

## 1. Launch context (established from evidence, 2026-09-20 12:xx)

Baseline revision: `e8e7650` on main (CI, e2e-win, Release all green; tag v0.1.0 on it).

| question | answer | evidence |
| --- | --- | --- |
| Initial clients | ClearPath Digital's own website clients: solo owners in the nine ClearPath trades (landscaping, home services, dental, med spa, pilates, crossfit, restaurant, wedding venue, church). They install Helix on one Mac or Windows machine. | README "Who it's for"; the 18 ClearPath site templates each expose `GET /api/crm/leads` for Helix (`ClearPath Sites/templates/CRM-ENDPOINT-STATUS.md`, 2026-09-18). |
| Tenancy | Neither single- nor multi-tenant SaaS. Each install is its own deployment: one owner, one machine, one or more local SQLite workspaces. No server, no shared database. | `src-tauri/src/db.rs`, `helix.json` registry, README "Workspaces". |
| Accounts, orgs, roles, subscriptions | None exist. No sign-up, login, session, invitation, role, or subscription code. Walker chose "Nothing now" for an app lock (D17). Whoever can use the OS account can use Helix. | grep for auth/session/role: none; PLAN.md D17. |
| Environments and delivery | Dev (`npm run tauri dev`), local release build (`npx tauri build`), and GitHub: `ci.yml` (typecheck, vitest, cargo), `e2e-win.yml` (real .exe on windows-latest), `release.yml` (tauri-action on tag → GitHub Release with .dmg/.msi/.exe, unsigned). "Production" = the installer a client downloads or that Walker installs by hand. No auto-update. | `.github/workflows/*`, README "Installing". |
| Customer data stored | Contacts (names, phones, emails, addresses, tags, custom fields), companies, deals, activities/notes, tasks, reminders, templates, products, quotes/invoices with line items, attachments (files copied under the workspace), change log, search index, backups. All in `~/Library/Application Support/com.clearpathdigital.helix/workspaces/<id>/` (macOS) or the Windows equivalent. Workspace file SQLCipher-encrypted, key in the OS keychain. | `drizzle/000*.sql` (30 tables), `db.rs`, `secrets.rs`, Diagnostics screen. |
| External services | Exactly two, both opt-in: (1) the client's own ClearPath website, polled every 5 min while open with a bearer token (`leads.rs`, reqwest/rustls, 15 s timeout); (2) Anthropic API with the owner's own key, only on button press (`src/features/ai`). Nothing else: no telemetry, crash reporting, analytics, or update pings. | `leads.rs`, `src/features/ai/lib/http.ts`, CHANGELOG "Not in v1". |
| Onboarding / billing / support / maintenance | Onboarding: in-app first-run (business name, trade preset, import path, optional sample data). Billing: nothing in the app; Helix is AGPL and free; ClearPath's commercial relationship with a client is for the website (not recorded in this repo). Support: "Report an issue on GitHub" in Help; no in-app support channel. Maintenance: automatic local backups (after launch + every 6 h, 30 days kept); updates are manual downloads. | `src/features/onboarding`, `src/features/help`, README. |
| Functional vs placeholder | Everything in the README feature list is implemented and covered by 2102 unit/repo tests, 41 Rust tests and 164 Playwright e2e (mocked Tauri) plus the Windows real-binary suite. Known gaps: payments are a document status (no payments table); PDFs use print faces not the app font; unsigned installers; `CHANGELOG.md` "Not in v1" is stale (lists invoices, recurring reminders, deal import as absent although they ship). | CPO/CDQO record §6.1; CHANGELOG lines 130–145. |

Things the prompt asks about that do not exist here and will be recorded as "not applicable, by design"
rather than built: sign-up/sessions, invitations/roles, tenant isolation across a shared store, webhooks,
rate limits on public endpoints, in-app billing state. The security phase must instead prove what a
local-only app must prove: the data on disk, the two outbound integrations, the keychain, exports,
backups, logs, and the site-lead ingestion path (untrusted input from a public form).

### 1.1 Commercial model (evidence outside this repo, for the REV phase)

- Helix itself carries no price: AGPL, free download. No Helix pricing, plan, trial, or subscription exists anywhere in this repo or in the ClearPath working notes.
- ClearPath's paid relationship with a client is the website build plus hosting. `ClearPath Sites/FOR-THE-NEXT-AGENT.md` (2026-09-16 note) records that website pricing itself is not settled (about $1,000 build, monthly hosting unpriced; earlier $500 + $75–100/mo; a $250/mo AI cohort). That is Walker's decision, not this round's.
- The only "entitlement" that connects a client to Helix is the `CRM_API_TOKEN` on the client's ClearPath site (`.env`), which the client pastes into Helix Settings. Provisioning = Walker sets the token on the site and hands it over; offboarding = rotate or remove it. All eighteen site templates expose `GET /api/crm/leads` behind that token (`templates/CRM-ENDPOINT-STATUS.md`, 2026-09-18, 18/18 tests each).
- Therefore the REV phase evaluates: the token lifecycle (issue, hand over, rotate, revoke), what a client keeps when the site relationship ends (everything: their data is on their machine), and what Walker must track by hand (which client has which token, which Helix version). It does not build billing.

## 2. Findings ledger

Format: `F-<role>-<n>` | class (Blocker / Required / Follow-up) | finding | why that class | fix commit(s) | evidence.
Roles: SEC, OPS, REV, CS, PX (product expansion), LA (launch assurance).

### Rechecks after PX (accepted by Fable)

SEC recheck: F-SEC-R-1 template titles capped and stripped of NUL/bidi (owner template + third-party data now leaves the screen as task titles, .ics SUMMARY, CSV cells); F-SEC-R-2 .ics builder strips after escaping; property injection pinned; everything else clean with hostile cases. OPS recheck: F-OPS-R-1 the "daily" automation sweep ran once per launch (now on the purge sweep's 24 h beat with pause/overlap guards); F-OPS-R-3 a rule creating a task during an import queues and survives the import's rollback (F-OPS-12 holds); migrations 0006–0009 idempotent, newer-schema refusal names all versions; restore of a pre-0006 backup migrates forward; performance non-issue (Schedule week 5 ms); OPERATIONS.md procedures 11–13. CS recheck: first outcome unchanged at 21 actions; imports never fire automations (pinned test); Help absorbed the three sections and its quality checks now cover all ten; two hard-coded "job" strings fixed; example data books one visit; install checklist updated. Docs worker: CONTRACTS.md new binding section, README feature bullets, CHANGELOG Unreleased. Fable: writeLock.ts comment corrected (a nested call hangs on the non-reentrant lock rather than throwing).

### PX (accepted by Fable; returns `launch-returns/px-a.md`, `px-b.md`, `px-c.md`)

Built and verified end to end: **A** payments as records (migration 0006, derived invoice status draft/sent/partial/paid/void, Collected = sum of payments, backfill proven figure-for-figure, Record payment dialog, balances on invoices/lists/contacts/companies/Today, customer Statement PDF, payments in exports and reports; markPaid/markUnpaid removed; RESTRICT + purge order fixed after Lead C found sample removal failing). **B** Schedule module (/schedule week + day, feed over tasks/deals/reminders/invoices/schedules, visit dialog writing timed tasks with place/duration/notes via 0007 + 0009, Add to calendar .ics, Today's schedule section, Today outstanding-balance line from A's contract). **C** automations (0008: three switchable rules, per-stage follow-ups, automation_runs idempotency ledger, synchronous in the triggering write, overdue sweep), Settings → Automations, Leads by source report, bulk actions with a selection model and BulkBar on Contacts and the deals list (no multi-select on the board, argued). Cross-lead defects caught in flight: payments RESTRICT vs sample-data removal (A fixed), bulk tag-removal undo silently doing nothing (C fixed) and the same hole in single-record tag removal (Fable fixed, c9fb6f5). Incidents: two `--amend`s on the shared index by B's workers swept A's MarkPaidDialog deletion into 163c561 (content correct); trailers missing on two worker commits; recorded, not rewritten. Fable also fixed a pre-existing evening-only flake in purgeSweep.test.ts (3948a8e) and repaired the drizzle snapshot chain (0009_snapshot.json).

### CS (accepted by Fable; full table in `launch-returns/cs.md`)

1 Blocker (F-CS-2 = LR-6: recovery key never surfaced in first run; now a persistent Today card until the key is revealed and copied/saved/printed, shared component with Settings → Backups, no nag afterwards), 13 Required (Today said "Nothing here yet" after a 52-customer import; mapper sent "Customer Name" to Skip; preview said "first 20 of 20 rows" for 2,997 rows; import warnings hard-coded to []; undo had no route; sample jobs indistinguishable on the board; removeSampleData left change_log rows; Diagnostics had no single support block; 16 vague or "[object Object]" error strings; silent workspace-rename failure; stale RELEASE-CHECKLIST first-launch section), 6 Follow-ups. First meaningful outcome (customers in, Today true, one job moved): 18 actions / 6 screens before → 21 after, the three extra being the recovery key; frictions 6 → 3. Synthetic messy 3,000-row fixture committed with its run record. docs/ONBOARDING-CHECKLIST.md written. Two release-day hand checks remain (Copy/Print on the real webview).

### REV (accepted by Fable; full table in `launch-returns/rev.md`)

Model confirmed: Helix is free; the site token is the only link to a paying client; nothing billing-related built. 1 Blocker (F-REV-2: a 400 from the site re-sent the same unreadable cursor forever with a misleading "cannot reach your website"), 7 Required (404 blamed the connection; Test connection tested the saved token during rotation; raw `LeadPollAuthError: HTTP 401` shown to the owner; a site gone for good never suggested disconnecting; keychain refusal blamed the website; pasted `CRM_API_TOKEN=`/quotes/placeholder 401'd silently; changing the site address duplicated the pipeline because lead identity carries the origin). Nine lifecycle states each with a pinned string, a test, and a Walker procedure (OPERATIONS.md "Commercial lifecycle" CL-1..CL-7). Proven: no ClearPath action can lose client data. Blank roster template at docs/CLIENT-ROSTER-TEMPLATE.md. Effort per client: install day 45–75 min; each release 10–15 min per client plus a 60–120 min release run. Six decisions for Walker (D-1..D-6 in rev.md §4). Follow-ups: F-REV-12 (external_id re-keying on address change), F-REV-13 (stale RELEASE-CHECKLIST first-launch lines → CS), F-REV-14 (= LR-6 → CS).

### OPS (accepted by Fable; full table in `launch-returns/ops.md`)

1 Blocker (F-OPS-1: no recovery key, so a dead laptop made every encrypted backup unreadable; now a recovery key the owner can show/save/print plus "Open a backup from another machine"), 10 Required: second backup copy to a folder the owner chooses; pre-import backup; keychain-denial boot screen with the right cause; older-app-on-newer-schema refusal; UNIQUE index on deals.external_id (migration 0005); purge-sweep overlap guard; prune could delete the file a restore was copying; restore ordering tested; npm + cargo audit in CI; and F-OPS-12 (the write-lock nesting shortcut let a concurrent writer join an import's transaction and lose its work on rollback), escalated by the lead and fixed by Fable with a mutation-checked repo test. docs/OPERATIONS.md holds ten incident procedures (7 tested, 1 inspected only, 1 needs Walker's machine, 1 mixed) and the founder-task inventory. Scale pass 20k/5k/10k: worst query 32 ms. Decisions: LR-4, LR-5, LR-6 below.

### SEC (accepted by Fable; full table in `launch-returns/sec.md`)

1 Blocker (F-SEC-1: a corrupt keychain item made the app mint a new key over the real one, destroying the workspace), 16 Required (plaintext pre-encryption copy kept; lost key overwritten instead of reported; site 401 body with echoed token reaching helix.log; purge left notes/tasks orphaned and searchable; unbounded lead response body, redirects off-origin with the token, unbounded lead count/field length, JSON-depth stack overflow, infinite poll loop on a stuck cursor; attachment display names with bidi overrides; change_log unbounded; purged documents' PDFs left on disk; CSV formula guard missed LF and leading whitespace; no import size/row limit; unescaped mailto; false claims in CHANGELOG and Help), 12 Follow-ups (delete-workspace command, external_id UNIQUE migration, backoff persistence, export-moment disclosure, etc.). All Blocker/Required fixed with tests. Not applicable by design: accounts, sessions, roles, tenants, webhooks, public rate limits, in-app billing. CI requests handed to OPS: npm audit, cargo audit. Escalations: signing (spending), CONTRACTS.md edits for F-SEC-1/2/3/5 (accepted by Fable).

## 3. Decisions

| id | decision | by | rationale |
| --- | --- | --- | --- |
| LR-1 | Phases run strictly in the order SEC → OPS → REV → CS → PX → LA. One Opus lead per phase for SEC/OPS/REV/CS; up to three leads for PX; LA gets an independent lead that implemented nothing. | Fable | The prompt requires each phase closed before the next; the codebase is one shared checkout. |
| LR-2 | No accounts, roles or billing code will be introduced to satisfy a checklist item that does not apply to a local desktop app. Findings that depend on a business decision (pricing, signing budget) are recorded as Walker's decisions, with the implementation prepared where possible. | Fable | Prompt §1 "do not invent a business model". |
| LR-4 | CONTRACTS.md change accepted: the workspace key may be shown to the owner of the open workspace as a recovery key (narrows SEC's "key never crosses IPC"). | Fable | The owner is the trust boundary of a local app; an unrecoverable backup is the larger risk (F-OPS-1). |
| LR-5 | No scheduled `rustsec/audit-check` run (F-OPS-13): audits run on push only. | Fable | A scheduled run opens GitHub issues on Walker's repo; he never manages GitHub. |
| LR-6 | The recovery key must be surfaced during first run / onboarding, not only in Settings → Backups. Assigned to the CS phase. | Fable | OPS §9: a client who never opens Backups has no key saved, which makes the F-OPS-1 fix optional in practice. |
| PX-1..PX-6 | Product-expansion decisions (build now: payments as records + statement; Schedule view with timed visits; automation + sources report + bulk actions; later/reject lists; automations synchronous; payments on invoices only; visits are timed tasks). | Fable | `launch-returns/px-common.md`; evidence: no payments/calendar/automation/bulk/source-report code exists (grep 2026-09-20), while quote→invoice, reminders, templates, duplicates, saved views, reports already do. |
| LR-3 | Each lead writes its return to `docs/rounds/launch-returns/<role>.md`; Fable owns this record and merges. | Fable | One writer per file. |

## 4. Task ledger

| task | role | owner | state | children | writable areas | return |
| --- | --- | --- | --- | --- | --- | --- |
| LR-SEC | CSPO | Opus lead | accepted 13:xx (24 commits, 552177f..7652ee9) | ≤3 Sonnet | see packet | `launch-returns/sec.md` |
| LR-OPS | CROO | Opus lead | accepted 14:xx (23 commits 44d72d8..38835f8 + Fable's F-OPS-12 fix) | ≤3 | | `launch-returns/ops.md` |
| LR-REV | CRevOps | Opus lead | accepted 15:xx (6 commits d376382..5c358a6) | ≤2 | | `launch-returns/rev.md` |
| LR-CS | CCSO | Opus lead | accepted 16:xx (32 commits 4d23656..889c142) | ≤3 | | `launch-returns/cs.md` |
| LR-PX | CPEO | 3 Opus leads A/B/C | accepted 18:xx; rechecks SEC (433a62e), CS (9ce26c4), OPS (c3ab2b0) and docs worker (e50c955) accepted 19:xx | ≤9 total | | `launch-returns/px-*.md` |
| LR-LA | CLAO | Opus lead (fresh) | accepted 21:xx (verdict at 82c06fc; return e7fd591/0689f9c) | ≤3 | | `launch-returns/la.md` |

## 5. Verification log

| when | what | result |
| --- | --- | --- |
| 22:xx | Release gate: CI on 2e035c6 green incl. the new `e2e` job (202 e2e on the runner), e2e-win green; tag v0.2.0 pushed | round closed |
| 21:xx | LA gate (Fable, 0689f9c): typecheck clean; vitest 235 files / 2798 passed / 3 skipped; cargo 125; build clean; LA's own full e2e 202 passed at 82c06fc | LA accepted |
| 18:xx | PX gate (Fable, e11279d + fixes): typecheck clean; vitest 220 files / 2718 passed / 3 skipped; cargo 123; build clean; `drizzle-kit generate` reports no schema changes after the snapshot repair | PX accepted; rechecks dispatched |
| 16:xx | CS gate (Fable, 889c142): typecheck clean; vitest 186 files / 2373 passed / 3 skipped; cargo 123; build clean; tree clean | CS accepted |
| 15:xx | REV gate (Fable, 5c358a6): typecheck clean; vitest 180 files / 2325 passed / 3 skipped; cargo 123; build clean; tree clean | REV accepted |
| 14:xx | OPS gate (Fable, after F-OPS-12 fix): typecheck clean; vitest 177 files / 2285 passed / 3 skipped; cargo 123 passed; vite build clean; new concurrent-writer test fails on the old code, passes on the fix | OPS accepted |
| 13:xx | SEC gate (Fable, 7652ee9): typecheck clean; vitest 170 files / 2221 passed / 3 skipped; cargo 102 passed; vite build clean; tree clean | SEC accepted |
| 12:0x | baseline `e8e7650`: typecheck clean; vitest 2102 passed / 3 skipped; CI + e2e-win green on GitHub; release app built and installed locally | baseline |

### LA (accepted by Fable; `launch-returns/la.md`, matrix `docs/LAUNCH-ACCEPTANCE.md`)

Verdict: **Ready with specific operating conditions**, no blockers. J1–J14 executed against the integrated app (not read from returns). Required fixes: F-LA-1 the Playwright suite ran in no CI job (added `e2e` job on macos-latest, artifacts failure-only, 7-day retention); F-LA-2 Help's payments section described the deleted Mark paid dialog and said nothing about deposits/balances/statement; F-LA-6 "export everything" lost a visit's place/duration/note, had no attachments manifest and skipped an unquoted job's priced lines (independent reviewer found the third hole). Also fixed: README/CHANGELOG said three rules ship on (two do); timeline line names where to switch a rule off; design walk now covers Schedule/Automations/Sources at 1024. Regression: all 1,866 baseline test titles accounted for (5 justified renames), no skips or `.only` added, all 17 removed assertions read (16 replacements, 1 recorded relaxation). Performance at 3,000 contacts: Today 109 ms, Contacts 216 ms, search 87 ms. Release bundle builds (15 MB), not launched. Deferred: F-LA-7 reopening an archived workspace whose folder was deleted silently creates an empty one (Help warns; boot-path fix handed off).

## 6. Remaining blockers and operating conditions

**Blockers: none.** Every Blocker found in the round (F-SEC-1 key overwrite, F-OPS-1 no recovery key, F-REV-2 cursor loop, F-CS-2 key never surfaced) is fixed with tests and re-verified by launch assurance.

**Operating conditions (owner: Walker), from `la.md` §VERDICT:** C1 real app on a never-run Mac (RELEASE-CHECKLIST "First launch", Keychain **Always Allow**); C2 recovery-key Copy/Print on the real webview; C3 Windows is smoke-tested only, nothing built this round has run there: onboard Mac clients first or run the Windows checklist section; C4 the new CI `e2e` job must be green on the first push before tagging; C5 second backup folder is an install-day step; C6 unsigned installers (decision D-4); C7 do not reopen a removed workspace (F-LA-7 deferred); C8 token hand-over by hand per CL-1 before install day; C9 keep the client roster, there is no telemetry.

**Decisions for Walker (prepared, not made):** D-1 website pricing; D-2 whether Helix is "included" or a free extra; D-3 in-person install vs self-install; D-4 code-signing budget (largest recurring friction, escalated by SEC, REV, LA); D-5 opt-in update check (recommended shape: a manual button, no background call); D-6 where the roster lives. F-OPS-13 scheduled audit runs declined (LR-5).

**Deferred improvements (recorded in the returns):** delete-workspace command (F-SEC-27), backoff persistence (F-SEC-29), export-moment plaintext disclosure for statement/.ics (F-SEC-32, F-SEC-R follow-ups), external_id re-keying on a site address change (F-REV-12), payments import, deposit request on a quote, OS notifications, multi-select on the pipeline board, quadratic wrapText (F-SEC-25), F-LA-7 boot-path fix, `tags.setTags` peers audited for the same undo shape.

**Push and release:** main pushed at 941ca78 (release 0.2.0 bump), then fd73b6b (CI headroom for the screen-capture walk and one toast wait after the new `e2e` job's first run timed out on the macOS runner) and 2e035c6 (Walker's request after seeing 0.2.0: pages refetch on open/switch/focus, Refresh command on mod+R / View menu / palette). CI on 2e035c6: js, rust (macOS + Windows), e2e, Security audit, rust-audit all green; e2e-win green. **C4 is cleared.** Tag v0.2.0 set on 2e035c6; GitHub Release builds the installers from it. Local 0.2.0 app installed from the same commit.
