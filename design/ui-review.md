# Component kit review — 2026-09-18

Reviewer: UI polish agent. Subject: `src/ui/**` (24 files), `src/styles/app.css`.
Contract: `docs/DESIGN.md`. Tokens: `src/styles/tokens.css`. Prior review of the
comps: `design/review.md`.

The kit was built in parallel with the design direction and had never been held
against it. It was written before `--control-h`, `--control-h-sm`,
`--color-accent-ink`, `--color-hover`, `--color-selected`, `--color-sidebar`,
`--color-overlay` and the `-ink` semantic tokens existed, and it shows: the
components reach for spacing tokens where they want control tokens, and for
fills where they want ink.

Method:

1. Every primitive read line by line against `docs/DESIGN.md` sections 4–10.
2. A generated gallery — `design/ui-screens/gallery.html`, produced by
   `tests/unit/ui/gallery.test.ts` from the real components via React DOM —
   rendering every primitive in every state (default, hover, focus-visible,
   disabled, loading, error, with icon, and with the 47-character name
   `Little Cottonwood Canyon Homeowners Association`).
3. The gallery screenshotted at 1280 in light, dark and compact with the pinned
   Playwright CLI (headless, in-memory, localhost:4791, session closed after),
   and looked at.
4. `design/contrast-audit.js` run against the gallery in all four modes.
5. Behaviour tests for the things a screenshot cannot see:
   `tests/unit/ui/{dialog,dropdownMenu,virtualList,field,button}.test.ts`.

---

## Defects found and fixed

Numbered for reference. "Caught by" says what actually found it, not what could
have.

### The accent, which is the one thing this product cannot get wrong

**1. The sidebar's active item was the accent.** `NavItem` painted
`--color-accent-soft` with `--color-accent` text when active. The sidebar is on
screen at all times, so the accent was on every screen at all times, which is
exactly the defect `design/review.md` finding 1 fixed in the comps and the rule
`DESIGN.md` §5 states as "global chrome never carries the accent". *Caught by:
reading `Nav.tsx` against §5.* **Fix:** `--color-selected` with full-strength
ink and `font-medium`.

**2. Every dropdown and select highlight was the accent.**
`data-[highlighted]:bg-[var(--color-accent-soft)]` in `DropdownMenu.tsx` (items
and checkbox items) and `Select.tsx`. Pointing at a menu item is not "this needs
you". *Caught by: grep for `color-accent` across the kit.* **Fix:**
`--color-selected`. Not `--color-hover`: in the dark theme `--color-hover`
(`#232D37`) sits one point from `--color-surface-raised` (`#242F39`), which the
menu is painted on, so the keyboard highlight would have been invisible at 10 pm.

**3. The selected table row was the accent.** `TR` used
`bg-[var(--color-accent-soft)]`. §9 says a selected row is `--color-selected`
plus a 3 px `--color-focus` left rail. *Caught by: reading `Table.tsx` against
§9.* **Fix:** both. The rail is drawn by the first cell's `::before`, not by a
`box-shadow` on the `<tr>`, because a `border-collapse` table does not reliably
paint a shadow on a row.

**4. The active tab was underlined in the accent.** Same class of error: tabs are
chrome. *Caught by: reading `Tabs.tsx`.* **Fix:** the selected tab is marked in
ink — `--color-text` border and label, weight 500.

**5. A ticked checkbox and an "on" switch were accent fills.** Selecting rows and
turning on a setting are not requests for attention. *Caught by: reading
`Checkbox.tsx` / `Switch.tsx` against §5.* **Fix:** both fill with
`--color-text`. `Checkbox` gained `tone="success"` for the one tick the contract
does colour — the completed task (§5, "Won or completed").

**6. Accent-coloured TEXT used `--color-accent`.** `Badge` tone `accent` set
`text-[var(--color-accent)]`, i.e. `#C1440E`, which measures 4.44:1 on the
canvas and fails AA — the precise distinction `tokens.css` and `DESIGN.md` §5
spell out. The same bug hit every semantic tone: `success`, `warning` and
`danger` badges used the fill colour as the label colour on top of the soft
tint. *Caught by: reading `Badge.tsx`; confirmed by the workaround already in
the feature code — `src/features/records/components/TaskRow.tsx:130` carries a
comment and a `className="text-[var(--color-accent-ink)]"` override to patch it
from the outside.* **Fix:** every tone is now `-soft` fill with `-ink` label,
and the feature-side override is redundant (harmless, but it can go).

