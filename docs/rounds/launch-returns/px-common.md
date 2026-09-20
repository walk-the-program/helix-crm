# LR-PX common brief (Chief Product Expansion Officer phase), packet rev 1

Coordinator: Fable. Base revision: `889c142` (SEC, OPS, REV, CS phases accepted). Three Opus leads
run in parallel, each with up to 3 Sonnet workers (one global pool of 9). Every lead and worker reads
`/Users/walker_tracy/.claude/skills/parallel-delivery/SKILL.md` first and follows it.

## Charter

`docs/rounds/2026-09-20-launch-readiness-prompt.md`, section "Chief Product Expansion Officer" plus
sections 7 and 8. Standard: "This capability belongs in this CRM, solves a concrete problem, and now
works end to end." A vertical slice is data model → repository → UI → feedback and failure handling →
search/reports/undo/export integration where relevant → tests. A button, a mocked screen or a
hard-coded result does not count.

## Standing rules (verbatim for every agent)

- Commit only with `git add <paths> && git commit -m "…" -- <paths>`; never `git add -A`, `git reset`,
  `--amend`, or any history rewrite. Local commits only; Fable pushes. Trailer:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` (Sonnet workers: `Claude Sonnet 5`).
- One active writer per file. Ownership below is binding; if you need a file another lead owns, put
  the request in your return (or message Fable) and do not edit it.
- Never launch `~/Applications/Helix CRM.app`; never touch `~/Library/Application Support/com.clearpathdigital.helix`.
  No paid services, no new network calls, no telemetry. Never weaken a test.
- `docs/DESIGN.md` is binding: brand voice; the vocabulary system (Deals/Jobs/Quotes via
  `src/app/vocabulary.ts`); colours only from `src/styles/tokens.css`; Phosphor icons via
  `src/ui/icons.ts`; no native date/time inputs (use `src/ui/DatePicker.tsx`, `TimePicker.tsx`,
  `Combobox.tsx`); radius 0; one primary block per view; empty states with one action; money through
  `useFormats().money` / `moneyOrDash`; dialogs on the kit `Overlay`/`Dialog`; tables through the kit
  `Table` (`TBody`, `TD dashZero`).
- Architecture: feature modules registered in `src/app/registry.ts` (`FeatureModule`: routes, nav,
  commands with aliases, overlays); repositories in `src/db/repos/*` with zod validation and
  `ValidationError`; every write under `withWrite`/`withTransaction` (never nest transactions);
  `change_log` entries for undo via the existing helpers; FTS through `src/db/repos/search.ts`
  conventions; money in integer cents; dates as ISO `YYYY-MM-DD`, instants as ISO UTC.
- Migrations: forward-only SQL in `drizzle/NNNN_name.sql` + `drizzle/meta` journal + `src/db/schema.ts`.
  Numbers are assigned below; do not take another lead's number. Every migration must pass
  `tests/repo/migrations.test.ts` (transaction-safety) and handle existing rows (backfill).
- Tests: `npm run typecheck`; `npx vitest run` (2373 passing at base); `cd src-tauri && cargo test`
  (123); Playwright e2e with mocked Tauri: `E2E_PORT=<your range> E2E_OUT=<your dist> npm run e2e:mac
  [-- <spec>]`; remove your dist folder after. Unit tests in `tests/unit/**`, repo tests (real SQLite
  through the production driver) in `tests/repo/**`, e2e specs in `tests/e2e-mac/specs/**`.
- Returns: `docs/rounds/launch-returns/px-<a|b|c>.md` in the protocol format (TASK/ATTEMPT/REV;
  STATUS; DELIVERED; CANDIDATES CONSIDERED with build-now/later/reject and reasons; per feature:
  user + problem, evidence of the gap, workaround avoided, smallest complete version, acceptance
  criteria → pass/fail with evidence; VERIFICATION with commands, results, revision; PROPOSED TEXT for
  `docs/CONTRACTS.md` and for Help (`src/features/help/lib/content.ts`), which Fable integrates;
  DEVIATIONS; ESCALATIONS; HANDOFF). Commit the return. Final message to Fable: 12 lines.

## Decisions already made by Fable (do not re-litigate; escalate with evidence if wrong)

| id | decision |
| --- | --- |
| PX-1 | Build now: (A) payments as records with balances and a customer statement; (B) a Schedule view over dated work with timed visits and single-item calendar export; (C) speed-to-lead and follow-up automation, a leads-by-source report, and bulk actions on lists. |
| PX-2 | Later (recorded, not built): OS notifications for due work; opt-in update check (Walker's decision D-5); external_id re-keying on site address change (F-REV-12); payments import; deposit request on a quote; multi-currency. |
| PX-3 | Reject: sending email from Helix (product promise: Helix never sends); teams/sync/portal (no server by design); map view; time or expense tracking; e-signature; contact photos. |
| PX-4 | Automations run synchronously inside the triggering write's transaction and create ordinary tasks; there is no job queue and no background scheduler beyond what exists. Rules are few, fixed in kind, and switchable in Settings. |
| PX-5 | Payments attach to invoices only. A deposit is either a deposit invoice (existing ruling R7) or a partial payment on the one invoice. `Collected` everywhere becomes the sum of payments; the backfill creates one payment per already-paid invoice so every report number is unchanged at upgrade. |
| PX-6 | Visits are tasks with a time (`tasks.due_at`) and an optional place; no new "appointments" table. The Schedule screen reads tasks, deals' expected dates, reminders' next due dates, invoice due dates and invoice-schedule next issue dates. |

## Ownership (binding)

| area | owner |
| --- | --- |
| `drizzle/0006_payments.sql`, `src/db/repos/payments.ts` (new), `src/db/repos/documents.ts`, `src/db/repos/money.ts`, `src/db/repos/reports.ts` revenue/receivables functions, `src/features/invoices/**`, `src/features/records/**/…Money…`/customer money cards (files listed in A's packet), Revenue + Receivables report screens, PDF render (`renderDocument.ts`) | **Lead A** |
| `drizzle/0007_visits.sql` (only if needed), `src/db/repos/tasks.ts`, `src/features/schedule/**` (new module), `src/app/registry.ts` (module list + nav order), `src/features/today/**`, `src/ui/TimePicker.tsx` fixes | **Lead B** |
| `drizzle/0008_automations.sql`, `src/db/repos/stages.ts`, `src/db/repos/automations.ts` (new), `src/db/repos/deals.ts` (stage-move hook only), `src/features/leads/**` (lead apply hook, Sources report screen, reports OverviewScreen), `src/features/settings/**` (Automations section), `src/features/records/screens/ContactsScreen.tsx`, `DealsListScreen`/board bulk selection, `src/ui/BulkBar.tsx` (new) | **Lead C** |
| `src/db/schema.ts` | split by table: A adds `payments`; B adds any `tasks` column; C adds `stages` columns + `automations`. Each edits only its own table block; commit promptly to reduce collisions. |
| `docs/CONTRACTS.md`, `docs/OPERATIONS.md`, `docs/ONBOARDING-CHECKLIST.md`, `README.md`, `CHANGELOG.md`, `src/features/help/lib/content.ts`, `docs/rounds/2026-09-20-launch-readiness-record.md` | **Fable** (leads propose text in their returns) |
| `tests/e2e-mac/specs/*.e2e.ts` | each lead adds NEW spec files named `px-a-*.e2e.ts` etc.; existing specs may be edited only by the lead whose feature area they cover (invoices/revenue → A; today/tasks → B; leads/records/settings → C). |
| e2e ports and dist | A: 4300–4309, `dist-pxa`; B: 4310–4319, `dist-pxb`; C: 4320–4329, `dist-pxc` |

Shared surface every lead touches by calling, never editing: `tasks.create` (B owns the file; A and C
call it), `documents.*` (A owns; C's "quote sent" trigger hooks via a callback registered from
`documents.ts`, contract below), `search.ts` (Fable owns; request indexing changes in the return).

## Cross-lead contracts (fixed for this phase)

1. **Task creation** (B owns `tasks.ts`; existing API stays): `tasks.create({ title, dueOn?, dueAt?, contactId?, companyId?, dealId?, source?: "automation" | "user" })`. B adds the optional `source` column/field (default `"user"`) so automation-created tasks can be told apart and listed; C relies on it. B commits this first (within its first hour) and tells Fable.
2. **Document status hook** (A owns `documents.ts`): A exports `onDocumentStatusChanged(listener: (event: { document: Document; from: DocumentStatus; to: DocumentStatus }) => Promise<void>): () => void` and calls listeners inside the same transaction after the status write. C registers its "quote sent → follow-up task" rule there. A commits the hook first (within its first hour).
3. **Stage move hook** (C owns `stages.ts`/`deals.ts` move path): C implements per-stage follow-up rules directly in `deals.moveToStage`.
4. **Lead arrival hook** (C owns `applyLeadPage`): C creates the speed-to-lead task inside the per-lead batch.
5. **Money vocabulary** (A owns `money.ts`): `collectedCents` = sum of payments; `outstandingCents` = sent invoices' totals minus their payments; an invoice is `paid` when payments ≥ total, `partial` when 0 < payments < total (new status, invoice-only), `sent` when unpaid. Quotes unchanged. A publishes the final `InvoiceStatus` type in its first commit; nobody else reads payments directly.
6. **Schedule feed** (B): a pure `scheduleItems(range)` in `src/features/schedule/lib/feed.ts` reads tasks, deals, recurring rules, documents (due dates), invoice_schedules through their existing repos; no new denormalised table.

## Verification bar for each lead

Typecheck clean; `npx vitest run` green (whole suite, not just yours); `cargo test` green if Rust was
touched; your new e2e spec(s) green on your port plus the existing specs for your area; `npm run
build` clean; a mutation check on at least one new guard; empty state, failure state, persistence
across reopen, undo where the feature writes, and search/reports/export integration verified and
described. Tree clean, dist removed, nothing running at return.
