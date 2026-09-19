# Brand sweep: records, Today, data

Date: 2026-09-19. Scope: `src/features/records`, `src/features/today`,
`src/features/data`, and their e2e specs. Source of truth:
`assets/brand/guide/helix-crm-brand-guide.html`. Tokens and the component kit
came from the foundation pass (`src/styles/tokens.css`, `src/ui`); this sweep
only changed feature code.

Screens were captured at 1280 in light and dark (plus compact on Today, the
contact page, the pipeline board and the import mapping step) into
`tests/e2e-mac/.cache/screens/brand-a/` and looked at beside the guide.

---

## What the guide changed here

**Radius 0 everywhere.** Thirty-eight `rounded-[var(--radius-*)]` utilities
came out of 23 files. The tokens are 0 now, so this was belt and braces, but it
also means the forbidden-literal grep is clean and nobody re-adds a corner by
copying a neighbour. Two things that used to be circles are now squares on
purpose: the 7px stage dot on a board column and in the stage manager, and the
5px timeline dot. Square swatches are what the guide's own palette page draws.

**Headings are the slab, and they come from globals.** `globals.css` sets
`h1`–`h6` in Zilla Slab at the brand's sizes and weights, so every heading
element in these three features now carries *no* type utilities at all — the
class attribute is gone from Today's section headings, the first-run lead-in,
the starter-card titles and the connect-site card, and the contact page's `h1`
keeps only `truncate`. Two headings are deliberately not heading elements and
keep the `font-[family-name:var(--font-heading)]` utility: the import drop
zone's lead line (a `<p>` inside a drop target) and the import result's four
figures (spans, at the 32px heading step in slab so the numbers carry).

One override stayed: a pipeline board column title is an `h2` semantically but
20px would be wrong on a 260px column, so it is held at body size — in the slab
face and the heading ink.

**Captions.** The two list column strips (contacts, companies), the stage
manager's column header row and the search dialog's group label now use the
`.section-label` class from `globals.css`: Poppins, the 11px caption step,
tracked out, uppercase. They used to hand-roll `--text-label`.

**Voice.** Three passes over every string in the three features. The copy was
already close, so the changes are small and specific: 13 strings in total.
Every one was grepped against `tests/` first; none of them turned out to be
asserted on, so no spec needed a copy change.

---

## The primary block, screen by screen

The guide allows the primary colour once per view, as a single confident block.
The sidebar's selected row belongs to the shell and does not count. A dialog is
its own view and keeps its own confirm button.

| Screen | The one primary block | Notes |
| --- | --- | --- |
| Today (panels) | the **Due now count**, filled | New: `Section` takes `emphasis` and only Due now passes it. It is not drawn when nothing is due, so a clear day is a colourless screen. |
| Today (first run) | **Import a CSV** | Carries the accent sticker shadow — the one hero element on the screen. |
| Contacts list | **New contact** | |
| Companies list | **New company** | The create dialog's Create is its own layer. |
| Contact page | the **phone number button** | Timeline's Save and the attachments Add a file were primary and are now secondary. |
| Company page | the **phone number button** | Same two demotions. |
| Deal page | the **deal value**, as a filled block | The deal page had no primary at all. The money is what the owner came for, so it is now a flat primary block with the accent sticker shadow. `data-testid="deal-value"`. |
| Pipeline (board and list) | **New deal** | Stages, view switch and saved views are secondary or ghost. |
| Tasks | the composer's **Add task** | The header's New task focuses the composer and is secondary. |
| Trash | none | Every action on this screen is destructive or a restore; nothing here earns the confident block. |
| Stage manager | **Done** (dialog) | |
| Quick add | **Save** (dialog) | Save and add another is secondary. |
| Search dialog | none | A Spotlight panel has no button. |
| Import, step 1 | **Choose a file** | Sticker shadow: this is the screen's hero. |
| Import, steps 2–3 | **Continue** / **Import** | One per step footer. |
| Import, running | the **progress bar** | Already a primary fill, and it is the only thing on the screen. |
| Import, result | **See the contacts** | The four figures are slab, not filled. |
| Export | **Export everything (.zip)** | The per-list buttons are secondary. |
| Backups | **Back up now** | Header when the list has rows, empty state when it does not — never both. |
| Duplicates (with pairs) | none | Fifty-two Review and merge buttons cannot all be primary, and promoting the header's Scan again would make a refresh the loudest thing on the screen. The primary block belongs to the merge dialog. |
| Duplicates (empty) | **Back to contacts** | |
| Merge dialog | **Merge into &lt;name&gt;** | |
| Merges history | none | A log. |

## Accent

The accent is pale yellow and the guide calls it a detail, never a background.
It appears three times in this scope, each as `--shadow-sticker` on the one
hero element of a screen that is an invitation rather than a list:

- Today, first run — the Import a CSV link.
- Import, step 1 — the Choose a file button inside the drop zone.
- Deal page — the value block.

Nothing else in these features is yellow.

## Copy changes

**records** (9)

- `ContactMethods` — "No phone number yet. Without one you cannot call him
  back." → "No phone number yet." The clause assumed the contact's gender and
  did no work; it now matches the email empty state beside it.
- `ContactMethods` — two "That did not save." → "That phone number did not
  save." / "That email did not save."
- `ContactPage`, `CompanyPage` — "That did not restore." → "That contact could
  not be restored." / "That company could not be restored."
- `ContactPage`, `CompanyPage`, `DealPage` — five picker failures, "That did
  not save." → "That change did not save."

**today** (2)

- Two "The phone app did not open." now name the number: "…Call (801) 555-0147
  directly." A dead end became something the owner can act on.

A proposed "Try again." on the complete-task and snooze-deal error toasts was
rejected on review: it is filler, and the guide bans filler.

**data** (2)

- Export empty state — "There is nothing in this workspace yet." → "Add
  contacts and companies, then come back to export them." The old line
  restated its own title.
- Export — a spaced hyphen standing in for an em dash.

Left alone on purpose: `StageManagerDialog` and `QuickAddDialog` each have one
catch block shared across several entity types, so there is no honest noun to
name without restructuring the save path.

## What the screenshots caught

- **The bespoke heading classes were fighting the kit.** The first pass gave
  every heading `font-semibold` and `--leading-tight`; `PageHeader` and
  `EmptyState` ship `font-bold` at `--leading-heading` / `--leading-subhead`,
  and `globals.css` already styles heading elements. Two weights of Zilla Slab
  on one screen is visible. Fixed by deleting the utilities and letting the
  element carry it.
- **Stripping the radius utility left trailing spaces** inside three
  joined class lists and two `className` strings. Cosmetic, cleaned.
- **The deal page had no colour at all** once the Timeline save went
  secondary, which is what turned the value into a block rather than leaving
  the screen without a primary.
- **Compact still holds.** Today, the contact page, the pipeline board and the
  import mapping step were all captured at `data-density="compact"`; nothing
  clipped, and the 32px rows and 13px body came through as tokens.
- Dark mode: the primary block keeps `--color-accent-text` (#141414) on the
  primary, which is the pairing the kit uses for its own primary button, so it
  does not need a second ink for dark.

## Verification

- `npm run typecheck` clean.
- `npm test` — 799 tests, 64 files, green.
- `records.e2e.ts`, `today.e2e.ts`, `data.e2e.ts` on port 4194 — 26 passed.
- `npx vite build --outDir dist-brand-a` succeeds.
- `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(|rounded-|font-family|Poppins|Zilla"`
  over the three features returns only `font-[family-name:var(...)]` utilities.
