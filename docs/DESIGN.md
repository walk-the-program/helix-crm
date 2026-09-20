# Helix CRM: design direction

Status: contract. Owner: design agent. Revision: 3 (2026-09-19).
Companion documents: `assets/brand/guide/helix-crm-brand-guide.html` (the brand
guide this revision implements), `src/styles/tokens.css` (the values),
`src/ui/icons.ts` (the icon set), `design/brand/review.md` (what the
screenshots caught), `design/research.md` (the audience evidence, still
current).

This file decides. If a component disagrees with it, the component is wrong.
Token names are fixed by `docs/CONTRACTS.md`; this file may add names, never
rename them.

Revision 3 puts the supplied brand guide on top of revision 2's desktop
chassis. What changed and what did not is at the bottom under **Superseded**.

---

## 1. What this should feel like

A native desktop application with a brand. Revision 2 got the chassis right —
air, hairlines, calm hierarchy, nothing decorative — and then refused to have
a point of view. The brand guide supplies the point of view, and it is
specific: a slab serif, a flat five-colour palette, hard edges everywhere, and
one confident block of colour per screen.

The two things together:

- **From the desktop chassis**: generous air, one hairline between things,
  40px rows, weight and position doing the hierarchy work, no gradient, no
  card shadow, no icon in a coloured circle, no illustration, a real dark
  mode, and a compact density that is a setting rather than the design.
- **From the brand guide**: Zilla Slab headings against Poppins body, a
  #FAFAFF canvas, corners at zero, the primary `#97B1C3` used once per view as
  a single confident block, the accent `#EDF0A3` as a detail and never a
  background, and the mark wearing a hard offset sticker shadow.

The owner is still the one from `design/research.md`: a solo owner, 40 to 65,
running a trade or service business, on a laptop at a kitchen table or in a
truck cab. He still wants exactly two things —

> **Do not lose a lead. Remember what I promised.**

— and every screen is still measured against those sentences. The brand does
not change the job. It gives the tool a face.

## 2. Principles

1. **Neutrals carry the layout.** The guide's own words. The canvas, the
   sidebar, the panels and the ink are all neutral. Colour is an event.
2. **One confident block per view.** The primary `#97B1C3` appears once: the
   selected sidebar row, and — on a screen that has a primary action — the
   primary button. A screen with two primary buttons is a bug.
3. **The accent is a detail, never a background.** `#EDF0A3` belongs to the
   mark's sticker shadow and to at most one hero element per screen. It is
   never a fill behind text, never a panel, never a row.
4. **Flat fills only.** No gradient, including a "subtle" one. No blurred
   shadow. A tint is the primary mixed into the neutral at 8% or less, and it
   is written as a flat hex so it does not shift with what is behind it.
5. **Hard edges.** Every radius in the product is zero — controls, cards,
   panels, badges, the mark. Nothing is a pill and nothing is rounded.
6. **Air is still the aesthetic.** Zero radius plus flat fills plus hairlines
   will read as a wireframe if the spacing gives out. Density is a setting
   (`compact`); the comfortable default leaves room between things.
7. **One hairline.** Everything is separated by the neutral dark at 14%, 1px,
   and by space. Nothing is separated by a shadow — even a floating layer gets
   a second hairline rather than a blur.
8. **Contrast is measured, not assumed.** Two of the five brand colours cannot
   legally carry small text on a light surface. The guide says so itself:
   "anything under 4.5:1 is reserved for large type and graphic shapes." Every
   pair the product can produce is measured in `tokens.css`.
9. **Plain words.** Direct, specific, warm. No hype, no jargon, no filler —
   the guide's voice page, applied to buttons, errors and empty states.
10. **No dark patterns, ever.** Nothing asks for money, an upgrade, an account
    or a review. No telemetry, no nag. Destructive actions are undoable and
    say so before they run.
11. **Built for the edge case.** A 47-character company name, an unparseable
    phone number, a 10 000-row table and a 1024px window are the normal case.

## 3. The window

