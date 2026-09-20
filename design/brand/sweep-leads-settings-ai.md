# Brand sweep: leads, settings, AI, and the four documents

Date: 2026-09-19. Source of truth: `assets/brand/guide/helix-crm-brand-guide.html`.
Tokens and fonts: commit `42e2bc6`. Component kit, lockup and shell: commit
`fa221ab`. Both the foundation agent's.

Scope swept: `src/features/leads/**`, `src/features/settings/**`,
`src/features/ai/**`, their three e2e specs, `README.md`, `CHANGELOG.md`,
`CONTRIBUTING.md`, `tests/RELEASE-CHECKLIST.md`.

---

## The three rules this sweep enforced

1. **One block of primary per view.** The guide gives a view a single confident
   block of `#97B1C3`. In the app that is the one primary button, and the
   sidebar's selected row, which belongs to the shell and is not counted here.
   Every other control on a screen is secondary, ghost or destructive.
2. **Radius 0, flat fills, no accent background.** Every rounded-corner utility
   is gone from the three feature folders. Bar caps are square. Tag swatches are
   squares. The accent appears only where the kit puts it.
3. **The guide's type.** Zilla Slab through `--font-heading` on the one heading
   this scope sets by hand; Poppins through `--font-body` everywhere else,
   including inside the SVG charts; captions and table headers at the caption
   step (11px comfortable, 10px compact). Helper text stays at `--text-xs`,
   which is where `docs/DESIGN.md` r3's scale table puts it.

No colour, font name, radius or shadow literal is written anywhere in the three
folders. The verification grep is at the bottom.

---

## Per screen

### Leads

**Website connection — `/settings/site`**
- Primary block: the **Save** button. Test connection and Poll now are
  secondary, Disconnect is the destructive text button, and the connection
  Status row reads with a badge rather than with colour alone.
- Changed: the token hints no longer say "this Mac" — the app ships on Windows
  too, so they now name the Mac Keychain and the Windows Credential Manager the
  way the AI screen already did.
- Changed: the poll banner lost its `--radius-lg` corner. It is a flat warning
  tint with a hairline and square edges, sitting in the content column.

**Reports — `/reports`**
- Primary block: **the bars.** There is no primary button on this screen, on
  purpose: a report is something the owner reads, not something he does, so the
  brand primary goes into the leading chart series and nowhere else.
- Chart colour is now `--brand-primary` for the leading series and
  `--brand-secondary` for the second (Won and lost). Leads by source and
  Conversion between stages are single-series and take the primary. Pipeline
  value by stage and Average days in stage keep the stage ramp, because the
  category *is* the stage and the owner already reads those colours as stages.
- **The accent stays out of the bars.** The guide allows a single highlighted
  bar in the accent, and `#EDF0A3` on the near-white report canvas is a shape
  the owner cannot read. Leaving it out costs nothing: every bar already carries
  its exact figure at the end of it.
- Bar caps went from a 4px rounded data end to square, both orientations.
- Axis ticks, bar labels and the legend are now the 11px caption step in
  `--font-body`, so the SVG text matches the HTML around it instead of falling
  back to the browser's default sans.
- The Won and lost headline figures are the one thing in this scope set in
  Zilla Slab: `--font-heading` at `--text-heading` in `--color-heading`, with an
  11px caption above and below. That is what makes them read as the number the
  card is about.
- Voice: the load-failure fallback said "Something went wrong loading your
  reports", which repeats the title and says nothing. It now says the database
  gave no reason and what to try. "Nothing to show for this slice yet" lost
  "slice".

### Settings

