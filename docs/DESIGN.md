# Helix CRM: design direction

Status: contract. Owner: design agent. Revision: 2 (2026-09-19).
Companion documents: `src/styles/tokens.css` (the values), `src/ui/icons.ts`
(the icon set), `design/apple/review.md` (what the screenshots caught),
`design/research.md` (the audience evidence, still current).

This file decides. If a component disagrees with it, the component is wrong.
Token names are fixed by `docs/CONTRACTS.md`; this file may add names, never
rename them.

Revision 2 replaces the light-first, equipment-orange, dense-ledger direction.
The short version of what changed is at the bottom under **Superseded**.

---

## 1. What this should feel like

A native desktop application. Not a web app in a window, not a SaaS dashboard,
not a design system demo. The reference is the software already on the owner's
Mac: System Settings, Notes, Reminders, Mail. What those share is not a colour
or a font — it is a set of habits:

- a **translucent grey sidebar** against **white content**, with a single
  hairline between them and no shadow anywhere;
- **one selected row**, marked by a soft neutral-blue tint and slightly heavier
  text, never by a bar, a chevron or a coloured pill;
- **grouped inset lists**: related rows in a 10px-radius panel with hairlines
  between them and a small-capitals label sitting above it in the canvas;
- **type between 11 and 28px**, the platform's own face, with weight and
  colour — not size — doing most of the hierarchy work;
- **air**. The single biggest difference between a native pane and a web page
  is how much nothing there is between things;
- **nothing decorative**. No gradient, no card shadow, no icon in a coloured
  circle, no illustration, no progress ring that is not showing progress.

The owner is still the one from `design/research.md`: a solo owner, 40 to 65,
running a trade or service business, on a laptop at a kitchen table or in a
truck cab, whose trusted software is QuickBooks, Gmail and his bank's app. He
still wants exactly two things —

> **Do not lose a lead. Remember what I promised.**

— and every screen is still measured against those sentences. Revision 2 does
not change the job. It changes the surface so the app looks like it belongs on
the machine it is running on.

## 2. Principles

1. **Air is the aesthetic.** Density is a setting (`compact`), not the design.
   The comfortable default leaves room between things.
2. **Colour is scarce.** Black for the one primary action, system blue for
   focus and links, muted pastels for tags and stages. Nothing else is
   coloured, ever.
3. **"Needs you" is position and weight, not colour.** The thing that needs the
   owner is at the top of the screen, in full-strength ink, with a real verb on
   its button. There is no attention colour any more.
4. **One hairline.** Everything is separated by `rgba(0,0,0,0.06)`, 1px, and by
   space. Nothing is separated by a shadow except a layer that actually floats.
5. **The platform's type.** System stack, 11 to 28px, no webfont, no serif, no
   monospace outside a code detail or a diagnostic dump.
6. **Plain words.** Buttons name what will happen. Errors say what went wrong
   and what to do. No exclamation marks, no apologies, no cleverness.
7. **No dark patterns, ever.** Nothing asks for money, an upgrade, an account,
   an email address or a review. No telemetry, no nag. Destructive actions are
   undoable and say so before they run.
8. **Built for the edge case.** A 47-character company name, an unparseable
   phone number, a 10 000-row table and a 1024px window are the normal case.

## 3. The window