```
┌──────────────┬──────────────────────────────────────────────┐
│  [mark]Helix │  toolbar 48px, white, hairline bottom        │
│              ├──────────────────────────────────────────────┤
│  sidebar     │                                              │
│  240px       │  content, #FAFAFF canvas                     │
│  #F2F4FA     │  32px side gutter, 24px top                  │
│  hairline    │  panels are #FFFFFF, radius 0, hairline      │
│  right edge  │                                              │
│  ███ selected│  <- the one primary block, #97B1C3           │
│  ──────────  │                                              │
│  workspace   │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **Sidebar**: `--sidebar-w` 240px, `--color-sidebar` (#F2F4FA — the primary at
  8% over the neutral light, which is the guide's tint ceiling), one hairline
  right edge, never collapses. The `Brand` lockup sits at the top with room
  under it for the sticker shadow's 4px overhang. Nav rows are 32px tall with
  a hard edge, label at body size in secondary ink, icon at 18px taking the
  row's own ink. **The selected row is the primary block**: a flat `#97B1C3`
  fill with `#141414` ink at 8.24:1. Group labels are the 11px caption style.
- **Toolbar**: `--topbar-h` 48px (44 compact), `--color-surface`, one hairline
  bottom. Three things — where you are, the search field, quick add — and
  nothing is ever added to it. Toolbar glyphs are monochrome, 16px bold, in
  secondary ink.
- **Search field**: a square field on `--color-accent-soft` with the 16px
  magnifier in tertiary ink and the shortcut hint on the right. It is a button
  that opens the search dialog; the field is the affordance.
