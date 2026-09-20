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
| `sarah.mitchell83@gmail.example` | hubspot, zoho, pipedrive, google | Sarah Mitchell / Sara Mitchell / Sarah J Mitchell | pipedrive uses "Sandy Landscape LLC" vs "Sandy Landscape Co" elsewhere |
| `dchen.hvac@yahoo.example` | hubspot, zoho, excel | David Chen / Dave Chen | excel uses "Orem HVAC Services" vs "Orem Heating & Air" elsewhere |
| `mgonzalez.plumbing@outlook.example` | zoho, pipedrive, excel | Maria Gonzalez / Maria Gonzales | excel uses "Layton Pipe & Drain" vs "Layton Plumbing Co" elsewhere |
| `jwhitfield@comcast.example` | hubspot, pipedrive, google | James Whitfield / Jim Whitfield | google uses "Draper Roof & Gutter" vs "Draper Roofing Co" elsewhere |
| `amybrewer99@gmail.example` | hubspot, google, excel | Amy Brewer | excel uses "Logan Electrical Services" vs "Logan Electric" elsewhere |
| `tnguyen.roofing@gmail.example` | zoho, google, excel | Tom Nguyen / Thomas Nguyen | excel uses "Riverton Roof & Gutter" vs "Riverton Roofing LLC" elsewhere |

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

## Deal and company fixtures

| File | Rows | Line endings | Delimiter | Encoding | Quoting | What makes it messy | What it tests |
|---|---|---|---|---|---|---|---|
| `hubspot-deals.csv` | 30 | CRLF | `,` | UTF-8, no BOM | Quoted only where needed | Mixed `Amount` formats (`$12,500.00`, `4200`, `$850`, `18,400.00`, ...) including one unparseable `Call for quote`; `Deal Stage` mixes the real seeded stage names in varied casing (`new`, `CONTACTED`, `SCHEDULED`, `WON`, ...) with one unknown stage (`Contract Sent`) and two blank stages; `Close Date` mixes US format (`3/14/2026`), ISO (`2026-04-02`), and three blank; four rows carry a contact name with no email or phone, two rows have no contact at all; five blank companies and one company name containing a comma (quoted); two notes with escaped double quotes (`""Ask for Dave""`) | A HubSpot-style deal export exercising deal-stage, amount, close-date, and contact-matching mapping paths |
| `pipedrive-deals.csv` | 30 | LF | `,` | UTF-8 | Every field quoted (matches real Pipedrive exports) | Same stage/amount/contact messiness as the HubSpot deal file — mixed casing on real seeded stages, one unknown stage (`Proposal Sent`), two blank stages, one unparseable `Value` (`Call for quote`) — but `Expected close date` is ISO throughout, `Value` is a bare number, and organization names and notes contain commas, which is why every cell is blanket-quoted; two notes with escaped double quotes | A Pipedrive-style deal export where the exporter quotes every cell regardless of content |
| `hubspot-companies.csv` | 25 | CRLF | `,` | UTF-8, no BOM | Quoted only where needed | Blank phone on 5 rows and blank street address on 5 rows, one company name containing a comma (quoted), one description with escaped double quotes (`""Ask for Dave""`), one exact duplicate company name appearing on two separate rows, tags semicolon-separated on some rows | A HubSpot-style company export for the company dedupe-policy test |

Row counts, field counts, and parse results were verified against the
actual generated files with the repo's own `sniffCsv` + `parseCsvText`
(`src/lib/csv.ts`) — all three parse with **zero parse errors**, and every
row's field count matches its header.

`hubspot-deals.csv` has exactly 30 data rows: 1 row with an unknown Deal
Stage (`Contract Sent`), 2 rows with a blank Deal Stage, 1 row with an
unparseable Amount (`Call for quote`), and 6 rows whose Associated Contact
Email is copied verbatim from `hubspot-contacts.csv` —
`sarah.mitchell83@gmail.example`, `dchen.hvac@yahoo.example`,
`jwhitfield@comcast.example`, `amybrewer99@gmail.example`,
`joseph.martin347@example.com`, and `maria.murphy131@example.com`. Its
Associated Company column has 10 distinct non-blank company names (5 rows
are blank), one of which — `Jordan River Pest Control, LLC` — contains a
comma. Note that those 6 shared emails sit on **7** deal rows: David Chen
has two jobs in the file, which is what makes importing the deals after the
contacts attach both to one person instead of making a twin.

`pipedrive-deals.csv` has exactly 30 data rows: 1 row with an unknown
Stage (`Proposal Sent`), 2 rows with a blank Stage, 1 row with an
unparseable Value (`Call for quote`), and 4 rows whose `Person - Email` is
copied verbatim from `pipedrive-persons.csv` —
`mgonzalez.plumbing@outlook.example`, `jwhitfield@comcast.example`,
`jessica.sanders624@example.com`, and `sharon.murphy422@example.com`. Its
Organization column has 10 distinct non-blank names (5 rows are blank),
one of which — `Deseret Pest Control, LLC` — contains a comma.

