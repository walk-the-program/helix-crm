# 08. Agent working rules

The exact rules every agent follows in this repo. They came from Walker's
instructions and from things that went wrong (each lesson names its source).
Breaking one is a defect in your work even if the code is right. The compressed
form is the repo's `CLAUDE.md`; this file has the reasons.

Walker's global instructions (`~/.claude/CLAUDE.md`) also apply and are not
repeated here: skill routing, communication style, efficient orchestration and
model routing. This file adds what is specific to Helix.

## 1. Parallel work

- `/parallel-delivery` is **required whenever a task calls for agents running in
  parallel** (multi-agent builds, fan-out research, parallel reviews). Invoke it
  first and follow it; do not start parallel agents any other way. (`~/.claude/CLAUDE.md`,
  "Parallel work".) Every child agent must be told to read
  `/Users/walker_tracy/.claude/skills/parallel-delivery/SKILL.md`; do not assume
  inheritance.
- Roles: Fable coordinates and is the integration owner and final QC; Opus leads own
  a workstream; Sonnet workers do bounded work and do not delegate. Ceiling used in
  the last rounds: 3 Opus leads plus 9 Sonnet workers in one global pool.
- One active writer per file or shared resource (shared types, migrations, lockfiles,
  `src/db/schema.ts` per table block, generated output, the task ledger). A parent does
  not edit a file its child owns. If you need someone else's file, put the request in
  your return and do not edit it.
- **Worker notifications route to the coordinator.** The coordinator relays them.
  Leads never poll with sleep loops; they wait for the relay. (Lesson, launch round.)
- Workers submit; parents accept. A completion message is not verification: the parent
  inspects the actual diff and evidence. Return format: TASK / ATTEMPT / PACKET REVISION;
  STATUS (submitted or blocked, never self-accepted); DELIVERED; ACCEPTANCE per
  criterion with evidence; VERIFICATION with exact commands, results and revision;
  DEVIATIONS; HANDOFF.
- Model use is subscription-only (see 3). Do not silently substitute models.

## 2. Git

Walker never manages GitHub. Source: "I never, ever want to deal with pull requests or
merge or whatever. I never want to manage GitHub." and the global rule "Commit straight
to main, push once per finished round of work, and never create pull requests,
branches, or merges for me to deal with."

- Work on `main`. No branches, no pull requests, no merges. Do not ask Walker about
  GitHub mechanics.
- **Commit by pathspec only:** `git add <paths> && git commit -m "..." -- <paths>`.
  Never `git add -A`, `git add .`, `git reset`, `git commit --amend`, `git stash`,
  `git checkout`/`restore` of files you do not own, or any history rewrite on the
  shared checkout. Lesson: two `--amend`s on the shared index swept another lead's
  deletion into the wrong commit (launch record §2; CPO/CDQO record §6.1 lists two more
  wrong-message commits), and memory `helix-crm-product.md` records `--amend`/`stash`
  causing swept files twice. Content was recovered; history was not rewritten.
- Commit locally. Commit messages are prefixed by area (`feat(records): ...`,
  `fix(tags): ...`, `docs(rounds): ...`, `test(e2e): ...`). End every commit with the
  Co-Authored-By trailer your session specifies for your model. Missing trailers on
  worker commits were recorded as an incident.
- **One push per finished round, by the director (Fable), after verification.** Workers
  and leads never push.
- Never touch changes you did not make. `git status` before you start; at the end it
  should show only your files. Full e2e runs re-render committed screenshots under
  `design/`; expect a few PNGs to show as modified (byte churn from re-rendering). Do
  not commit them and do not "clean" them.

## 3. Cost

"Nothing may incur cost." (Walker, CPO prompt header.)

- No metered or paid third-party model APIs. All model usage goes through the Claude
  Code subscription; if a skill or task needs an external API key, stop and ask.
- No paid services, no new network calls, no telemetry, no crash reporting, no update
  pings. Helix's only outbound calls are the owner's own ClearPath site and the owner's
  own Anthropic key on a button press.
