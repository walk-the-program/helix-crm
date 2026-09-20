# Helix CRM against the Apple Human Interface Guidelines

Date: 2026-09-19. Read-only review. Reviewer: apple-design skill, HIG pages as of
Apple's June 2026 revisions.

What was read: `docs/DESIGN.md` revision 3 (the brand contract), `docs/PLAN.md`
"What this is", `src/app/Shell.tsx`, `src/app/CommandPalette.tsx`,
`src/app/shortcuts.ts`, `src/app/appSettings.ts`, the whole component kit in
`src/ui`, `src/styles/{tokens,globals,app}.css`, `src-tauri/tauri.conf.json`,
`src-tauri/src/lib.rs`, `src-tauri/icons/`, and the shipped screenshots in
`tests/e2e-mac/.cache/screens/{final,today-compact,onboarding,brand-a,depth}/`
in both themes.

This review is written **inside** the brand. Radius 0, the slab headings, the
five-colour palette, the hairline-instead-of-shadow elevation and the one
confident block per view are the owner's decisions and are treated as correct.
Nothing below asks Helix to look like a stock Mac app. Section 4 lists the
brand decisions explicitly so nobody undoes them while fixing section 2.

One limit worth stating: every screenshot in `tests/e2e-mac/.cache/screens/`
was captured with `VITE_E2E` set, which turns off the macOS platform layout
(`src/app/appSettings.ts:246`). The images are therefore an accurate record of
the web layout and **not** of what a macOS user sees at the top of the window.
Finding 1 is the thing that hides in that gap.

---

## 1. Verdict

Helix is a well-built desktop app that has not yet finished becoming a Mac app:
the inside of the window is careful, measured and genuinely better than most
shipping CRMs, while the parts that connect it to macOS — the title bar, the
menu bar, undo, text selection, window restoration and the app icon — are
either missing or were designed and then not wired up. The brand does not
fight the platform anywhere; zero radius, the slab, the flat fills and the
hairline elevation read as a considered native app with an opinion, not as a
web page in a window, and the contrast work in `tokens.css` is better than
Apple's own minimum in almost every pair the product can produce. The most
serious problem is a one-line omission: the code sets `data-platform="macos"`
and `data-titlebar-inset` and comments that `globals.css` pays 38px for the
traffic lights, but no such rule exists in any stylesheet, so on a real Mac the
window buttons land on top of the Helix lockup. The second most serious is
structural: with no menu bar, a Mac user has nowhere to look for Helix's own
commands, no Edit > Undo for anything Helix does, and no Settings… item under
the app menu even though Cmd+, works. Rated **Needs work** — no accessibility
failure inside the content area, but four High findings and one Critical that
sit exactly on the seam between the app and the operating system.

---

## 2. Findings, ranked by user impact

### 1. Critical — the macOS traffic lights land on the Helix lockup

`windows.md › macOS window anatomy`; `layout.md › Guides and safe areas`:
"Safe areas are essential for avoiding a device's interactive and display
features."

**Screen and element.** Every screen, the sidebar's brand slot.
`src-tauri/tauri.conf.json` sets `"titleBarStyle": "Overlay"` with
`"hiddenTitle": true`, so the web view starts at y=0 and the system draws the
close/minimise/zoom buttons over the app's own first ~38px.

**What a Mac user expects.** The window's controls sit in clear space; nothing
of the app's own is drawn underneath them.

**What Helix does.** `src/ui/Nav.tsx:40` stamps `data-titlebar-inset` on the
brand slot and `src/app/appSettings.ts:257` stamps `data-platform="macos"` on
`<html>`, and the comments in both files say `globals.css` pays 38px for it.
It does not: `grep -rn "titlebar\|data-platform" src/styles/` returns nothing,
and neither does the built CSS in `dist/`. The brand slot's only top padding is
`pt-[var(--space-4)]` — 16px comfortable, 12px compact — and the 26px mark
starts at roughly x=20, y=19, which is inside the button strip. The E2E
screenshots cannot show this because `isMacOS()` returns false under
`VITE_E2E`.

**Fix.** Add the missing rule to `src/styles/globals.css`:
`[data-platform="macos"] [data-titlebar-inset] { padding-top: 38px; }` (and
check the `--topbar-h` column at the same time, since `Topbar` also starts at
y=0 on the content side). Then capture one screenshot from the real Tauri
window, not from the E2E harness, and keep it.

---

### 2. Critical — there is no app menu, so Helix's own commands have nowhere to live

`the-menu-bar.md › Best practices`: "Mac users are very familiar with the macOS
menu bar, and they rely on it to help them learn what an app does and find the
commands they need." `toolbars.md › Desktop (macOS)`: "Make every toolbar item
available as a command in the menu bar."

**Screen and element.** The whole app. `src-tauri/src/lib.rs` never calls
`set_menu` and registers no menu module, so macOS falls back to Tauri's generic
default: an app submenu with About/Services/Hide/Quit, a near-empty File, the
system Edit items, and nothing else.