**7. `DropdownMenuItem destructive` used `--color-danger` as text.** Fill token
used as ink again. **Fix:** `--color-danger-ink`.

### Control heights, hit targets and density

**8. No control used `--control-h` or `--control-h-sm`.** Every height came off
the *spacing* scale: `Button` md was `min-h-[var(--space-9)]` = **48 px** where
the contract says 36, `Button` sm was `--space-8` = **40 px** where it says 32,
and `Input`, `Textarea`, `Select`, `Tabs` and `NavItem` were all 48 px. In
compact those become 36/30 px — the spacing scale and the control scale shrink
by different ratios, so the whole kit drifted in both modes at once. §7 exists
to make this impossible: "a control that uses the token cannot be too small by
accident". *Caught by: reading every primitive; the numbers are the tokens'.*
**Fix:** `--control-h` for buttons, inputs, selects, tabs and nav items;
`--control-h-sm` for small buttons, icon buttons, menu items, the dialog close
and the checkbox/switch hit box.

**9. No button carried `flex: none`.** `Button` had none at all; `IconButton`
had `shrink-0`, which stops it shrinking but still lets it grow. §7 names this
defect explicitly — it is the 27 px icon button `design/review.md` finding 7
measured in the comps, and the kit had shipped the same bug again. **Fix:**
`flex-none` on `Button`, `IconButton`, `Select`'s trigger, `Tabs`' triggers,
`Kbd`, `Spinner`, the dialog close, `Badge`'s dot and the sidebar/topbar shells.

**10. The checkbox was an 18–20 px hit target.** `--space-5` square, which is
20 px comfortable and **15 px compact** — half the 28 px floor. *Caught by:
reading `Checkbox.tsx` against §7.* **Fix:** the box people see stays 18 px; the
thing they can hit is `--control-h-sm`, with the visual box centred inside it.
The switch got the same treatment: a 36 × 20 track inside a `--control-h-sm`
hit area.

**11. Buttons and inputs were 14 px.** `text-[length:var(--text-sm)]` on every
button, input, textarea, select trigger, menu item, tab and nav item. §4 puts
body, table cells, inputs, buttons and menu items at `--text-base`, and §7 bans
dropping below 15 px to fit more in. **Fix:** `--text-base` throughout; the
heights are held by the control tokens and `--leading-tight`, not by shrinking
the type.

### Colour, surface and radius

**12. The dialog scrim was hand-mixed.** `bg-[var(--color-text)] opacity-40`
instead of `--color-overlay`, which put a second, slightly different scrim in
the product and made the whole dialog subtree semi-transparent in the light
theme. **Fix:** `--color-overlay`.

**13. `--color-surface-raised` was used for resting surfaces.** `Card`,
`Input`, `Textarea`, `Select`, `Topbar`, `Checkbox` and `Switch` all painted
themselves on the *raised* surface. In light that is invisible (both are white);
in dark, `#242F39` against the `#1B242D` panel it sits on is a visible mistake —
a resting input looked like a popover. §5 reserves raised for overlays. **Fix:**
`--color-surface` for resting things; raised stays on dialogs, popovers,
dropdowns, tooltips and toasts.

**14. The sidebar was painted `--color-surface`.** `--color-sidebar` exists
precisely so the rail sits one step deeper than the canvas. **Fix:** applied.

**15. Radii were one step too large across the form controls.** §6 assigns
`--radius-sm` to inputs and badges and `--radius-md` to buttons and cards.
`Input`, `Textarea` and `Select` were `--radius-md`; `Badge` was
`--radius-full`; `Card` was `--radius-lg`; `Popover` and the dropdown surface
were `--radius-md` where overlays take `--radius-lg`. **Fix:** all four moved
onto the assigned step. `Badge` keeps `--radius-full` behind a new `pill` prop,
which is what §9 reserves it for — count pills.

**16. Hover states applied to disabled controls.** The variants used bare
`hover:`, so a disabled button still lit up under the pointer. **Fix:** every
hover and active state is `enabled:`-gated, and `disabled:pointer-events-none`
was dropped in favour of `disabled:cursor-not-allowed` so the cursor says why
nothing happens (and a tooltip explaining it can still open).

### Type and copy

**17. All-caps tracked-out labels in two places.** `TH` was
`text-xs uppercase tracking-wide` and `SidebarSection`'s label was
`uppercase tracking-wide`. §4: "There are no all-caps labels in this product;
small caps at 13 px is the opposite of legible for a 58-year-old in a truck."
**Fix:** column headers are sentence case at `--text-sm` weight 600, which is
what §9 asks for; the sidebar group label is sentence case at `--text-xs`.

