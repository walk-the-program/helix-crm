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

(Populated by each phase below.)

## 3. Decisions

| id | decision | by | rationale |
| --- | --- | --- | --- |
| LR-1 | Phases run strictly in the order SEC → OPS → REV → CS → PX → LA. One Opus lead per phase for SEC/OPS/REV/CS; up to three leads for PX; LA gets an independent lead that implemented nothing. | Fable | The prompt requires each phase closed before the next; the codebase is one shared checkout. |
| LR-2 | No accounts, roles or billing code will be introduced to satisfy a checklist item that does not apply to a local desktop app. Findings that depend on a business decision (pricing, signing budget) are recorded as Walker's decisions, with the implementation prepared where possible. | Fable | Prompt §1 "do not invent a business model". |
| LR-3 | Each lead writes its return to `docs/rounds/launch-returns/<role>.md`; Fable owns this record and merges. | Fable | One writer per file. |

## 4. Task ledger

| task | role | owner | state | children | writable areas | return |
| --- | --- | --- | --- | --- | --- | --- |
| LR-SEC | CSPO | Opus lead | running (12:1x, packet rev 1) | ≤3 Sonnet | see packet | `launch-returns/sec.md` |
| LR-OPS | CROO | Opus lead | planned (after SEC) | ≤3 | | `launch-returns/ops.md` |
| LR-REV | CRevOps | Opus lead | planned (after OPS) | ≤2 | | `launch-returns/rev.md` |
| LR-CS | CCSO | Opus lead | planned (after REV) | ≤3 | | `launch-returns/cs.md` |
| LR-PX | CPEO | up to 3 Opus leads | planned (after CS) | ≤9 total | | `launch-returns/px-*.md` |
| LR-LA | CLAO | Opus lead (fresh) | planned (after PX) | ≤3 | | `launch-returns/la.md` |

## 5. Verification log

| when | what | result |
| --- | --- | --- |
| 12:0x | baseline `e8e7650`: typecheck clean; vitest 2102 passed / 3 skipped; CI + e2e-win green on GitHub; release app built and installed locally | baseline |

## 6. Remaining blockers and operating conditions

(Filled at the end by Fable from the LA return.)
