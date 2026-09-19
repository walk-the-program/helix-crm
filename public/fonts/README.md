# Self-hosted webfonts

These files are self-hosted so Helix CRM can render its fonts offline, with no
CDN dependency. All files were fetched from Google Fonts (fonts.gstatic.com),
latin subset only (unicode-range U+0000-00FF and companion latin punctuation
codepoints — no latin-ext, cyrillic, devanagari, etc.).

## Font files

- `zilla-slab-600.woff2` — Zilla Slab, weight 600 (SemiBold), normal style
- `zilla-slab-700.woff2` — Zilla Slab, weight 700 (Bold), normal style
- `poppins-400.woff2` — Poppins, weight 400 (Regular), normal style
- `poppins-500.woff2` — Poppins, weight 500 (Medium), normal style
- `poppins-600.woff2` — Poppins, weight 600 (SemiBold), normal style

Each file's internal name table and OS/2.usWeightClass were checked with
fontTools and match the weight in the filename.

## Licensing

Both Zilla Slab and Poppins are licensed under the SIL Open Font License,
Version 1.1 (OFL 1.1). The full license text for each family is included
alongside the font files:

- `Zilla_Slab-OFL.txt` — fetched from
  https://raw.githubusercontent.com/google/fonts/main/ofl/zillaslab/OFL.txt
- `Poppins-OFL.txt` — fetched from
  https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/OFL.txt

The OFL permits self-hosting, bundling, and redistribution as part of this
application; no additional attribution beyond keeping these license files is
required.
