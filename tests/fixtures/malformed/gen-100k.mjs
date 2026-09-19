#!/usr/bin/env node
// Zero-dependency ESM script that streams a large synthetic CSV fixture.
// Header matches tests/fixtures/hubspot-contacts.csv.
//
// Usage:
//   node gen-100k.mjs                  writes tests/fixtures/malformed/100k.csv (100000 rows)
//   node gen-100k.mjs <outPath>        writes to a custom path
//   node gen-100k.mjs --rows 1000      overrides the row count
//   node gen-100k.mjs <outPath> --rows 1000
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  let outPath = path.join(__dirname, '100k.csv');
  let rows = 100000;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rows') {
      rows = parseInt(argv[++i], 10);
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest[0]) outPath = path.resolve(rest[0]);
  return { outPath, rows };
}

const { outPath, rows } = parseArgs(process.argv.slice(2));

const HEADER = ['Record ID', 'First Name', 'Last Name', 'Email', 'Phone Number',
  'Mobile Phone Number', 'Associated Company', 'Job Title', 'City',
  'State/Region', 'Postal Code', 'Country/Region', 'Contact owner',
  'Lead Status', 'Create Date', 'Last Activity Date', 'Original Traffic Source',
  'Website URL'].join(',') + '\r\n';

const FIRST_NAMES = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
const CITIES = ['Sandy', 'Provo', 'Orem', 'Lehi', 'Ogden', 'Logan', 'Bountiful', 'Draper', 'Layton', 'Kaysville'];
const STATUSES = ['New', 'Open', 'In Progress', 'Unqualified', 'Customer'];
const SOURCES = ['Organic Search', 'Paid Search', 'Referral', 'Direct Traffic', 'Organic Social'];

function row(i) {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
  const city = CITIES[(i * 3) % CITIES.length];
  const status = STATUSES[i % STATUSES.length];
  const source = SOURCES[(i * 5) % SOURCES.length];
  const phone = `801-555-${String(i % 10000).padStart(4, '0')}`;
  const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`;
  const fields = [
    100000 + i,
    first,
    last,
    email,
    phone,
    '',
    `${city} Services LLC`,
    'Owner',
    city,
    'UT',
    84000 + (i % 999),
    'United States',
    'Mike Turner',
    status,
    '2026-01-01',
    '2026-01-02 09:00',
    source,
    `https://www.${last.toLowerCase()}${i}.com`,
  ];
  return fields.map((f) => {
    const s = String(f);
    return /[,"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',') + '\r\n';
}

async function main() {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const start = Date.now();
  const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });

  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.write(HEADER, (err) => (err ? reject(err) : resolve()));
  });

  for (let i = 0; i < rows; i++) {
    const ok = stream.write(row(i));
    if (!ok) {
      await new Promise((resolve, reject) => {
        stream.once('drain', resolve);
        stream.once('error', reject);
      });
    }
  }

  await new Promise((resolve, reject) => {
    stream.end((err) => (err ? reject(err) : resolve()));
  });

  const elapsedMs = Date.now() - start;
  const { size } = fs.statSync(outPath);
  console.log(`wrote ${rows} rows to ${outPath}`);
  console.log(`elapsed: ${elapsedMs}ms`);
  console.log(`size: ${size} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
