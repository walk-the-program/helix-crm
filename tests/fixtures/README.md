# CSV import test fixtures

All fixtures are generated data: invented Utah trade businesses and people.
None of the names, businesses, or contact details refer to real people or
companies. The generator that produced these files lives outside this repo
(scratchpad only); these `.csv` files and this README are the only
committed artifacts.

## Main fixtures

| File | Rows | Line endings | Delimiter | Encoding | Quoting | What makes it messy | What it tests |
|---|---|---|---|---|---|---|---|
| `hubspot-contacts.csv` | 52 | CRLF | `,` | UTF-8, no BOM | Quoted only where needed | Mixed phone formats, 2 blank phones, blank optional cells, one company name containing a comma (quoted), two job titles with escaped double quotes, one non-ASCII name, leading/trailing whitespace on a few names, one company name exactly 47 characters long | A HubSpot-style export with separate Phone/Mobile columns and a single `Associated Company` field |
| `zoho-contacts.csv` | 47 | LF | `,` | UTF-8 | Every field quoted (matches real Zoho exports) | Same phone/blank/whitespace/non-ASCII messiness as above, plus mailing-street addresses with embedded commas and description fields with escaped double quotes | A CRM export where the exporter blanket-quotes every cell regardless of content |
| `pipedrive-persons.csv` | 58 | LF | `,` | UTF-8 | Every field quoted, addresses always contain commas, notes with escaped quotes, split Email Work/Home and Phone Work/Mobile | `Person - Name` is a single full-name column with no first/last split — the split-name parsing test case |
| `google-contacts.csv` | 44 | LF | `,` | UTF-8 | Most phonetic/prefix/suffix/photo columns blank (as in real Google exports), grouped Labels like `* myContacts ::: Suppliers`, comma-containing formatted addresses, notes with escaped quotes | A Google Contacts export with many structurally-always-empty columns and label-based grouping instead of tags |
| `excel-saveas.csv` | 41 | CRLF | `,` | UTF-8 | Header has two trailing empty column names; every data row therefore ends with two trailing commas; US-format dates (`3/14/2026`); mixed-case state (`UT` / `ut`); quoted addresses/notes with commas and escaped quotes | A hand-kept spreadsheet exported via Excel "Save As CSV", including the stray trailing columns Excel emits when formatting extends past the used range |

Row counts, field counts, and papaparse error counts were verified against
the actual generated files (see **Verification** below) — all five parse
with **zero papaparse errors** under `Papa.parse(content, { header: true })`.

Every optional column (email, city, notes, company, and similar) has at
least 15% of its cells blank in each file. Every file contains mixed phone
formats (`801-555-0142`, `(385) 555-0199`, `+1 435 555 0117`,
`8015550188`, `801.555.0163`, `801-555-0150 ext 2`) and at least two blank
phone numbers. Every file contains at least one quoted field with an
embedded comma, at least two fields with escaped double quotes
(`""Ask for Dave""`), at least one non-ASCII name, and a few cells with
leading/trailing whitespace.

`hubspot-contacts.csv` contains one company name that is exactly 47
characters long: `Wasatch Front Premier Landscape & Design Groups`
(Associated Company column).

## Cross-file duplicate emails (for dedupe testing)

These six email addresses each appear in at least three of the five main
fixtures, with slightly different name spellings, different phone formats
per file, and — in one file each — a different company name, to give
dedupe/merge logic something real to reconcile:

| Email | Appears in | Name variants | Note |
|---|---|---|---|
| `sarah.mitchell83@gmail.com` | hubspot, zoho, pipedrive, google | Sarah Mitchell / Sara Mitchell / Sarah J Mitchell | pipedrive uses "Sandy Landscape LLC" vs "Sandy Landscape Co" elsewhere |
| `dchen.hvac@yahoo.com` | hubspot, zoho, excel | David Chen / Dave Chen | excel uses "Orem HVAC Services" vs "Orem Heating & Air" elsewhere |
| `mgonzalez.plumbing@outlook.com` | zoho, pipedrive, excel | Maria Gonzalez / Maria Gonzales | excel uses "Layton Pipe & Drain" vs "Layton Plumbing Co" elsewhere |
| `jwhitfield@comcast.net` | hubspot, pipedrive, google | James Whitfield / Jim Whitfield | google uses "Draper Roof & Gutter" vs "Draper Roofing Co" elsewhere |
| `amybrewer99@gmail.com` | hubspot, google, excel | Amy Brewer | excel uses "Logan Electrical Services" vs "Logan Electric" elsewhere |
| `tnguyen.roofing@gmail.com` | zoho, google, excel | Tom Nguyen / Thomas Nguyen | excel uses "Riverton Roof & Gutter" vs "Riverton Roofing LLC" elsewhere |

## Malformed fixtures (`malformed/`)

| File | Rows | Purpose |
|---|---|---|
| `bom.csv` | 5 data rows | UTF-8 file starting with a BOM (`EF BB BF`); tests BOM stripping before parsing |
| `crlf.csv` | 5 data rows | Explicit CRLF line endings throughout, including a trailing CRLF after the last row |
| `semicolon.csv` | 5 data rows | European-style export: `;` delimiter and `,` as the decimal separator inside `Deal Value` (e.g. `1250,00`) |
| `ragged.csv` | 10 data lines | Inconsistent field counts per row (3, 4, and 5 fields against a 4-column header) — deliberately invalid, used to test error handling and recovery |
| `empty-with-headers.csv` | 0 data rows | Header row only, single trailing newline — tests the "no records to import" path |
| `gen-100k.mjs` | generates on demand | Zero-dependency Node ESM script that streams a large synthetic CSV (default 100,000 rows, header matching `hubspot-contacts.csv`) for performance/load testing |
| `.gitignore` | — | Excludes the generated `100k.csv` from version control |

Note on `bom.csv`, `crlf.csv`, `semicolon.csv`, and `empty-with-headers.csv`:
each of these ends with a trailing newline (by design, and required for
`empty-with-headers.csv` and `crlf.csv` specifically). Parsed with plain
`Papa.parse(content, { header: true })` (no `skipEmptyLines`), that
trailing newline produces one extra phantom empty row and a
`TooFewFields` error — this is a papaparse quirk with trailing newlines,
not a defect in the fixture content, and the real import code should set
`skipEmptyLines: true` (or equivalent) to avoid it. `ragged.csv` is the
one file that is *supposed* to produce parse errors — its ragged field
counts generate 7 `TooFewFields`/`TooManyFields` errors, which is the
whole point of the fixture.

### Running `gen-100k.mjs`

```
node tests/fixtures/malformed/gen-100k.mjs                 # writes tests/fixtures/malformed/100k.csv (100000 rows)
node tests/fixtures/malformed/gen-100k.mjs <outPath>        # writes to a custom path
node tests/fixtures/malformed/gen-100k.mjs --rows 1000      # overrides the row count
node tests/fixtures/malformed/gen-100k.mjs <outPath> --rows 1000
```

It streams output with `fs.createWriteStream` and honors backpressure
(`await`s the `drain` event when `write()` returns `false`), and prints
elapsed time in milliseconds, row count, and final file size in bytes when
done. `100k.csv` is not committed — it is listed in
`malformed/.gitignore` and should be generated locally when needed for
performance testing.
