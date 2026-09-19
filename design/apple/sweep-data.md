# Data + leads sweep — 2026-09-19

Agent: data/leads design sweep. Scope: `src/features/data/**`,
`src/features/leads/**`, `tests/e2e-mac/specs/{data,leads}.e2e.ts`,
`tests/unit/{data,leads}/**`. Contract: `docs/DESIGN.md` revision 2, the kit in
`src/ui`, and `design/apple/review.md`.

Screens: the import wizard (pick, mapping, preview, running, result, parse
error, empty file), export, backups (list and restore dialog), duplicates
(list, merge dialog, merges history), attachments, the website connection, and
the five reports with their table views.

Screenshots: `tests/e2e-mac/.cache/screens/sweep-data/`, one 1280-wide shot per
screen per theme, produced by the two e2e specs in this scope and reviewed
three times.

---

## Route ownership

Two routes moved out of these features and into Settings, which owns that URL
space (`docs/CONTRACTS.md`):

- `src/features/leads/index.tsx` no longer registers `/settings/site`. It still
  exports `SiteConnectionScreen`, and the settings feature mounts it.
- `src/features/data/index.tsx` no longer registers `/backups`, and now exports
  `BackupsScreen` for the settings feature to mount at `/settings/backups`.
  There was no `/backups` nav item to remove — the data feature's only nav row
  is Import.

Both screens keep their own `PageHeader`, so they read the same whichever
feature mounts them. `data.e2e.ts` navigates to `/settings/backups`; nothing
inside either feature linked to the old paths.

---

## What changed, screen by screen

### The import wizard

The whole wizard now reads like a macOS setup assistant: a quiet trail of step
names in the canvas, one panel under it, and the two buttons that move the
assistant at the bottom right.

- **The step trail** was four tinted pills, one of them green — four filled
  shapes and two colours to say one thing. It is now four step names joined by
  hairlines, where the current step is full ink at weight 500, the steps behind
  it are secondary and the ones ahead tertiary. No pill, no fill, no colour.
- **Back and Continue.** The two navigation buttons were a ghost "Choose another
  file" on the far left and a primary on the far right. They are now a
  `secondary` **Back** and the one black **Continue**, together at the bottom
  right, which is where an assistant puts them. The final step keeps the real
  verb: the button on the preview step says **Import**, because that is what
  happens. `data.e2e.ts` was updated for the rename.
- **File pick.** The 40px spreadsheet glyph in the middle of the drop zone is
  gone (§11: no spot glyph), the `border-2 border-dashed` became one dashed
  hairline, and the drag state is a tint rather than a colour change. The
  sentence is capped at `--content-max`.
- **Mapping.** The "Guessed from the column names" badge with a 12px wand glyph
  inside it — a size the icon contract does not have — is now a sentence, and
  so is the deal-columns note, which used to be a yellow box with a warning
  glyph. Neither asks the owner to do anything, and §3 puts "needs you" in
  position and weight rather than colour. The table moved into a `Card` and the
  hard-coded `w-[220px]` / `w-[180px]` control widths became a share of the
  cell.
- **Preview.** The two warning/danger badges lost their 12px glyphs and kept
  their words. Flag text moved from `--color-danger` / `--color-warning`, which
  are fills, to the `-ink` partners that are allowed to carry text. The
  duplicate policy is now a grouped inset list under a small-capitals label
  with the sentence as a footnote under the panel, instead of three outlined
  boxes inside a card.
- **Running.** The panel is a card with the spinner, the progress bar and the
  sentence about the single transaction. The progress track was
  `--color-surface`, which is white on white and drew nothing; it is the quiet
  neutral tint now, and the indeterminate state pulses at full width instead of
  sitting at 100%, which read as finished.
- **Result.** The four counts keep their `--text-2xl` tabular figures; the
  "rows did not go in" card became one grouped row; there is one black button
  ("See the contacts").

### Export

Six SaaS cards — a header, a body and a footer each — became two grouped inset
lists: **Everything** with one row and the screen's one black button, and **By
list** with one row per entity, its live count in tabular figures and a
`secondary` "Export CSV". The empty state's inline link became the one black
button the contract asks for.

### Backups

