# Helix CRM: design direction

Status: contract. Owner: design agent.
Companion documents: `design/research.md` (evidence), `src/styles/tokens.css`
(the values), `design/comps/` (what it looks like), `design/review.md` (what the
review found).

This file decides. If a component disagrees with it, the component is wrong.
Token names are fixed by `docs/CONTRACTS.md`; this file may add names, never
rename them.

---

## 1. Audience

One person. A solo owner, 40 to 65, running a landscaping crew, a dental office,
a med spa, a plumbing van, a venue, a gym, a church office or a restaurant. He
is on a laptop in a truck cab or at a kitchen table, early morning or late
night, often in direct sun. He is frequently a two-finger typist. Presbyopia is
likely. The software he trusts is QuickBooks, Gmail and his bank's app.

He did not want a CRM. He wants two things:

> **Do not lose a lead. Remember what I promised.**

Every screen is measured against those two sentences. A screen that serves
neither should not ship.

## 2. Principles

1. **Density is the aesthetic.** The design is the information. There is no
   decoration anywhere in this product.
2. **One accent, one meaning.** Orange means "this needs you". If it appears
   anywhere that is not asking for his attention, that is a bug.
3. **Money and names get the large type.** Everything else is subordinate.
4. **Light first.** Dark is a setting for the person working at 10 pm.
5. **Plain words.** Buttons name what will happen. Errors say what went wrong
   and what to do. No exclamation marks, no apologies, no cleverness.
6. **No dark patterns, ever.** Nothing in this product asks for money, an
   upgrade, an account, an email address, or a review. There is no telemetry
   and no nag. Destructive actions are undoable and say so before they run.
7. **Built for the edge case.** A 47-character company name, an unparseable
   phone number, a zero-result search and a dead internet connection are the
   normal case, not the exception.
8. **Offline is absolute.** No webfonts, no CDN, no remote image, no analytics
   script. The app must render identically with the network unplugged.

## 3. Hierarchy rules

These are not suggestions. They are the layout law.

**App-wide**

- Today is the first screen after boot, always. It is the first item in the
  sidebar and it owns the `Escape`-to-home behaviour.
- The sidebar is 232 px and never collapses. Eight items, fixed order: Today,
  Contacts, Companies, Pipeline, Tasks, Reports, Import, Settings. Pinned saved
  views sit under Pipeline in their own group.
- The top bar is 56 px and holds three things: where you are, search, and quick
  add. Nothing else is ever added to it.

**On Today**

- Order is fixed: **Needs you**, then **New leads**, then **Gone quiet**, then
  **Recent activity**. Overdue rises to the top of "Needs you".
- The "Needs you" count is the largest number on the screen.
- Every row on Today carries the customer's name and a direct action. A row he
  cannot act on from the row does not belong on Today.

**On a record (contact, company, deal)**

- The top block is fixed and does not scroll. It holds, in this order and
  nothing else:
  1. the name, at `--text-xl`;
  2. the **phone number**, as a real `tel:` control with a visible label;
  3. the **next step** — the next open task with its due date — in full-strength
     text, or "No next step" in the accent if there is none;
  4. at most two more controls (Email, Log a call).
- The phone number and the next step are above everything else on the record.
  Tags, custom fields, the address, the company link and the timeline all sit
  below the fold of that block.
- The timeline is reverse-chronological and scrolls under the fixed block.

**On the pipeline board**

- Stage header shows name, deal count and value total. The value total is the
  largest text in the header.
- A card shows: deal title, company, value, next task due date. Four things.
- A card with no next step shows "No next step" in the accent. That is the only
  nag in the product.

## 4. Typography

System stack only. The app runs offline; a webfont is not a style decision here,
it is a bug.

```
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text",
             "Segoe UI", system-ui, "Helvetica Neue", Arial, "Noto Sans",
             sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", monospace;
```

`Segoe UI Variable Text` comes before `Segoe UI` so Windows 11 picks the
optical-size-corrected text face at 16 px.

