# Design review — 2026-09-18

Reviewer: design agent. Subject: `docs/DESIGN.md`, `src/styles/tokens.css`,
`src/styles/globals.css`, `design/comps/*.html`.

Method: the five comps were served from a local static server and driven with
the pinned Playwright CLI (`@playwright/cli@0.1.19`, headless, in-memory,
localhost only). Every comp was measured at 1024, 1280 and 1440 in light and
dark, comfortable and compact. Findings below were fixed and the comps
re-captured; `design/screenshots/` holds the post-fix state (40 files).

Two tools did the work that eyes are bad at:

- `design/contrast-audit.js` — walks every element that paints text, resolves
  the real background by climbing to the first opaque ancestor, applies the
  right WCAG threshold for the size and weight, and reports every failure.
- A small LCh / CVD script (Viénot 1999 matrices) that solved and verified the
  stage ramp. Its numbers are recorded in `tokens.css`.

---

## What the review found

Nineteen defects. All fixed. Four of them were in `docs/DESIGN.md` itself —
the contract was wrong, not the implementation.

### Contract violations (the design disagreed with its own rules)

1. **The accent was in the global chrome.** The top bar's Quick add button was
   the accent primary, which put "needs you" orange on every screen at all
   times. Fixed: Quick add is a Default button. `DESIGN.md` §5 now states that
   global chrome never carries the accent.
2. **Overdue badges used `--color-danger`.** A task six days late is the
   owner's queue, not an error. Fixed: overdue is `badge-accent`; danger is now
   reserved for destructive actions and things that actually failed.
   `DESIGN.md` §5 amended.
3. **"Used to match duplicates" on the import screen was an accent badge.** It
   is information, not a request for attention. Fixed: neutral badge.
4. **The progress bar fill was accent orange with no rule covering it.** Kept,
   but `DESIGN.md` §5 now names it as an explicit, narrow exception: it is the
   visual continuation of the accent button the owner just pressed.

### Measured claims that were false

5. **"Compact fits about 30% more rows" was wrong.** Measured: 29% for
   single-line tables (48 px → 34 px) but only 7% for Today's two-line rows
   (58 px → 54 px), because those rows are sized by their text, not their
   padding. `DESIGN.md` §7 now states both numbers and defends the trade.
6. **Dark-theme stage tints failed AA.** At 22% over the surface,
   `--color-text-muted` landed at 4.04:1 on the sage and green columns, and the
   empty Lost column's note (faint, 13 px) measured 3.75:1. Fixed: dark tints
   re-cut at 14%, where the worst muted pair is 4.86:1. New rule in `DESIGN.md`
   §5: text on a stage tint is `--color-text` or `--color-text-muted`, never
   `--color-text-faint` — faint tops out at 3.48:1 on the worst dark tint.

### Implementation defects

7. **Icon buttons shrank to 27 px** inside flex rows, below the 32 px hit-target
   floor. Fixed with `flex: none` on `.btn`. Measured after: 32 px comfortable,
   28 px compact.
8. **Control heights were hard-coded pixels** and did not respond to density.
   Added `--control-h` (36/32) and `--control-h-sm` (32/28) to `tokens.css` and
   pointed buttons, inputs and selects at them. A control that uses the token
   cannot now be too small by accident.
9. **The accent rail did not render on the contact record.** `.rail-accent` was
   a `box-shadow`, and `.record-head`'s own `--shadow-sm` was declared later and
   won. Fixed with a pseudo-element, which composes with any elevation.
10. **"No next step" rendered faint grey instead of the accent.** The colour
    utilities sat above the component rules in the stylesheet, so `.deal-next`
    beat `.accent-ink`. Fixed by moving the utilities to the end of the file,
    with a comment saying why they must stay there.
11. **Anchors styled as buttons were underlined** by the base reset. Fixed with
    `text-decoration: none` on `.btn`.
12. **Deal cards truncated the due date away.** Value and next step shared one
    180 px line, so "Crew out 22 Sep" became "Crew out…". Fixed by stacking
    them: the promise is the point of the card.
13. **Six board columns did not fit at 1440.** Column minimum reduced from
    196 px to 180 px; all six now fit with no board scroll at 1440.
14. **Stage badges truncated to an ellipsis inside table cells**, destroying the
    one cue the colour is paired with. Fixed with a `.shrink` cell rule.
15. **The drag grip was hover-only**, which is an affordance a person who never
    hovers will never find. Fixed: visible at 45% opacity, full on hover.
16. **Selects had `appearance: none` and no disclosure arrow.** Drawing one
    would have needed a colour outside `tokens.css`. Fixed by keeping the native
    control, which is also the better read for this audience.