The list is a table in a card, with the count and total size as a quiet line
above it and the backups folder as a truncated footnote below it (it used to be
the page subtitle, where a 90-character path sat under the title). The failure
alert kept its pastel tint and moved its text to `--color-danger-ink`. The
restore dialog is `ConfirmDialog` unchanged. The restore overlay was a
95%-opacity raised surface over the screen, which left the page showing through
the text; it is the canvas colour now.

### Duplicates and merge

- The pairs list was a stack of cards with a **black button on every one** —
  fifty-two primaries, which is no primary at all. It is one grouped inset list;
  the row's actions are a ghost "Not a duplicate" and a `secondary` "Review and
  merge", and the black button lives in the dialog, where something happens.
- The match reason was a `warning` badge on every row, which washed the page
  yellow for a fact that is not a warning. It is neutral.
- The merge dialog marks both choices the way a native list marks a selection —
  the `--color-selected` tint and full ink — instead of an accent border and an
  accent-tinted fill. The `text-xs uppercase tracking-wide` label above each
  choice (the only stray capitals in this scope) is a sentence at `--text-sm`,
  and the per-field choices are a grouped list under a small-capitals label
  rather than a grid of outlined radio boxes.
- The merges history table moved into a card; the two id cells show the end of
  the id rather than the first eight characters, which were identical for both
  records because the ids are time-ordered.

### Attachments

The header is a real `CardHeader` + `CardTitle`, the bordered `<li>` boxes
became a full-bleed inset list with one hairline between rows, the file name is
body size at weight 500 instead of `--text-sm`, the thumbnail is `--space-8`
square, and the empty state dropped its paperclip (the `icon` prop is
deliberately not drawn).

### Website connection

Three cards with headers became three grouped inset lists under small-capitals
labels. The connected state is a pastel badge in a "Status" row rather than a
green word in a card header; the poll facts are label-and-value rows instead of
a `<dl>` grid; the screen keeps one black button (Save), with Test connection
and Poll now as push buttons and Disconnect as the text-only destructive. The
screen also had `p-[var(--space-6)]` of its own inside the shell's `<main>`,
which already pads by `--space-7`, so it was 56px in from the sidebar.

### Reports

- Every colour and axis style is in `components/charts.tsx` and every value is
  a `var(--token)` string, so the marks follow the theme (a presentation
  attribute is parsed as CSS, so `fill="var(--color-text)"` resolves against
  `data-theme` with no second code path for dark).
- **Bars are ink** — `--color-text`, with `--color-text-faint` for a second
  series beside it — **except where the category is a stage**, where the bar
  takes that stage's own muted colour from the stage ramp. That is the pipeline
  chart and the two dwell mini-charts. "Leads by source" was `--stage-2` and
  "Conversion between stages" was `--stage-4`; neither category is a stage, so
  both are ink now, and won/lost stopped being green and red.
- **No gridlines, no value axis, no axis line.** Every bar carries its own
  figure at the end of it, so the grid was a fainter second copy of what the
  label states exactly. Direct labels are full ink with tabular figures; axis
  text is secondary grey.
- The card is `data-report="<title>"`, the report headline figures moved to
  `--text-3xl` (§4 reserves that step for exactly this), the tooltip's swatch is
  a hairline rather than a 2px hard-coded rule, and the two dwell mini-charts
  are titled with the small-capitals label.

---

## What the screenshots caught

Ten defects that reading the code did not show. Each was fixed and
re-captured.

1. **`TD primary` truncated every name to three characters** in the preview's
   seven-column table (`Sa…`, `Da…`, `Jo…`). The kit's primary cell is
   `max-w-0 truncate`, which is right for a two- or three-column list and
   leaves nothing for a name in a wide one. The table is `table-fixed` with a
   share per column now, and the cells carry `title`. Same root cause as item 2
   in the records sweep's contract list.
2. **Two phone numbers wrapped a preview row to double height**, so the table
   had 40px and 80px rows alternating. Fixed by the same `table-fixed` pass:
   one line per row, the full value on hover.
3. **The second record in a duplicate pair started at a different x on every
   row.** It was a wrapping flex row, so the column position followed the
   length of the first name. It is a two-column grid on a `flex-1` container
   now, and the detail line truncates instead of wrapping to a second line.
