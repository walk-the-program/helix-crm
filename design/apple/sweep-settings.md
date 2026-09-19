# Apple-direction sweep: settings and AI — 2026-09-19

Agent: settings + AI sweep. Subject: `src/features/settings/**`,
`src/features/ai/**`, their two e2e specs, and the two route mounts under
`/settings`. Contract: `docs/DESIGN.md` revision 2. Kit review it builds on:
`design/apple/review.md`.

Screenshots: `tests/e2e-mac/.cache/screens/sweep-settings/`, 34 files, every
screen and overlay at 1280 in light and dark, captured by the two specs below.

## The decision the brief asked for

**A left section list inside the content area, not a segmented control at the
top.** It is the idiom the reference application uses, it keeps every section
one click from every other, and it survives the 1024px floor: the shell's
sidebar takes 240, the shell's gutter takes 2 x 32, the section list takes 224
and the 24px gap leaves a 472px detail column — wider than the System Settings
pane at its own minimum window, and a grouped list of label/control rows is
exactly what fits there. A segmented control would have had to hold thirteen
sections, which is a scrolling tab bar, which is a web page.

The list is built from `NavItem` and `SidebarSection` — the same two primitives
the shell's own sidebar uses — so the selected tint, the ink, the 32px row and
the hit target cannot drift from the chrome sitting 24px to its left.

## The shared vocabulary

`SettingsLayout.tsx` was rewritten from a "block and rail" file into the row
vocabulary every screen is now built from. `SettingsBlock` and `DataRow` are
gone; nothing outside this feature imported them.

| Component | What it draws |
| --- | --- |
| `SettingsNav` | the section list, four groups under 11px labels |
| `SettingsScreenFrame` | nav + a `max-w-3xl` detail column + `PageHeader` |
| `SettingsMount` | the same frame around a screen another feature built |
| `SettingsGroup` | `CardGroupLabel` + a `Card` of rows + a footnote under it |
| `SettingsRow` | leading glyph, label (and a hint line), control on the right |
| `SettingsChoiceRow` | one radio in a grouped list, with its sentence |
| `SettingsValueRow` | read-only label/value, fixed label column, top-aligned |
| `SettingsLoading` | the one "Reading…" line, so every screen says it once |
| `SettingsNotice` | a muted-pastel warning row, the only tint allowed |

Three rules fell out of building it and are worth keeping:

- **A footnote goes under the panel, not above the first row.** That is where
  System Settings explains a switch, and it keeps the panel nothing but rows.
- **A hairline belongs to whatever is the panel's own child.** When a row is
  wrapped in a `<label>`, a `<Link>` or a `<button>`, `CardRow`'s
  `last:border-b-0` resolves against the *wrapper*, where every row is an only
  child — so every hairline disappears. The wrapper carries the border instead.
  This was invisible in code review and obvious in the first screenshot.
- **The screens add no page gutter.** `Shell`'s `<main>` already pays
  `--space-7` / `--space-6`; the old index paid it twice.

## Per screen

### Settings index (`OverviewScreen`)
Was a two-column grid of bordered link cards with a 20px icon and a doubled page
gutter. Now four grouped inset lists in the order `sections.ts` fixes, a row per
section with its glyph, its one line and a caret, and the two rows another
feature owns saying where they land ("Opens the pipeline"). *Screenshot caught:*
the description was starting under the icon instead of under the title, because
the glyph was inside the label node — `SettingsRow` grew a `leading` slot and
the text column now lines up.

### Workspace
Two groups. "Business" holds the name field; "Formats" holds currency, date
format and phone region, each with its sample as the row's second line ("A deal
worth 12,450 reads $12,450.00"). Save name is the screen's one black button, in
the header. *Screenshot caught:* the locale pop-up truncated at
"English (United States) …" because each label carried its own sample date; the
samples now live in the row hint and the labels fit.

### Vocabulary
Three radio rows in one grouped list with a sentence each, then a "Reads like"
group of two value rows showing the sidebar label and the board's button label.
The old preview drew a disabled primary button, which was a second black button
on a screen that has none.

### Tags
The inline create form above the table became the screen's one dialog, opened by
`Add tag`; the table became one grouped list — swatch, name, "On 3 records" in
quiet text, then the rename and delete icon buttons. The count `Badge` is gone: a
grey pill on every row is noise, and a count is not a status. The colour picker's
40px swatches with a 2px ring became 24px wells with an ink hairline on the
chosen one.