`hubspot-companies.csv` has exactly 25 data rows and 24 distinct company
names: `Wasatch Front Sprinkler Repair` appears twice (an exact duplicate,
for the dedupe-policy test). 5 rows have a blank Phone Number, 5 rows have
a blank Street Address, one company name (`Jordan River Plumbing, Inc`)
contains a comma, and one Description contains an escaped double quote
(`""Ask for Dave""`).

## The install-day fixture (`messy-3000.csv`)

| File | Rows | Line endings | Delimiter | Encoding | Quoting | What makes it messy | What it tests |
|---|---|---|---|---|---|---|---|
| `messy-3000.csv` | 3,000 | CRLF | `,` | UTF-8, **with BOM** | Quoted only where a cell needs it (embedded comma or quote) | Every item in the list below | The whole contacts import path against one large, realistic, "a real trade owner just handed this over" export |

`messy-3000.csv` is generated by `gen-messy-3000.mjs` (precedent:
`malformed/gen-100k.mjs`), seeded with a fixed constant (`mulberry32`, seed
`20260918`) so re-running it produces a byte-identical file — verified by
hashing the output of two separate runs. Regenerate it with:

```
node tests/fixtures/gen-messy-3000.mjs
```

It is a contacts-style export with ten deliberately non-obvious headers —
`Customer Name`, `Co.`, `Cell`, `E-mail Address`, `Notes/Comments`, `City`,
`State`, `Zip`, `Total Spent`, `Last Service Date` — and contains, at least
once each: a UTF-8 BOM and CRLF throughout; a single full-name column instead
of split first/last; all five of the required ragged phone shapes
(`801-555-0142 ext 2`, `(385) 555-0199 x14`, `801.555.CALL`,
`+1 435 555 0117`, `8015550188`); an email with leading/trailing whitespace
and one in all caps; a non-ASCII name (`François Dubé`); a row with only a
company name and nothing else; three rows that are just commas
(`,,,,,,,,,`); a currency column (`Total Spent`) using all four required
notations (`$1,200.00`, `1200`, `$0.00`, `(500.00)`); a date column (`Last
Service Date`) mixing all three required formats in the same column
(`3/14/2026`, `2026-03-14`, `14 Mar 2026`); a company name and a notes field
each with an embedded comma and an escaped double quote; two **exact**
duplicate rows (byte for byte, one deliberate and one drawn from the
generated bulk, each appearing at two different positions in the file); and
three **near**-duplicate pairs (same email, a different spelling of the name
and a different phone format) plus one more near-duplicate pair drawn from
the generated bulk. Four genuinely empty lines are also written into the
file, at scattered positions, outside the 3,000-row count.

Everything below was verified against the actual generated file, and against
a real run of it through `runImport` (`tests/repo/data/messyImport.test.ts`),
not assumed:

- **3,000** literal data rows are written (confirmed by the generator's own
  row count and by counting `\r\n`-terminated lines). Parsed the way the real
  import path parses (`Papa.parse(text, { header: true, skipEmptyLines:
  "greedy" })`, which is what `src/lib/csv.ts`'s `walkCsv` uses), only
  **2,997** rows ever reach `applyMapping` and **zero** parse errors are
  raised. The gap is exactly the 3 "just commas" rows plus the 4 injected
  blank lines (7 rows): papaparse's greedy mode treats an all-blank row
  exactly like a blank line and drops it before the importer ever sees it —
  the same documented quirk `malformed/empty-with-headers.csv` exercises,
  just from the opposite direction (a row with delimiters but no content,
  rather than no delimiters at all). This is correct behavior, not a defect:
  a row with nothing in any column has nothing to report.
- The mapper's guess for every column: `Customer Name` → full name, `Co.` →
  company, `Cell` → phone (labelled "mobile"), `E-mail Address` → email,
  `Notes/Comments` → notes, `City`/`State`/`Zip` → city/state/postal, and
  `Total Spent`/`Last Service Date` → Skip (correctly — neither has a
  contacts-schema home). `Customer Name` → full name and `Co.` → company were
  **not** the guess before this task; both were landing on Skip. See
  `src/features/data/lib/mapping.ts` and `tests/repo/data/messyImport.test.ts`.
- The import creates **2,991** contacts and skips exactly **6** rows, all six
  for the same reason class (`Already in Helix (matched on email …)`) — one
  per duplicate email in the file. None of the five ragged phone shapes fail
  to import; four of the five parse to a dialable E.164 number and
  `801.555.CALL` does not (letters are not converted to digits), which raises
  one warning rather than a skip. In total the run surfaces **61**
  warning-level rows (1 phone, 60 "no name on this row" — including the
  company-only row) that import successfully but that Helix had to make a
  judgement call on.