| Token | Size | Used for |
|---|---|---|
| `--text-xs` | 13 px | Badges, table meta, helper text. **The floor.** Nothing is smaller, anywhere. |
| `--text-sm` | 14 px | Secondary line in a row, column headers, field labels |
| `--text-base` | **16 px** | Body, table cells, inputs, buttons, menu items |
| `--text-lg` | 18 px | Customer name in a list row, section headings |
| `--text-xl` | 22 px | Record name, dialog title |
| `--text-2xl` | 28 px | Money on a record, the Today counts |
| `--text-3xl` | 34 px | Report headline figures only |

Line height: `--leading-normal` 1.55 for body (WCAG wants ≥1.5), 
`--leading-tight` 1.25 for headings. Weights: 400 body, 500 for a row's primary
line, 600 for headings and column headers. No weight below 400 and no weight
above 600 — the system faces get muddy at 700 on Windows.

**Numbers.** Money, counts, dates, phone numbers and percentages are set in
tabular figures (`font-variant-numeric: tabular-nums lining-nums`) via the
`.tabular` / `.money` utilities in `globals.css`. Money is right-aligned in
tables, never wraps, always carries the currency symbol and two decimals:
`$12,450.00`. A column of amounts that does not line up reads as sloppy
bookkeeping to this audience, and that is the whole game.

**Letter-spacing.** −0.011em on headings only. Nothing is tracked out. There are
no all-caps labels in this product; small caps at 13 px is the opposite of
legible for a 58-year-old in a truck.

**Truncation.** Names and titles truncate with an ellipsis at one line and carry
a `title` attribute. They never wrap to a second line inside a fixed-height row,
and they never shrink to fit. `Little Cottonwood Canyon Homeowners Association`
is 47 characters and appears in the comps for this reason.

## 5. Colour

### The canvas

Paper-white panels on a cool grey canvas. Ink is a blue-black (`#16202B`), not a
tinted near-black. Nothing here is cream and nothing is warm-neutral.

Light: `--color-bg` canvas, `--color-surface` panels and rows,
`--color-surface-raised` overlays, `--color-sidebar` the nav rail.
In light, surface and surface-raised are the same white; an overlay is separated
by `--shadow-lg` and a border. In dark they are genuinely different values.

### The accent: one colour, one meaning

`--color-accent` is **equipment orange** — `#C1440E` in light, `#F0742E` in dark.
It means exactly one thing: **this needs you**.

It may appear on:

- the "Needs you" count and its section rule on Today;
- the overdue badge on a task;
- the 3 px left rail on a row or card that is overdue or has gone quiet;
- the "No next step" label;
- the single primary button on a screen, when that button is the thing he came
  to do (Save, Import, Log the call);
- the fill of a determinate progress bar for an operation he just started — it
  is the visual continuation of the accent button he pressed, not a new signal;
- the unread dot on a new lead.

It may not appear on: headings, links, icons that are not signalling, chart
fills, hover states, focus rings, the logo, or any surface larger than a badge.
**Global chrome never carries the accent.** The top bar's Quick add button is a
Default button, not a primary one — if the accent lived in the chrome it would
be on every screen at all times and would stop meaning anything.
**Budget: on a full screen the accent should cover well under 2% of the pixels.**

Overdue is the accent, not danger. `--color-danger` is reserved for destructive
actions and for things that actually failed. A task that is six days late is not
an error; it is the owner's queue.

Why orange. The audience's eyes yellow with age and pale blue loses apparent
contrast for them, which rules out the default SaaS blue accent (see
`design/research.md`). Warm, dark and high-chroma survives both presbyopia and
direct sun. It is also the colour of the equipment in their own yards. It is not
terracotta: terracotta (`#D97757`) is L\* 61 at chroma 49; this is L\* 46 at
chroma 72 — darker, twice as saturated, and never used as a background wash.

