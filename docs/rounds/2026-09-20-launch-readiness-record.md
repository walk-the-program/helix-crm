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
| LR-3 | Each lead writes its return to `docs/rounds/launch-returns/<role>.md`; Fable owns this record and merges. | Fable | One writer per file. |

## 4. Task ledger

| task | role | owner | state | children | writable areas | return |
| --- | --- | --- | --- | --- | --- | --- |
| LR-SEC | CSPO | Opus lead | accepted 13:xx (24 commits, 552177f..7652ee9) | ≤3 Sonnet | see packet | `launch-returns/sec.md` |
| LR-OPS | CROO | Opus lead | accepted 14:xx (23 commits 44d72d8..38835f8 + Fable's F-OPS-12 fix) | ≤3 | | `launch-returns/ops.md` |
| LR-REV | CRevOps | Opus lead | accepted 15:xx (6 commits d376382..5c358a6) | ≤2 | | `launch-returns/rev.md` |
| LR-CS | CCSO | Opus lead | running (packet rev 1) | ≤3 | | `launch-returns/cs.md` |
| LR-PX | CPEO | up to 3 Opus leads | planned (after CS) | ≤9 total | | `launch-returns/px-*.md` |
| LR-LA | CLAO | Opus lead (fresh) | planned (after PX) | ≤3 | | `launch-returns/la.md` |

## 5. Verification log

| when | what | result |
| --- | --- | --- |
| 15:xx | REV gate (Fable, 5c358a6): typecheck clean; vitest 180 files / 2325 passed / 3 skipped; cargo 123; build clean; tree clean | REV accepted |
| 14:xx | OPS gate (Fable, after F-OPS-12 fix): typecheck clean; vitest 177 files / 2285 passed / 3 skipped; cargo 123 passed; vite build clean; new concurrent-writer test fails on the old code, passes on the fix | OPS accepted |
| 13:xx | SEC gate (Fable, 7652ee9): typecheck clean; vitest 170 files / 2221 passed / 3 skipped; cargo 102 passed; vite build clean; tree clean | SEC accepted |
| 12:0x | baseline `e8e7650`: typecheck clean; vitest 2102 passed / 3 skipped; CI + e2e-win green on GitHub; release app built and installed locally | baseline |

## 6. Remaining blockers and operating conditions

(Filled at the end by Fable from the LA return.)
