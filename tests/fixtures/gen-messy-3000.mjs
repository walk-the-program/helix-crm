#!/usr/bin/env node
// Deterministic, seeded generator for tests/fixtures/messy-3000.csv.
//
// Zero-dependency Node ESM script (precedent: tests/fixtures/malformed/gen-100k.mjs)
// that writes a ~3,000-row "contacts-style export" the way a real trade owner's
// spreadsheet or CRM actually hands one over on install day: a UTF-8 BOM, CRLF
// line endings, one full-name column instead of split first/last, non-obvious
// header names, ragged phone formats (some with letters and extensions), mixed
// email casing/whitespace, exact and near duplicates, blank and comma-only
// rows, a currency column in four different notations, and a date column that
// mixes three formats in the same file.
//
// Every name, business, email and phone below is invented: `.example` email
// domains only, 555 phone exchanges only, no real person or company.
//
// Usage:
//   node gen-messy-3000.mjs                 writes tests/fixtures/messy-3000.csv
//   node gen-messy-3000.mjs <outPath>       writes to a custom path
//   node gen-messy-3000.mjs --rows 500      overrides the bulk row count (still pads to fixed-row count if larger)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  let outPath = path.join(__dirname, "messy-3000.csv");
  let totalRows = 3000;
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--rows") {
      totalRows = parseInt(argv[i + 1], 10);
      i += 1;
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest[0]) outPath = path.resolve(rest[0]);
  return { outPath, totalRows };
}

const { outPath, totalRows } = parseArgs(process.argv.slice(2));

/** mulberry32: tiny, fast, deterministic for a fixed seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260918; // fixed: re-running this script produces byte-identical output.
const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const chance = (p) => rand() < p;

/* -------------------------------------------------------------------------- */
/* header: mixed / non-obvious names, on purpose                              */
/* -------------------------------------------------------------------------- */

const HEADERS = [
  "Customer Name", // single full-name column, no first/last split
  "Co.", // abbreviated company
  "Cell", // phone, but not spelled "Phone"
  "E-mail Address", // email, but not spelled "Email"
  "Notes/Comments", // notes, slash in the header
  "City",
  "State",
  "Zip",
  "Total Spent", // currency
  "Last Service Date", // date, three formats mixed in this column
];

/* -------------------------------------------------------------------------- */
/* data pools (invented people and businesses only)                          */
/* -------------------------------------------------------------------------- */

const FIRST_NAMES = [
  "Michael", "Jessica", "Daniel", "Ashley", "Christopher", "Amanda", "Matthew",
  "Brittany", "Joshua", "Samantha", "Andrew", "Megan", "Ryan", "Lauren",
  "Brandon", "Nicole", "Justin", "Stephanie", "Tyler", "Rachel", "Kevin",
  "Kayla", "Jordan", "Danielle", "Aaron", "Courtney", "Eric", "Whitney",
  "Jacob", "Hailey",
];
const LAST_NAMES = [
  "Turner", "Reyes", "Foster", "Bennett", "Coleman", "Ramirez", "Hayes",
  "Sanders", "Price", "Wood", "Barnes", "Ross", "Henderson", "Fitzgerald",
  "Mercer", "Holloway", "Weaver", "Pruitt", "Sawyer", "Whitfield",
];
// At least one non-ASCII name is required; a few more are sprinkled through
// the bulk rows for realism.
const NON_ASCII_NAMES = [
  ["François", "Dubé"],
  ["Renée", "Bélanger"],
  ["José", "Núñez"],
  ["Björn", "Håkansson"],
];
const TRADES = [
  "Plumbing", "Electric", "HVAC", "Roofing", "Landscaping", "Fencing",
  "Painting", "Flooring", "Pest Control", "Cleaning",
];
const SUFFIXES = ["LLC", "Inc", "Co", "& Sons", "Services", "Group"];
const CITIES = [
  "Sandy", "Provo", "Orem", "Lehi", "Ogden", "Logan", "Bountiful", "Draper",
  "Layton", "Kaysville", "Riverton", "Herriman", "Murray", "Taylorsville",
  "American Fork",
];
const AREA_CODES = ["801", "385", "435"];