4. **The running panel could not be photographed at all**: 1,500 rows import in
   about 200ms, so the first "during the import" capture came back showing the
   result screen. The spec now holds each batched write for 600ms through the
   `window.__helixDb` bridge, and asserts the progress bar is *still* visible
   after both shots, so the screenshot cannot silently be of the wrong screen.
5. **Fifty-two yellow badges down the duplicates list.** Only visible at full
   page. Neutral now.
6. **The export row's sentence ran into its button** — 15px of gap at 1280.
   The text column is capped at `--content-max`.
7. **The Disconnect button wrapped onto its own line, left-aligned**, because
   the row was `flex-wrap` with `justify-between`. One row now.
8. **"Kept" and "Merged in" printed the same eight characters** in the merges
   history, because both ids share a time prefix. The last six differ.
9. **A doubled hairline under the last row of every table**, 1px from the card's
   own edge. Every table in this scope passes
   `[&>tr:last-child]:border-b-0` to `TBody`.
10. **The Files panel's empty state was a 300px box** inside a 380px details
    column on a record page. It takes `--space-5` of padding there rather than
    the default `--space-10`, which is right for a whole pane.

Two more things the captures settled rather than fixed:

- A chart with one category was 140px of white with a bar in the middle of it.
  The height floor is two rows' worth now, so a one-bar chart is one bar and
  the air around it.
- The stage-coloured bars read as more saturated in light than in dark, where
  the ramp lifts. They are kept: the stage ramp is revision 2's own, the
  category *is* the stage, and every other bar on the screen is ink — two
  coloured charts out of five, each colour meaning a stage the owner already
  reads that way everywhere else.

---

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 64 files, 799 tests passing |
| `E2E_PORT=4188 E2E_OUT=dist-sweep-data` on `data.e2e.ts` + `leads.e2e.ts` | 19 tests passing |
| `npx vite build --outDir dist-sweep-data` | succeeds; directory deleted |
| Hex / `rgb()` / `rgba()` / `hsl()` / `lucide-react` / `shadow-[var(--shadow-sm)]` in scope | none |
| Screens captured | 22 screens x 2 themes (44 files) in `.cache/screens/sweep-data/` |

### Spec changes

- `data.e2e.ts`: `/backups` → `/settings/backups`; "Preview 20 rows" →
  "Continue"; screenshots moved to `sweep-data/` and every screen is now shot
  in both themes; the theme switch no longer clicks a button in another agent's
  file but sets `data-theme` and waits for `body`'s untransitioned background
  to change; new tests for the running panel, the backups list and its restore
  dialog, the three empty screens, and the attachments panel on a record.
- `leads.e2e.ts`: `reportCard()` matched `div[class*="shadow-[var(--shadow-sm)]"]`,
  which stopped identifying a card the moment cards stopped casting a shadow.
  It matches `[data-report="<title>"]` now. The screenshot test captures the
  site screen connected and not connected, and the five reports as charts and
  as tables, in both themes.
- No assertion about behaviour was weakened, and no unit test needed a change.

### For other owners

1. **The e2e fixture writes backup files under a name the product cannot read.**
   `DbBridge.backup` in `tests/e2e-mac/fixtures.ts` stamps
   `new Date().toISOString()` with every `:` and `.` replaced by a dash, which
   leaves the milliseconds in the file name
   (`2026-09-19T00-48-08-123Z-manual.db`). `parseBackupName` and the Rust side
   agree on `<date>T<HH-MM-SS>Z-<reason>.db`, so every backup the harness writes
   is invisible to `listBackups`. The spec seeds two correctly named files into
   the stub's file map to photograph the list; the fixture is the right place to
   fix it, and it belongs to whoever owns `tests/e2e-mac/fixtures.ts`.
2. **`TD primary` still needs a width hint** (already raised by the records
   sweep). Both sweeps hit it independently in a wide table.
3. **`CardRow` has no `asChild`.** A row that is a single `<label>` or `<button>`
   has to nest one inside the row, which means the hit target is the child
   rather than the row. A Radix-style `asChild` on `CardRow` would let the
   grouped-list pattern carry a real control.