**What a Mac user expects.** *App* (About, **Settings…** ⌘,, Services, Hide,
Quit ⌘Q), *File* (New Contact ⌘N, New Job, Import…, Export…, Close Window ⌘W),
*Edit* (Undo ⌘Z, Redo ⇧⌘Z, Cut/Copy/Paste/Select All, Find ⌘F), *View*
(Show/Hide Sidebar, Comfortable/Compact, Enter Full Screen ⌃⌘F), *Window*
(Minimize ⌘M, Zoom), *Help* (Helix Help ⌘?). Above all: a place to discover
what the app can do without guessing a keystroke.

**What Helix does.** Every command lives in the command palette and in eight
web-layer shortcuts (`mod+k` search, `mod+shift+k` palette, `mod+n` quick add,
`mod+,` settings, `?` shortcut list, `mod+shift+v` AI paste, Escape, Enter —
`src/app/shortcuts.ts`, `src/features/settings/lib/shortcuts.ts:30`). ⌘Q, ⌘W
and ⌘M work only because Tauri's default menu supplies them; Helix contributes
nothing. There is no Settings… item even though `mod+,` is bound
(`src/features/settings/index.tsx:88`), and web-layer shortcuts stop working
the moment focus leaves the web view.

**Fix.** Build a `Menu` in `src-tauri/src/lib.rs` from Tauri v2's predefined
items plus a Helix section, and emit an event per custom item that the shell
routes into `findCommand(...)`. Start with the six standard menus and only the
commands Helix already has; the palette then becomes the fast path rather than
the only path.

---

### 3. High — undo is a ten-second toast and nothing else

`undo-and-redo.md › Desktop (macOS)`: "Mac users expect to find undo and redo
at the top of the Edit menu; they also expect to use Command–Z and
Shift–Command–Z." Also: "Let people undo multiple times."

**Screen and element.** Every destructive or state-changing action.
`src/ui/toast.ts` `toast.undo()` gives a single Undo button for 10 000ms;
`src/features/records/lib/mutations.ts:74`, `today/sections/DueNow.tsx:92`,
`templates/lib/hooks.ts:77`, `recurring/lib/hooks.ts:150` and
`data/duplicates/DuplicatesScreen.tsx:180` are its only callers.

**What a Mac user expects.** ⌘Z reverses the last thing they did, repeatedly,
and the Edit menu says what it will reverse ("Undo Delete Contact").

**What Helix does.** If the toast times out or is dismissed, the action is
gone. A pipeline drag (`PipelineBoard.tsx`), an inline field edit
(`records/components/InlineEdit.tsx`) and a stage change are not undoable at
all — deletes fall back to the 30-day Trash screen, which is a different
mental model and does not cover edits. `drag-and-drop.md › Best practices`
asks specifically for undo on a drop.

**Fix.** Keep an in-memory undo stack of the last ~20 mutations, bind ⌘Z/⇧⌘Z
to it in `src/app/shortcuts.ts`, and label the Edit menu items from the stack
once finding 2 lands. The toast stays as the discoverable surface.

---

### 4. High — nothing on any screen can be selected or copied

`designing-for-macos.md › Best practices`: "Help people take advantage of
high-precision input modes to perform pixel-perfect selections and edits."

**Screen and element.** Every record screen. `src/styles/globals.css` sets
`user-select: none` on `body` and re-enables it for
`input, textarea, [contenteditable], [data-selectable], .selectable` — and
`grep -rn "selectable" src/` shows those two opt-in hooks are used **nowhere**
outside the stylesheet that declares them.

**What a Mac user expects.** Drag across a phone number, an address, a note or
a log line and press ⌘C. This is the single most common thing an owner does
with a CRM record before pasting it into a text message or an invoice.

**What Helix does.** The timeline on `ContactPage`, every table cell, the
diagnostics paths, the activity notes and the reports figures are all
unselectable. The workaround is per-feature clipboard buttons
(`DiagnosticsScreen.tsx:152`, `leads/components/ReportCard.tsx:59`,
`ai/components/*`), which cover four places out of dozens.

**Fix.** Invert the default: put `user-select: text` on the content area
(`<main>` in `src/app/Shell.tsx:348`) and keep `user-select: none` on the
sidebar, the toolbar and row-action clusters. That preserves the "a desktop app
is not a document" intent for chrome while making content behave.

---

### 5. High — the toolbar theme switch mislabels itself and strands the owner out of Auto

`dark-mode.md › Best practices`: "Avoid offering an app-specific appearance
setting… they may think your app is broken because it doesn't respond to their
systemwide appearance choice."

**Screen and element.** The toolbar's sun/moon `IconButton`,
`src/app/Shell.tsx:329-343`.

**What a Mac user expects.** The app follows System Settings unless they
deliberately override it, and any override is reversible.

**What Helix does.** The default theme is `auto` (`appSettings.ts:33`) and Auto
is offered in Settings > Appearance, which is right. But the toolbar button
reads `appearance.theme`, not the *resolved* theme: on a Mac set to dark with
Helix on Auto, the app is already dark while the button says "Switch to dark"
and shows a moon. Pressing it pins the app to dark, and there is no way back to
Auto from the toolbar — only from Settings, which most owners will never
connect to the button they pressed.