function fullName(first, last) {
  return `${first} ${last}`;
}

function companyName() {
  const style = int(0, 2);
  if (style === 0) return `${pick(CITIES)} ${pick(TRADES)} ${pick(SUFFIXES)}`;
  if (style === 1) return `${pick(LAST_NAMES)} ${pick(TRADES)}`;
  return `${pick(CITIES)} ${pick(TRADES)}`;
}

function last4(n) {
  return String(n % 10000).padStart(4, "0");
}

/** One of the ordinary (non-"special") phone shapes, keyed to the same digits. */
function bulkPhone(n) {
  const area = pick(AREA_CODES);
  const digits = last4(n);
  const shape = int(0, 4);
  if (shape === 0) return `${area}-555-${digits}`;
  if (shape === 1) return `(${area}) 555-${digits}`;
  if (shape === 2) return `${area}.555.${digits}`;
  if (shape === 3) return `+1 ${area} 555 ${digits}`;
  return `${area}555${digits}`;
}

function bulkEmail(first, last, n) {
  let email = `${first.toLowerCase()}.${last.toLowerCase()}${n}@example.com`;
  if (chance(0.06)) email = email.toUpperCase();
  if (chance(0.06)) email = `  ${email}`;
  if (chance(0.06)) email = `${email}  `;
  return email;
}