**Accent text vs accent fill.** `--color-accent` is for fills, rails, dots and
borders. Accent-coloured *text* uses `--color-accent-ink`, because `#C1440E`
reads 4.44:1 on the grey canvas and fails AA. This distinction is enforced in
`tokens.css` comments and must be respected in components.

### Semantics

| Token | Means | Where it appears |
|---|---|---|
| `--color-danger` | Destructive or failed | Delete buttons, failed import rows, error text |
| `--color-success` | Won or completed | Won stage, completed task check, import success count |
| `--color-warning` | System caution, reversible | Offline banner, backup overdue, unsaved changes |

`--color-*-soft` is the tinted background; `--color-*-ink` is the text on it.
Warning and the accent are both warm and are deliberately kept apart by role:
the accent is about **the owner's queue**, warning is about **the system's
state**. Neither is ever used without a word beside it.

### Focus

`--color-focus` is a clear blue used for one thing only: the keyboard focus
ring. It never means anything else, which is why it can be blue without
competing. The ring is 2 px with a 1 px offset so it stays visible on a stage
colour, a soft tint or a selected row. It is never removed.

### The stage ramp

Eight defaults for user-created pipeline stages, `--stage-1` … `--stage-8`.

| | Colour | Default stage |
|---|---|---|
| 1 | sage `#789695` | New lead |
| 2 | cyan `#009BD4` | Contacted |
| 3 | indigo `#4F62B6` | Estimate sent |
| 4 | deep teal `#0082A3` | Scheduled |
| 5 | green `#44A26E` | Won |
| 6 | mauve `#925D77` | Lost |
| 7 | orchid `#BF6DC4` | spare |
| 8 | moss `#47733A` | spare |

Three properties, all of them load-bearing:

1. **No stage hue enters the 5°–100° band.** That band belongs to the accent,
   to warning and to danger. A stage can never be mistaken for "needs you".
2. **Colour-vision safe.** Lightness and chroma were solved numerically to
   maximise the *worst* pairwise CIE Lab ΔE across normal, protanope,
   deuteranope and tritanope simulation (Viénot 1999). Worst case over all 28
   pairs and all four vision types is **ΔE 11.1** — comfortably above the ~5
   threshold at which two swatches stop being separable. The per-mode worst
   pairs are recorded in `tokens.css`.
3. **Shared across themes.** Every value clears 3:1 against both the light and
   the dark canvas, so a stage keeps its identity when the theme flips. Only the
   `--stage-N-soft` column tints change.

**Stage colour is never the only cue.** The stage name is always present in
full-strength text beside the colour. Stage colours are graphic tokens; they are
not text colours and they are never used for text.

**Text on a `--stage-N-soft` tint is `--color-text` or `--color-text-muted`,
never `--color-text-faint`.** In the dark theme faint text lands at 3.48:1 on
the worst tint and fails AA. This review caught exactly that on the empty Lost
column. The measured worst pairs for both themes are in `tokens.css`.

## 6. Spacing, radius, elevation

**Space** is a 4 px scale, `--space-1` (4) … `--space-10` (64). Component
padding uses 2/3/4; gaps between related blocks use 4/6; gaps between sections
use 7/8. Nothing uses a value off the scale.

**Radius** is deliberately modest: `--radius-sm` 4 (inputs, badges),
`--radius-md` 6 (buttons, cards, table container), `--radius-lg` 10 (dialogs,
popovers), `--radius-full` (avatars and count pills only). Large radii make
dense rows read as loose cards, which is the wrong signal for a tool.

**Elevation** has three levels and each has a job:

- `--shadow-sm` — a resting panel or card.
- `--shadow-md` — a dropdown, a popover, a dragged card.
- `--shadow-lg` — a dialog or a toast.

Nothing else casts a shadow. A row never lifts on hover.

## 7. Density

Comfortable is the default: `--row-h` 48 px, 16 px body, 56 px top bar,
`--control-h` 36 px, `--control-h-sm` 32 px.
Compact is a setting: `--row-h` 34 px, 15 px body, 48 px top bar,
`--control-h` 32 px, `--control-h-sm` 28 px, spacing scale tightened to roughly
3 px steps.