- GitHub Actions is free because the repo is public. Keep CI artifacts failure-only
  (`if: failure()`; `e2e` retention 7 days, `e2e-win` 3). Do not add a `schedule`
  trigger: scheduled `rustsec/audit-check` opens GitHub issues on Walker's repo
  (decision LR-5).
- Code signing is a spend and Walker's decision (07, D-4). Do not buy, subscribe or
  wire secrets that imply a purchase.

## 4. Data and safety

- **Never launch the installed app** (`~/Applications/Helix CRM.app`) unasked, and never
  touch Walker's live workspace at `~/Library/Application Support/com.clearpathdigital.helix`.
  Walker is sometimes asleep; real-window checks wait for his next launch. The macOS
  e2e harness stubs Tauri, so tests never need the real app.
- No real prospect or client data in the repo. Fixtures in `tests/fixtures/` are
  synthetic: `.example` domains (`owner@ironpeaklandscape.example`), 555 phone numbers
  (`801-555-0101`). Walker's real export lives outside the repo at
  `ClearPath Sites/crm/data/helix-import.csv`; the fixture with a similar name is
  synthetic. The client roster stays outside the repo too, and never holds a token, a
  recovery key, a client's Anthropic key or client CRM data.
- Never send customer communications, initiate real financial transactions, deploy
  publicly or delete production data. Do not touch the old outreach CRM in
  `ClearPath Sites/crm/`.
- Do not invent business terms: pricing, plans, trial rules, what is "included". Those
  are Walker's (07, D-1 to D-6). Prepare, record, and stop.
- Do not add accounts, roles, sessions, invitations, tenants or billing: they do not
  exist by design (decision LR-2).

## 5. Design

`docs/DESIGN.md` (revision 3.1) is binding. "This file decides. If a component
disagrees with it, the component is wrong."

- Colour, size and duration only through tokens in `src/styles/tokens.css`. No hex,
  `rgb()`, `hsl()` outside that file. No hard-coded px height or font size in a
  component (it breaks compact density).
- Fonts only through the one font switch at the top of `tokens.css`; never
  grep-and-replace fonts.
- Radius 0 everywhere. Flat fills. No blurred shadow, no `--shadow-sticker`, no
  gradient, no tinted or purple/blue text (links are ink with an underline), no accent
  background, no emoji anywhere including code comments and alt text.
- **One primary block per view.** Selected sidebar row plus, on a screen with a
  primary action, the primary button.
- **Vocabulary system:** Deals/Jobs/Quotes go through `src/app/vocabulary.ts`; never
  hard-code "job" or "deal" in owner-facing strings.
- Icons through `src/ui/icons.ts` (Phosphor). Dates and times through
  `src/ui/DatePicker.tsx` and `TimePicker.tsx`; picking a record through `Combobox`.
  Never a native date or time input, never a `Select` for records.
- Dialogs on the kit `Overlay`/`Dialog`; tables through the kit `Table`; money through
  `useFormats().money` / `moneyOrDash`; empty states have one action and tell the truth
  about zero.
- Voice: direct, specific, warm. Buttons name what happens ("Save changes"). Errors
  say what went wrong and what to do. Toasts are past tense. No hype, jargon, filler,
  exclamation marks, apologies.
- The sidebar is grouped by relation (`NAV_ORDER` in `src/app/feature.ts`); stages
  always appear in pipeline order; every invoice and quote is tied to a deal; one
  money definition in `src/db/repos/money.ts`.
- Never set a long `staleTime` on a Helix query (`docs/CONTRACTS.md` "Fresh pages").
  Local reads are cheap; stale numbers are what Walker notices first.

## 6. Architecture and migrations

- Feature modules register in `src/app/registry.ts`; repositories in `src/db/repos/*`
  validate with zod (`ValidationError`); every write runs under `withWrite` /
  `withTransaction` and never nests a transaction (a nested call hangs on the
  non-reentrant lock; F-OPS-12 was a nesting shortcut that lost a concurrent writer's
  work). Undoable writes log the **whole row** in `change_log` (an id-less `before`
  makes undo report success and restore nothing; `c9fb6f5`). Money is integer cents;
  dates `YYYY-MM-DD`; instants ISO UTC. Interfaces between agents are pinned in
  `docs/CONTRACTS.md`; contract changes go through the coordinator.