### Craft

17. **Pipeline arithmetic did not add up.** The summary counted Won and Lost as
    open deals, and the Lost column's header claimed "1 deal" above an empty
    body. Fixed: 19 open deals / $89,420.00 open value, with won stated
    separately; Lost reads "No deals". For an audience that reads columns of
    numbers for a living, a total that does not sum is the fastest way to lose
    them.
18. **Straight quotes in prose.** `No results for "hendrix retaining wall"` and
    `Don't import` now use typographic quotes.
19. **"Phone — mobile", "Email — work".** The spaced-em-dash label is a
    generated-design tell. Now "Mobile phone", "Work email", "Office phone".

---

## Verification after the fixes

| Check | Result |
|---|---|
| Rendered contrast, 5 comps × light/dark × comfortable/compact | **0 failures.** 112 (today), 112 (contact), 146 (pipeline), 122 (import), 62 (empty states) text elements measured per mode |
| Horizontal page scroll at 1024 | None. `scrollWidth == innerWidth` on all five |
| Console errors / failed requests | Zero on all five, all modes |
| Icon sprite | Every `href="#i-…"` resolves to a `<symbol>`; 33–37 uses per comp |
| Keyboard focus ring | Measured `rgb(29, 111, 209) 2px solid`, offset 1 px, on tab |
| Hit targets | Minimum 32 px comfortable, 28 px compact |
| Hex / rgb / hsl outside `tokens.css` | None, in comps or `globals.css` |
| Token names used by `src/ui` | 47 referenced, all 47 defined. No component invents a name |

Screenshots: `design/screenshots/<comp>-<width>-<theme>.png` for 1024/1280/1440
× light/dark, plus `<comp>-1280-<theme>-compact.png` as density evidence.

## Accepted, not fixed

- **The pipeline board scrolls horizontally at 1024 and 1280.** Six columns
  cannot fit in 792 px of content width without dropping below ~130 px each,
  which would truncate every deal title. The board scrolls inside its own
  wrapper; the page does not. This is the right trade and it is what every
  usable board does.
- **The contact record has no primary button.** The accent is already carrying
  the overdue badge and the identity block's rail; a third accent element in the
  same block would dilute all three. The phone number is the largest interactive
  thing on the record, which is the hierarchy the contract asks for.
- **`--color-text-faint` is only just over AA in a few light pairs** (4.62:1 on
  the sidebar, 4.63:1 on a selected row). It passes, and raising it further
  would flatten the three-step ink hierarchy that makes dense rows scannable.

## Against the high-end-visual-design checklist

That skill's checklist is written for a marketing page. Run honestly against it,
this product fails eight of its eleven items, and each failure is the correct
decision for a 10 000-row table read in six minutes by a 58-year-old in a truck.
Recorded here so the disagreement is deliberate rather than accidental.

| Checklist item | Status | Why |
|---|---|---|
| No banned fonts / icons | **Fails** | The brief pins lucide at 20 px, and the app is offline so the font must be the system stack. Both are in `docs/PLAN.md`. The brief wins. |
| A Vibe + Layout archetype applied | **Fails** | All three archetypes (Ethereal Glass, Editorial Luxury, Soft Structuralism) are wrong for this audience, and two of them are on Walker's banned list. |
| Double-bezel nested cards | **Fails** | Nested enclosures cost 8–12 px of padding per card. On a pipeline board that is a whole deal card per column. |
| Button-in-button trailing icon | **Fails** | `DESIGN.md` bans trailing arrows in button text. |
| Section padding ≥ `py-24` | **Fails** | Density is the aesthetic here. Sections use `--space-7` (32 px). |
| Custom cubic-bezier transitions | **Passes** | `--ease-out` and `--ease-in-out` are custom curves; nothing uses `linear` or `ease-in-out` keyword. |
| Scroll entry animations | **Fails, deliberately** | Nothing animates on load or scroll. `DESIGN.md` §8. |
| Collapses below 768 px | **N/A** | Minimum window is 1024 px; `html, body { min-width: 1024px }`. |
| Transform / opacity only | **Passes** | No layout-triggering animation anywhere. |
| `backdrop-blur` on fixed elements only | **Passes** | No blur is used at all. |
| Reads as "$150k agency build" | **Judged differently** | The target is that it reads as *competent* — like the accounting software this owner already trusts. |

What was taken from that skill and kept: borders encode structure rather than
appearing by default, elevation is three defined jobs rather than one soft grey
shadow on everything, motion uses deliberate curves, and boldness is spent in
exactly one place. Here that place is the accent.