What compact actually buys, measured in the comps, not estimated: about **29%
more rows in a single-line table** (48 px to 34 px) and about **7% more in the
two-line rows on Today** (58 px to 54 px), because those rows are sized by their
two lines of text and not by their padding. That is the correct trade. The
two-line row exists because the customer's name and the job need to be read at a
glance; squeezing it to one line would win rows and lose the screen's job.

**Density comes out of padding, never out of legibility.** Body text never drops
below 15 px and meta text never below 13 px in either mode. The shell sets
`data-density` on `<html>` from app settings; components must never hard-code a
row height.

Hit targets are at least 32 × 32 px in comfortable and 28 × 28 px in compact —
that is exactly what `--control-h-sm` is, so a control that uses the token
cannot be too small by accident. Keep at least 8 px between adjacent targets. A
row's whole height is the click target for opening the record.

Controls must not shrink. Every button carries `flex: none`; without it a flex
row squeezes an icon button below its hit target, which is a defect this review
actually caught (27 px instead of 32 px).

## 8. Motion

- Motion answers an action. It never announces itself.
- No entrance animations. No scroll reveals. No hover lifts. No skeleton
  shimmer — a loading table shows a quiet row count instead.
- Durations: `--dur-fast` 90 ms (hover, press, checkbox), `--dur-base` 160 ms
  (popover, dropdown, toast), `--dur-slow` 240 ms (dialog, drawer). Easing is
  `--ease-out` for things entering, `--ease-in-out` for things moving.
- Only `transform` and `opacity` are animated.
- A dragged pipeline card follows the pointer with no spring and no rotation.
  The drop target is shown with a 2 px `--color-focus` outline, not by animating
  the neighbours apart.
- `prefers-reduced-motion: reduce` collapses every duration to 1 ms in
  `globals.css`. The product remains fully usable and nothing is lost.

## 9. Components

### Buttons

Four variants and no more.

| Variant | Look | Use |
|---|---|---|
| Primary | `--color-accent` fill, `--color-accent-text` | **One per screen**, for the thing he came to do |
| Default | `--color-surface` fill, `--color-border` 1 px, `--color-text` | Everything else |
| Quiet | no fill, no border, `--color-text-muted`; `--color-hover` on hover | Row actions, toolbar |
| Danger | `--color-danger` fill, white | Confirmed destructive action inside a dialog only |

Height `--control-h` (36 px comfortable, 32 px compact); row-action buttons use
`--control-h-sm` (32 / 28). Never a hard-coded pixel height. Padding
`--space-4` horizontal.
Radius `--radius-md`. Label is a verb phrase in sentence case: "Save changes",
"Import 1,204 contacts", "Move 8 deals to Contacted". Never "Submit", never
"OK", never a bare arrow. Icon-only buttons exist only in a row's action cluster
and always carry an `aria-label` and a tooltip. A pressed button darkens; it
does not scale.

Loading: the label is replaced by the progressive form of the same verb
("Importing…") and the button is disabled. It never shows a spinner alone.

### Inputs

Label above the field, always visible, `--text-sm`, `--color-text-muted`.
Placeholder text is an example (`(801) 555-0147`), never a substitute for the
label. Field height `--control-h`, 1 px `--color-border`, `--radius-sm`,
`--color-surface` fill, 16 px text. Focus draws the standard ring.

Helper text sits under the field at `--text-xs`, `--color-text-faint`. Errors
replace it, in `--color-danger-ink`, with a 16 px `alert-circle` icon and a
sentence that says what to fix: "Enter a phone number with at least 10 digits."
The field border goes `--color-danger`. Errors appear next to the field, never
only in a summary at the top.

Required fields are marked on the label with the word "Required", not an
asterisk.

### Tables

