# Lead C (platform) IMPLEMENTATION return, relayed by Fable (main session)

TASK: CPO-LC-IMPL / attempt 1 / packet rev 2.2. STATUS: submitted. 22 commits on main (12 lead: 4094608, b2aed5e, 12f1fd1, fdeeea7, 1a4a034, 308efbd, 7534920, 5033b85, 59c68ec, 744bbba, 98d5268, 6750351; 10 workers: 79181da, 4764d28, 4285185, df38907, e76edbb, 466da63, f592fbf, 23fd98d, f7ad4ae, 56494aa).

## Per finding
Implemented: F-LC-1 formats (useFormats hook src/app/formats.ts; also fixed typedImportRun stamping currency "USD" on every imported deal), F-LC-3 purge (boot + 24 h sweep src/features/data/trash/purgeSweep.ts; removes attachment files first; 6 repo tests), F-LC-4 export (16 tables in the zip; Settings "Your data" row), F-LC-5 import scroll, F-LC-6 Tailwind @source not docs/design (zero CSS warnings; junk rule gone), F-LC-7 shortcuts sheet + `FeatureCommand.aliases` contract (mod+/ printed as "⌘K or ⌘/"), F-LC-8 custom field copy, F-LC-10 boot screens (cause-specific copy, Open a different workspace, Show folder), F-LC-11 Field aria to Combobox/Select, F-LC-12 Combobox highlight scroll + page keys, F-LC-13 dialog footers, F-LC-15, F-LC-16, F-LC-17 (--color-print-ink token), F-LC-20 AI off (reason in tooltip + aria-description only; showReasonLine opt-in), F-LC-21 quick add "+" button, R9 sample money (nine presets get priced deals/invoices; removal also deletes sample documents, items, schedules, system activities on sample deals).
Refuted: F-LC-19 (the !ready spinner gate prevents the race; a pinning test added to onboarding.e2e.ts).
Deferred: F-LC-18 PDF fonts (DESIGN.md §4 sentence supplied: PDFs embed Zilla Slab and Lato and do not follow the font switch), F-LC-22 3.02 MB chunk / ineffective dynamic import (phase two).
Routed elsewhere, untouched: F-LC-2, 9, 14, 23, 24.

## Contract text for CONTRACTS.md
- Combobox, MultiCombobox, Select accept aria-describedby and aria-invalid, forwarded to the trigger; Field injects them; Select's `invalid` still wins.
- FeatureCommand.aliases?: string[] — extra keys, same chord grammar, same binder rules; the sheet prints the first alias.

## Verification
tsc clean; vitest 60 files / 957 tests in its suites; vite build zero CSS warnings (CSS 77.83 → 73.70 kB); e2e data|settings|smoke|onboarding|ai|hig 62 passed on 4251; compact density and a 1280x700 dialog measured; 36 screenshots under tests/e2e-mac/.cache/screens/lc/impl-*; audit specs deleted (durable checks moved into smoke/ai/onboarding specs); cargo test not run (src-tauri untouched).

## Deviations
R16: no visible reason line (tooltip + aria only) to avoid re-creating the CSS hack; opt-in prop exists. Port 4252 self-collision (recovered). W2 changed two export assertions because the zip grew 6 → 16 files. W3 skipped the recurring-line exception for five presets that define no monthly service.