- **Migrations** are forward-only SQL in `drizzle/NNNN_name.sql` plus the journal
  `drizzle/meta/_journal.json`, `src/db/schema.ts`, and must pass
  `tests/repo/migrations.test.ts` and handle existing rows. Hand-written migrations
  (0006 to 0008 were) leave no snapshot, so `drizzle/meta` has snapshots 0000 to 0005
  and `0009_snapshot.json`; that last file repaired the chain, and generate would
  otherwise re-diff everything. Respect it. Run `npx drizzle-kit generate`
  (`npm run drizzle:generate`) **only when `src/db/schema.ts` changed**, and check it
  produces exactly the intended diff and nothing else. After a hand-written migration,
  confirm `npx drizzle-kit generate` reports no schema changes. Migration numbers are
  assigned by the coordinator; do not take another lead's number.
- `docs/CONTRACTS.md`, `docs/OPERATIONS.md`, `docs/ONBOARDING-CHECKLIST.md`,
  `README.md`, `CHANGELOG.md`, Help content and the round record are owned by the
  coordinator; leads propose text in their returns.

## 7. Tests and verification

- **Never weaken a test to get a pass.** No skips, no `.only`, no relaxed assertion
  without a recorded reason. Fix the code or report the conflict.
- Bar before any acceptance:
  1. `npm run typecheck` clean.
  2. `npx vitest run` green (whole suite; 2,798 passed and 3 skipped at the last gate).
  3. `cd src-tauri && cargo test` green if Rust was touched (125 at the last gate).
  4. `npm run build` clean.
  5. e2e for the areas touched, on a unique port with its own output folder:
     `E2E_PORT=<port> E2E_OUT=dist-<name> npm run e2e:mac [-- <spec>]` (202 e2e at the
     last gate). Never use the default 4173 in parallel with others. **Remove your
     `dist-<name>` folder afterwards.**
  6. A mutation check on at least one new guard: the test must fail on the old code.
- Repo tests (`tests/repo/**`) run real SQLite through the production driver; unit tests
  in `tests/unit/**`; e2e in `tests/e2e-mac/specs/**` against a mocked Tauri layer.
  What none of these prove is on `tests/RELEASE-CHECKLIST.md` (real window, keychain,
  clipboard, Windows).
- Report checks actually run, with revision. Distinguish failures, pre-existing
  failures and checks not run. A flaky failure under load is reported as such and
  re-run, not hidden.

## 8. Records

- Every round writes `docs/rounds/<date>-<round>-record.md` (findings with ids
  `F-<role>-<n>`, classes Blocker / Required / Follow-up, decisions, task ledger,
  verification log with revision) and leads write returns under a `...-returns/`
  folder, one writer per file. Prompts from Walker are saved verbatim beside them
  (`<date>-<round>-prompt.md`).
- Findings are implemented, deferred with a concrete reason, or blocked by a named
  dependency. No unexplained backlog.
- `docs/STATUS.md` is append-only, newest at the bottom; do not rewrite it.
- Final report to Walker: outcome first; verdict; most consequential findings; what was
  actually verified; what is deferred. No unprioritised recommendation lists.

---

Verified against: `~/.claude/CLAUDE.md` ("Parallel work", "Constraints", "GitHub");
`docs/rounds/2026-09-20-launch-readiness-record.md` (standing rules, §2, §3);
`docs/rounds/launch-returns/px-common.md` (standing rules, verification bar, ownership);
`docs/ORCHESTRATION.md` ("After round 3"); `docs/DESIGN.md` §11, §12;
`docs/CONTRACTS.md` "Fresh pages"; `CONTRIBUTING.md` (commit prefixes, migrations);
`tests/e2e-mac/playwright.config.ts` (`E2E_PORT`, `E2E_OUT`); `.github/workflows/ci.yml`,
`e2e-win.yml`; `drizzle/meta/` listing; `tests/fixtures/*.csv`; memory
`feedback-github-no-prs.md`, `helix-crm-product.md`; at `2e9fb04`, 2026-09-28.