The ledger. A white surface, a sticky header row at `--text-sm` weight 600 on
`--color-surface` with a `--color-border` bottom rule, rows separated by a
single 1 px `--color-border` hairline. **No zebra striping** and no vertical
cell borders — they fight the data.

- Row height `--row-h`. Hover `--color-hover`. Selected `--color-selected` plus
  a 3 px `--color-focus` left rail.
- The row's primary cell (the customer's name) is `--text-lg` weight 500; every
  other cell is `--text-base` `--color-text-muted`.
- Numeric columns carry `data-numeric`: right-aligned, tabular.
- A totals row is pinned to the foot, `--color-surface` with a 2 px
  `--color-border-strong` top rule and weight 600.
- The first column is sticky when the table scrolls horizontally.
- Sortable headers show a 16 px chevron; the sorted column's header is
  `--color-text`, the rest `--color-text-muted`.
- 10 000 rows are virtualised. The scrollbar is always visible (see
  `globals.css`) so the layout does not shift between macOS and Windows.

### Cards

Only three things are cards: a pipeline deal, a Today panel, and a report tile.
`--color-surface`, 1 px `--color-border`, `--radius-md`, `--shadow-sm`, padding
`--space-4`. A card that needs attention gains a 3 px `--color-accent` left
rail — it does not change its background. Cards never nest inside cards.

### Badges

`--radius-sm`, 13 px, weight 500, padding `--space-1` / `--space-2`, height
20 px. Three kinds:

- **Stage**: `--stage-N-soft` background, `--color-text` label, and a 8 px dot
  in `--stage-N`. The name is always spelled out.
- **Semantic**: `--color-{danger,success,warning}-soft` background with the
  matching `-ink` text. Always paired with a word ("Overdue", "Won", "Offline").
- **Count**: `--radius-full`, `--color-accent` fill with `--color-accent-text`
  when it is a "needs you" count; `--color-border` fill with `--color-text-muted`
  otherwise.

A badge never carries meaning by colour alone.

### Empty states

An empty state is a designed screen. Structure, top to bottom, left-aligned in a
column capped at `--content-max`:

1. A 24 px lucide icon in `--color-text-faint`. One icon, no illustration.
2. A heading at `--text-lg` that says what belongs here in the owner's words —
   "No leads waiting", "No contacts yet".
3. One or two sentences at `--text-base` `--color-text-muted` saying how this
   list fills up.
4. One primary action, and at most one secondary text link.

Rules: never "Nothing to see here". Never a shrug or a mascot. A **zero-result
search** is different from an **empty list** — the zero-result state repeats the
query back in quotes, offers to clear the filters, and offers to create a record
with that text as the name. A **first-run** state is different from a
**cleared** state: "No overdue tasks. Everything is caught up." is a reward, and
it gets a `--color-success` check, not the accent.

### Dialogs

`--color-surface-raised`, `--radius-lg`, `--shadow-lg`, max width 520 px for a
confirm and 720 px for a form, centred, scrim `--color-overlay`. Title at
`--text-xl`. Body in plain sentences that name the consequence and the reversal:
"Delete Brent Hendrickson? He moves to Trash and can be restored for 30 days."
Actions bottom-right, cancel on the left of the confirm. The destructive button
carries the verb and the object: "Delete contact", never "Yes".

Escape closes. Focus is trapped and returns to the trigger. The first focusable
element is the safe one.

### Toasts

Bottom-left, above the status bar, `--color-surface-raised`, `--shadow-lg`,
`--radius-md`, max width 420 px, stacked to a maximum of three. A toast carries
a sentence in the past tense — "Deleted 1 contact" — and, for the ten seconds it
lives, an **Undo** button as a Default button, not a link. Undo toasts do not
auto-dismiss while hovered or focused. Errors do not auto-dismiss at all and
carry a "Copy details" action.

### Status bar

A 28 px strip at the bottom of the window: workspace name, last backup time,
last lead poll time, and the write-queue label when a write is queued behind an
import. `--text-xs`, `--color-text-faint`. This is where "it is working"
lives, so it never needs to be a toast.