**18. A required field was marked with a red asterisk.** §9: marked with the
word "Required", not an asterisk — and it was `--color-danger`, which is
reserved for destructive and failed. **Fix:** the word, in
`--color-text-faint`, beside the label.

**19. Field labels were full-strength bold ink.** §9 puts them at `--text-sm`
`--color-text-muted`, subordinate to the value the owner is typing. **Fix:**
applied. Helper text moved to `--color-text-faint` (it was muted) and error text
to `--color-danger-ink` (it was `--color-danger`), with the 16 px `alert-circle`
the contract asks for.

**20. `Kbd`'s font-family never applied.** `font-[var(--font-mono)]` is
ambiguous to Tailwind and compiles to a *font-weight*, so the keycaps rendered
in the sans stack. *Caught by: reading the class list; visible in the gallery.*
**Fix:** `font-[family-name:var(--font-mono)]`.

**21. The empty state was centred.** §9 specifies left-aligned in a column
capped at `--content-max`, and the description at `--text-base` (it was 14 px).
**Fix:** applied.

### Behaviour

**22. A loading button showed a spinner beside the same label.** §9: the label
is replaced by the progressive form of the same verb, and it never shows a
spinner alone. **Fix:** `loadingLabel` — `<Button loading loadingLabel="Importing…">`
— falling back to the children when a caller has not supplied one. Additive; no
existing call site changes.

**23. An invalid input recoloured the focus ring to danger.** §5: the focus ring
is `--color-focus` and means "the keyboard is here", nothing else. **Fix:** an
invalid field turns its border `--color-danger` and the ring stays blue.

**24. The focus ring offset disagreed with `globals.css`.** Every component used
`outline-offset-2`; `globals.css` draws the standard ring at 1 px. **Fix:** one
shared constant in `src/ui/styles.ts` — 2 px of `--color-focus` at 1 px offset —
used by every interactive primitive, with an inset variant for table rows.

**25. Motion was un-tokenised.** `transition-colors` with Tailwind's default
150 ms `cubic-bezier(.4,0,.2,1)`, on top of `--dur-fast`/`--ease-out` sitting
unused in `tokens.css`. `globals.css` collapses durations under
`prefers-reduced-motion`, but only via `!important` on the duration. **Fix:**
`duration-[var(--dur-fast)] ease-[var(--ease-out)]` plus an explicit
`motion-reduce:transition-none`, and `motion-reduce:animate-none` on the two
spinners, so reduced motion removes the transition instead of racing it.

**26. `VirtualList` hard-coded a 48 px row.** §7: "components must never
hard-code a row height". In compact the estimate was 41 % too tall until the
rows measured themselves. **Fix:** the default estimate reads `--row-h` off the
document element, falling back to 48.

**27. Errors auto-dismissed.** §9: "Errors do not auto-dismiss at all and carry
a 'Copy details' action." `toast.error` inherited sonner's 4-second default.
**Fix:** infinite duration, and an optional `details` string that renders the
"Copy details" action.

