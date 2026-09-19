# Apple-direction review — 2026-09-19

Reviewer: redesign agent. Subject: `src/styles/**`, `src/ui/**`, `src/app/Shell.tsx`,
`src/app/CommandPalette.tsx`, `src/app/BootScreens.tsx`. Contract:
`docs/DESIGN.md` revision 2. Superseded review: `design/ui-review.md` (the
orange-accent kit).

## Method

1. `docs/DESIGN.md` rewritten first, then `tokens.css`, then every primitive held
   against it line by line.
2. The gallery — `design/ui-screens/gallery.html`, produced by
   `tests/unit/ui/gallery.test.ts` from the real components via React DOM —
   regenerated, with three new specimens (`groupedlist.inset`,
   `sectionlabel.default`, `badge.tones-all`).
3. Served on `127.0.0.1:4792` (plain static server, started and stopped by this
   agent) and driven with the pinned Playwright CLI 0.1.19, headless, in-memory,
   session `helix-apple-gallery`, closed at the end.
4. Screenshotted full-page at 1280 in all four modes into
   `design/apple/gallery-1280-{light,dark}-{comfortable,compact}.png`, plus 32
   per-section crops in `design/apple/sections/` which is what the defects below
   were actually found in — a 9000px full-page shot is not reviewable.
5. `design/contrast-audit.js` run in each of the four modes:
   `design/apple/contrast-*.json`.
6. Behaviour the camera cannot see asserted in `tests/unit/ui/*.test.ts`.

## Defects found and fixed

### 1. The danger button's hover specimen painted red on red

*Caught by:* `contrast-light-comfortable.json`, three failures at 1.00:1 —
`rgb(159,47,45)` text on `rgb(159,47,45)`.

`tests/unit/ui/gallery.specimens.tsx` simulated hover by painting the variant's
hover token behind the button, and `BUTTON_HOVER_TOKEN.danger` was still
`--color-danger-ink` from the old kit, where the danger button was a red fill.
Under revision 2 the destructive button is text-only and its hover background is
`--color-danger-soft`. The specimen, not the component, was wrong; it was
asserting a contract that no longer exists.

**Fix:** `danger: "--color-danger-soft"` in both the button and icon-button hover
maps. All four modes then measured 0 failures over 428 text elements.

### 2. Menu labels did not line up

*Caught by:* `design/apple/sections/light-dropdownmenu.png` (the first pass) —
"Log a call" sat 20px left of "Pin to Today", because a plain item is padded
`--space-3` and a checkbox item is padded `--space-7` to leave room for the tick.

A macOS menu that has a tick anywhere indents every row to the same text origin.
The old kit had the same defect and nobody had looked at a menu with a mixed set
of items.

**Fix:** `DropdownMenuContent` now carries
`[&:has([role=menuitemcheckbox])_[role=menuitem]]:pl-[var(--space-7)]` and the
same for `[data-menu-label]`, so the indent appears only in menus that actually
have a tick. Verified in the recapture: the label, all three items and the
destructive item share one left edge.

### 3. The dialog could run its confirm button off-screen