### Custom fields
The entity tabs sit directly under the header with no panel around them — a
control that points at a section is not itself a setting. The table became a
grouped list: the field name, and under it the kind and (for a choice field) its
options as one quiet line, the way a Finder list subtitles a file. The kind badge
is gone. The "Kind" block in the locked case no longer fakes a `<label for>`
pointing at a paragraph.

### Appearance
Theme and density as two grouped lists of choice rows, then a "Sample" group
drawn from the real tokens: a name, a next step and one list row — the three
things every screen in the product is made of.

### Keyboard shortcuts (screen and "?" sheet)
One grouped list per command group, command on the left and `Kbd` on the right.
The sheet dropped its own `max-h-[70vh] overflow-y-auto`, which was a second
scroll box inside `DialogContent`'s own.

### Workspaces and the switcher
The workspace list is a grouped list; the open workspace wears the
`--color-selected` tint and carries an "Open" badge, which is how a native list
marks the row you are in. Row actions dropped to one push button ("Switch to
it") plus two ghosts, instead of three bordered buttons per row. The name is body
size at weight 500, not `--text-lg`. The switcher is a 480px sheet whose rows
*are* the action — no per-row Switch button, a check on the open one — with
Cancel as a ghost.

### Diagnostics
Four grouped lists of label/value rows and nothing else. Both buttons are ghost:
this screen reads, it never writes, and DESIGN.md gives a screen a black button
only when it has one thing the owner came to do.

### AI settings
Four groups: an unlabelled first group holding the switch (the page title
already says AI), the key, the model, and "What gets sent, and when" as four
value rows. Save key is the one black button, Test key is a push button and
Remove key is text-only red. The three buttons lost their glyphs — "Save key" is
already the shortest true sentence, and a glyph on each of three adjacent buttons
is noise.

### Paste to record
680px (a form) rather than 840. The proposal lands in two grouped lists —
Customer and Job — with the label left and the field right, and Notes as a
full-width field under them. **"Read it" is now always a push button**: it used
to be `primary` until the form appeared, which put two black buttons in one sheet
whenever there was nothing to save yet. Cancel is a ghost, Save is the black one.

### Draft a follow-up, Summary
Both are 680px sheets now. Draft: subject, message, then Cancel (ghost), Copy
(push) and Open in Mail (black). Summary: the paragraph, then Close (ghost) and
Copy (black) — copying it somewhere useful is the only thing that sheet is for.
Both Copy buttons are disabled until there is something to copy.

## The two route mounts

`/settings/site` (the leads feature's `SiteConnectionScreen`) and
`/settings/backups` (the data feature's `BackupsScreen`) are registered by the
settings feature, listed in the index's "Data" group and in the section list, and
wrapped in `SettingsMount` so following the section list into one of them does
not lose the section list.

**One caveat, visible in `site-light.png`:** the leads feature also registers
`/settings/site` itself and sits earlier in the registry, so wouter's `Switch`
matches its bare registration first and the website connection renders without
the section list. Backups has no duplicate and gets the frame today. The fix is
one deleted line in `src/features/leads/index.tsx`, which is not this agent's
file; the route here is already correct and starts working the moment that line
goes.

## What the screenshots caught, in order

1. The settings index's description line was indented to the icon, not the title.
2. Every hairline vanished from the index, the choice lists and the switcher,
   because `last:border-b-0` was resolving against a wrapper.
3. "Keyboard shortcuts" and "Website connection" truncated in a 192px section
   list; it is 224px now.
4. The locale pop-up truncated its own label.
5. The AI screen's first group label said "AI" under a page titled "AI".
6. The switcher's single list carried a section label in a 480px sheet.
7. Backups, reached from the section list, had no section list.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 64 files, 799 tests, all passing |
| `settings.e2e.ts` + `ai.e2e.ts` on 4189 / fake on 4795 | 18 passed |
| `npx vite build --outDir dist-sweep-settings` | succeeds; deleted afterwards |
| hex / `rgb()` / `rgba()` / `hsl()` in scope | none |
| `lucide-react` in scope | none |
| `shadow-[var(--shadow-sm)]` in scope | none |

Two new e2e tests came out of the sweep: the section list is asserted to list
every section, to mark exactly one row current, and to navigate without going
back to the index; and the AI screenshot test now drives the paste flow through
to a saved record so the summary and draft sheets have something real to say.
