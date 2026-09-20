# Orchestration log (kept by the directing session)

## Wave 1 (done)
- Rust shell: 6c14a41. TS foundations: 6f5e690. Integration: 84e6f5a (template a4aeec0). Design: a2acc65.
- Harness integration fixed by the director: 58b9f1c (sidebar nav links, registry seed, fs bytes).

## Wave 2 (running)
- records (port 4181), today (4182), data (4183), leads (4184), settings+ai (4185).

## Wave 3 reconciliation list (do after wave 2 lands)
1. Route ownership: mount Leads' SiteConnectionScreen at /settings/site from Settings; move Data's /backups under /settings/backups; Trash link from Settings overview.
2. Duplicate one-tap action helpers (today/actions.ts vs records): keep one, promote to src/lib or src/ui.
3. Saved views library (today/views): adopt in Records lists and Data lists; give pinned views a real sidebar section in the shell.
4. Mount AI DraftFollowUpButton on deal pages and SummarizeButton on record pages; mount Data's AttachmentList on record pages.
5. Workspace switcher: sidebar footer opens Settings' switch-workspace picker.
6. src/ui pass against DESIGN.md: accent-ink for coloured text, --control-h heights, `flex: none` on buttons, add the `@theme` block in app.css so `bg-surface`-style utilities exist; screenshot every component state light/dark/compact.
7. Promote feature-local repo helpers listed under "Contract changes needed" in STATUS.md into src/db/repos.
8. Full e2e run of every spec sequentially; fix flakes.
9. Real Tauri launch on this Mac: `npm run tauri dev`, walk the manual checklist (tests/RELEASE-CHECKLIST.md to be written), keychain prompt behaviour, backups on disk, restore, workspace switch.
10. Import Walker's real prospects (`ClearPath Sites/crm/data/helix-import.csv`, produced by `tools/import-clearpath-crm.mjs`) as customer zero in a real workspace; `tests/fixtures/clearpath-prospects.csv` is a synthetic fixture and is not this data.
11. Port the CRM endpoint to the other 17 templates per templates/CRM-ENDPOINT-PORT.md (Sonnet, one commit per template, tsc + config:check gates).
12. README.md (install, first run, unsigned-build caveats on Mac and Windows, keychain prompt), CONTRIBUTING.md, CHANGELOG.md.
13. Release: tag v0.1.0, GitHub repo (public, AGPL), release workflow builds unsigned dmg + msi.

## Notes from wave 2 reports
- today (65b1661): search lives on mod+/ because the palette owns mod+k and exposes no provider hook. Wave 3: make the palette delegate to Today's search dialog (or give mod+k to it) so there is ONE search. Pinned views render as a strip on Today; FeatureModule.nav is static, so the shell needs a dynamic "Views" section. Six repo helpers under src/features/today/lib to promote. Any e2e test must destructure `helix` or the shim is not installed.
- Known cross-agent breakages to fix in wave 3 if still present: tests/repo/boot.test.ts hardcodes the migration list (leads added 0002_report_views); unused TIME_BUDGET_MS in tests/repo/data/import-100k.test.ts.
- data (bfead53): /backups must move under /settings/backups. Backups/restore unproven e2e (fs stub lacks readDir/copyFile); add them to the manual Tauri checklist. Promote lib/csv.ts to src/lib and the ten statement builders to repos. Decide attachment file deletion on purge (Rust command or plugin-fs remove). Harness bug: fixtures.ts writeTextFile receives the path as a request header, not an arg; fix in the harness so written files are keyed correctly.
- records (ba778d6): undoBatch cannot undo soft deletes (softDeleteRow logs no `before`); either make softDeleteRow log `before` and undoBatch restore, or write the rule into CONTRACTS. deals.board() omits empty stages and ignores stage position; fix in repo. Saved views not wired into any list (Today built the library): adopt in Records/Data lists. playwright outputDir shared: derive from E2E_OUT. Quick add mounts its own root from onBoot beside the shell.
- leads (7880089): /settings/site registered twice (leads + settings' /settings/:section); remove once Settings mounts SiteConnectionScreen. Toaster in Shell.tsx lacks theme prop (toasts light on dark). deals.createStatements missing (applyLeads builds inserts by hand); promote reportQueries.ts to src/db/repos/reports.ts. Migration tests now read the journal.
- template port done: 17 commits, all gates green; CRM-ENDPOINT-PORT.md mapping corrected (home-services uses `issue`, dental uses `reason`). Stray gitignored data/ demo stores in three signature templates predate this work and were left alone (Walker's call).
- Real Tauri launch on this Mac (2026-09-18 23:52): app started, workspace created under ~/Library/Application Support/com.clearpathdigital.helix, migrations 0000..0002 applied, seed present, pre-migration and boot backups written via VACUUM INTO, log file written, poller idled correctly with no site. Screen capture blocked (no screen-recording permission), so the window was not visually verified by the director.
- Final integration TODO: vite dev server reloads on tests/e2e-mac/.cache and dist-* writes; add them to server.watch.ignored in vite.config.ts.

## Redesign (2026-09-18, Walker: "still super sloppy, use /minimalist-ui, truly Apple-like")
- Phase R1 (running): DESIGN.md rewritten, tokens, kit, shell, Phosphor icons via src/ui/icons.ts.
- Phase R2 (after R1 and the settings commit): three sweep agents over features (records+today, data+leads, settings+ai) applying DESIGN.md, migrating Lucide to the icon map, screenshots reviewed per screen.
- Phase R3: final integration (AI buttons on record pages, /settings/site and /settings/backups mounted from Settings, vite watch ignores), full e2e, manual checklist in the real window, docs refresh, release.
- Dev window relaunched at 23:5x without a pipe (the first launch died when `| head` closed).
- settings+ai (7acff56): 17 e2e green. Final integration: promote the three AI settings keys and deals.createStatements (check if the reconciliation already did the latter); shell should bind registry command shortcuts generically instead of each feature mounting an overlay host from onBoot; FeatureModule needs an overlay slot; DialogContent height bound (sent to the redesign agent).

## Brand guide + depth (2026-09-19)
- Brand guide implemented: foundation (42e2bc6, fa221ab), sweep A (eb9ff1f), sweep B running (leads/settings/ai/docs).
- Decisions D16-D19: industry-first onboarding with trade presets and sample data (running); no lock/account for now; SQLCipher at rest keyed from keychain (running); recurring reminders, templates, add-to-calendar, week summary, help (running). Signed installers still deferred.
- After these land: mount RemoveSampleDataButton and the Templates/Recurring links in Settings; Diagnostics shows encrypted/cipherVersion/disk encryption; full e2e; re-tag v0.1.0 (or v0.2.0) so the published release carries the brand and encryption; rebuild the local app.
- Windows e2e agent iterating on branch e2e-win/fix-session (budget 8 runs).
- sweep B (5573fb9) follow-ups for the final pass: grep repo for `font-[var(--font-mono)]` (not a Tailwind utility; use `font-[family-name:var(--font-mono)]`); consider deriving the stage ramp from the brand tints so stage bars are not louder than brand bars; other specs that flip data-theme must wait for the transition before screenshots.
- onboarding (106aafc): mount <RemoveSampleDataButton/> in Settings Workspace section and on Today's first-run card; promote lib/settings.ts keys + settingStatement into repos/settings.ts; sidebar "Pipeline" label should follow vocabulary (records/index.tsx).
- depth (cd5fb38): add the Templates row to src/features/settings/lib/sections.ts (id templates, group general, icon Article); Trash should list recurring rules and templates (move the seed guard to a settings key first).
