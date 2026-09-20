# Lead A (records) IMPLEMENTATION return, relayed by Fable (main session)

TASK: CPO-LA-IMPL / attempt 1 / packet rev 2.2. STATUS: submitted. 32 commits on main, all verified ancestors.

## Per finding
Implemented: F-LA-1 (b06130d), F-LA-2 (2dd6cb5), F-LA-3 (7d32b43, ae02923), F-LA-4 and F-LA-5 (52eef7c), F-LA-6 (1ea980d, b06130d), F-LA-7 (05a9168, 6d939b9, 2c3b31c), F-LA-8 (b580345), F-LA-9 (05a9168, 386eaaf, d62d3e6), F-LA-10 (05a9168 repo + 7d32b43 UI; audit's fix was insufficient, repo changed: explicit `at` on the current closed stage updates closed_at and stage_entered_at, no new stage event, timeline "Won date changed"), F-LA-11 (7d32b43), F-LA-12 (386eaaf), F-LA-13 (1040cde), F-LA-14 (7d32b43), F-LA-15 (b580345), F-LA-16 (dd8170d), F-LA-17 a/b/d (dd8170d, 7d32b43), F-LA-18 (2dd6cb5), F-W1-1..4 (b580345, 742f041, cd182d2, d62d3e6/386eaaf), 2.1a purge refusal (05a9168, b0e0099, e7a8bf2), 2.1b document in trash, 2.1c PollNotice on Today (bb6642f), 2.1d reopen mentions billing, 2.2a phone region (e57cf01, a87bbea), 2.2b trash types, 2.2d, 2.2e (6df6284), 2.2f AI CSS hack (7d32b43), 2.2g useFormats sweep (c285c98, 66a10e1, 4f74b37, 2bf1c3d, 321619d, ae02923).
Partially deferred: F-LA-17c (board hint moved to region title; Help sentence for lead-platform: "On the jobs board, drag a card to another stage, or focus a card and hold shift with an arrow key to move it.").
BLOCKED: 2.2c (mod+/ on the shortcuts sheet) needs either a row in src/features/settings/lib/shortcuts.ts (lead-platform) or a `hidden` flag on FeatureCommand in src/app/feature.ts. Fable to assign.

## Deviations / risks
- DealsCard extracted to components/DealsCard.tsx; CompanyPage still has a local copy (W1 was mid-edit).
- tasks.today() gained optional `now?: Date` (test-only; production passes none).
- W2 used `min-[1440px]:` (no 1440 breakpoint in config).
- vitest.config.ts include is *.test.ts only, so tests/unit/catalog/NewServiceDialog.test.tsx is never collected (coordinator-owned file).
- git reset incident: dropped commit re-landed byte-identical as 1cc2fa2; all 32 commits verified present.
- Unverifiable here: Rust, keychain, files, HTTP, restore, switch.

## Scenarios owed
- 7 merge: records pages correct after a merge (survivor shows loser's deal/task/activities). Issue for the merge owner: a merged-away loser's page still offers Restore, which would rebuild a duplicate; should read "Merged into <survivor>" with a link, no Restore.
- 16 long names: 64-char company and first-name-only contact hold at 1024/1280/1440; truncation with tooltips; no clipping.

## Verification
typecheck clean; vitest 143 files / 2019 passed / 3 skipped (baseline 1789); vite build ok; e2e records+today+depth+listNav 43 passed on 4232. Numbers now match the DB: pipeline "7 open · $103,930"; won deal strip "Won $3,610 · Upfront $1,450 + $180/mo · Invoiced $1,450 · Collected $1,450 · Outstanding $0"; contact strip "Open $61,000 · …". Tests added: quickAddDialog (8), dealCustomer (6), recordChip (4), tasks repo (+11), phoneRegionDedupe (7), trashLcAudit (8), six e2e regressions. Audit specs deleted (behaviour moved into records/today/listNav specs). Build folders removed; nothing running.

## Handoff for the coordinator
1. 2.2c mod+/ ownership. 2. Merged-away contact page (merge owner). 3. vitest.config.ts include for .tsx tests. 4. Help sentence for lead-platform. 5. CompanyPage adopt shared DealsCard. 6. MoneyStrip uses formatMoneyTrim with explicit currency/locale (correct; note for a future Formats variant).