*Caught by:* the orchestrator, from the settings e2e ("element is outside of the
viewport"), and recorded as item 8 in `docs/STATUS.md`. Not visible in the
gallery at all — see the coverage note below.

**Fix:** `DialogContent` is now a flex column capped at
`max-h-[calc(100vh-var(--space-9)*2)]` with `overflow-hidden`, holding one scroll
box (`min-h-0 flex-1 overflow-y-auto`). `DialogHeader` sticks to the top of that
box and `DialogFooter` to the bottom, both painted with the raised surface and
pulled full-bleed with negative margins. The pinning lives in the header and
footer components rather than in a new wrapper, so all 14 existing dialog call
sites in `src/features` get the fix without a line changing. Asserted in
`tests/unit/ui/dialog.test.ts` ("caps its own height and scrolls internally,
with the header and footer pinned").

### 4. `kbd` was set in a monospace with a bottom bezel

*Caught by:* `design/apple/sections/light-kbd.png` against a macOS menu, where a
shortcut is drawn in the system face at the same size as the menu item's label,
with no key-cap chrome at all.

The old `kbd` was a skeuomorphic key: mono face, `border-bottom-width: 2px`. Two
web-page tells in one 30px element.

**Fix:** system sans, tertiary ink on `--color-accent-soft`, one hairline, 4px
radius, no bezel — in `globals.css` for the bare element and in `Kbd.tsx` for the
component, so they cannot drift apart.

### 5. The table header was a sentence-case grey label

*Caught by:* reading `Table.tsx` against §4 and comparing
`design/apple/sections/light-table.png` with a Finder list view.

Revision 1 explicitly banned small capitals. That was the right call for body
copy and the wrong one for a column header, which is the one place a native list
view does use them.

**Fix:** `TH` now renders the section-label style (11px, uppercase,
`--tracking-label`, `--color-text-faint`) at `--control-h` rather than `--row-h`,
and the sort caret dropped from 16px to 10px and is hidden until hover on an
unsorted column. The header now reads as a label rather than as a first row of
data. Small capitals remain banned everywhere else.

### 6. Every list row carried a rail, a bar or a second size

*Caught by:* reading `Table.tsx` and `Card.tsx` against §9 after the first
screenshot pass showed the selected row wearing both a tint and a 3px blue bar.

Three web-app devices were in the kit: the selected row's 3px `--color-focus`
left rail, the card's 3px orange "attention" rail, and a primary cell set two
steps larger than its neighbours (`--text-lg` against `--text-base`).

**Fix:** the selected row is the tint and full ink and nothing else; `attention`
swaps the hairline for `--color-border-strong`; the primary cell is body size at
weight 500. A native list keeps one size down a column.

### 7. Three levels of drop shadow

*Caught by:* `tokens.css` against the brief, and confirmed in the first
light-comfortable capture, where every card sat on a grey halo.

**Fix:** `--shadow-sm: none`; `--shadow-md` and `--shadow-lg` are both
`0 2px 8px rgba(0,0,0,0.04)` (0.40 alpha in dark). Cards, rows, inputs, buttons
and tables cast nothing; only a floating layer does. `Switch`'s thumb, which used
`--shadow-sm` to lift off its track, took a hairline instead.

### 8. Apple's own greys fail WCAG AA

*Caught by:* computing the ramp before writing it — `#A1A1A6` is 2.57:1 on white
and `#86868B` is 3.62:1, and the brief asks for both the platform greys and AA on
every text element.

**Fix:** the ink ramp ships the accessible cousins — `#1D1D1F` / `#56565A`
(7.31:1) / `#6E6E73` (5.07:1) — and `#A1A1A6` survives as
`--color-text-disabled`, which may sit on a disabled glyph or a scrollbar thumb
and never on text. Tertiary ink is additionally barred from `--color-selected`
(4.39:1), where full ink is used instead. Every pair is listed with its measured
ratio in `tokens.css`.

### 9. The primary button was invisible in dark mode

*Caught by:* pairing `#111111` against the `#1E1E1E` canvas while writing the
dark block.

**Fix:** `--color-accent` inverts to `#F5F5F7` with `#1D1D1F` ink in dark, which
is what a native dark app does with its default button. Verified in
`design/apple/sections/dark-button.png`.

### 10. Lucide

*Caught by:* the minimalist-ui skill's ban, and visible at 16px against 15px text
where a 2px hairline stroke reads lighter than the label it belongs to.

**Fix:** `src/ui/icons.ts` maps every one of the 86 Lucide names the product used
onto a Phosphor equivalent and re-exports them under both spellings, so a feature
migrates by changing the import path alone. `src/ui` and `src/app` are clear of
`lucide-react`; `src/features` is the sweep agents' job.

## Coverage gaps, stated rather than hidden

- **The gallery cannot show a dialog's real geometry.** Its harness forces
  `position: static !important` on portalled overlay content so it can render
  inline, which disables `position: fixed`, `absolute` and `sticky`. So the
  dialog specimens show the close button adrift at the panel edge and the header
  and footer un-pinned — both are harness artifacts, not defects. The height
  bound and the pinning are asserted in `tests/unit/ui/dialog.test.ts` instead.
- **`Shell.tsx` and `CommandPalette.tsx` are not in the gallery**, which imports
  only from `src/ui`. Their primitives (`Sidebar`, `SidebarSection`, `NavItem`,
  `Topbar`, `Kbd`, `Input`) are covered; the composed toolbar, the search field
  and the Spotlight panel were reviewed by reading them against §3 and §9 and are
  live in the Tauri dev window under HMR. A feature agent adding a shell specimen
  would close this.
- **The gallery's `kbd` renders the Windows spelling** (`Ctrl+K`) because jsdom's
  navigator is not a Mac. The mac branch is unit-tested, not photographed.

## Verification

| Check | Result |
| --- | --- |
| Rendered contrast, gallery × {light, dark} × {comfortable, compact} | **0 failures.** 428 text elements measured in each mode (`design/apple/contrast-*.json`) |
| Console messages / failed requests | 0 errors, 0 warnings; 2 requests per load (the HTML and `gallery.css`), both 200 |
| `npm run typecheck` | clean |
| `npm test` | 59 files, 739 tests, all passing |
| `npx vite build --outDir dist-redesign` | succeeds; directory deleted afterwards |
| Hex / `rgb()` / `rgba()` / `hsl()` outside `tokens.css` | none in `src/ui/**`, `src/app/**`, `src/styles/app.css`, or the generated gallery |
| `lucide-react` in `src/ui` or `src/app` | none |
| Webfont, CDN link or remote image | none. The gallery links one local stylesheet and nothing else |
| Compact density | verified live: body 15px → 13px, `--row-h` 40px → 32px, on `[data-density="compact"]` |

Screenshots: `design/apple/gallery-1280-{light,dark}-{comfortable,compact}.png`
(full page, 1280 × 8999 comfortable / 6951 compact) and
`design/apple/sections/{light,dark}-<section>.png`.