**The section list (every settings screen)**
- **Fixed, and the biggest thing the screenshots caught.** The list was built
  from `NavItem`, the shell's sidebar primitive, whose selected row is
  deliberately a flat block of brand primary — its own docstring says the
  sidebar is where the application spends its one confident block. Beside the
  shell's sidebar that put two primary blocks on every settings screen, and
  three on the ones that also have a primary button. The rows are now a local
  `SettingsNavRow` with `NavItem`'s exact geometry (same height, same gutter,
  same 18px glyph taking the row's ink) and the quiet `--color-selected` tint
  with full ink and weight 500 for the selected one, which is what
  `docs/DESIGN.md` r3 assigns to a selected row that is not the sidebar.

**Index — `/settings`**
- No primary block. The index is a list of destinations with nothing to do on
  it, so it earns no block of primary; the neutrals and the hairlines carry it.

**Workspace — `/settings/workspace`**: primary block is **Save name**. Unchanged
apart from the frame.

**Vocabulary — `/settings/vocabulary`**: no primary block. It saves on the radio,
so there is no button to make primary.

**Appearance — `/settings/appearance`**: no primary block, same reason.
- Voice and accuracy: Compact said "Text never gets smaller than 11px." Under
  the brand scale compact captions are 10px, so that was no longer true. It now
  says what actually changes: body text goes from 15px to 13px. The Density
  footnote was corrected the same way — density moves the type scale with the
  row height, it does not leave it alone.

**Keyboard shortcuts — `/settings/shortcuts` and the "?" sheet**: no primary
block. Both render the same list, so neither can drift from the other.

**Tags — `/settings/tags`**: primary block is **Add tag**, in the header when
there are tags and in the empty state when there are none, never both.
- Changed: the colour swatches are squares now, both the 24px picker wells and
  the 12px swatch on a row. A round dot beside square everything else was the
  one shape giving the screen away as a web app.
- Voice: the empty state lost a sentence that restated the screen's own subtitle.

**Custom fields — `/settings/fields`**: primary block is **Add a field**, already
in exactly one place at a time.

**Workspaces — `/settings/workspaces`**: primary block is **New workspace**.
- **Fixed:** the header button and the empty state's button both rendered when
  the list was empty — two blocks of primary in one view. The header button is
  now conditional on there being a workspace to list, which is the rule Tags and
  Custom fields already followed.

**Workspace switcher (sheet)**: no primary block. Picking a row is the action;
the open row wears the selected tint with a check, and the footer holds a ghost
and a secondary.

**Diagnostics — `/settings/diagnostics`**: no primary block. Copy log and Reveal
data folder are equals, and a screen with two equal actions has no single thing
the owner came to do.
- Fixed a broken Tailwind utility on the path/version text: `font-[var(--font-mono)]`
  never resolved and is now `font-[family-name:var(--font-mono)]`.

### AI

**AI settings — `/settings/ai`**: primary block is **Save key**. Test key is
secondary, Remove key is the destructive text button.

**Paste to record (sheet)**: primary block is **Save customer and job**. "Read
it" is secondary — a sheet with two filled buttons has no primary action at all.
- Changed: the disabled-reason note and the raw-answer `<pre>` lost their
  corners, and the `<pre>` had the same broken mono utility as Diagnostics; it
  is `font-[family-name:var(--font-mono)]` now. Its size stays `--text-xs`,
  which is what the scale table gives helper text and a diagnostic dump — the
  11px caption step is for labels and table headers, not for something the
  owner may have to read and copy.

**Draft a follow-up (sheet)**: primary block is **Open in Mail**. Copy is
secondary, Cancel is ghost.

**Summary (sheet)**: primary block is **Copy**. Close is ghost.

**`AiActionButton`** stays secondary by default. An AI action is never the one
thing a screen is for, so it does not take the screen's block of primary; a
sheet that owns its own footer passes `variant="primary"` explicitly. The
disabled reason beside it stays at `--text-xs`: it is a sentence the owner has
to read, which the scale table calls helper text, not a label.

---

## The four documents

Voice pass against the guide's page 5: direct, specific, warm; no hype, jargon
or filler.