```
┌──────────────┬──────────────────────────────────────────────┐
│              │  toolbar 48px, white, hairline bottom        │
│  sidebar     ├──────────────────────────────────────────────┤
│  240px       │                                              │
│  #F7F6F3     │  content, #FBFBFA canvas                     │
│  hairline    │  32px side gutter, 24px top                  │
│  right edge  │  panels are #FFFFFF, 10px radius, hairline   │
│              │                                              │
│  ──────────  │                                              │
│  workspace   │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **Sidebar**: `--sidebar-w` 240px, `--color-sidebar` (#F7F6F3), one hairline
  right edge, never collapses, never scrolls horizontally. Nav rows are 32px
  tall at `--radius-md`, label at body size in secondary ink, icon at 18px
  regular taking the row's own ink. The selected row is `--color-selected`
  (system blue at 10%) with full ink and weight 500. Group labels are the
  11px small-capitals style. The workspace name sits in the footer at
  `--text-sm` in tertiary ink.
- **Toolbar**: `--topbar-h` 48px (44 compact), `--color-surface`, one hairline
  bottom. It holds three things — where you are, the search field, quick add —
  and nothing is ever added to it. Toolbar glyphs are monochrome, 16px bold, in
  secondary ink.
- **Search field**: the macOS search control. A soft grey rounded field
  (`--color-accent-soft`, `--radius-full`, no border), a 16px magnifier in
  tertiary ink, the shortcut hint on the right. It is a button that opens the
  search dialog; the field is the affordance.
- **Content**: `--color-bg` (#FBFBFA) canvas, 32px side gutter, 24px top.
  Panels are white with a hairline and a 10px radius. The minimum window is
  1024px and the design target is 1280.

## 4. Typography

The platform's own text face and nothing else. `-apple-system` resolves to
SF Pro Text under 20px and SF Pro Display above it, which is the optical-size
switch a native app gets for free; Windows gets Segoe UI Variable Text. There
is **no serif anywhere in the application** — the minimalist-ui skill's
editorial serif is for marketing pages, and this is a tool.

| Token | Comfortable | Compact | Where |
| --- | --- | --- | --- |
| `--text-label` | 11px | 10px | section labels, table column headers |
| `--text-xs` | 12px | 11px | badges, helper text, kbd, meta |
| `--text-sm` | 14px | 12px | secondary row text, field labels, subtitles |
| `--text-base` | 15px | 13px | body, table cells, inputs, buttons, menus |
| `--text-lg` | 17px | 15px | card titles, the primary line of a list row |
| `--text-xl` | 20px | 18px | dialog title, section heading |
| `--text-2xl` | 24px | 22px | page title, the money on a record |
| `--text-3xl` | 28px | 24px | report headline figures only |

**Body is 15px, not 14.** The brief allowed either. 15px wins here for two
reasons: the audience skews presbyopic (`design/research.md`), and at 1280 the
content column has the room — a 14px body saves about one row per screen and
costs legibility on every row. 15px is also what macOS uses for Notes and Mail
body copy, so it reads as native rather than as small. Compact drops to 13px,
which is the macOS list size, and nothing in the product goes below 10px.

Rules:

- Line height is 1.5 on body (`--leading-normal`), 1.25 on anything set at
  `--text-lg` or larger (`--leading-tight`).
- Titles at `--text-xl` and up are semibold with `--tracking-title` (-0.01em).
  Nothing else is tracked.
- **Section labels** are the only capitals in the product: 11px, weight 590,
  `--tracking-label` (0.05em), uppercase, `--color-text-faint`, never more than
  three words. They label a group of rows or a table column, never a paragraph.
- Money, counts, dates and phone numbers carry tabular figures
  (`data-numeric`, `.tabular`, `.money` in `globals.css`). A column of amounts
  that does not line up reads as sloppy bookkeeping to this audience.
- A name truncates with an ellipsis and carries a `title`; it never wraps
  inside a fixed-height row.
- Sentence case everywhere else, including buttons, tags and stage names.

## 5. Colour

### The canvas

| Token | Light | Dark |
| --- | --- | --- |
| `--color-bg` | `#FBFBFA` | `#1E1E1E` |
| `--color-surface` | `#FFFFFF` | `#2A2A2A` |
| `--color-surface-raised` | `#FFFFFF` | `#323232` |
| `--color-sidebar` | `#F7F6F3` | `#232323` |
| `--color-hover` | `#F2F2F0` | `#323232` |
| `--color-selected` | `#E9EFF9` | `#24344A` |
| `--color-border` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.08)` |
| `--color-border-strong` | `rgba(0,0,0,0.13)` | `rgba(255,255,255,0.16)` |
| `--color-text` | `#1D1D1F` | `#F5F5F7` |
| `--color-text-muted` | `#56565A` | `#B0B0B5` |
| `--color-text-faint` | `#6E6E73` | `#9A9AA0` |
| `--color-text-disabled` | `#A1A1A6` | `#6E6E73` |

Dark mode is true Apple greys — a #1E1E1E canvas with #2A2A2A content and white
hairlines at 8%. Never pure black, never a blue-black, never a tinted charcoal.

**On the ink ramp.** The platform's own label greys do not clear WCAG AA:
`#A1A1A6` measures 2.57:1 on white and `#86868B` measures 3.62:1. Helix ships
the accessible cousins — same hue family, darkened until they clear 4.5:1 on
every surface they can land on (`#56565A` 7.31:1, `#6E6E73` 5.07:1). `#A1A1A6`
survives as `--color-text-disabled`, which is allowed on a disabled glyph or a
scrollbar thumb and is **never** allowed on text the owner has to read.
Tertiary ink is also not allowed on `--color-selected` (4.39:1); a selected row
uses full ink.

### The one filled control

