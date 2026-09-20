# CPO / CDQO review and execution record (2026-09-20)

Coordinator: Fable (this session). Assignment: `docs/rounds/2026-09-20-cpo-cdqo-prompt.md`,
run verbatim. Protocol: `~/.claude/skills/parallel-delivery/SKILL.md`. Base revision:
main at `487c2b2` (46 ahead of origin, nothing pushed by this session). Ceilings: 3 Opus
leads, each up to 3 Sonnet workers. Commits local, pathspecs only. No app launch.

This file is the durable working record the prompt asks for: the product map, the
findings, the decisions, the tasks, their owners and their verification status. It is
updated as the work moves.

## 1. Baseline (before any change)

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npx vitest run` | 125 files passed, 1 skipped; 1789 tests passed, 2 skipped |
| `cargo test` (src-tauri) | 49 passed across 5 binaries |
| Discovery walk (`tests/e2e-mac/specs/cpoWalk.e2e.ts`, port 4220) | see §3 |
| Working tree | clean at start |

## 2. Product map (observed, not assumed)

**Who.** A solo trade or service owner (the nine ClearPath trades), 40 to 65, on a laptop.
Two jobs: do not lose a lead; remember what was promised. Walker is customer zero
(`docs/PLAN.md`).

**Shape.** Tauri v2 desktop app. React 19 + Vite + TanStack Query + wouter over a
repository layer (`src/db/repos/*`, Drizzle sqlite-proxy) over a Rust SQLite pipe
(`src-tauri/src/db.rs`, SQLCipher at rest). One SQLite file per workspace. No server, no
account. Optional BYO-key AI. Website leads polled from a ClearPath site.

**Entities** (`src/db/schema.ts`, migrations 0000..0004): sources, companies, contacts
(+phones, +emails), pipelines, stages, deals, deal_stage_events, activities, tasks, tags,
tag_links, custom_fields, custom_values, attachments, saved_views, recurring_rules,
templates, products, deal_items, documents (quote | invoice), document_items,
document_sequences, invoice_schedules, settings, lead_sync, change_log, merges.

**Money model** (binding, round 3): Customer → Deal → Invoice → Payment. A document
requires a deal and inherits its customer. `src/db/repos/money.ts` is the single
definition of Quoted / Won / Invoiced / Collected / Outstanding.

**Feature modules** (`src/app/registry.ts`): today, records, data, leads (poller +
reports), ai, settings, onboarding, recurring, templates, help, catalog (services),
invoices. Sidebar groups (`src/app/feature.ts` NAV_GROUPS): Today · Contacts, Companies ·
Deals/Jobs/Quotes, Services, Invoices, Reports · Tasks, Reminders · Import · Trash ·
Settings, Help.

**Routes.** `/`, `/contacts(/:id)`, `/companies(/:id)`, `/pipeline`, `/deals/:id`,
`/tasks`, `/trash`, `/services`, `/invoices`, `/invoices/new`, `/invoices/:id`,
`/reports`, `/reports/{revenue,deals,people,receivables}`, `/recurring`, `/import`,
`/export`, `/duplicates`, `/setup`, `/help`, `/settings/*` (workspace, vocabulary,
appearance, templates, invoices, shortcuts, services, tags, fields, site, backups, ai,
workspaces, diagnostics).

**Background work** (only while the app is open): lead poller (5 min), backup scheduler
(launch + 6 h), duplicate scan (24 h), invoice schedule runner (drafts only).

**Verification available.** Unit + repo suites (Vitest over better-sqlite3), Rust tests,
the macOS Playwright harness (real frontend build, database bridge, every Tauri command
stubbed), screenshots through the harness. Not available in this session: the real
window, the keychain, the real file copy, HTTP, restore, workspace switch (the owner is
asleep and the app may not be launched).

## 3. Discovery walk

`tests/e2e-mac/specs/cpoWalk.e2e.ts` (port 4220, dist-cpo, deleted after): 2 tests
passed in 1.6 min. Dense = onboarding as "Alpine Ridge Landscape" (landscaping preset +
the sample week: 16 contacts, 8 companies, 10 deals, 8 tasks); sparse = empty workspace
with setup skipped. 87 captures at 1280x800 (plus 1024x700 and dark/compact samples) in
`tests/e2e-mac/.cache/screens/cpo/`; `dense-errors.json` and `sparse-errors.json` record
zero page errors and zero console errors across every route, including `/nowhere-at-all`
(a designed "That screen does not exist" state) and every overlay (quick add, search,
palette).

What the coordinator saw, before any lead reported (each became a seed finding below):

- The deal page's primary money block reads "Quoted $0" for a deal the board shows at
  $14,800 (`dense-deal-page.png` vs `dense-pipeline.png`); a won $1,450 deal reads $0 on
  all four figures (`dense-deal-won-page.png`). `money.ts` defines Quoted as quote
  documents; round 3 defined it as the deal's line items.
- Board cards say "No company" for a deal that has a contact (`dense-pipeline.png`).
- The Contacts list has no phone or email column (`dense-contacts.png`).
- Company page subtitle: "1 open jobs" (`dense-company-page.png`).
- Invoices with zero invoices: "Every invoice you have sent has been paid."
  (`dense-invoices.png`); Receivables stacks two empty states
  (`dense-reports-receivables.png`).
- `/import` mounts scrolled so its title is clipped (`dense-import.png`).
- Three record pages each carry a disabled AI button and the sentence "AI is off. Turn it
  on in Settings." for a product that is not AI-first.
- The one-block rule holds on every screen captured; no purple or blue text; no native
  date/time inputs met on the walk; dark mode and 1024 px layouts held.

## 4. Findings

Format: id · severity · class (defect / usability / strategic / hypothesis) · evidence ·
affected workflow · consequence · decision · owner · status.

### 4.1 Coordinator's seed findings (2026-09-20, before the lead audits)

| id | sev | class | finding (evidence) | decision | owner | status |
| --- | --- | --- | --- | --- | --- | --- |
| F-0-1 | high | defect | Deal money strip "Quoted" reads quote documents, not the deal's value; a $14,800 deal and a won $1,450 deal both show $0 (`dense-deal-page.png`, `dense-deal-won-page.png`, `src/db/repos/money.ts` QUOTED, `MoneyStrip.tsx`). Violates the round-3 definition (Quoted = line items = value_cents). | D1: Quoted = deal value_cents everywhere; period Quoted = value of deals created in the period. | lead-money (money.ts, reports), lead-records (strip, deal page) | planned |
| F-0-2 | medium | defect | CompanyPage subtitle "1 open jobs" (`CompanyPage.tsx:118`). | fix plural | lead-records | planned |
| F-0-3 | medium | usability | Board card prints "No company" for a deal with a contact (`DealCard.tsx:95`). | name the customer: contact, else company, else "No customer" | lead-records | planned |
| F-0-4 | high | usability | Contacts list: Name · Company · Tags only; no phone/email (`dense-contacts.png`); PLAN says the owner scans for the phone. | add reach columns; lead proposes exact set | lead-records | planned |
| F-0-5 | medium | usability | "Won on" says "Change it by moving the stage again" but a single won stage cannot be re-picked; fixing a wrong won date needs reopen + re-win (two events). | lead proposes | lead-records | planned |
| F-0-6 | medium | copy | Invoices empty state claims every sent invoice is paid when none exist; Receivables shows two stacked empty states. | one honest empty state per screen | lead-money | planned |
| F-0-7 | low | defect | `/import` mounts scrolled ~20px (`dense-import.png`). | find the autofocus; fix | lead-platform | planned |
| F-0-8 | low | hygiene | Vite build warns on `font-[var(--font-mono)]`: Tailwind's source scan reads docs/design prose. | `@source not` for docs/design | lead-platform | planned |
| F-0-9 | hypothesis | strategic | AI-off sentence + disabled button on every record page (D2: not AI-first). | lead-platform proposes; coordinator decides | lead-platform | open |
| F-0-10 | hypothesis | strategic | Landscaping preset's won stage is "Paid" while Collected counts only invoices: Won ≠ Collected forever for an owner who invoices elsewhere. | lead-money proposes copy; presets unchanged unless evidence | lead-money | open |
| F-0-11 | low | usability | Tasks: header "New task" and an always-open composer with a content-like placeholder; Trash empty state links "Back to Contacts"; deal page shows Expected twice; Reopen has no undo; board carries a permanent instruction line. | lead proposes | lead-records | planned |

### 4.2 Lead findings

**Lead A, records (return relayed to `docs/rounds/cpo-returns/lead-a-records-audit.md`,
23:43).** 18 findings, F-LA-1..18. Critical: quick add double-submits (F-LA-1). High:
pipeline headline counts closed deals (2); Quoted strip (3, = F-0-1); a contact changing
company leaves deals and documents behind (4); the contact page never shows the person's
jobs (5); Today collapses into six empty panels after the first contact (6); lists carry
no phone / next step (7, = F-0-4). Medium: three definitions of overdue (8); trashed
companies named without a mark (9); a wrong won date cannot be corrected (10, = F-0-5);
Reopen has no undo and never recomputes (11); "No company" on cards (12, = F-0-3);
plural (13, = F-0-2); customer strip lacks Open (14). Low: snooze drops the time (15);
two ways to add a task (16); four copy items (17); orphan-stage column (18). Scenario 6
(multiple stakeholders) judged fine for v1; scenarios 7 and 16 owed in the
implementation return. All eight coordinator seeds confirmed.

**Lead A's Sonnet worker W1 (scenarios 10-14; relayed to
`docs/rounds/cpo-returns/lead-a-worker-1.md`).** F-W1-1 = F-LA-8; F-W1-2 a saved view
whose tag was deleted shows a generic empty state (fix: name the missing tag); F-W1-3
search results stale up to 10 s after a write (fix: invalidate `qk.search` in
invalidateRecords); F-W1-4 a task on a trashed deal loses its chip silently. Undo/redo,
persistence, search, views, tasks and reminders otherwise fine. All four go to Lead A's
implementation.

**Lead B, money (returned 00:1x; full text in the coordinator's transcript, summarised
here).** 23 findings, F-LB-1..23. Critical: a malformed `leads_fetch` payload is accepted
as success and manufactures deals (1). High: Quoted from quote documents (2, = F-0-1,
blast radius listed file by file); the Revenue headline and its per-deal table cannot
reconcile when a document's deal is missing or trashed (3); a paid invoice is terminal, no
correction path (4); a sent invoice's bill-to is silently rewritten when the deal's
customer changes (5); the poll error reads "[object Object]" (6); no way to record a
deposit (7, hypothesis). Medium: id-less leads swallow each other (8); a lost deal keeps
drafting monthly invoices (9); schedule drafts appear with no notice (10); untrue empty
states (11, = F-0-6); the sample week has no line items or documents, so the product's
own demo shows $0 everywhere (12); New invoice lets lines diverge from the deal (13);
"New deal for this" lands in the first stage (14); Won vs Collected copy (15, = F-0-10);
a deduped lead's new phone is discarded (16). Low: silent re-poll updates (17); the poll
banner only on Settings (18); no CSV on the two money tables (19); a percent column in
CSV (20); PDF page-break counts rows (21); quote-with-no-lines error copy (22); documents
can never be trashed (23). Arithmetic (tax, numbering, totals across every surface)
verified correct to the cent; scenarios 1, 2, 4, 5, 8, 9 fine.

**Lead C, platform (relayed to `docs/rounds/cpo-returns/lead-c-platform-audit.md`,
00:2x).** 24 findings, F-LC-1..24. High: workspace currency and date format never reach
96 format call sites (1); phone dedupe ignores the workspace region (2); the 30-day Trash
purge never runs and products, custom fields and documents have no Trash path (3); export
covers 5 of ~25 tables and has no entry point (4). Medium: `/import` scroll (5, = F-0-7);
Tailwind scanning prose (6, = F-0-8); shortcuts sheet inconsistencies (7); deleting a
custom field claims values go (8); Deals report ignores vocabulary (9); boot error screen
blames locks for any error (10); Combobox/Select drop aria-describedby (11); Combobox
never scrolls the highlight into view (12). Low: four dialogs defeat the footer hoist (13);
trashed company shown as live (14, = F-LA-9); Diagnostics keychain line always
"available" (15); GB phone hint (16); `color: black` in print CSS (17); PDF fonts hard-coded
(18); onboarding name overwrite hypothesis (19); AI-off sentence (20, = F-0-9); no quick-add
affordance in the toolbar (21); one 2.98 MB chunk (22); `/settings/site` registered twice
(23); InlineText allows type "date" (24). Kit greps clean: zero native date/time inputs,
zero records picked with a Select, zero radius, zero hex outside tokens (one named colour),
one primary block per screen held. Design notes collected for phase two.

Rulings (contract revision 2): R1 `MoneyTotals.openCents` added by lead-money; R2
`moveToStage` with an explicit `at` on the current closed stage updates `closed_at`
without a stage event and writes "Won date changed to …"; R3 `deals.board()` contract
stands, the board renders an "Unassigned stage" column; R4 Reopen recomputes, and
recompute clears the recurring clock when the deal is not won (lead-money). Packet
CPO-LA-IMPL rev 2 sent 23:5x. R5 Quoted is the annual deal value; the Revenue caption
explains the dates. R6 "No job" row in the per-deal table (money) and purge refusal for a
deal with a sent/paid document (records). R7 deposits by a "Deposit invoice" and a balance
invoice with a "Less deposit" line; the payments table is deferred (migration text kept
in Lead B's return). R8 draft-invoice notice inside UnpaidInvoicesSection; `PollNotice`
exported by leads and mounted by records on Today. R9 sample-week money goes to
lead-platform with fixtures from lead-money. R10 draft documents can be trashed
(`document` entity in trash.ts, records). R11 numbering stays continuous across years;
PDF page breaks measured and a 12-line sample rendered. R12 recompute clears the recurring
clock when not won. Packet CPO-LB-IMPL rev 2 sent 00:1x. R13 `useFormats()` in
src/app (lead-platform owns src/lib/money.ts and dates.ts for the pass; each lead sweeps
its own screens after the hook lands). R14 a boot + 24 h purge sweep in data (platform);
`product`, `custom_field`, `document` Trash types and the deal purge refusal in trash.ts
(records). R15 export covers every table; entry from Settings > Data. R16 AI off → no AI
controls on records; on without a key → disabled with the reason as a tooltip and one
short line. R17 shortcuts sheet derived from allCommands. R18 PDF fonts stay the brand
guide's embedded faces (documented exception, deferred). R19 route-level lazy() to phase
two. Packet CPO-LC-IMPL rev 2 sent 00:3x.

### 4.3 Phase-two findings (design pass; product problems it exposed carry F-P2-*)

| id | sev | class | finding (evidence) | decision | owner | status |
| --- | --- | --- | --- | --- | --- | --- |
| F-P2-LB-1 | high | defect | The deal page contradicted itself: money strip "Won $0" above a services panel and Identity card reading $2,560; `invalidateDealMoney` (catalog/lib/dealItemHooks.ts) invalidated every key except `["money"]`, the one the strip reads. Hidden while Quoted came from quote documents; exposed by D1. A reload fixed it, so every navigating test passed. | fixed `2eaa0ff`, pinned in revenue.e2e.ts with a test that never reloads | lead-money | implemented |
| F-P2-LB-2 | medium | defect | Repository validation messages cannot follow the vocabulary ("A document belongs to a deal.") because the pure table lives in src/app, which src/db never imports. | move the pure table to src/lib/vocabulary.ts (lead-platform), then repos read `settings.get("vocabulary")` + `vocabularyFor` (lead-money) | lead-platform → lead-money | in progress |
| F-P2-LB-3 | medium | defect | "Send" reappeared on a paid invoice after F-LB-4 made paid → sent legal (`canSend` asked `canTransition`); pressing it would re-send the PDF and overwrite a live `paid_on`. | Send is a draft action | lead-money | implemented |
| F-P2-LB-4 | low | usability | A draft offered both Void and Delete (two red buttons, different consequences); paid invoices read "Due in 14 days"; "Paid · bank" echoed a stored value; the TAX column said "Yes" on every line while the rate was 0. | draft offers Delete only; due line hidden once paid; method labels; tax column follows `hasMixedTaxability` | lead-money (+W2) | implemented |

Further phase-two findings are appended from each lead's return.

## 5. Decisions

### 5.1 Product decisions (phase one)

- **D1 Quoted is the deal's value.** On a deal, Quoted = `value_cents` (the line items at
  actual price, or the figure typed on a deal with no lines). Over a period, Quoted = the
  value of deals created in that period. `money.ts` is the single definition; the
  document-based sum, if anything still needs it, is renamed to say what it is. Reason:
  the round-3 plan is binding, and the walk showed the current definition producing $0
  beside a $14,800 board card, which is the kind of misleading money the owner's prompt
  calls a serious failure.
- **D2 No new entities without a walk-through that needs them.** A payments table for
  part payments is recorded as a proposal with migration text unless the money lead's
  scenario walk shows the current model losing information the owner will actually
  enter (a deposit). Schema and migrations are coordinator-owned either way.
- **D3 Copy tells the truth about zero.** An empty state may not describe a state the
  workspace is not in ("every invoice you have sent has been paid" with no invoices).
  One empty state per screen, one action.
- **D4 Proportion.** Focused fixes over rewrites; a finding is implemented, deferred with a
  concrete reason, or blocked by a named dependency. Nothing is left as an unexplained
  backlog.

### 5.2 Design direction (phase two, draft before the design audit)

The contract is `docs/DESIGN.md` revision 3.1 and it stands: two faces through the font
switch, the flat five-colour brand, radius 0, hairlines, one primary block per view, no
tinted text. The walk found it holding on every screen. What this pass adds is not a new
look but a set of pattern-level rules the screens do not yet share:

1. **Lists show what the owner scans for.** A list row carries the name, how to reach
   them, where they are, and what is next, before it carries tags. Numeric cells are
   right-aligned tabular; a table never paints an empty white panel below its last row.
2. **One way in per screen.** A screen has one place to add its thing (a header action
   or a composer, not both), and the palette is a shortcut to it, never the only route.
3. **No permanent instructions.** A sentence that explains a control is a tooltip, a
   placeholder or a Help entry, not a line on the screen.
4. **Quiet when off.** An optional module that is off is at most one quiet control; it
   does not narrate its absence on every record.
5. **Money reads the same everywhere.** The four figures in the same order, the primary
   block on the deal's own value, and a won deal reads as won at the top of its page.
6. **Empty, loading and error states are designed and true.** Title, one sentence, one
   action; the sentence is true for the zero-record case; an error says what happened and
   what to do next.
7. **Density is a setting the kit honours**, so no screen hard-codes a height; compact is
   verified on a table, a dialog and the board, not assumed.

These are refined after lead-platform's design notes and the phase-two audit.

## 6. Tasks and ownership

Budget: 3 Opus leads + up to 9 Sonnet workers (ceiling). Shared checkout, disjoint
ownership, pathspec commits. Integration owner: Fable. Merge order: repo-level changes
(money.ts) → feature screens → kit-level design changes → coordinator verification.

| Task | Lead | Writable paths (implementation) | Ports | State |
| --- | --- | --- | --- | --- |
| CPO-LA (records and the day) | lead-records (Opus) | src/features/{records,today,recurring,templates}/**, src/db/repos/{contacts,companies,deals,activities,tasks,tags,customFields,stages,pipelines,recurring,templates,savedViews,search,trash,sources}.ts, their tests, e2e specs records/today/depth/listNav/laAudit | 4231-4233 | audit running |
| CPO-LB (money and leads) | lead-money (Opus) | src/features/{catalog,invoices,leads}/**, src/db/repos/{money,documents,dealItems,products,invoiceSchedules,receivables,reports,leadSync}.ts, their tests, e2e specs invoices/revenue/leads/lbAudit | 4241-4243 | audit running |
| CPO-LC (platform, shell, kit) | lead-platform (Opus) | src/features/{data,settings,onboarding,ai,help}/**, src/app/**, src/ui/**, src/styles/**, src/main.tsx, index.html, public/**, src/db/{client,migrator,changeLog,writeLock,errors}.ts, src/db/drivers/**, src/db/repos/{seed,settings,attachments,merge}.ts, src-tauri/**, their tests, e2e specs data/settings/smoke/onboarding/ai/hig/lcAudit | 4251-4253 | audit running |
| lead-platform also owns for this pass | | src/lib/money.ts, src/lib/dates.ts (R13); src/app/formats.ts (new) | | |
| Coordinator-owned | Fable | src/db/schema.ts, drizzle/**, package.json, package-lock.json, tests/e2e-mac/fixtures.ts, tests/e2e-mac/playwright.config.ts, vite.config.ts, docs/**, README.md, tests/e2e-mac/specs/cpoWalk.e2e.ts | 4220-4229 | — |

Cross-feature mounts (internals belong to the component's lead; the mount point to the
page's lead): DealPage mounts DealServicesPanel + DealInvoicesPanel (money) and
AttachmentList (platform); Today mounts UnpaidInvoicesSection (money); Settings mounts
SiteConnectionScreen (money) and BackupsScreen (platform).

## 7. Verification log

| when | what | result |
| --- | --- | --- |
| 23:02 | baseline: typecheck, `npx vitest run`, `cargo test` | clean; 1789 passed / 2 skipped; 49 passed |
| 23:1x | discovery walk `cpoWalk.e2e.ts` on 4220 | 2 passed; 87 captures; zero page/console errors |
| 23:51 | `835a797` feat(money): Quoted is the deal's value; openCents (lead-money, inspected by Fable) | typecheck clean; vitest 1796 passed / 2 skipped (+7 repo tests: table sums to headline for NULL-deal and trashed-deal) |

| 00:2x | Lead A implementation return (`docs/rounds/cpo-returns/lead-a-records-impl.md`): 32 commits, all verified on main; typecheck clean; vitest 2019 passed / 3 skipped; records+today+depth+listNav e2e 43 passed on 4232. Fable inspected `05a9168`, `52eef7c`, `b0e0099`. | accepted; follow-up CPO-LA-3 (merged-away pages, shared DealsCard) sent |
| 00:32 | `vitest.config.ts` now collects `*.test.tsx` (Fable). `tests/unit/catalog/NewServiceDialog.test.tsx`, never collected since `2441fc9`, runs and fails 1 of 5 (`selectOptions` on a Radix Select) | fix assigned to lead-money |

| 00:4x | Lead A follow-up CPO-LA-3 (`docs/rounds/cpo-returns/lead-a-followup-3.md`): `ab4a665` merged-away records name their survivor and offer no Restore (`trash.mergedInto`, reversed merges excluded); `13d4ed3` CompanyPage on the shared DealsCard; audit specs gone. typecheck clean; 271 tests in area; records+today e2e 31 passed on 4231. Fable inspected `ab4a665`. | accepted; Lead A finished |

| 00:5x | Lead C implementation return (`docs/rounds/cpo-returns/lead-c-platform-impl.md`): 22 commits; 17 findings implemented, F-LC-19 refuted with a pinning test, F-LC-18 and F-LC-22 deferred; tsc clean; 957 tests in its suites; data/settings/smoke/onboarding/ai/hig e2e 62 passed on 4251; zero CSS warnings. Fable inspected `1a4a034`, `b2aed5e`, `fdeeea7`. Contract text placed in CONTRACTS.md (Field wiring on pickers; `FeatureCommand.aliases`) and DESIGN.md §4 (PDF fonts exception). | accepted; Lead C finished phase one |

| 01:0x | Regression found by lead-money: `1ea980d` (Today keeps starter cards until something is on Today) tested tasks, open deals and activities only, so a workspace whose one Today item is an overdue invoice showed "Nothing here yet"; `invoices.e2e.ts` "mark paid from Today" red. | fix packet CPO-LA-4 to lead-records (fourth term from `useOutstandingSummary`, unit test, e2e green) |

| 01:2x | Lead B implementation return (`docs/rounds/cpo-returns/lead-b-money-impl.md`): 16 commits; all 23 findings implemented except F-LB-7's payments table (deferred by R7) and rev 2.1b (refuted: no duplicate route exists); typecheck clean; vitest 2049 passed / 3 skipped; invoices+revenue e2e 17 passed on 4243; leads e2e 23 passed; PDF samples looked at. Fable inspected `7bea580`, `2de8734`, `d2aea80`. | accepted; Lead B finished phase one |

| 01:3x | Lead A CPO-LA-4: `e2813d2` the first-run gate counts every Today section (tasks, open deals, activities, documents of any status, reminders) through a pure `todayIsUnstarted(counts)` with a per-section unit test; invoices+today e2e 27 passed on 4231; full vitest 2049 passed. | accepted; Lead A finished phase one |

| 01:5x | **Gate 1 (phase-one integration, Fable, port 4221):** typecheck clean; vitest 146 files / 2049 passed / 3 skipped; cargo 49 passed; vite build clean (chunk-size warning only, deferred to phase two); full e2e **148 passed** (baseline 121) including `cpoWalk.e2e.ts` re-run on the finished product. Two stranded spec changes from lead-platform committed after passing. | phase one verified |

| 02:0x | Phase one reconciled against the re-run walk (`cpo/` vs `cpo-before/`): won deal reads Won $3,610 · Upfront $1,450 + $180/mo · Invoiced/Collected $1,450 · Outstanding $0; Today lists the overdue invoice; Contacts shows phone and next step; Invoices list true; Revenue Quoted $65,530 / Won $4,530; AI narration gone; quick add in the toolbar. Two leftovers noted for phase two (board column subtotals say "Upfront"; "No company" as content). | phase two dispatched: lead-platform (kit first), lead-records, lead-money |

Incident (00:5x, verified by Fable from the reflog): a lead-money Sonnet worker committed
with `git add <file> && git commit -m …`, which swept another worker's staged PDF files
into `c0bd452 test(leads): …` (content correct, attribution wrong, left as is), then ran
`git reset f7ad4ae` to "fix" it and dropped three later commits: `e4f345b` (re-landed
identical as `2bf1c3d`), `ebcfd10` (re-landed inside `4d22ae4`), `1d60b25` (re-landed by
lead-records on instruction). Nothing lost. Standing rules issued to every agent: commit
only with `git commit -m "…" -- <paths>`; never reset or rewrite shared history.

Notes from `835a797`: `dealItems.recompute` never cleared `recurring_started_on`; MRR is
already stage-gated in `reports.recurringDeals`, so R12 matters for
`invoiceSchedules.ensureForWonDeal` (a re-won deal would back-bill from the old date), and
that is the test it gets. `reports.ts` reads `closed_at` only, never `deal_stage_events`,
so R2 is safe for reports.