**28. Tables had no sticky header and no totals row.** §9 asks for both. **Fix:**
`THead` is sticky with the surface fill behind it, and a `TFoot` primitive
carries the 2 px `--color-border-strong` top rule and weight 600. `TD` gained
`primary` (the customer's name at `--text-lg` weight 500) and `muted`, and both
`TD` and `TH` stamp `data-numeric` when right-aligned, which is what switches on
tabular figures in `globals.css` — the kit had `tabular-nums` on right-aligned
cells but never emitted the attribute the stylesheet keys off.

**29. `aria-sort` was on the sort button, not the column header.** It is only
meaningful on the `th`. **Fix:** moved; the button keeps the click target.

---

## `src/styles/app.css`: the Tailwind theme

`bg-surface`, `text-muted`, `border-strong`, `text-accent-ink` and the rest did
not exist — the kit wrote every colour as `bg-[var(--color-surface)]`, and
feature code had no semantic utility to reach for.

The complication is that Tailwind 4's colour namespace *is* `--color-*`, which
is exactly what `tokens.css` calls its colours, so `@theme { --color-surface:
var(--color-surface) }` is a self-reference. Each token is therefore mirrored
onto a private `--tok-*` alias and the theme block reads that, with
`@theme inline` so the utility emits `var(--tok-surface)` at use time rather
than baking a value — which is what keeps `[data-theme="dark"]` and
`[data-density="compact"]` working. The aliases are declared on `:root` *and*
`[data-theme]`, so a theme scoped to a subtree re-derives them; the gallery
relies on that.

Verified in the built CSS rather than assumed:

```
.bg-surface{background-color:var(--tok-surface)}
.text-muted{color:var(--tok-text-muted)}
.border-strong{border-color:var(--tok-border-strong)}
.text-accent-ink{color:var(--tok-accent-ink)}
```

and the layer order holds — `@layer theme` carries
`--color-surface:var(--tok-surface)` at byte 2910 while `@layer base` carries
the real `--color-surface:#fff` at byte 8586, so `tokens.css` out-ranks the
theme block and the existing `bg-[var(--color-surface)]` usages across the
features are untouched. `@source inline(...)` emits the full semantic set so the
names exist whether or not anything has used them yet.

No hex, `rgb()` or `hsl()` value appears anywhere in `src/ui/**` or
`src/styles/app.css`.

---

## Defects the screenshots caught, which reading could not

**30. The totals row covered the column header.** `TFoot` shipped as
`position: sticky; bottom: 0`. `bottom: 0` means "never fall below the
scrollport's bottom edge", so while the table is still below the fold the
browser lifts the foot and clamps it to the top of its containing block.
Measured in the gallery at 1280 × 900:

```
thead  top 5343  height 48
tbody  top 5391  height 240
tfoot  top 5343  height 48      <- exactly on top of the header
```

The header row was invisible in the first screenshot pass, and the table read as
if its first row were "Total $130,974.00". **Fix:** `TFoot` is a plain `<tfoot>`
with the 2 px `--color-border-strong` top rule. A totals row is pinned to the
foot by *being* a `tfoot`; pinning it to a viewport is only correct inside a
dedicated scroll container, and a shared primitive cannot know that it is in
one. `THead`'s `sticky top-0` does not have the same failure — `top: 0` only
engages once the table's top has scrolled past — so it stays. After the fix:
`thead 5343 / tbody 5391 / tfoot 5631`.

**31. A 47-character name wrapped a table row to two lines.** `TD primary`
had no truncation, so `Little Cottonwood Canyon Homeowners Association` broke
across two lines, took the "Estimate sent" cell with it, and made two rows in
the screenshot taller than the rest — the exact thing §4 forbids ("they never
wrap to a second line inside a fixed-height row"). *Caught by: the first
screenshot pass.* **Fix:** `max-w-0 truncate` on the primary cell, which is what
makes an ellipsis work in an auto-layout table — the cell still takes its share
of the width, and the overflow happens inside it. Callers pass `title`.

**32. The kit could not render a "needs you" count pill.** §9 defines the count
badge as `--color-accent` **fill** with `--color-accent-text` (or
`--color-border` fill with `--color-text-muted` when it is not a "needs you"
count), and `Badge` only had tinted `-soft` backgrounds. *Caught by: building
the gallery specimen for it and finding nothing to call.* **Fix:** a `solid`
prop. `<Badge tone="accent" pill solid>12</Badge>` is the count on Today.

**33. A stage badge was a grey badge with a coloured dot.** §9 wants the
`--stage-N-soft` tint behind full-strength ink plus the 8 px dot; the kit gave
`dotColor` a dot and left the badge neutral, so the gallery specimen had to
reach around the component with `className="bg-[var(--stage-3-soft)]"`. Stages
are user-created, so there is no token to look up. *Caught by: writing that
workaround in the specimen and noticing it was the same shape as the
`accent-ink` workaround already in `TaskRow.tsx`.* **Fix:** when `dotColor` is
set, `Badge` mixes the tint itself —
`color-mix(in srgb, <stage> 12%, var(--color-surface))` — and switches the label
to `--color-text`. 12 % is the figure `tokens.css` uses for its own ramp. The
gallery's override is gone.

---

## Verification

All four modes are `design/ui-screens/gallery.html` at 1280, captured full-page
with `@playwright/cli@0.1.19` (headless, in-memory, session `helix-ui-gallery-4`,
closed afterwards; served from `localhost:4791` by a server started and stopped
for the run).

| Check | Result |
|---|---|
| Rendered contrast, gallery × {light, dark} × {comfortable, compact} | **0 failures.** 408 text elements measured in each of the four modes (`design/ui-screens/contrast-*.json`) |
| Console messages / failed requests | 0 errors, 0 warnings; 2 requests per load (the HTML and `gallery.css`), both 200 |
| Control heights, comfortable | 162 buttons measured: every one 32 px or 36 px, i.e. `--control-h-sm` / `--control-h` exactly. Inputs 36, textareas 72, checkbox 32 × 32, switch 32 × 36 |
| Control heights, compact | inputs 32, checkbox 28, switch 28 — the compact tokens, unchanged type at 15 px body |
| Hit targets | **0** interactive elements below 32 × 32 comfortable, **0** below 28 × 28 compact |
| Density | the same page is 8 922 px tall comfortable and 6 963 px compact — 22 % more on screen, out of padding and row height only |
| Hex / `rgb()` / `hsl()` outside `tokens.css` | none in `src/ui/**`, none in `src/styles/app.css`, none in the generated gallery |
| Webfont, CDN link or remote image | none. The gallery links one local stylesheet and nothing else |
| Tailwind build | `npx vite build --outDir dist-ui` succeeds; `dist-ui` deleted after the CSS was copied to `design/ui-screens/gallery.css` |

Component tests (`tests/unit/ui/`, jsdom, 32 tests):

| File | Covers |
|---|---|
| `dialog.test.ts` | Escape closes, focus trapped and wrapping, focus returns to the trigger, `ConfirmDialog` lands on Cancel, destructive path calls `onConfirm` once |
| `dropdownMenu.test.ts` | Enter/Space opens, Arrow keys move the highlight and skip a disabled item, Escape closes and restores focus, Enter selects |
| `virtualList.test.ts` | 10 000 items render a small window, the sizer reflects the full height, `getKey`/`ariaLabel` honoured |
| `field.test.ts` | error text linked by `aria-describedby`, `role="alert"`, `aria-invalid` on and off, hint linked, "Required" with no asterisk, label bound to the control |
| `button.test.ts` | disabled blocks the click, loading sets `disabled` and `aria-busy`, the loading label replaces the children and is never a bare spinner, the accent token appears on `primary` only |
| `gallery.test.ts` | regenerates `gallery.html` and asserts every specimen id, the 47-character label, no literal hex, no `<img>`, no remote URL |

`npm run typecheck` clean. `npm test` green.

---

## Not fixed, and why

- **`Badge`'s stage tint is mixed at 12 % in both themes.** `tokens.css` cuts
  the dark `--stage-N-soft` ramp at 14 %, but a user-created stage colour has no
  token to read, so the component mixes its own. At 12 % over
  `--color-surface`, full-strength ink measures well clear of AA in both themes
  (the audit above covers the rendered case), and the difference from 14 % is
  not visible side by side. If the design agent ever exposes a soft-tint
  function, this should use it.
- **`TD` defaults to full-strength ink, not `--color-text-muted`.** §9 says
  every cell that is not the name is muted. The primitive cannot know which cell
  is which, and defaulting to muted would have quietly greyed the name column in
  every table the feature agents have already built. `primary` and `muted` are
  there; the feature screens should adopt them, and until they do, full ink is
  the safe default rather than the correct one.
- **Icon sizes are the caller's.** §10 pins lucide at 20 px (16 px inline in 13 px
  text, 24 px in empty states) and the kit passes icons straight through.
  Forcing a size from `IconButton` would have overridden the sizes the feature
  screens already set. The gallery renders them at 20 px and they are right
  there; a lint rule would catch it better than a primitive can.
- **The pipeline board, Today panels and the status bar are not in the kit.**
  They are feature composition, not primitives, and other agents own them.

## Handed to other owners

- **`<Toaster>` needs `position="bottom-left"`, `visibleToasts={3}` and
  `theme={resolvedTheme}`.** §9 puts toasts bottom-left, stacked to a maximum of
  three. `src/ui/toast.ts` can set the duration and the actions — it now makes
  errors persist and gives them "Copy details" — but placement and stack depth
  live on the `<Toaster>` element in `src/app/Shell.tsx`, which foundations
  owns. The missing `theme` prop is already reported in `docs/STATUS.md` by the
  leads agent.
- **`src/features/records/components/TaskRow.tsx:130`** carries a comment and a
  `className="text-[var(--color-accent-ink)]"` override that patched defect 6
  from outside the component. It is harmless now and can be deleted by whoever
  owns that file next.
- **Feature tables should adopt `TD primary` / `TD muted` and `TFoot`**, which is
  what gives them the §9 row hierarchy and a totals row that adds up.