`--color-accent` is the primary button fill: `#111111` in light, `#F5F5F7` in
dark with `#1D1D1F` ink, because a black button on a #1E1E1E canvas is
invisible and a native dark app inverts its default button. There is exactly
one primary button per screen — the thing the owner came to that screen to do.

`--color-accent-soft` (`#F2F2F0`) is the quiet neutral tint: the search field,
a pressed ghost button, a `kbd`, a code block. It is not an accent; it is the
absence of one.

### Blue

System blue does three things and nothing else:

- **Focus.** `--color-focus` (#007AFF light / #0A84FF dark), a 2px ring at a
  1px offset, on every interactive element, keyboard-only, never removed.
- **Links.** `--color-accent-ink` / `--color-link` (#0B62D6 light / #64ABFF
  dark). Apple's #007AFF measures 4.02:1 on white and fails AA for 15px text,
  so link text is darkened and #007AFF stays the ring.
- **The selected row tint**, `--color-selected`, which is the blue at 10%.

Blue is never a button fill, never a badge, never an icon colour.

### Muted pastels

Every tag, badge, stage and semantic state is a washed-out pastel fill with its
own dark text partner. Pale blue, green, yellow and red come from the
minimalist-ui palette verbatim; lavender, teal, clay and slate are derived in
the same family. Measured ratios are in `tokens.css` beside each pair.

| Role | Fill | Ink |
| --- | --- | --- |
| info / `tone="accent"` | `#E1F3FE` | `#1F6C9F` |
| success | `#EDF3EC` | `#346538` |
| warning | `#FBF3DB` | `#956400` |
| danger | `#FDEBEC` | `#9F2F2D` |

The bare semantic token (`--color-danger`) is a fill for white text and appears
in exactly one place: the confirm button of a destructive dialog, where the
sentence above it has already explained the red.

### The stage ramp

Eight muted pastels, `--stage-1` … `--stage-8` (the readable ink: the 7px dot,
the stage name, a board column rule) paired with `--stage-N-soft` (the pastel
fill). Every ink clears 4.5:1 on its own tint and on white, and the ramp keeps
its identity across themes: the same eight hues, lifted to the light side in
dark mode with the dark tint behind them.

1 slate · 2 blue · 3 lavender · 4 teal · 5 green · 6 red · 7 clay · 8 yellow.

Stage colour is **never the only cue**: the stage name is spelled out in full
beside it everywhere it appears. A user-created stage mixes its tint at render
time (`color-mix(in srgb, <stage> 14%, var(--color-surface))`).

### What has no colour

The sidebar, the toolbar, tabs, menus, checkboxes, switches, tables, the
selected row's text, an icon in a nav row, a count in a badge, an empty state,
and the word "overdue". If something in the chrome is coloured, that is a bug.

## 6. Shape, elevation, space

- **Radius**: `--radius-md` 6px on anything you click (buttons, inputs,
  selects, nav rows, menu items); `--radius-lg` 10px on anything that contains
  things (cards, grouped lists, dialogs, menus, popovers); `--radius-sm` 4px on
  the checkbox box and a `kbd`; `--radius-full` on tags and count pills only.
  Nothing else is a pill, and nothing is square.
- **Elevation**: one shadow in the product, `0 2px 8px rgba(0,0,0,0.04)`
  (`--shadow-md` / `--shadow-lg`), and only a floating layer may wear it:
  menus, popovers, tooltips, dialogs, the command palette, toasts.
  `--shadow-sm` is `none` — cards, rows, tables, inputs and buttons cast
  nothing. In dark the same shadow runs at 0.40 alpha because the hairline and
  the lighter surface do most of the lifting.
- **Space**: the 4px scale, `--space-1` … `--space-10`. Content gutter 32px,
  panel padding 16px, gap between panels 24px, gap between a label and its
  field 4px, gap between fields 16px.
- **Heights**: `--row-h` 40px comfortable / 32px compact; `--control-h` 32/28;
  `--control-h-sm` 28/24, which is the hit-target floor and is what a bare
  glyph, a checkbox and a switch are wrapped in.

## 7. Density

Two modes and no more. **Comfortable** is the default. **Compact** takes about
25% more rows out of padding, row height and the type scale (body 15 → 13px,
rows 40 → 32px), and nothing drops below 10px. Density is a token change on
`<html data-density>`; a component that hard-codes a height or a font size
breaks it, which is why every size in `src/ui` is a `var()`.

## 8. Motion

Motion answers something the owner did, or it does not happen.

- 150ms (`--dur-fast`) on hover and press, 180ms (`--dur-base`) on a menu or
  popover opening, 200ms (`--dur-slow`) on a dialog. All of it `--ease-out`.
- `scale(0.98)` (`--press-scale`) on a button's `:active`. That is the only
  transform in the product.
- Nothing on scroll. No entrance animation, no staggered reveal, no hover lift,
  no ambient anything.
- Everything is off under `prefers-reduced-motion`, including the spinner.

## 9. Components

One paragraph per type. The kit lives in `src/ui`; feature code never restyles
a primitive, it passes props.

**Buttons.** Four variants. `primary` is the solid near-black control with
white ink, 6px radius, no shadow, one per screen. `secondary` is the default:
white fill, a `--color-border-strong` hairline, full ink — the macOS push
button. `ghost` is no fill, no border, secondary ink, for toolbars and row
actions. `destructive` (and its legacy alias `danger`) is **text-only red**,
gaining `--color-danger-soft` on hover and a red fill only when it is a
dialog's confirm button (`solid`). Heights are `--control-h`; a loading button
keeps its label in the progressive form of its own verb and shows a 16px bold
CircleNotch.

**Inputs, textareas, selects.** White fill, one `--color-border-strong`
hairline, `--radius-md`, `--control-h` tall, body type, placeholder in tertiary
ink. Focus is the blue ring and nothing else — the border does not thicken and
the field does not change colour, because a field that redraws itself on focus
reads as a web form. An invalid field turns its border `--color-danger`; it
never recolours the ring, which means "the keyboard is here" and nothing else.
The select trigger is identical to an input with a 14px caret in secondary ink
at the right edge. `Input` has a `search` form: the soft grey rounded macOS
search field, borderless.

**Fields.** Label above the control at `--text-sm` in secondary ink, always
visible, never a placeholder standing in for a label. Required is the word
"Required" in tertiary ink, not an asterisk. Helper text sits under the field
at `--text-xs` in tertiary ink; an error replaces it in `--color-danger-ink`
with a 14px WarningCircle beside it. Both are wired through `aria-describedby`
so a screen reader reads the sentence that says what to fix.

**Tables.** A white surface, rows separated by one hairline, **no zebra
striping, no vertical rules, no shadow, no row rails.** The header is the
section-label style — 11px uppercase tracked in tertiary ink — which is how a
native list view labels a column; the sort caret is 10px and only appears on
hover until the column is actually sorted. Rows are `--row-h` tall; the primary
cell is body size at weight 500 in full ink (not a larger size), subordinate
cells are `--text-sm` in secondary ink, numeric cells are right-aligned with
tabular figures. A selected row is the `--color-selected` tint with full ink.
The totals row is a `<tfoot>` with one `--color-border-strong` hairline above
it, and it is deliberately not sticky.

**Cards and grouped lists.** A card is a grouped inset list: white,
`--radius-lg`, one hairline, **no shadow, ever**. `CardRow` gives the inset-list
row — full-bleed, hairline under every row but the last, `--row-h` tall, label
left and value right — and `CardGroupLabel` gives the small-capitals label that
sits above the panel in the canvas. Cards never nest. `attention` no longer
paints a rail; it swaps the hairline for the stronger one, because attention in
this product is position and weight.

**Badges and tags.** A pastel fill with its matching ink, pill radius, 12px,
sentence case, and always a word — never colour alone. `tone` covers neutral,
accent/info, success, warning and danger; `dotColor` renders a stage tag whose
fill is mixed from the stage colour at 14%. `solid` is reserved for a count
that has to read instantly from the sidebar. There is no loud filled badge.

**Dialogs, menus, popovers, tooltips.** The floating layer: raised surface, one
hairline, `--radius-lg`, the single diffuse shadow, over a light scrim
(`rgba(0,0,0,0.22)`). Dialogs are 480px for a confirm, 680px for a form, 840px
for a reference sheet, and they are **height-bound**: the content column is
capped at `100vh - 2 × 48px` and scrolls internally while `DialogHeader` and
`DialogFooter` stick to the top and bottom of that scroll box. Without the cap
a tall form ran its Save button off-screen, which the settings e2e caught as an
unreachable element; the pinning lives in the header and footer components so
every existing call site gets the fix for free. Menu items are `--radius-md`
and `--control-h-sm` tall, the highlight is `--color-selected`, a destructive
item is `--color-danger-ink`, and a menu label is the section-label style.

**Sidebar and nav.** Covered in §3. The one rule worth repeating: the nav icon
takes the row's ink. A sidebar full of coloured glyphs is the loudest tell of a
web app pretending to be a desktop one.

**Page header.** Title at `--text-2xl` semibold tracked -0.01em, truncated with
a `title` attribute; optional breadcrumb above at `--text-sm` in tertiary ink,
optional subtitle below at `--text-sm` in secondary ink, actions right-aligned
on the baseline. **No bottom hairline** — the toolbar 24px above already draws
one, and a second rule under it is the detail that makes a window look
assembled rather than designed.

**Empty states.** One short title, one sentence in secondary grey, one black
button, centred in air. No illustration, no glyph, no card, no border. The
`icon` prop is still accepted so call sites compile and is deliberately not
drawn.

**Command palette and search.** A Spotlight panel: 600px, held 14% down the
window over the scrim, `--radius-lg`, one hairline, the diffuse shadow. A 18px
magnifier and a 17px input in the header with one hairline under it, group
headings in the section-label style, rows `--row-h` tall with the
`--color-selected` highlight and no icons.

**Toasts.** Bottom right, a sentence in the past tense — "Deleted 1 contact" —
with an Undo for the ten seconds it lives. Errors do not auto-dismiss and carry
"Copy details", because the owner is often offline and pasting the detail
somewhere is the only way to send it.

**Kbd.** The glyph in tertiary ink on `--color-accent-soft`, one hairline, 4px
radius, **the system sans face** — macOS draws ⌘K in the system font, not in a
monospace, and the mono version was the single most web-looking thing in the
old kit.

## 10. Iconography

**Phosphor only** (`@phosphor-icons/react`), imported through `src/ui/icons.ts`
and never directly. Lucide is banned by the minimalist-ui skill and is gone
from `src/ui` and `src/app`; `src/features` migrates by changing
`from "lucide-react"` to `from "@/ui/icons"`, because the map re-exports every
Lucide name the product used under its old spelling alongside the Phosphor
name.

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

## 11. Do / Don't

**Do**

- Separate things with a hairline and with space.
- Let the primary button be the only filled thing on the screen.
- Put the thing that needs the owner at the top, in full ink.
- Use the section-label style for the label above a group, and sentence case
  for everything else.
- Keep one size down a column and let weight carry the hierarchy.
- Wrap every bare glyph in a `--control-h-sm` hit target.
- Give every number tabular figures.
- Reach for a token. Every size, colour and duration in `src/ui` is a `var()`.

**Don't**

- No shadow on a card, a row, a button, an input or a table. One diffuse shadow
  exists and only a floating layer may wear it.
- No gradient, anywhere, including a "subtle" one.
- No coloured chrome: no coloured sidebar row, tab, icon, toolbar or header.
- No zebra striping, no vertical cell rules, no coloured row rails.
- No pill-shaped container, panel or primary button. Tags and counts only.
- No Lucide, no Feather, no Heroicons, no Inter, no serif, no webfont.
- No all-caps text outside the 11px section label.
- No emoji, anywhere, including in code comments and alt text.
- No illustration or spot glyph in an empty state.
- No entrance animation, no scroll reveal, no hover lift.
- No second accent colour, and no colour that means something on its own.
- No hex, `rgb()`, `rgba()` or `hsl()` outside `src/styles/tokens.css`.
- No hard-coded px height or font size in a component: it breaks compact.

## 12. Superseded

**Revision 1 (rejected, 2026-09-19).** The first direction was a light-first,
high-density "ledger": a cool grey `#ECEFF3` canvas, a single equipment-orange
accent (`#C1440E`) that meant "this needs you", 16px body, 48px rows, three
levels of drop shadow, blue-black ink, an eight-hue saturated stage ramp solved
against CVD simulation, and sentence-case 14px table headers.

It was rejected by the owner as "still super sloppy", and the specific reasons
are worth keeping so they are not rebuilt by accident:

- **The orange did not read as a system, it read as a warning label.** One
  saturated accent on an otherwise grey UI makes every screen look like a form
  with an error on it.
- **Three shadow levels plus a grey canvas plus white cards is the SaaS-card
  kit.** It is the look the clearpath-frontend-direction skill names as a
  generated-design default, and it is the opposite of native.
- **The tables were dense to the point of being undesigned.** 48px rows with
  16px body and a 2px totals rule read as a spreadsheet export, not as a list
  view.
- **Lucide's 2px hairline strokes are a web signature.** At 16 and 18px against
  15px text they sit visually lighter than the type they label.
- **Row rails, left accents and a 3px focus bar** are web-app devices; a native
  list marks selection with a tint and heavier text and nothing else.

What carried over unchanged: the audience research, the two sentences in §1,
the no-dark-patterns rule, tabular figures, the 1024px floor, the token
architecture and the contract in `docs/CONTRACTS.md`.