**Fix.** Either drop the toolbar toggle and leave appearance in Settings (the
HIG's preference), or make it a three-state pull-down (Light / Dark / Auto)
and label it from `resolveTheme(theme)` rather than from `theme`.

---

### 6. High — the record lists are not lists: no click-to-sort, no column resize, no arrow-key navigation, no multi-select

`lists-and-tables.md › Desktop (macOS)`: "When it provides value, let people
click a column heading to sort a table view based on that column." "Let people
resize columns." `focus-and-selection.md › Best practices`: in macOS "you only
need to support focus for content elements like list items."

**Screen and element.** Contacts, Companies, Tasks.
`src/features/records/screens/ContactsScreen.tsx:373` renders the column strip
as a flex `div` marked `aria-hidden="true"`, above a `VirtualList` of
`role="button"` rows. The sortable `TH` in `src/ui/Table.tsx:110` exists and is
used only by the pipeline's list view.

**What a Mac user expects.** Click "Name" to sort, click again to reverse. Drag
the divider between "Name" and "Company" to widen a column. Arrow up and down
to move the selection. Shift-click and ⌘-click to select several rows and act
on them at once.

**What Helix does.** Sorting is a separate `Select` in the filter bar
("Name A to Z"), columns are fixed at `w-[200px]` / `w-[180px]`, every row is
its own tab stop with no arrow-key handling, and there is no multi-selection
anywhere — so tagging or deleting twelve contacts is twelve trips.

**Fix.** Reuse the existing sortable `TH` for the list headers and bind the
sort `Select` to the same state so both stay in sync; add up/down arrow
navigation with a roving `tabIndex` inside `VirtualList`; add Shift-click and
⌘-click range selection with one bulk-action bar. Column resize is the
expensive one and can wait.

---

### 7. High — the app icon is an opaque white square with no dark variant

`app-icons.md › Icon shape` and `› Appearances`: macOS icons are square layers
that the system masks into a rounded rectangle; "Use your light app icon as the
basis for your dark icon"; "Design a background that both stands out and
emphasizes foreground content."

**Screen and element.** The Dock, Spotlight, the About window.
`src-tauri/icons/icon.png` is 512×512 with corner pixel `#FFFFFF` at full
alpha — a flat white square with the four-X mark inset at roughly 80%.
`src-tauri/tauri.conf.json:44` points at PNG/ICNS/ICO generated from it, so
there is no Icon Composer source and no dark, clear or tinted variant.

**What a Mac user expects.** A rounded-rect icon with a background that is part
of the brand, and a dark variant that does not glow on a dark Dock.

**What Helix does.** Ships white. On a light desktop the icon is a white patch
with a small mark; there is no dark variant at all, so on a dark Home Screen /
Dock the system falls back to the same white square.

**Fix.** Rebuild the icon in Icon Composer with the mark as a foreground layer
over a brand background — the primary tint `#F2F4FA` or the neutral light
`#FAFAFF`, not pure white — supply square unmasked layers, and export the dark
variant. Keep the four-X mark exactly as it is; only the background and the
layering change. The mark already has a transparent source at
`assets/brand/helix-logo.png`.

---

### 8. Medium — the window forgets its size and position between launches

`windows.md › Desktop (macOS)`: "people typically run several apps at the same
time… moving, resizing, minimizing, and revealing the windows to suit their
work style."

**Screen and element.** `src-tauri/tauri.conf.json:18-22` — `width: 1280`,
`height: 820`, `center: true`, and `src-tauri/Cargo.toml` has no
`tauri-plugin-window-state`.

**What a Mac user expects.** The app reopens where they left it, at the size
they left it.

**What Helix does.** Every launch re-centres at 1280×820, discarding whatever
the owner set up on a second display or beside another window.

**Fix.** Add `tauri-plugin-window-state` and initialise it in
`src-tauri/src/lib.rs`. It is the cheapest fix on this list and the one an
owner notices daily.

---

### 9. Medium — the search field is at the leading edge and the toolbar carries no view title

`search-fields.md › Tablet and desktop (iPadOS, macOS)`: "Put a search field at
the trailing side of the toolbar for many common uses." `toolbars.md › Titles`:
"Provide a useful title for each window." `toolbars.md › Item groupings`: the
leading edge is for the sidebar toggle and the view title; the trailing edge is
for "an optional search field".

**Screen and element.** `src/app/Shell.tsx:311-325` puts the search button in
`Topbar`'s `left` slot; the `right` slot holds only the write-status badge and
the theme toggle. Combined with `hiddenTitle: true`, no window title appears
anywhere on screen.

**What a Mac user expects.** Search on the trailing side, the current view's
name on the leading side — the Mail and Notes arrangement, which is exactly
Helix's layout otherwise.

**What Helix does.** Search sits where the sidebar toggle and title normally
sit. In practice this also puts it directly under the traffic lights strip once
finding 1 is fixed, which will need re-checking.

**Fix.** Move the search button to the `right` slot and put the current view's
name (the same string `PageHeader` renders) in `left`. This costs nothing —
`Topbar` already has three slots — and it frees the leading edge for a
Show/Hide Sidebar control when finding 11 is addressed.

---

### 10. Medium — Settings is a screen inside the main window, not a settings window

`settings.md › Desktop (macOS)`: "When people choose the Settings item in your
app's or game's App menu, your custom settings window opens. Typically, a
custom settings window contains a toolbar that includes buttons for switching
between views." And: "Avoid adding settings buttons to a window's toolbar."

**Screen and element.** The sidebar's Settings row and the `/settings` route
(`tests/e2e-mac/.cache/screens/final/settings-index-light.png`). ⌘, navigates
the main window rather than opening a window.

**What a Mac user expects.** ⌘, opens a small, separate, non-resizable window
with a fixed toolbar of panes, and it remembers the last pane.

**What Helix does.** Replaces the whole main window with a settings screen, so
the owner loses their place. The content itself is excellent — a grouped list
under General / Your Records / Data / Advanced, with a second-level sidebar,
which is a better information architecture than most Mac settings windows.

**Trade-off.** A separate window is real work in Tauri and the current screen
is genuinely good. The pragmatic middle is to keep the screen, remember where
the owner was, and return there on close. Note that the "Run setup again",
"Stages" and "Trash" rows already navigate out of Settings into the main app,
which a settings *window* could not do — so the in-window choice is partly
load-bearing.

**Fix.** Lowest cost: on entering `/settings`, store the previous route, and
add a "Done" affordance that returns to it. Higher cost, later: a real settings
window for the panes that do not navigate away.

---

### 11. Medium — the sidebar never collapses, and the only workspace switcher is on its bottom edge

`sidebars.md › Best practices`: "Consider letting people hide the sidebar… in
macOS, you can include a show/hide button or add Show Sidebar and Hide Sidebar
commands to your app's View menu." And: "Avoid putting critical information or
actions at the bottom of a sidebar. People often relocate a window in a way
that hides its bottom edge."

**Screen and element.** `src/ui/Nav.tsx:23-56`; the workspace footer in
`src/app/Shell.tsx:288-303`.

**What a Mac user expects.** ⌃⌘S or a toolbar button collapses the sidebar when
they want the width; nothing they need lives on the window's bottom edge.

**What Helix does.** `docs/DESIGN.md §3` states the sidebar "never collapses",
which is a defensible product decision for a 240px rail at a 1024px floor — the
pipeline board is the one screen that would benefit, and it already scrolls
horizontally. The workspace name at the bottom is the harder problem: for an
owner running two businesses it is the switch between them, and it is the first
thing to go off-screen when the window is dragged down.

**Fix.** Keep the non-collapsing sidebar; it suits this product. Move the
workspace switcher to the top of the sidebar under the lockup, or make it the
leading item in the toolbar. It is also reachable from the palette and from
Settings > Workspaces, so this is about the primary affordance, not about
access.

---

### 12. Medium — date and time fields are raw web inputs that ignore the owner's own date format

`pickers.md › Desktop (macOS)`: "There are two styles of date pickers in
macOS: textual and graphical." `entering-data.md`: "Be clear about the data you
need."

**Screen and element.** `mm/dd/yyyy` with the browser's calendar glyph appears
on `ContactPage`'s task rail, the Tasks screen, `NewDealDialog.tsx:191`,
`QuickAddDialog.tsx:423`, `CustomFieldsPanel.tsx:101`,
`PeriodPicker.tsx:83`, `RuleDialog.tsx:220` and `DealPage.tsx:273` — ten
`<Input type="date">` / `type="time"` call sites.

**What a Mac user expects.** A segmented field they can arrow through, with a
small calendar popover, formatted to their region.

**What Helix does.** Renders WKWebView's own date control. It is keyboard-usable
and it validates, so this is not broken — but it is the one control in the
product that visibly is not Helix's, it carries a rounded browser affordance in
a zero-radius app, and it shows `mm/dd/yyyy` regardless of the date format the
owner chose in Settings > Workspace.

**Fix.** Wrap `type="date"` in a small `DateField` in `src/ui` that renders the
workspace's format as the placeholder and styles the native control's
appearance to the kit. Replacing the picker itself is a later job.

---

### 13. Medium — hover feedback is close to invisible in dark mode

`designing-for-macos.md › Best practices` (pointer feedback);
`accessibility.md › Vision`.

**Screen and element.** Every row and nav item.
`--color-hover: #242424` against `--color-surface: #1E1E1E`
(`src/styles/tokens.css`, dark block).

**What a Mac user expects.** A clearly visible highlight under the pointer.

**What Helix does.** The dark hover step measures **1.07:1** against the
surface — a six-value jump in each channel. On a laptop screen in daylight it
is not perceptible. Light mode is better but still quiet: `#EAEDF3` on
`#FFFFFF` is 1.17:1.

**Fix.** Lift `--color-hover` in the dark block to about `#2C2C2C` (≈1.18:1,
matching the light theme's step) and re-check `--color-selected` against it so
hover and selection stay distinguishable. No brand rule is affected: hover is
a neutral, not a colour event.

---

### 14. Medium — the column strip above every record list is hidden from VoiceOver

`voiceover.md › Navigation`: "Specify how elements are grouped, ordered, or
linked… Examine your app for places where relationships among elements are
visual only."

**Screen and element.** `ContactsScreen.tsx:373` —
`<div className="section-label …" aria-hidden="true">Name / Company / Tags`.
The rows below are `role="listitem"` wrappers around `role="button"` elements.

**What a Mac user expects.** VoiceOver reads a list row as a row with named
columns, and the rotor can move between them.

**What Helix does.** A VoiceOver user hears each row as an unstructured button
label and never learns that the second value is the company and the third the
tags.

**Fix.** Either give the strip `role="row"` with `role="columnheader"` cells
inside a `role="grid"` (and drop the `aria-hidden`), or leave it decorative and
build each row's accessible name explicitly — "Priya Raghunathan, no company,
tagged Sample" — via `aria-label` on the row button.

---

### 15. Medium — a long CSV import cannot be cancelled

`progress-indicators.md › Best practices`: "When it's feasible, let people halt
processing. If people can interrupt a process without causing negative side
effects, include a Cancel button."

**Screen and element.**
`tests/e2e-mac/.cache/screens/brand-a/import-running-light.png` — "Reading your
file… / Rows read / 1,000 rows" with a determinate bar and no control.

**What a Mac user expects.** A Cancel button beside the bar.

**What Helix does.** The copy says "It all goes in at once, so if anything fails
nothing is left half imported. Other changes wait until this finishes." — good,
honest, and it explains the transaction — but the owner who picked the wrong
20,000-row file has to wait it out or kill the app.

**Fix.** Add a Cancel to the running step that aborts the parse and rolls back
the transaction. The all-or-nothing design already makes the rollback safe,
which is what makes this cheap.

The rest of the loading and progress work is right: the write-status badge in
the toolbar (`Shell.tsx:87`), the `transition` line during a workspace switch,
determinate progress where the count is known, and `Spinner` stopping under
`prefers-reduced-motion`.

---

### 16. Low — the keyboard focus ring on a selected table row measures 2.98:1

`accessibility.md › Vision` (3:1 for non-text indicators);
`focus-and-selection.md › Best practices`.

**Screen and element.** `focusRingInset` in `src/ui/styles.ts`, applied by
`TR` in `src/ui/Table.tsx:96` to clickable rows. The ring is `--color-focus`
`#8B85C2`; on a selected row (`--color-selected` `#EEF1F8`) it computes to
**2.98:1**, two hundredths under the bar. On white it is 3.37:1 and on the
sidebar tint 3.06:1, so the outset ring is fine everywhere else, and the dark
theme is fine at 4.06:1.

**Fix.** Darken the ring by one step for the inset case only, or give the inset
ring a 1px `--color-surface` inner edge the way the outset ring already has.
Do not change `--color-focus` globally — it is the brand secondary doing one of
its two sanctioned jobs.

---

### 17. Low — a pipeline move announces nothing and cannot be undone

`drag-and-drop.md › Best practices`: "Prefer letting people undo a
drag-and-drop operation." `voiceover.md › Navigation`: "Inform VoiceOver when
visible content or layout changes occur."

**Screen and element.** `src/features/records/components/PipelineBoard.tsx:143`
(`onKeyMove`) and `DealCard.tsx:66-68`.

**What Helix does well here first.** The board has a real keyboard path —
Shift plus an arrow moves the focused card and focus follows it across the
move — a drag handle with `aria-label={`Drag ${deal.title}`}`, an on-screen
instruction ("Drag a card, or focus one and hold shift with an arrow key to
move it"), optimistic reordering with a server rollback on failure, and a
required reason when a card enters a lost stage. That is better than most
boards ship.

**What is missing.** No `aria-live` announcement after the keyboard move, so a
VoiceOver user gets no confirmation; and a move — by mouse or key — has no
undo and no toast.

**Fix.** Add a polite live region that says "Moved Retaining wall to Estimate
sent, position 2", and route the move through the undo stack from finding 3.

---

### 18. Low — small things worth a pass

- **Compact type is at the platform floor.** `--text-label` and
  `--text-caption` drop to 10px in compact (`tokens.css`, `[data-density]`),
  which is exactly macOS's minimum (`typography.md › Ensuring legibility`:
  13pt default, 10pt minimum). It clears — `#646B71` on white is 5.41:1 — but
  there is no headroom, so nothing should go below it and 10px uppercase
  tracked at 0.05em should be spot-checked on a non-Retina display.
- **Body runs larger than the platform.** 15px comfortable against macOS's 13pt
  default. For a 40-to-65-year-old owner on a laptop this is the right call,
  not a defect, and compact lands on 13px for anyone who wants the density.
- **The toast close button is small.** sonner's `closeButton`
  (`Shell.tsx:378`) is around 20×20 — at macOS's absolute minimum
  (`accessibility.md › Mobility`: 28×28 default, 20×20 minimum) and visually
  cramped against the toast's corner in the screenshots.
- **The "Conversion between stages" chart draws labels with no marks** when
  every value is zero (`final/reports-dark.png`). `charting-data.md` asks for a
  chart to say something; an all-zero chart should show the "Nothing here yet."
  line that "Time in stage" already uses.
- **Window title.** With `hiddenTitle: true` and no toolbar title, "Helix CRM"
  from `tauri.conf.json` is all the Window menu and Mission Control get. Once
  finding 9 lands, consider setting the window title to the current view too.

---

## 3. What Helix does better than a stock Mac app

These are specific so they survive the next iteration.

- **Measured contrast instead of assumed contrast.** `src/styles/tokens.css`
  states the WCAG ratio for every text/background pair the product can actually
  produce, in both themes, including the awkward ones — tertiary ink on the
  hover tint at 4.61:1, tertiary on the sidebar tint at 4.92:1. The tertiary
  step was darkened from `#6A7278` to `#646B71` specifically because the first
  value failed on the sidebar where a kbd glyph lands. Very few shipping Mac
  apps can produce that table.
- **A colour-blind-solved categorical ramp.** The eight pipeline stage colours
  were re-derived at one fixed OKLCh chroma and their lightness solved by hill
  climb to maximise the smallest pairwise ΔE2000 across normal vision and three
  dichromat simulations. The worst dark-mode reading went from 0.7 (a green and
  a red a deuteranope could not separate at all) to 4.9. And stage colour is
  never the only cue — the stage name is spelled out beside it everywhere.
- **Writing.** Empty states say what will make them fill ("A lead lands here
  when a deal is created and nobody has logged a call, an email or a note
  against it yet"). Errors name the thing and the fix. Toasts are past tense.
  The confirm dialog for a restore explains that today's data is backed up
  first so the restore itself can be undone. `writing.md` asks for all of this
  and most apps deliver none of it.
- **Dialog buttons in the right order, with the safe one focused.**
  `src/ui/Dialog.tsx:165` puts Cancel to the left of the confirm, gives the
  destructive confirm the red fill only inside a dialog, and lands initial
  focus on Cancel — which is precisely `alerts.md › Buttons`.
- **A keyboard path through the pipeline board**, with focus following the
  moved card so a run of Shift-arrows works. Most Kanban boards have no
  keyboard path at all.
- **Density as a real setting.** Every size in `src/ui` is a `var()`, so
  compact is a token swap rather than a second layout. `settings.md` asks for
  general, infrequently-changed options and this is a model one.
- **Honest offline behaviour.** Fonts are self-hosted, there is no CDN, errors
  carry "Copy details" because the owner is often in a truck, and the Help
  screen says plainly that there is no support team watching.
- **No dark patterns.** Nothing asks for money, an account, a review or
  telemetry. `docs/DESIGN.md §2.10` makes it a rule and the screens keep it.

---

## 4. Do in the next pass — top ten by impact over effort

1. **Add the missing `[data-platform="macos"] [data-titlebar-inset]` rule** to
   `src/styles/globals.css`, then screenshot the real Tauri window once to
   prove it. (Finding 1. One line; currently the app is visibly broken at the
   top on every Mac.)
2. **Add `tauri-plugin-window-state`** so the window reopens where it was.
   (Finding 8. Half an hour; noticed every launch.)
3. **Fix the theme toggle**: label it from `resolveTheme(theme)` and either
   make it three-state or remove it. (Finding 5. Small; it currently lies.)
4. **Turn text selection back on inside `<main>`** and keep it off in the
   chrome. (Finding 4. Two CSS rules; unblocks the most common thing an owner
   does with a record.)
5. **Move search to the toolbar's trailing edge and put the view name on the
   leading edge.** (Finding 9. A slot swap in `Shell.tsx`.)
6. **Build the macOS menu bar** with the six standard menus and the commands
   Helix already has, routed into `findCommand`. (Finding 2. A day; it is what
   makes the app findable.)
7. **Rebuild the app icon** in Icon Composer on a brand background with a dark
   variant. (Finding 7. An afternoon in a design tool; it is the first thing
   anyone sees.)
8. **Lift `--color-hover` in the dark theme** to roughly `#2C2C2C`. (Finding
   13. One token; hover is currently invisible at night.)
9. **Give the record lists click-to-sort and arrow-key navigation**, reusing
   the sortable `TH` that already exists. Multi-select next, column resize
   later. (Finding 6.)
10. **Add an undo stack behind ⌘Z** covering deletes, edits and pipeline moves,
    with the toast kept as the discoverable surface. (Finding 3. The largest
    item here and the one that changes how safe the app feels.)

Deliberately below the line for this pass: a real settings window (10), a
custom date picker (12), import cancel (15), the grid roles for VoiceOver (14),
and the focus-ring inset ratio (16).

---

## 5. Brand decisions to keep — do not "fix" these

Everything in this list is a deliberate departure from the default Mac look,
stated in `docs/DESIGN.md`, and it is working. No finding above asks for any of
it to change.

- **Radius 0 everywhere** — controls, cards, panels, badges, the search field,
  the mark. `--radius-sm/md/lg/full` all resolve to `0` and should stay there.
- **Zilla Slab headings against Lato body.** Every `h1`–`h6`, `PageHeader`,
  `CardTitle`, `DialogTitle` and `EmptyState` title is the slab; nothing else
  is. The system font stack is a fallback, not a target.
- **No blurred shadow.** `--shadow-sm: none`; `--shadow-md`/`--shadow-lg` are a
  second hairline (`0 0 0 1px`). A floating layer gets a crisp double edge, not
  a grey haze.
- **`--shadow-sticker`, the accent offset, on the Brand lockup and at most one
  hero element per screen.** It is the signature; a second one on a screen is
  the bug, not the first one.
- **One confident block per view** — the selected sidebar row in `#97B1C3`
  with `#141414` ink at 8.24:1, plus the primary button where a screen has a
  primary action. It does not invert in dark, which is the strongest single
  thing the brand does.
- **Coloured chrome nowhere else.** Tabs, toolbar, menus, checkboxes, switches
  and tables mark their state in ink, not in the accent.
- **No zebra striping, no vertical cell rules, no row rails.** One hairline and
  space.
- **No illustration or spot glyph in an empty state.** `EmptyState` accepts an
  `icon` prop and deliberately does not draw it.
- **Body at 15px comfortable** rather than the macOS 13pt default. The audience
  is 40 to 65 on a laptop; compact exists for anyone who disagrees.
- **Phosphor as the only icon set**, one weight per context, monochrome, taking
  the parent's ink.
- **The five-colour palette and its rules** — the accent is never a background,
  `#97B1C3` and `#8B85C2` never carry small text, tints are the primary at 8%
  or less as a flat hex.
- **Sentence case everywhere except the 11px caption label**, which is the only
  uppercase type in the product.
- **No motion that the owner did not cause.** No entrances, no scroll reveals,
  no hover lift; everything off under `prefers-reduced-motion`.

---

## 6. Fixed — the top ten, 2026-09-19

Every item in section 4, with the commit that did it. Nothing in section 5 was
touched. Where a fix turned out to be smaller or larger than the review
assumed, that is said here rather than quietly absorbed.

1. **The macOS title-bar inset** — `1850c21`, with `581403d` before it. The
   stylesheet rule the review asked for had in fact been added a round earlier
   and *still did not apply*: `globals.css` is imported into the `base` cascade
   layer, the brand slot's padding comes from a Tailwind `pt-[…]` utility, and a
   later layer beats any specificity an earlier one can bring. The lockup kept
   its 16px. `app.css` now declares a `platform` layer after `utilities` and the
   rule lives there; measured, the slot is 38px. The harness could not see any
   of this because `isMacOS()` returned false under `VITE_E2E`, so `ff1608e`
   added a `window.__helixPlatform` hook read only under that flag, and
   `tests/e2e-mac/specs/hig.e2e.ts` opts in, asserts the **computed** padding —
   an attribute check passed throughout — and screenshots the top of the sidebar
   in both themes into `design/hig/`. The drag regions are asserted present and
   unselectable; that they actually move the window is still a manual check,
   because `data-tauri-drag-region` means nothing without Tauri under the page.

2. **Window state** — `d7eb7b8`. `tauri-plugin-window-state` 2.4.1, registered
   in the existing `#[cfg(desktop)]` block, with `window-state:default` in the
   capability. `minWidth`/`minHeight` were already 1024×700, so a restored
   window is still clamped. `cargo build` clean.

3. **The theme toggle** — `ff1608e` and `bc1dc35`. `nextTheme` in
   `appSettings.ts` is now the one Auto → Light → Dark → Auto cycle, used by the
   toolbar button, the View menu's item and the palette's command, so Auto is
   never more than three presses away. The button's icon and its accessible name
   come from `resolveTheme(theme)`, and a tooltip names the state — "Auto
   (dark)" rather than "Auto", since "Auto" alone does not tell an owner what
   they are looking at. The two strings are deliberately different sentences:
   the name says what pressing it will do, the tooltip what the appearance is.

4. **Text selection** — `b8fa451`, proved by `fa2f7af`. The blanket
   `user-select: none` is off `body`; the sidebar, any `nav` landmark, every
   button and every `<label>` opt out. A record's name, its address lines and
   its notes select and copy, asserted through a real triple-click and
   `window.getSelection()`. One gap worth naming: the primary phone number in a
   contact's header is inside the one-tap call button, so *that copy* of it is
   not selectable; the number in the Phones list below is an input and is.

5. **The toolbar** — `bc1dc35`. View title on the leading edge, search field on
   the trailing edge. The title is derived from the most specific nav item the
   location matches, with named fallbacks for the screens no sidebar row owns
   and "Not found" for a route that does not exist. Plain ink in the body face:
   it is toolbar chrome, not a heading, and it does not spend the one confident
   block.

6. **The macOS menu bar** — `a19dcd3`, with `d1e8519` guarding it. Six menus in
   `src-tauri/src/menu.rs`. Cut, Copy, Paste, Select All, Hide, Quit, Minimise,
   Zoom, Bring All to Front and Enter Full Screen are the predefined items, so a
   text field behaves the way macOS makes it behave. Everything of Helix's own
   carries a command id from the registry or a `nav:` route, is emitted to the
   web view as one `menu` event, and is run by `src/app/menu.ts` — so a menu item
   and a palette entry can never drift apart. Undo and Redo are deliberately
   *not* predefined (see 10), and `menu.ts` hands the keystroke back to a focused
   text field. **Attached on macOS only.** Tauri renders this menu inside the
   window on Windows; Helix's floor is a 1024px window and the Windows suite
   drives the real app through WebDriver, so turning it on there is a layout
   change this pass could not look at. `attach()` is the one line that decides.

7. **The app icon** — `f6ba815`. 1024px, white rounded square at Apple's 22.37%
   corner radius, the four marks at 62% of the width, transparent outside the
   square, no ring and no shadow — Walker's decision, not the review's
   suggestion of a tinted background. `tools/brand/make-app-icon.py` generates
   it and `npx tauri icon` regenerated the set. A dark variant sits beside it at
   `assets/brand/app-icon-macos-dark.png` and is **not shipped**: Tauri cannot
   carry a dark icon variant without an Icon Composer bundle, so it waits for
   signing.

8. **Dark hover** — `b8fa451`. `--color-hover` goes `#242424` → `#383838`,
   measured at **1.42:1** against `--color-surface` `#1E1E1E`. The review's
   suggested `#2C2C2C` only reaches 1.19:1 and was rejected on measurement.
   `--color-selected` moved with it, `#2A2D2E` → `#373D41` (1.51:1 against the
   surface), and tertiary ink on the new selected is 4.61:1 — still AA, and the
   token comment that claimed AAA for the old pair was wrong and is corrected.
   `docs/DESIGN.md`'s table carries the new values.

9. **The lists** — `dd79024`. Contacts, Companies and Tasks. The sortable header
   logic came out of `Table.tsx` into `src/ui/SortableHeader.tsx`, so the
   pipeline's `<th>` and the flex column strip above a virtualised list are the
   same button, the same caret and the same `aria-sort`; the header drives the
   same state the "Sort" select shows, so the two cannot disagree. Arrow-key
   navigation with a roving `tabIndex` (`src/ui/useRovingRowNav.ts`) makes each
   list one tab stop instead of one per row, and the virtualised path scrolls by
   index rather than calling `scrollIntoView` on a row that may not be mounted.
   Enter opens a contact or a company; a task has nowhere to open, so Enter ticks
   it off. Multi-select and column resize are still open, as the review said they
   would be. **Finding 14 is still open too**: the strip is `role="row"` with
   `role="columnheader"` cells but there is no `role="grid"` above it, so the
   roles have no valid context. That is not a regression — it replaced
   `aria-hidden` — but it is not the fix finding 14 asked for.

10. **The undo stack** — `a19dcd3` and `37822de`, proved by `fa2f7af`.
    `src/app/undo.ts` holds the last twenty `change_log` batches. Creates and
    deletes already logged one; pipeline drags, inline field edits on all three
    record pages, and the deal page's stage picker did not, and now do. Cmd+Z
    reverses through `changeLog.undoBatch` and Shift+Cmd+Z re-applies through the
    new `changeLog.redoBatch`; the toast names what happened ("Undone: deleted
    Priya Raghunathan"). Typing suppresses the shortcut, so a text field keeps
    its own undo. The stack is emptied on every `db_open`, because a batch id
    means nothing in another workspace. A merge is not on it: only
    `merge.reverse(mergeId)` knows how to re-point rows across tables, and both
    directions skip it.

    **A defect found on the way.** `undoBatch` crashed on a contact update or a
    stage move with "no such column: company_name" — the repositories log the
    shape their callers see, and that carries `companyName` and `stageName`,
    which are joins. Undo of an edit had therefore never worked. Both directions
    now filter every key through `PRAGMA table_info`.

### Verification

`cargo build` clean. `npm run typecheck` clean. `npm test` 1531 passed, 1
skipped. The full macOS e2e suite 93 passed on port 4207. `npx vite build`
clean. Screenshots at 1280 in light and dark in `design/hig/`: the inset
sidebar, the toolbar, a sorted list and the undo toast.

One harness fix was needed on the way: `@tauri-apps/api`'s `unlisten` reaches
for `window.__TAURI_EVENT_PLUGIN_INTERNALS__` directly rather than through
`invoke`, and the shim did not have it, so the menu bridge's subscription threw
on teardown once per page load. `tests/e2e-mac/fixtures.ts` stubs it now.

**Not verified here:** the menu bar at runtime. It compiles, its ids are checked
against the registry by `tests/unit/app/menuIds.test.ts`, and the bridge that
runs them is unit-tested — but nothing in this pass launched the real window, so
that the menu *draws* is still a manual check, as is the drag region and the
restored window position.
