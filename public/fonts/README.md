# Self-hosted webfonts

These files are self-hosted so Helix CRM can render its fonts offline, with no
CDN dependency. All files were fetched from Google Fonts (fonts.gstatic.com),
latin subset only (unicode-range U+0000-00FF and companion latin punctuation
codepoints — no latin-ext, cyrillic, devanagari, etc.).

## Font files

- `zilla-slab-600.woff2` — Zilla Slab, weight 600 (SemiBold), normal style
- `zilla-slab-700.woff2` — Zilla Slab, weight 700 (Bold), normal style
- `lato-400.woff2` — Lato, weight 400 (Regular), normal style
- `lato-700.woff2` — Lato, weight 700 (Bold), normal style
- `lato-400italic.woff2` — Lato, weight 400 (Regular), italic style
- `dm-sans-400.woff2` — DM Sans, weight 400 (Regular), normal style
- `dm-sans-500.woff2` — DM Sans, weight 500 (Medium), normal style
- `dm-sans-700.woff2` — DM Sans, weight 700 (Bold), normal style
- `poppins-400.woff2` — Poppins, weight 400 (Regular), normal style
- `poppins-500.woff2` — Poppins, weight 500 (Medium), normal style
- `poppins-700.woff2` — Poppins, weight 700 (Bold), normal style

Four families, two in use. `src/styles/fonts.css` declares all four, each under
its own `--family-*` name, and the two the app actually wears are chosen by two
lines at the top of `src/styles/tokens.css` under a `FONT SWITCH` banner. Today
that is DM Sans for headings and Lato for body; Zilla Slab (the brand guide's
original heading face) and Poppins (its original body face) stay here so the
switch has somewhere to go back to. A declared family is not downloaded until
something asks for it, so the two that are not in use cost nothing at runtime.

Lato ships here at 400 and 700 only, plus 400 italic — not the five weights
Google Fonts offers it in — because nothing in the product needs more than a
regular and a bold. Tailwind's `font-medium` / `font-semibold` utilities are
remapped to those two real faces (400 and 700) rather than a weight with no
matching file; see `src/styles/app.css` for the `--font-weight-medium` /
`--font-weight-semibold` remap and `docs/DESIGN.md` for the rationale. See
`CHANGELOG.md` for when and why the body face changed.

Each file's internal name table and OS/2.usWeightClass were checked with
fontTools and match the weight in the filename.

## Licensing

Zilla Slab, Lato, DM Sans and Poppins are licensed under the SIL Open Font License,
Version 1.1 (OFL 1.1). The full license text for each family is included
alongside the font files:

- `Zilla_Slab-OFL.txt` — fetched from
  https://raw.githubusercontent.com/google/fonts/main/ofl/zillaslab/OFL.txt
- `Lato-OFL.txt` — fetched from
  https://raw.githubusercontent.com/google/fonts/main/ofl/lato/OFL.txt
- `DM_Sans-OFL.txt` — fetched from
  https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/OFL.txt
- `Poppins-OFL.txt` — fetched from
  https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/OFL.txt

The OFL permits self-hosting, bundling, and redistribution as part of this
application; no additional attribution beyond keeping these license files is
required.