- **Content**: `--color-bg` (#FAFAFF) canvas, 32px side gutter, 24px top.
  Panels are white with a hairline and no radius. Minimum window 1024px,
  design target 1280.

## 4. Typography

Two faces, both self-hosted, both OFL 1.1: **Zilla Slab** for headings and
**Poppins** for everything else. They live in `public/fonts` as latin-subset
woff2, are declared in `globals.css` with `font-display: swap`, and the two
faces the first frame needs are preloaded from `index.html`. The app is
offline; there is no CDN and no network font request, ever.

Zilla Slab ships at 600 and 700 only, and Poppins at 400, 500 and 600, so
nothing in the product can ask for a weight the browser would have to
synthesise. `font-synthesis-weight: none` keeps that honest.

The guide's scale, verbatim:

| Token | Size / leading | Where |
| --- | --- | --- |
| `--text-display` | 52 / 1.0 | the boot lockup, and nothing else |
| `--text-heading` | 32 / 1.1 | the page title |
| `--text-subhead` | 20 / 1.3 | dialog title, empty-state title |
| `--text-body` | 15 / 1.65 | body copy |
| `--text-caption` | 11 / 1.4 | labels, table headers, metadata |

The desktop app needs sizes between those five steps, so the revision-2 UI
scale stays alongside it, and where the two meet they now agree: `--text-base`
**is** the guide's body, `--text-label` **is** its caption, `--text-xl` **is**
its subhead, `--text-3xl` **is** its heading.

| Token | Comfortable | Compact | Where |
| --- | --- | --- | --- |
| `--text-label` | 11px | 10px | section labels, table column headers |
| `--text-xs` | 12px | 11px | badges, helper text, kbd, meta |
| `--text-sm` | 14px | 12px | secondary row text, field labels, subtitles |
| `--text-base` | 15px | 13px | body, table cells, inputs, buttons, menus |
| `--text-lg` | 17px | 15px | card titles, the primary line of a list row |
| `--text-xl` | 20px | 18px | dialog title, section heading |
| `--text-2xl` | 24px | 22px | the money on a record |
| `--text-3xl` | 32px | 26px | page title, report headline figures |

Rules:

- **Headings are the slab.** Every `h1`–`h6`, `PageHeader`, `CardTitle`,
  `DialogTitle`, `EmptyState` title and the `Brand` wordmark are
  `--font-heading` in `--color-heading` (#141414 light, #FAFAFF dark) tracked
  -0.01em. Nothing else is.
- **Everything else is Poppins.** `--font-sans` resolves to `--font-body`, so
  the whole kit picked it up without an edit.
- **Two leadings.** Prose — a paragraph, a description, an empty state — takes
  `--leading-body` (1.65), which is what the guide specifies. Rows and
  controls take `--leading-normal` (1.5), because 1.65 pushes a label off the
  centre of a 32px control.
- **Section labels** are the only capitals in the product: the caption step at
  11px, weight 600, tracked 0.05em, uppercase, `--color-text-faint`, never
  more than three words. They label a group of rows or a table column, never a
  paragraph.
- Money, counts, dates and phone numbers carry tabular figures
  (`data-numeric`, `.tabular`, `.money` in `globals.css`).
- A name truncates with an ellipsis and carries a `title`; it never wraps
  inside a fixed-height row.
- Sentence case everywhere except the section label.

## 5. Colour

### The brand

| | Hex | Token |
| --- | --- | --- |
| Primary | `#97B1C3` | `--brand-primary` |
| Secondary | `#8B85C2` | `--brand-secondary` |
| Accent | `#EDF0A3` | `--brand-accent` |
| Neutral dark | `#4E555A` | `--brand-neutral-dark` |
| Neutral light | `#FAFAFF` | `--brand-neutral-light` |
| Primary tint | `#F2F4FA` | `--brand-primary-tint` (primary at 8% over the neutral light) |

### The canvas

| Token | Light | Dark |
| --- | --- | --- |
| `--color-bg` | `#FAFAFF` | `#141414` |
| `--color-surface` | `#FFFFFF` | `#1E1E1E` |
| `--color-surface-raised` | `#FFFFFF` | `#282828` |
| `--color-sidebar` | `#F2F4FA` | `#191919` |
| `--color-hover` | `#EAEDF3` | `#242424` |
| `--color-selected` | `#EEF1F8` | `#2A2D2E` |
| `--color-border` | `rgba(78,85,90,0.14)` | `rgba(250,250,255,0.12)` |
| `--color-border-strong` | `rgba(78,85,90,0.30)` | `rgba(250,250,255,0.24)` |
| `--color-heading` | `#141414` | `#FAFAFF` |
| `--color-text` | `#4E555A` | `#FAFAFF` |
| `--color-text-muted` | `#5C6368` | `#B4B5BE` |
| `--color-text-faint` | `#646B71` | `#A6A7B1` |
| `--color-text-disabled` | `#8B9196` | `#6E7278` |

The dark canvas is `#141414` because that is the near-black the guide measured
the palette against: `#97B1C3` at 8.24:1 and `#EDF0A3` at 15.43:1 are the
numbers printed on its palette page, so in dark mode the brand runs at exactly
its stated contrast.

**On the ink ramp.** Body ink is the brand's neutral dark. Headings step up to
the near-black. Muted and faint are that same grey lightened until they stop
clearing AA on **every** surface in the product, not just on white — tertiary
ink is `#646B71` (4.61:1 at worst, on the hover tint) rather than the `#6A7278`
the ramp first reached for, which measured 4.89:1 on white but 4.45:1 on the
sidebar tint, exactly where a kbd glyph and a sidebar group label land. The
ramp is compressed — 7.58 / 6.11 / 5.41 on white — because the brand's neutral
dark is already a mid grey; size and weight carry the hierarchy, as they always
did. `--color-text-disabled` is 3.19:1 and may carry a glyph or a scrollbar
thumb, never text the owner has to read.

### The one filled control

`--color-accent` is the brand primary, and it is the only saturated fill a view
gets. Its ink is `--color-accent-text` `#141414` at **8.24:1** — the same pairing
the guide uses on its own cover page. White on `#97B1C3` measures 2.24:1 and is
never used anywhere.

In practice the block is:

- the **selected sidebar row**, on every screen; and
- the **primary button**, on a screen that has a primary action.

It does not invert in dark mode. Same colour, same ink, same ratio, both
themes — which is the strongest single thing the brand does.

`--color-accent-soft` (`#F2F4FA`) is the quiet tint: the search field, a
pressed ghost button, a `kbd`, a code block. It is not an accent; it is the
absence of one.

### The secondary

The secondary does two jobs and no others:

- **Focus.** `--color-focus` is the pure `#8B85C2`, a 2px ring at a 1px offset,
  on every interactive element, keyboard-only, never removed. It measures
  3.37:1 on white, which clears the 3:1 bar a non-text indicator has to meet.
- **Links.** `--color-link` is `#5F58A6` — the same hue darkened until it
  clears AA for 15px text (6.12:1 on white), because the pure secondary at
  3.37:1 does not. This is the guide's own rule about sub-4.5:1 colour,
  applied rather than ignored.

The secondary is never a button fill and never chrome.

### The accent

`#EDF0A3` is a detail. It appears in exactly two shapes:

- `--shadow-sticker` (`4px 4px 0`), which belongs to the `Brand` lockup and to
  **at most one hero element per screen**; and
- `--color-brand-accent-soft` (`#FDFEF6`), the accent at 10%, which is the one
  surface it is allowed to make and is nearly white by design.

It is never a background, never a row, never a fill behind body text.

### Brand tint pairs

Each brand colour at 10% over white with the AA ink it is always shown with.
These are what a square badge wears.

| Tone | Fill | Ink | Ratio |
| --- | --- | --- | --- |
| `brand` / `accent` / `info` | `#F5F7F9` | `#2C5670` | 7.32:1 |
| `secondary` | `#F3F3F9` | `#5F58A6` | 5.53:1 |
| `highlight` | `#FDFEF6` | `#5A5D18` | 6.86:1 |

### Semantics

Danger, success and warning keep their revision-2 muted pastels. The guide is
silent on state colour, and these are the only three hues in the product that
mean something on their own. Info now follows the brand primary, which is what
an informational tag should look like in a product with a palette.

| Role | Fill | Ink |
| --- | --- | --- |
| info / `tone="accent"` | `#F5F7F9` | `#2C5670` |
| success | `#EDF3EC` | `#346538` |
| warning | `#FBF3DB` | `#956400` |
| danger | `#FDEBEC` | `#9F2F2D` |

The bare semantic token (`--color-danger`) is a fill for light text and
appears in exactly one place: the confirm button of a destructive dialog,
where the sentence above it has already explained the red.

### The stage ramp

Eight muted hues, `--stage-1` … `--stage-8` (the readable ink) paired with
`--stage-N-soft` (the fill). A pipeline needs eight separable hues and a
five-colour brand cannot supply them, so the ramp is **derived** from the brand
family rather than sitting beside it: one OKLCh chroma for all eight (0.062, and
0.020 for the neutral), which is under the loudest brand bar — the secondary
measures 0.0903 — so no stage bar can be louder than a brand bar. Revision 2's
ramp ran from 0.045 to 0.148 and four of its eight entries were above the
secondary, which is what made a stage-coloured bar on Reports read as a
different kind of bar from the brand-primary one two cards above it.

Hues come from the brand where the brand has one: 1 is the neutral dark's hue at
near-zero chroma, 2 is the primary's hue, 3 is the secondary's hue, 8 sits beside
the accent. Teal, green, red and clay are the four the brand cannot supply.

With chroma fixed, **lightness carries the separation**, and it is solved rather
than chosen: a hill climb maximising the smallest pairwise ΔE2000 across normal
vision and the three dichromat simulations (Viénot, Brettel & Mollon 1999, in
linear light — the method `design/review.md` used for the first ramp), subject to
every contrast bar. The smallest CVD reading went from 1.9 to 5.5 in light and
from 0.7 to 4.9 in dark; revision 2's dark ramp had a green and a red a
deuteranope could not separate at all. Every ink still clears 4.5:1 on its own
tint, on the canvas and on white, and `--color-text` / `--color-text-muted` still
clear it on every tint and on the 14% mix a user-created stage wears. The numbers
are in `src/styles/tokens.css`.

1 slate · 2 blue · 3 lavender · 4 teal · 5 green · 6 brick · 7 tan · 8 olive.

Stage colour is **never the only cue**: the stage name is spelled out in full
beside it everywhere it appears. A user-created stage mixes its tint at render
time (`color-mix(in srgb, <stage> 14%, var(--color-surface))`).

### What has no colour

The toolbar, tabs, menus, checkboxes, switches, tables, an icon in a nav row, a
count in a badge, an empty state, and the word "overdue". The sidebar has one
coloured row and no others. If something else in the chrome is coloured, that
is a bug.

## 6. Shape, elevation, space

- **Radius**: zero. `--radius-sm`, `--radius-md`, `--radius-lg` and
  `--radius-full` all resolve to `0`. The names survive so no call site breaks
  and so `docs/CONTRACTS.md` holds, but there is no rounded corner anywhere in
  the product, including on badges, count pills, the search field and the
  mark.
- **Elevation**: there is no blurred shadow. `--shadow-sm` is `none`, and
  `--shadow-md` / `--shadow-lg` are a second hairline drawn outside the box
  (`0 0 0 1px`) — a floating layer gets a crisp double edge instead of a grey
  haze over the content it covers. Only menus, popovers, tooltips, dialogs, the
  command palette and toasts may wear it.
- **`--shadow-sticker`** (`4px 4px 0 var(--brand-accent)`) is **not** part of
  that ramp. It is the brand's signature: the `Brand` lockup wears it, and a
  screen may give it to at most one hero element. A second element wearing it
  on the same screen is a bug.
- **Space**: the 4px scale, `--space-1` … `--space-10`. Content gutter 32px,
  panel padding 16px, gap between panels 24px, gap between a label and its
  field 4px, gap between fields 16px.
- **Heights**: `--row-h` 40px comfortable / 32px compact; `--control-h` 32/28;
  `--control-h-sm` 28/24, which is the hit-target floor and is what a bare
  glyph, a checkbox and a switch are wrapped in.

## 7. Density

Two modes and no more. **Comfortable** is the default. **Compact** takes about
25% more rows out of padding, row height and the type scale (body 15 → 13px,
rows 40 → 32px), and nothing drops below 10px. The guide's five steps come
down with the rest and keep their ratios, and `--shadow-sticker` shortens to
`3px 3px 0` so the offset stays proportional to the type it sits behind.
Density is a token change on `<html data-density>`; a component that hard-codes
a height or a font size breaks it, which is why every size in `src/ui` is a
`var()`.

## 8. Motion

Unchanged. Motion answers something the owner did, or it does not happen.

- 150ms (`--dur-fast`) on hover and press, 180ms (`--dur-base`) on a menu or
  popover opening, 200ms (`--dur-slow`) on a dialog. All of it `--ease-out`.
- `scale(0.98)` (`--press-scale`) on a button's `:active`. The only transform.
- Nothing on scroll. No entrance animation, no staggered reveal, no hover lift.
- Everything is off under `prefers-reduced-motion`, including the spinner.

## 9. Components

One paragraph per type. The kit lives in `src/ui`; feature code never restyles
a primitive, it passes props. Every prop and export name from revision 2 is
unchanged — the brand landed through the tokens, not through the API.

**Brand.** New in this revision. The lockup: the mark in a hard-edged square
with a hairline and the accent sticker shadow behind it, and "Helix" in Zilla
Slab bold beside it. Two sizes — `sm` (a 26px mark, for the sidebar header) and
`lg` (56px, for a boot screen) — plus `wordmark` and `sticker` switches. The
mark is a transparent PNG, so it needs the surface behind it for the sticker to
read as an offset card rather than a smear behind the glyphs; that surface is
also what the guide draws around it on its "Marks & Surfaces" page. When the
wordmark is showing, the image is decorative (`alt=""`, `aria-hidden`) so a
screen reader does not say "Helix" twice.

**Buttons.** Four variants. `primary` is the `#97B1C3` block with `#141414`
ink, square, no shadow, **one per screen**, and it does not invert in dark.
`secondary` is the default: surface fill, one `--color-border-strong`
hairline, full ink. `ghost` is no fill, no border, secondary ink, for toolbars
and row actions. `destructive` (and its legacy alias `danger`) is text-only
red, gaining `--color-danger-soft` on hover and a red fill only when it is a
dialog's confirm button (`solid`). Heights are `--control-h`; a loading button
keeps its label in the progressive form of its own verb.

**Inputs, textareas, selects.** Surface fill, one `--color-border-strong`
hairline, hard edge, `--control-h` tall, body type, placeholder in tertiary
ink. Focus is the secondary ring and nothing else — the border does not
thicken and the field does not change colour, because a field that redraws
itself on focus reads as a web form. An invalid field turns its border
`--color-danger`; it never recolours the ring, which means "the keyboard is
here" and nothing else. The select trigger is identical to an input with a
14px caret in secondary ink at the right edge.

**Fields.** Label above the control at `--text-sm` in secondary ink, always
visible, never a placeholder standing in for a label. Required is the word
"Required" in tertiary ink, not an asterisk. Helper text sits under the field
at `--text-xs` in tertiary ink; an error replaces it in `--color-danger-ink`
with a 14px WarningCircle beside it. Both are wired through `aria-describedby`.

**Tables.** A white surface, rows separated by one hairline, **no zebra
striping, no vertical rules, no shadow, no row rails.** The header is the
caption style — 11px uppercase tracked in tertiary ink. Rows are `--row-h`
tall; the primary cell is body size at weight 500 in full ink, subordinate
cells are `--text-sm` in secondary ink, numeric cells are right-aligned with
tabular figures. A selected row is the `--color-selected` tint with full ink —
**not** the primary block, which belongs to the sidebar. The totals row is a
`<tfoot>` with one `--color-border-strong` hairline above it.

**Cards and grouped lists.** A card is a grouped inset list: white, square, one
hairline, **no shadow, ever**. `CardRow` gives the inset-list row — full-bleed,
hairline under every row but the last, `--row-h` tall, label left and value
right — and `CardGroupLabel` gives the caption label that sits above the panel
in the canvas. Cards never nest. `CardTitle` is the slab. `attention` swaps the
hairline for the stronger one; it does not paint a rail.

**Badges and tags.** A flat tint with its matching ink, **square**, 12px,
sentence case, and always a word — never colour alone. `tone` covers neutral,
accent/info, the three brand tints (`brand`, `secondary`, `highlight`),
success, warning and danger; `dotColor` renders a stage tag whose fill is mixed
from the stage colour at 14%. `solid` is reserved for a count that has to read
instantly from the sidebar.

**Dialogs, menus, popovers, tooltips.** The floating layer: raised surface, one
hairline, square, the hairline-only `--shadow-md`, over `--color-overlay`.
Dialogs are 480px for a confirm, 680px for a form, 840px for a reference sheet,
and they are **height-bound**: the content column is capped at
`100vh - 2 × 48px` and scrolls internally while `DialogHeader` and
`DialogFooter` stick to the top and bottom of that scroll box. `DialogTitle` is
the slab at the subhead step. Menu items are `--control-h-sm` tall, the
highlight is `--color-selected`, a destructive item is `--color-danger-ink`,
and a menu label is the caption style.

**Sidebar and nav.** Covered in §3. The rule worth repeating: the selected row
is the product's one primary block, and the nav icon takes the row's ink — on
the selected row that ink is the near-black, so the glyph reads against the
block without being given a colour of its own.

**Page header.** Title at `--text-heading` (32/1.1) in Zilla Slab bold, tracked
-0.01em, truncated with a `title` attribute; optional breadcrumb above at
`--text-sm` in tertiary ink, optional subtitle below at `--text-sm` in
secondary ink, actions right-aligned on the baseline. **No bottom hairline** —
the toolbar 24px above already draws one.

**Empty states.** One short title in the slab at the subhead step, one sentence
in secondary grey at the prose leading, one button, centred in air. No
illustration, no glyph, no card, no border. The `icon` prop is still accepted
so call sites compile and is deliberately not drawn.

**Command palette and search.** A Spotlight panel: 600px, held 14% down the
window over the scrim, square, one hairline, the hairline shadow. A 18px
magnifier and a 17px input in the header with one hairline under it, group
headings in the caption style, rows `--row-h` tall with the `--color-selected`
highlight and no icons.

**Boot screens.** The `Brand` lockup at `lg` above the panel. A boot screen is
the first thing the owner sees when something has gone wrong, and the brand
saying who is talking is worth more there than on any other screen. The title
is the slab at the subhead step; the detail stays in the mono face.

**Toasts.** Bottom right, a sentence in the past tense — "Deleted 1 contact" —
with an Undo for the ten seconds it lives. Errors do not auto-dismiss and carry
"Copy details", because the owner is often offline.

**Kbd.** The glyph in tertiary ink on `--color-accent-soft`, one hairline,
square, in the body face — a shortcut glyph is drawn in the UI font, not in a
monospace.

## 10. Iconography

Unchanged. **Phosphor only** (`@phosphor-icons/react`), imported through
`src/ui/icons.ts` and never directly.

- `weight="regular"` at **18px** in lists, nav rows, timelines, empty states.
- `weight="bold"` at **16px** inside a button, an icon button or a menu item.
- 14px is allowed for a caret, a check inside a menu, or the error glyph beside
  a field; 10px for a table sort caret.
- **One weight per context.** Never two weights or two sizes in one cluster.
- An icon is monochrome and takes its parent's ink. It never has its own
  colour, never sits in a coloured circle, and never appears without a label
  unless it is an `IconButton`, which carries `aria-label` and `title`.
- Decorative icons take `aria-hidden`.

`src/ui/icons.ts` is deliberately **not** re-exported from `src/ui/index.ts`:
the icon set contains `Table`, `Check` and `X`, which would collide with the
component of the same name. Import icons from `@/ui/icons`, components from
`@/ui`.

## 11. Voice

The guide's voice page, applied to product copy.

**We sound like** — direct (the point comes first, the detail second), specific
(real numbers and real examples over adjectives), warm (plain language, written
to a person, not a segment).

**We never sound like** — hype (no superlatives we cannot demonstrate), jargon
(if a shorter word works, it wins), filler (nothing on the page that does no
work).

In practice: buttons name what will happen ("Save changes", not "Submit").
Errors say what went wrong and what to do. Toasts are past tense. No
exclamation marks, no apologies, no cleverness, no emoji anywhere including in
code comments and alt text.

## 12. Do / Don't

**Do**

- Separate things with a hairline and with space.
- Spend the primary once per view, and know where you spent it.
- Put the thing that needs the owner at the top, in full ink.
- Set every title in the slab and everything else in Poppins.
- Use the caption style for the label above a group, sentence case elsewhere.
- Keep one size down a column and let weight carry the hierarchy.
- Wrap every bare glyph in a `--control-h-sm` hit target.
- Give every number tabular figures.
- Reach for a token. Every size, colour and duration in `src/ui` is a `var()`.

**Don't**

- No rounded corner, anywhere, on anything.
- No blurred shadow. A floating layer gets a second hairline; nothing else gets
  anything.
- No second `--shadow-sticker` on a screen, and never on something that is not
  a hero.
- No accent background. `#EDF0A3` is a detail, not a surface.
- No second primary block on a screen.
- No gradient, including a "subtle" one.
- No coloured chrome beyond the one selected sidebar row.
- No zebra striping, no vertical cell rules, no coloured row rails.
- No `#97B1C3` or `#8B85C2` carrying small text: 2.24:1 and 3.37:1 on white.
- No Lucide, no Feather, no Heroicons, no Inter, no third webfont, no CDN.
- No all-caps text outside the 11px caption label.
- No emoji, anywhere, including in code comments and alt text.
- No illustration or spot glyph in an empty state.
- No entrance animation, no scroll reveal, no hover lift.
- No hex, `rgb()`, `rgba()` or `hsl()` outside `src/styles/tokens.css`.
- No hard-coded px height or font size in a component: it breaks compact.

## 13. Superseded

**Revision 2 (superseded, 2026-09-19).** Revision 2 was the Apple-like native
direction: a warm `#FBFBFA` canvas, the platform's own system font stack with
no webfont and explicitly no serif, a near-black `#111111` primary button,
6px/10px radii, a soft neutral-blue selected-row tint, and one diffuse
`0 2px 8px` shadow on floating layers.

It was not rejected — the chassis it built is what revision 3 stands on, and
the following carried over unchanged: the audience research, the two sentences
in §1, the air, the hairlines, the no-dark-patterns rule, tabular figures, the
1024px floor, 40px rows, comfortable/compact density, the dark mode, the
Phosphor icon set, the eight-hue stage ramp, the token architecture and the
contract in `docs/CONTRACTS.md`.

What revision 3 replaced, and why:

- **The system font stack became two self-hosted webfonts.** Revision 2's rule
  was "the platform's own face and nothing else, and no serif anywhere". The
  brand guide specifies Zilla Slab and Poppins, so that rule is gone. The
  offline constraint behind it is not: the fonts ship in the bundle and there
  is no CDN.
- **The near-black primary button became the brand primary.** A black button is
  the absence of a decision. `#97B1C3` with `#141414` ink is the decision, and
  it is the same block in both themes rather than inverting.
- **The selected sidebar row became the primary block rather than a tint.**
  The guide allows the primary once per view; this is where the application
  spends it. Table rows, menu items and palette rows keep the quiet tint.
- **Every radius went to zero.** Revision 2's 6px/10px pairing was a native
  habit. The guide's corner language is explicit and absolute.
- **The diffuse shadow became a hairline.** "Flat fills only" rules out a blur,
  so a floating layer is lifted by a second hairline instead.
- **The pill went away.** Badges, count tags and the search field were the last
  rounded things in the product and are now rectangles.

**Revision 1 (rejected, 2026-09-19).** The first direction was a light-first,
high-density "ledger": a cool grey `#ECEFF3` canvas, a single equipment-orange
accent (`#C1440E`), 16px body, 48px rows, three levels of drop shadow, and
sentence-case 14px table headers. It was rejected by the owner as "still super
sloppy". The specific reasons, kept so they are not rebuilt by accident: one
saturated accent on an otherwise grey UI made every screen look like a form
with an error on it; three shadow levels plus a grey canvas plus white cards is
the generated-SaaS-card kit; 48px rows with 16px body read as a spreadsheet
export; Lucide's 2px hairline strokes sat visually lighter than the type they
labelled; and row rails, left accents and a 3px focus bar are web-app devices.