## 10. Iconography

**lucide**, 20 px, stroke width 1.75, `currentColor`, never filled, never
coloured independently of its text. 16 px is permitted only inline inside 13 px
badge and helper text. 24 px is permitted only in empty states.

An icon never appears alone unless it is in a row's action cluster, and then it
carries an `aria-label` and a tooltip. There are no icons in the sidebar's
labels competing with the words — the icon sits left of the word at 20 px in
`--color-text-muted`, and the word is what is read.

No emoji anywhere in the product UI.

## 11. Do / Don't

**Do**

- Put the phone number and the next step at the top of every record.
- Right-align money, set it tabular, and show two decimals.
- Spell out the stage name next to its colour.
- Say what a button will do, in a verb phrase.
- Give every destructive action a ten-second Undo and say so.
- Truncate long names with an ellipsis and a `title`.
- Design the empty state before the full one.
- Keep the accent under 2% of the pixels.
- Show the keyboard shortcut next to the action it triggers.

**Don't**

- Don't use the accent for anything that is not asking for attention.
- Don't zebra-stripe a table or draw vertical cell borders.
- Don't put a second primary button on a screen.
- Don't use colour as the only carrier of meaning, anywhere.
- Don't shrink type below 15 px body / 13 px meta to fit more rows.
- Don't animate anything on load, on scroll, or on hover.
- Don't use an all-caps tracked-out label, a middle-dot meta string, or a
  trailing arrow in a button.
- Don't write "Oops", "Nothing to see here", "Awesome", or an exclamation mark.
- Don't add a webfont, a CDN link, or a remote image.
- Don't nest a card inside a card.
- Don't hide a destructive action behind an icon with no label.

## 12. What was rejected, and why

**The dispatch board** (the prior ClearPath tool: dark-first, very dense,
sodium-yellow signal). Rejected by decision D9. It was designed for one power
user who lives in it all day on a bright office monitor. Our owner opens the app
for six minutes in a truck cab in full sun. Dark-first loses in sun, and a
yellow signal on dark cannot be reproduced on white without becoming a
mud-brown. The density lesson was kept; the palette and the theme were not.

**Cream, serif display and terracotta.** The current default of generated
design, and specifically off-limits here. It also reads as "boutique studio",
which is exactly the wrong promise to make to someone who wants his CRM to feel
like his accounting software.

**Near-black with an acid accent.** Same objection, opposite costume. Acid green
and vermilion on near-black is a developer-tool costume, and the audience is not
developers.

**The default SaaS blue accent.** Rejected on evidence, not taste: the ageing
lens yellows and absorbs short wavelengths, so pale blue loses apparent contrast
for exactly this age band. Blue is kept for the focus ring, where it is a
transient 2 px ring and never carries meaning.

**Okabe-Ito unmodified for the stage ramp.** It is the right reference and it is
cited in the research, but three of its eight colours sit in the warm band the
accent owns, and its yellow fails contrast on white. The ramp was re-solved under
the same objective with the warm band held out.

**The agency-polish playbook** (`~/.claude/skills/high-end-visual-design`):
`py-24` macro-whitespace, double-bezel nested cards, squircle 2rem radii,
pill CTAs with a nested icon circle, staggered scroll reveals, glass blur, and
its ban on lucide icons. All of it is correct for a marketing page and wrong for
a 10 000-row table that a 58-year-old scans in six minutes. The brief pins
lucide at 20 px and comfortable-but-dense layout, and the brief wins. What was
kept from that playbook: no generic grey 1 px border used thoughtlessly (borders
here encode structure), a real elevation system with three defined jobs instead
of one soft shadow on everything, deliberate easing curves, and the discipline
of spending boldness in exactly one place. Here that place is the accent.

**A compact toggle that shrinks the type.** The obvious implementation and the
wrong one for this audience. Compact takes its space out of padding and row
height only.
