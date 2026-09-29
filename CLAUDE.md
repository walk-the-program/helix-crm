# Helix CRM: project instructions

Walker's global `~/.claude/CLAUDE.md` applies (skill routing, communication style,
GitHub, efficient orchestration). This file adds what is specific to this repo and
does not repeat those rules. Full reasons for everything below: `docs/handoff/08-agent-working-rules.md`.

## What Helix is

Helix CRM is an open-source (AGPL-3.0) Tauri v2 desktop CRM (React, TypeScript, Vite;
SQLite through a small Rust pipe; SQLCipher-encrypted, key in the OS keychain) for solo
trade and service owners, the nine ClearPath website trades. Mac and Windows, local
first, no account, no cloud, no telemetry. Not AI-first: AI is an optional
bring-your-own-Anthropic-key button. Owner: Walker Tracy (ClearPath Digital), the only
stakeholder. State: v0.2.0 (tag on `2e035c6`), verdict "Ready with specific operating
conditions", no blockers. Helix has no price; the site's `CRM_API_TOKEN` is the only
link to a paying ClearPath client. Repo: `https://github.com/walk-the-program/helix-crm`.

## Read first, in order

1. `docs/handoff/README.md`, then `docs/handoff/01` to `08` (the handoff set).
2. `docs/rounds/2026-09-20-launch-readiness-record.md` (verdict, conditions C1 to C9,
   deferred items, decisions).
3. `docs/OPERATIONS.md` (13 procedures, commercial lifecycle CL-1 to CL-7).
4. `docs/CONTRACTS.md` (every binding interface; read the section you are touching).
5. `docs/DESIGN.md` (binding design contract, revision 3.1).
Search, do not read whole: `docs/STATUS.md` (append-only, 4,000+ lines) and
`docs/rounds/launch-returns/*`.

## Non-negotiable rules

Git
- Commit by pathspec only: `git add <paths> && git commit -m "..." -- <paths>`. Never
  `git add -A`/`.`, `reset`, `--amend`, `stash`, or history rewrites on the shared checkout.
- Commit to `main`, locally. One push per finished round, by the director. No PRs, no
  branches, no merges. Commit prefixes by area (`feat(records):`, `fix(tags):`).
- Touch only files you own; `git status` at the end shows only yours. e2e runs churn a few
  `design/**.png` files; leave them.

Parallel work
- Agents in parallel go through `/parallel-delivery`, and every child reads its SKILL.md.
  One writer per file. Worker notifications route to the coordinator; leads never poll or
  sleep-loop. A completion message is not verification.

Cost and data
- Nothing may cost Walker money: subscription models only, no paid APIs or services, no new
  network calls, no telemetry, no `schedule` CI triggers, no signing spend (his call, D-4).
- Never launch the installed app (`~/Applications/Helix CRM.app`) or touch
  `~/Library/Application Support/com.clearpathdigital.helix`. Walker is sometimes asleep.
- No real prospect or client data in the repo. Fixtures are synthetic: `.example` domains,
  555 numbers. The client roster lives outside the repo. Do not invent pricing or commercial
  terms; do not add accounts, roles or billing (they do not exist by design).

Design (`docs/DESIGN.md` is binding)
- Tokens only (`src/styles/tokens.css`; no hex elsewhere); fonts only via the font switch
  at the top of that file. Radius 0, flat fills, no shadows or gradients, no purple or blue
  text, no emoji anywhere. One primary block per view.
- Vocabulary system (`src/app/vocabulary.ts`: Deals/Jobs/Quotes); icons via `src/ui/icons.ts`;
  `DatePicker`/`TimePicker`/`Combobox`, never native date inputs or a `Select` for records;
  kit `Overlay`, `Dialog`, `Table`; money via `useFormats().money`.
- Sidebar grouped by relation; stages in pipeline order; every invoice tied to a deal; one
  money definition in `src/db/repos/money.ts`. Voice: direct, specific, warm.
- Never set a long `staleTime` on a query (`docs/CONTRACTS.md` "Fresh pages").

Code and data layer
- Writes under `withWrite`/`withTransaction`, never nested. Log the whole row in
  `change_log` for anything undoable. Money is integer cents; dates `YYYY-MM-DD`.
- Migrations: forward-only `drizzle/NNNN_name.sql` plus journal plus `src/db/schema.ts`.
  Snapshot chain is 0000 to 0005 plus `0009_snapshot.json`; run `npx drizzle-kit generate`
  only when `schema.ts` changed and confirm it produces exactly the intended diff. Ask the
  coordinator for a migration number.

Tests
- Never weaken a test. No skips, no `.only`. Bar: `npm run typecheck`; `npx vitest run`;
  `cd src-tauri && cargo test` if Rust changed; `npm run build`; e2e for the area on a unique
  `E2E_PORT` with its own `E2E_OUT` (`E2E_PORT=4290 E2E_OUT=dist-x npm run e2e:mac -- <spec>`),
  then delete `dist-x`. Mutation-check new guards. Report checks actually run, with revision.

Records
- Rounds write `docs/rounds/<date>-<round>-record.md` and returns beside it; Walker's prompts
  are saved verbatim. Findings are implemented, deferred with a reason, or blocked.
  `docs/STATUS.md` is append-only.
- Coordinator-owned files: `docs/CONTRACTS.md`, `docs/OPERATIONS.md`,
  `docs/ONBOARDING-CHECKLIST.md`, `README.md`, `CHANGELOG.md`, Help content. Workers propose text.

## Releasing (director only)

Bump `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and both lockfiles;
CHANGELOG heading; `main` green (`js`, `e2e`, `rust`, `rust-audit`); run
`tests/RELEASE-CHECKLIST.md`; `git tag vX.Y.Z && git push origin vX.Y.Z`; publish the draft
release by hand; tell clients. Installers are unsigned. See `docs/handoff/06`.

## Open and next

Walker owns D-1 to D-6 (pricing, "included" or free extra, in-person or self-install,
signing budget, opt-in update check, roster home). Deferred: delete-workspace (F-SEC-27) and
F-LA-7 (do together), backoff persistence, export-moment disclosure, `external_id` re-keying,
payments import, deposit request on a quote, OS notifications. Detail and recommended order:
`docs/handoff/07-open-decisions-and-roadmap.md`. Walker's feedback comes from using the app;
expect the next round to start from that. Report outcome first, concisely.