- **README.md** — kept the logo at `assets/brand/helix-logo.png` and added the
  guide's own tagline under it. Rewrote the closing attribution. Fixed two
  sentences that personified the software ("time Helix doesn't have") and one
  doubled "only". No design description existed to correct, and none was
  invented.
- **CHANGELOG.md** — read line by line and left alone. The entries already lead
  with the fact and carry real numbers.
- **CONTRIBUTING.md** — a run of comma splices turned into sentences, and four
  paragraphs re-ordered so the rule comes before the reasoning. No command,
  path, or rule changed.
- **tests/RELEASE-CHECKLIST.md** — two comma splices in the intro prose. Every
  checklist item untouched.

---

## What the screenshots caught

Captured at 1280 wide, light and dark, into
`tests/e2e-mac/.cache/screens/brand-b/` (42 images), read beside the five pages
of the brand guide.

1. **Three blocks of primary on every settings screen.** The section list used
   `NavItem`, which paints its selected row in the primary. Fixed as described
   above; a settings screen now shows the shell's sidebar block and, at most,
   its own primary button.
2. **Every dark-mode dialog photographed with white text fields.** This one was
   the screenshot pass lying, not the app. Both `shoot()` helpers set
   `data-theme` and captured in the same tick, and every surface and control in
   the kit carries `transition-colors`, so the frame that was captured still
   held the light colours. A computed-style probe confirmed it: on the dark
   textarea `--color-surface` already read `#1e1e1e` while
   `background-color` was still `rgb(255, 255, 255)`. Both helpers now wait for
   the canvas colour to actually change and then give the slowest transition
   250ms to land. The leads spec already did this, which is why its captures
   were right and the other two were not. Same bug, same white fields, in the
   pre-brand captures under `.cache/screens/sweep-settings/`.
3. **"Sonnet 5 (recommended)" truncated in the model pop-up.** Poppins is wider
   than the old system face, and the label ran past the `w-56` control column.
   The parenthetical was doing no work — Sonnet is the default value, and the
   footnote under the group already explains the tradeoff — so the label is now
   "Sonnet 5" and the note starts "The default."
4. **The database paths on Diagnostics were not monospace.** `font-[var(--font-mono)]`
   is not a Tailwind utility and had silently never resolved; it is
   `font-[family-name:var(--font-mono)]` now, which is the form the sweep's own
   verification grep allows.
5. **Not a bug: the toast stays light in the dark captures.** `Toaster` reads
   the app's theme *setting*, and the screenshot pass forces `data-theme` on the
   element instead of changing the setting. In the app the two move together.
6. **Zilla Slab reads well at the report headline.** The Won and lost figures at
   `--text-heading` were the only place in this scope worth spending the heading
   face, and they carry the card. Nothing else in these screens needed it; the
   kit's `PageHeader`, `CardTitle` and `DialogTitle` already bring it.
7. **Stage bars stay louder than the brand bars in light mode.** The stage ramp
   is the ink value, so a stage-coloured bar is a saturated fill next to a
   `#97B1C3`-family one. `tokens.css` says the guide is silent on the ramp and
   keeps revision 2's eight hues, and the brief keeps stage bars on the ramp, so
   this is by design and the two kinds of bar are telling the owner two
   different things. In dark mode, where the ramp lifts to its light side, they
   sit together well.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — 67 files, 815 tests, all passing.
- `E2E_PORT=4195 E2E_OUT=dist-brand-b npx playwright test -c tests/e2e-mac/playwright.config.ts tests/e2e-mac/specs/{leads,settings,ai}.e2e.ts`
  — 30 passed.
- `npx vite build --outDir dist-brand-b` — succeeded; the folder was deleted
  afterwards.
- `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(|rounded-|font-family|Poppins|Zilla" src/features/leads src/features/settings src/features/ai`
  — no matches. The only font utilities in the three folders are
  `font-[family-name:var(--font-heading)]` and
  `font-[family-name:var(--font-mono)]`.
