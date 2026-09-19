# Apple sweep — records and Today (2026-09-19)

Agent: records/Today design sweep. Subject: `src/features/records/**`,
`src/features/today/**`, their two e2e specs, and the AI buttons mounted on the
three record pages. Contract: `docs/DESIGN.md` revision 2. Companion:
`design/apple/review.md` (the kit's own review).

The owner rejected the first pass as "super sloppy". The kit and the tokens were
rebuilt to the Apple direction before this sweep started; this document records
what the feature screens looked like against that kit, what changed, and what
the screenshots caught that reading the code did not.

## Method

1. `docs/DESIGN.md`, `design/apple/review.md`, every primitive in `src/ui`,
   `src/styles/tokens.css`, and the two skills read first; then every file in
   scope.
2. A shared house style written down before any edit, so the three Sonnet
   agents and this one produced the same screen rather than four opinions.
3. The layout and hierarchy work on Today, the contact page, the pipeline and
   the timeline done by hand; the mechanical sweep — the icon import, the
   shadow, the 44px override, the empty-state glyph — delegated and then read
   back file by file.
4. `npm run typecheck`, `npx vitest run tests/unit/records tests/unit/today`,
   the two e2e specs on port 4187 into `dist-sweep-records`, and a production
   build.
5. Screenshots at 1280 in light and dark for every screen, plus compact for
   Today, the contact page and the pipeline board, into
   `tests/e2e-mac/.cache/screens/sweep-records/`. Looked at, fixed, recaptured.

## The five defects that were on every screen

Before the per-screen notes, the patterns. These were not one screen's mistake;
they were the house style of the rejected pass, and they are what made the app
read as a web form in a window.

**1. A black button on every row.** Today's New leads and Gone quiet sections
each put `variant="primary"` on *every* row's "Log a call". A ten-row list was
ten black buttons. The contract allows one per screen. Row actions are now
`ghost`, the one action that matters per row is `secondary`, and the only filled
control on a record page is the phone number itself.

**2. `className="min-h-[44px]"` on 31 controls.** A 44px minimum on a 32px
token-height button does two things: it breaks compact density outright, and it
makes every toolbar 37% taller than the macOS control it is imitating. All of
them are gone; the height is `--control-h`, and the hit-target floor is
`--control-h-sm`, which is what `DESIGN.md` §6 actually specifies and what
`IconButton` already wraps a bare glyph in.

**3. Attention drawn in colour.** A 3px `--color-accent` left rail on every
overdue Today row, a filled black count pill beside "Due now", "No next step"
set in `--color-accent-ink` on every deal card and every task rail, an
accent-tinted badge on any lead from the website. All removed. "Needs you" is
now position and weight: Due now is the first section, its overdue rows carry a
muted pastel badge that states the number of days, and "No next step" is a
tertiary-ink sentence.

**4. `shadow-[var(--shadow-sm)]` on six panels** that the token now resolves to
`none` — dead code that still read as an intention. Gone. The only shadows left
in scope are on the search dialog, the popovers, and the board's drag overlay.

**5. Two type sizes doing one job.** List rows set their primary line at
`--text-lg` against a `--text-sm` secondary, which is a two-step jump a native
list view never makes. Every list row's primary line is now `--text-base` at
weight 500 in full ink, and the hierarchy comes from weight and colour.

## Per screen

### Today

The biggest structural change in the sweep. Was: four panels of equal weight,
each headed by a `--text-lg` title and a filled count pill, rows 2–3 full-size
buttons wide, each row wearing a 3px accent rail.

- Section headings moved to `--text-xl` semibold tracked, which is the
  contract's own "section heading" step (§4) and what makes a heading read as a
  heading above `--text-base` rows. The count beside it is plain tabular text in
  secondary ink; the pill is gone.
- Gap between sections went from `--space-7` to `--space-8`. Air is the single
  biggest difference between a native pane and a web page, and four panels at a
  tight gap read as one scrolling wall.
- Rows lost the rail, the pill and the third button. Due now is Call (ghost),
  Done (secondary), Snooze (ghost). New leads is Call (ghost), Log a call
  (secondary). Gone quiet is Log a call (secondary), Snooze a week (ghost).
- The overdue badge moved from `tone="accent"` to `tone="warning"` — a muted
  pastel that says "Overdue 6 days" in words, which is the contract's rule that
  colour is never the only cue.
- Recent activity lost its per-row icon entirely. Six rows each with a small
  grey glyph is a column of glyphs, not a log; the kind is already spelled out
  in the label. The timestamp moved to the right edge in tabular figures.
- The connect-website card lost its 24px globe, its shadow and its black
  button. It is the quietest thing on the screen now, which is the point: it is
  the one panel that asks for something, and the primary button on Today belongs
  to what the owner came to do.
- First run: the three starter panels lost their spot glyphs. One black button
  ("Import a CSV"), two hairline ones.

### Contacts list, Companies list

Was: a filter bar of four stacked "visible label above control" blocks, then
68px rows with a `--text-lg` name, a stacked company line, and a trailing
"Open" link.

- The filter bar is one toolbar line: the macOS search field (`Input search` —
  soft grey, rounded, borderless, no glyph needed), then the pop-up buttons
  whose own placeholder names them ("Any tag", "Any source"), then the Archived
  checkbox. Labels survive as `sr-only`. One hairline under the whole thing.
- The row is a native list row: `--row-h`, the name at `--text-base` weight 500
  in full ink flexing and truncating with a `title`, the company (or the phone,
  on companies, in tabular figures) in a fixed column, tags right-aligned. The
  "Open" link is gone — the row was already the target.
- **Added a column-header strip** in the 11px uppercase section-label style.
  Once the row read as columns rather than as a stacked card, the columns needed
  naming, which is exactly what a Finder list view does and the one place the
  product is allowed capitals.
- `VirtualList` no longer hard-codes `estimateSize={68}`; it reads `--row-h`, so
  compact actually compacts.
- Rows are `cursor-default`. A native list row does not show a hand.

### Contact page

Was: a bordered `<section>` summary card sitting directly under the toolbar,
holding a `--text-2xl` phone number in a bespoke button, with the details column
below it as one large card full of `<h3>` + control pairs.

- The summary card is gone. The header is in the open air: a quiet breadcrumb,
  the name as an `h1` at `--text-2xl` semibold tracked and truncated, the
  company as a link, then the actions. `PageHeader`'s rule applies — no bottom
  hairline, because the toolbar above already draws one.
- **The phone is the one black button on the page**, and its label is the
  formatted number in tabular figures. That is the hierarchy the brief asks for
  — name, phone, next step — expressed as the only filled control rather than as
  a 24px number in a box.
- Next step is the third thing on the screen, in a plain sentence. "No next
  step" is tertiary ink, not the accent.
- The details column is seven grouped inset lists (Details, Phones, Emails,
  Tags, Address, Custom fields, Notes), each with a small-capitals label sitting
  in the canvas above its panel. This is the System Settings pattern and it is
  what `Card` + `CardGroupLabel` were rebuilt for.
- `SummarizeButton` mounted in the header actions.

### Company page, Deal page

Same treatment: `PageHeader` with the record's name as the `h1`, the facts
block below it, grouped inset lists in the details column. On the company page
the phone became the one black button, matching the contact page. On the deal
page the value leads at `--text-2xl` in tabular figures with the stage as a
pastel dot-tag beside it, then the next-step sentence.

`DraftFollowUpButton` and `SummarizeButton` mounted on the deal page header;
`SummarizeButton` on the company page. All three render visible-and-disabled
with their reason when AI is off, which is the default, so they are not behind a
condition.

### Pipeline board

Was: 300px columns each in its own bordered box on a grey fill, a `--text-sm`
stage name, the column total at `--text-lg` semibold, cards with a shadow and a
permanent grip glyph, "No next step" in accent ink, and a 2px blue outline on
the drop target.

- **The column is no longer a box.** No border, no fill. A header — the 7px dot
  in the stage's own colour, the stage name in full ink at `--text-base`, the
  count and the column total in tabular secondary ink — with one hairline under
  it, and a stack of cards below. A coloured or boxed column is the loudest tell
  of a web kanban, and the contract's stage colour is a dot or a rule, never a
  column.
- Columns are 280px with `--space-6` between them and `--space-2` between cards
  inside one, so the eye groups the cards before it groups the columns.
- The card is `--radius-lg`, one hairline, no shadow. Title, then company and
  value on one baseline (value right, tabular), then the next step in tertiary
  ink. The grip is faint until the card is hovered or holds focus.
- The drop target is a calm `--color-selected` tint instead of a 2px blue
  outline. Blue in this product is focus, links and the selected tint, and a 2px
  ring means "the keyboard is here".
- The empty-column line dropped the repeated instruction. The keyboard hint is
  stated once, above the board.

### Pipeline list, Stage manager

The list's filter row got the same toolbar treatment as Contacts. The table now
uses the kit's own cell variants (`TD primary`, `TD muted`, `align="right"`)
instead of hand-rolled `--text-lg` spans, so the column keeps one size and the
header keeps the 11px uppercase label `TH` already draws. The stage manager's
colour swatch went from a 20px bordered square to the 7px round dot the rest of
the product uses for a stage.

### Timeline

Was: an `<ol>` of bordered boxes, each with a 24px round icon chip, a dashed
border for a system entry, and a permanent pair of icon buttons.

- **A quiet log on a hairline rail.** One `border-l` down the whole list,
  entries separated by hairlines, each marked by a 5px dot on the rail — solid
  for an entry the owner wrote, hollow for one Helix wrote, so his own trail
  reads as the darker line. No boxes, no chips, no dashed borders.
- The five kind buttons lost their glyphs. Five icon-and-label buttons in a card
  header is a cluster; the words already name the kinds. The active one takes
  the `--color-selected` tint, which is the macOS toggle.
- The row's edit and delete buttons are revealed on hover or focus. A column of
  glyphs beside every entry turns a log into a toolbar.

### Tasks, Trash, Quick add, Search dialog, Saved views

- **Tasks**: group headings moved to `CardGroupLabel` (the 11px label) from an
  ad hoc `--text-lg` heading. Overdue is weight and full ink, not a red badge.
  The "Nothing overdue" reassurance was a bordered panel holding one line with a
  green tick in it — now one sentence in tertiary ink, because a coloured glyph
  is banned and a card that holds a single line is not a card.
- **Trash** stays a real table, which is right: it has four columns of dates and
  counts and the kit's `TH`/`TD` already draw them correctly. Dates moved to the
  `.tabular` class.
- **Search dialog** rebuilt as the Spotlight panel from §9: 600px, held 14% down
  the window over the scrim, an 18px magnifier and a `--text-lg` borderless
  input with one hairline under it, group headings in the 11px label style, rows
  at `--row-h` with the selected tint, and no icons on the rows.
- **Saved views**: the two triggers are plain `secondary` buttons at
  `--control-h`. The picker's rows are hairline-separated at `--row-h` under a
  label, the active one marked by the tint and weight rather than by a tinted
  pill, and the pin is an `IconButton`.
- **Task rail** on a record page moved from a card with a title inside it to the
  same `CardGroupLabel` + `Card` pattern as the groups it sits beside, so a
  record page has one way of labelling a panel rather than two.

## What the screenshots caught

Reading the code caught the icon imports, the shadows, the 44px overrides and
the accent colour. Every one of the following was invisible until a screenshot
was on screen, and each was fixed and recaptured.

**1. Today's row titles did not line up.** The leading tag sits in the first
column and the tags are different widths ("Overdue 6 days", "Due today",
"Website", "Contacted"), so the task title started at a different x on every
row — a ragged left edge on the one thing the owner actually reads. The tag
slot is now a fixed 116px column and every title down every section starts at
the same place. This is the single most "sloppy"-looking thing the sweep found
and it is invisible in the source.

**2. The AI buttons printed their disabled sentence twice on the deal page.**
`AiActionButton` renders "AI is off. Turn it on in Settings. Open AI settings"
beside each disabled button, so mounting two of them in the page header put the
same sentence on screen twice and shoved Delete into the gutter. The buttons
moved out of the header onto the record's own action row, where the sentence has
a line to wrap onto, and the cluster hides every copy but the first with
`[&>*:not(:first-child)_[data-testid=ai-disabled-reason]]:hidden`. That uses the
hook the AI feature already exposes rather than restyling anything inside it.

**3. An empty timeline was a 1900px white void.** The record pages put the
timeline and the details column in one grid row, so the timeline stretched to
the height of a 1900px details column with one empty state floating in the
middle of it. `xl:self-start` on the timeline column, and `fill` dropped, so it
is as tall as its content.

**4. The Spotlight panel stretched to the bottom of the window.** The search
overlay is `fixed inset-0 flex`, and a flex container stretches its children by
default, so a panel with one result was 780px tall with 600px of white under the
footer. `items-start` on the overlay. Only a screenshot shows this; the max
height on the list looked correct in the source.

**5. Two hairlines 6px apart under every filter toolbar.** The toolbar drew a
`border-b` and the list panel below drew its own top border. That is exactly the
"assembled rather than designed" detail `DESIGN.md` §9 warns about under the
page header. The toolbar's rule is gone on Contacts, Companies and the pipeline
list.

**6. The pipeline list truncated its deal titles to 120px.** `TD primary` is
`max-w-0 truncate`, which is what makes truncation work in an auto-layout table
— but with no width hint the browser gave the name column almost nothing while
the gap between Stage and Value ran 200px wide. Percentage widths on the five
`TH`s; "Spring cleanup and mulch" now reads in full.

**7. The stage manager printed "Name / Colour / Quiet days" six times.** One set
of labels per row, six rows, eighteen labels. A list of identical rows labels
its columns once — now a single 11px uppercase strip above them, with
`aria-label` on each control so nothing regressed for a screen reader. The
screenshot also caught a copy bug in the dialog's own description ("how long a
deals can sit here").

**8. A green tick in a bordered panel on the tasks screen.** "Nothing overdue.
You are caught up." was a card holding one line with a `--color-success` glyph
in it. A coloured icon is banned outright (§10) and a card that holds a single
sentence is not a card. It is one sentence in tertiary ink now.

**9. A column of red trash glyphs down the task list.** Every task row showed
its snooze and delete buttons permanently, so the eye landed on a vertical run
of red before it landed on any task. Revealed on hover and focus, the way the
timeline's row controls already were.

**10. Nested cards on the contact page.** `PhoneList` and `EmailList` each draw
their own grouped-list `Card`, and the page wrapped them in another one. Cards
never nest (§9) — the page gives them the label only.

**11. "Next step: No next step", and "Notes" above a field labelled "Notes".**
Two small copy stutters that only read as stutters on screen. Now "Next step:
none yet", and the notes field is labelled "What to remember" under its NOTES
group label. The task rail said "No next step" too, so the contact page said the
same three words twice; it now says "Nothing open."

**12. What compact caught: nothing.** The three compact captures came back
correct on the first pass — 13px body, 32px rows, every panel shorter and
nothing clipped or overlapping — which is the payoff for deleting the 31 hard-
coded `min-h-[44px]` overrides. Before the sweep, compact would have been 40+
controls stuck at their comfortable height.

**13. What the dark captures caught: nothing.** Both themes were correct on
every screen from the first pass, because nothing in scope carries a colour any
more — the feature code names tokens and the tokens invert.


## Judgement calls, stated rather than hidden

- **The 44px hit target.** The brief asked for 44px hit targets to be kept and
  also for hard-coded heights to be replaced with tokens. Those conflict:
  `DESIGN.md` §6 names `--control-h-sm` (28px comfortable, 24px compact) as the
  hit-target floor and §7 says a component that hard-codes a height breaks
  compact. The contract wins — every control is on the token scale, and a bare
  glyph is wrapped in `IconButton`, which is `--control-h`. Nothing in scope
  hard-codes a pixel height any more.
- **Two black buttons can be on screen at once on a record page.** The page's
  primary is the phone; the timeline composer's Save is also primary while the
  composer is open. That is the same role as a dialog footer's confirm — a
  transient form's confirm, not a second page action — and making it secondary
  would leave an open form with no obvious way to finish it.
- **The timeline's kind buttons are a five-item toggle set**, which is more
  controls in one place than the contract loves. The alternative is a dropdown,
  which turns a one-click "log a call" into two. The row of five stayed, with
  the glyphs removed so it reads as words.
- **`min-h-[120px]` survives on the log-call textarea.** It is content sizing,
  not a hit target, and there is no token for "three lines of a textarea" beyond
  `Textarea`'s own `calc(var(--control-h)*2.5)`, which is shorter than this
  dialog wants.
- **The e2e specs were edited**, but only their screenshot plumbing: the output
  folder moved to `sweep-records`, a `shootCompact` helper was added, and three
  captures were added (Today compact, contact page compact, pipeline board
  compact, plus the saved-views popover open). No assertion changed, because a
  restyle that needs an assertion changed has broken something.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 64 files, 799 tests, all passing |
| `records.e2e.ts` + `today.e2e.ts` on port 4187 | 19 tests, all passing (`E2E_PORT=4187 E2E_OUT=dist-sweep-records`) |
| `npx vite build --outDir dist-sweep-records` | succeeds; directory deleted afterwards |
| Hex / `rgb()` / `rgba()` / `hsl()` in scope | none |
| `lucide-react` in scope | none |
| `shadow-[var(--shadow-sm)]` in scope | none |
| `min-h-[44px]` / `h-[44px]` in scope | none |
| Uppercase in scope | three places, all the 11px section label |

Screenshots: `tests/e2e-mac/.cache/screens/sweep-records/` (gitignored) —
`{screen}-{light,dark}.png` for every screen above, plus `today-compact.png`,
`contact-page-compact.png` and `pipeline-board-compact.png`.