function bulkCurrency() {
  const shape = int(0, 3);
  const amount = int(0, 4200);
  if (shape === 0) {
    return amount >= 1000
      ? `$${amount.toLocaleString("en-US")}.00`
      : `$${amount}.00`;
  }
  if (shape === 1) return String(amount);
  if (shape === 2) return "$0.00";
  return `(${int(50, 900)}.00)`; // a refund/credit, parens for negative
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function bulkDate() {
  const month = int(1, 12);
  const day = int(1, 28);
  const year = pick([2024, 2025, 2026]);
  const shape = int(0, 2);
  if (shape === 0) return `${month}/${day}/${year}`;
  if (shape === 1) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const NOTE_TEMPLATES = [
  (city) => `Prefers text over calls, works out of ${city} most weeks.`,
  () => `Call after 5, ask for "Dave" if he does not pick up.`,
  () => `Repeat customer, sends referrals, be responsive.`,
  () => `Left a message, said he'd call back, day or night is fine.`,
  () => `Gate code is on file, dog is friendly.`,
];

function bulkNotes(city) {
  const t = pick(NOTE_TEMPLATES);
  return t(city);
}

/* -------------------------------------------------------------------------- */
/* CSV field quoting                                                          */
/* -------------------------------------------------------------------------- */

function csvField(value) {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toLine(cells) {
  return cells.map(csvField).join(",");
}

/* -------------------------------------------------------------------------- */
/* rows: an array of 10-cell arrays, in file order                            */
/* -------------------------------------------------------------------------- */

const rows = [];

/** Fixed rows covering every required edge case literally. */
function pushFixed(cells) {
  rows.push(cells);
}

// 1) The five required phone shapes, each on its own otherwise-normal row.
pushFixed(["Wendy Sorensen", "", "801-555-0142 ext 2", "wendy.sorensen@example.com", "", "Sandy", "UT", "84070", "$450.00", "3/14/2026"]);
pushFixed(["Marcus Webb", "Webb Electric LLC", "(385) 555-0199 x14", "marcus.webb@example.com", "", "Provo", "UT", "84601", "1200", "2026-03-14"]);
pushFixed(["Diane Okafor", "", "801.555.CALL", "diane.okafor@example.com", "", "Ogden", "UT", "84401", "$0.00", "14 Mar 2026"]);
pushFixed(["Patrick Yates", "", "+1 435 555 0117", "patrick.yates@example.com", "", "Logan", "UT", "84321", "(500.00)", "2026-04-02"]);
pushFixed(["Carla Jimenez", "Jimenez Roofing", "8015550188", "carla.jimenez@example.com", "", "Lehi", "UT", "84043", "$1,200.00", "4/2/2026"]);

// 2) Email casing / whitespace quirks, explicit.
pushFixed(["Sarah Mitchell", "", "801-555-0201", "  sarah.mitchell@EXAMPLE.com", "", "Draper", "UT", "84020", "$780.00", "2026-01-09"]);
pushFixed(["Bob Larkin", "", "801-555-0202", "BOB.LARKIN@EXAMPLE.COM  ", "", "Bountiful", "UT", "84010", "300", "1/9/2026"]);

// 3) Non-ASCII name (required at least one).
pushFixed(["François Dubé", "Dubé Fencing", "385-555-0311", "francois.dube@example.com", "Speaks French at home, no issue in English.", "Layton", "UT", "84040", "$920.00", "9 Jan 2026"]);

// 4) One row with only a company name and nothing else.
pushFixed(["", "Wasatch Front Handyman Co", "", "", "", "", "", "", "", ""]);

// 5) Rows that are just commas (all fields blank, but the row is not empty).
pushFixed(["", "", "", "", "", "", "", "", "", ""]);
pushFixed(["", "", "", "", "", "", "", "", "", ""]);
pushFixed(["", "", "", "", "", "", "", "", "", ""]);

// 6) Embedded commas and escaped double quotes, beyond the "Dave" note above.
pushFixed(["Priya Chandrasekaran", "Chandrasekaran, Reyes & Sons Plumbing", "801-555-0455", "priya.c@example.com", `Told us to leave the gate open, "just knock loud" if the dog is barking.`, "Murray", "UT", "84107", "$1,845.00", "2025-11-22"]);
pushFixed(["Owen Bright", 'Bright "The Fence Guys" Fencing', "801-555-0456", "owen.bright@example.com", "", "Riverton", "UT", "84065", "640", "11/22/2025"]);

// 7) Exact duplicate rows: this row appears twice, byte for byte. The first
// copy goes in now; the second is spliced in far away from it, after the
// bulk rows are generated below, the way a real export actually repeats a
// row (pasted twice, exported twice, synced twice) rather than back to back.
const EXACT_DUP = ["Melissa Nakamura", "Nakamura Landscaping", "801-555-0512", "melissa.nakamura@example.com", "Seasonal client, spring and fall only.", "Herriman", "UT", "84096", "$1,340.00", "2026-04-18"];
pushFixed(EXACT_DUP);

// 8) Near-duplicate rows: same email, different name spelling / phone format.
pushFixed(["Katherine Osei", "Osei Cleaning Services", "801-555-0623", "k.osei@example.com", "", "Taylorsville", "UT", "84123", "$210.00", "2026-02-05"]);
pushFixed(["Kathy Osei", "Osei Cleaning", "(801) 555-0623", "k.osei@example.com", "", "Taylorsville", "UT", "84123", "$210.00", "2/5/2026"]);

pushFixed(["Anthony DiMarco", "DiMarco Painting LLC", "385.555.0734", "adimarco@example.com", "", "American Fork", "UT", "84003", "980", "2026-03-30"]);
pushFixed(["Tony DiMarco", "DiMarco Painting", "3855550734", "adimarco@example.com", "", "American Fork", "UT", "84003", "$980.00", "30 Mar 2026"]);

pushFixed(["Grace Whitfield", "", "801-555-0845", "gracew@example.com", "Referred by James Whitfield.", "Kaysville", "UT", "84037", "$0.00", "2026-01-15"]);
pushFixed(["Grace M Whitfield", "", "801 555 0845", "gracew@example.com", "Referred by James Whitfield.", "Kaysville", "UT", "84037", "$0.00", "1/15/2026"]);

const FIXED_COUNT = rows.length;

/* -------------------------------------------------------------------------- */
/* bulk rows: fill the rest with realistic, varied messiness                  */
/* -------------------------------------------------------------------------- */

const bulkTarget = Math.max(0, totalRows - FIXED_COUNT);
for (let i = 0; i < bulkTarget; i += 1) {
  const useNonAscii = chance(0.01);
  const [first, last] = useNonAscii ? pick(NON_ASCII_NAMES) : [pick(FIRST_NAMES), pick(LAST_NAMES)];
  const name = chance(0.02) ? "" : fullName(first, last);
  const co = chance(0.2) ? "" : companyName();
  const cell = chance(0.08) ? "" : bulkPhone(i);
  const email = chance(0.08) ? "" : bulkEmail(first, last, i);
  const city = pick(CITIES);
  const notes = chance(0.55) ? "" : bulkNotes(city);
  const cityCell = chance(0.1) ? "" : city;
  const state = chance(0.1) ? "" : "UT";
  const zip = chance(0.15) ? "" : String(int(84001, 84999));
  const spent = chance(0.12) ? "" : bulkCurrency();
  const lastService = chance(0.15) ? "" : bulkDate();

  rows.push([name, co, cell, email, notes, cityCell, state, zip, spent, lastService]);
}

/* -------------------------------------------------------------------------- */
/* a couple more exact/near duplicates drawn from the bulk, so duplicate      */
/* handling is exercised against generated data too, not only the fixed rows */
/* -------------------------------------------------------------------------- */

if (rows.length > FIXED_COUNT + 20) {
  // The deliberate exact duplicate (Melissa Nakamura, row 0 above): spliced in
  // far from its first appearance, byte for byte.
  rows[rows.length - 20] = [...EXACT_DUP];

  // A second exact duplicate, this one drawn from a generated bulk row, so
  // duplicate handling is exercised against generated data too.
  const sourceIdx = FIXED_COUNT + 5;
  const targetIdx = rows.length - 3;
  if (rows[sourceIdx][3]) {
    rows[targetIdx] = [...rows[sourceIdx]];
  }

  // Near duplicate: same email, reformatted phone, tweaked name.
  const nearSourceIdx = FIXED_COUNT + 12;
  const nearTargetIdx = rows.length - 7;
  const src = rows[nearSourceIdx];
  if (src[3]) {
    const [firstWord, ...restWords] = src[0].split(" ");
    rows[nearTargetIdx] = [
      `${firstWord[0]}. ${restWords.join(" ")}`.trim() || src[0],
      src[1],
      src[2].replace(/[^0-9+]/g, "").replace(/^1?(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3"),
      src[3],
      src[4],
      src[5],
      src[6],
      src[7],
      src[8],
      src[9],
    ];
  }
}

/* -------------------------------------------------------------------------- */
/* write: BOM, header, CRLF rows, with a few genuinely blank lines mixed in   */
/* -------------------------------------------------------------------------- */

async function main() {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const start = Date.now();
  const stream = fs.createWriteStream(outPath);

  const write = (chunk) =>
    new Promise((resolve, reject) => {
      const ok = stream.write(chunk, (err) => (err ? reject(err) : undefined));
      if (ok) resolve();
      else stream.once("drain", resolve);
    });

  await write("﻿"); // UTF-8 BOM
  await write(toLine(HEADERS) + "\r\n");

  // A handful of completely empty lines, spaced through the file. These sit
  // outside the counted data-row total: papaparse's greedy skipEmptyLines
  // (which the real importer uses) drops them before they ever reach a row
  // handler, so they test "the parser tolerates blank lines" rather than
  // "the importer files a blank row somewhere."
  const blankLineAfter = new Set([50, 500, 1500, rows.length - 1]);

  for (let i = 0; i < rows.length; i += 1) {
    await write(toLine(rows[i]) + "\r\n");
    if (blankLineAfter.has(i)) await write("\r\n");
  }

  await new Promise((resolve, reject) => {
    stream.end((err) => (err ? reject(err) : resolve()));
  });

  const elapsedMs = Date.now() - start;
  const { size } = fs.statSync(outPath);
  console.log(`wrote ${rows.length} data rows (+${blankLineAfter.size} blank lines) to ${outPath}`);
  console.log(`elapsed: ${elapsedMs}ms`);
  console.log(`size: ${size} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
