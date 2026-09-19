#!/usr/bin/env node
// Export Walker's ClearPath outreach prospects as a CSV that Helix can import.
//
// This is a one-time bridge, not a sync. The ClearPath CRM (a small Node app
// under "ClearPath Sites/crm") is the source of truth for outreach until Helix
// takes over; this reads its prospects file and writes the same people out in
// Helix's import shape. The source file is opened read-only and is never
// written, moved or touched in any other way. The output also stays inside
// "ClearPath Sites/crm/data" — Walker's private outreach data never gets
// written into this (public) repo; tests/fixtures/clearpath-prospects.csv is
// a synthetic, hand-authored fixture and is not touched by this script.
//
//   node tools/import-clearpath-crm.mjs
//   node tools/import-clearpath-crm.mjs --in <path> --out <path>
//   node tools/import-clearpath-crm.mjs --out /custom/path.csv
//
// Zero dependencies: node: builtins only.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_IN = "/Users/walker_tracy/Desktop/ClearPath Sites/crm/data/prospects.json";
const DEFAULT_OUT = "/Users/walker_tracy/Desktop/ClearPath Sites/crm/data/helix-import.csv";

/** Helix's default pipeline stages, keyed by ClearPath's outreach status. */
const STAGE_BY_STATUS = new Map([
  ["new", "New"],
  ["researched", "New"],
  ["demo_building", "New"],
  ["awaiting_demo", "New"],
  ["demo_ready", "New"],
  ["outreach_ready", "New"],
  ["sent", "Contacted"],
  ["replied", "Quoted"],
  ["call_scheduled", "Scheduled"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["dropped", "Lost"],
  ["held", "Lost"],
]);

/** Every deal is the same offer: a site build. */
const DEAL_VALUE = 1500;

const HEADER = [
  "First name",
  "Last name",
  "Company",
  "Email",
  "Phone",
  "City",
  "State",
  "Deal title",
  "Deal stage",
  "Deal value",
  "Source",
  "Notes",
  "Tags",
];

// ---------------------------------------------------------------------------

/**
 * "Alex Vargas" -> ["Alex", "Vargas"]; "Manuel" -> ["Manuel", ""].
 * A middle name or a suffix stays with the last name rather than being dropped:
 * these are names Walker will read, not keys anything joins on.
 */
function splitName(full) {
  const parts = String(full ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return ["", ""];
  if (parts.length === 1) return [parts[0], ""];
  return [parts[0], parts.slice(1).join(" ")];
}

/** The region reads "Utah / Mountain West"; Helix wants the postal code. */
function stateOf(prospect) {
  const region = String(prospect.geo?.region ?? "");
  if (/utah/i.test(region)) return "UT";
  const match = /\b([A-Z]{2})\b/.exec(region);
  return match ? match[1] : "";
}

/**
 * Everything worth carrying over that has no column of its own: the gap that
 * made them a prospect, the scout's notes, the second contact, and the two
 * links. Joined with " | " because the notes field already uses that.
 */
function notesOf(prospect) {
  const parts = [];
  if (prospect.gap) parts.push(`Gap: ${String(prospect.gap).trim()}`);
  if (prospect.notes) parts.push(String(prospect.notes).trim());

  const alt = [prospect.contact?.altName, prospect.contact?.altPhone].filter(Boolean).join(" ");
  if (alt) parts.push(`Second contact: ${alt}`);

  if (prospect.websiteUrl) parts.push(`Site: ${prospect.websiteUrl}`);
  if (prospect.yelpUrl) parts.push(`Yelp: ${prospect.yelpUrl}`);

  return parts.join(" | ");
}

/**
 * The mapped stage loses the detail of where in outreach they were, so the
 * original status rides along as a tag on every row, not only on the lost
 * ones. The niche tag makes the whole batch selectable in Helix later.
 */
function tagsOf(prospect) {
  const tags = ["clearpath"];
  if (prospect.niche) tags.push(String(prospect.niche));
  if (prospect.status) tags.push(String(prospect.status));
  return tags.join(";");
}

/** RFC 4180: quote every field, double the quotes inside. */
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r\n|\r|\n/g, " ")}"`;
}

function toRow(prospect, warnings) {
  const status = String(prospect.status ?? "").trim();
  const stage = STAGE_BY_STATUS.get(status);
  if (!stage) warnings.push(`${prospect.id ?? prospect.business}: unknown status "${status}", filed as New`);

  const [first, last] = splitName(prospect.contact?.name);
  const business = String(prospect.business ?? "").trim();

  return [
    first,
    last,
    business,
    prospect.contact?.email ?? prospect.email ?? "",
    prospect.contact?.phone ?? "",
    prospect.geo?.city ?? "",
    stateOf(prospect),
    business ? `${business} website` : "Website",
    stage ?? "New",
    DEAL_VALUE,
    "Import",
    notesOf(prospect),
    tagsOf(prospect),
  ];
}

// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      in: { type: "string", default: DEFAULT_IN },
      out: { type: "string", default: DEFAULT_OUT },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      [
        "Export ClearPath outreach prospects as a Helix import CSV.",
        "",
        "  --in <path>   prospects.json (read-only)",
        `                default: ${DEFAULT_IN}`,
        "  --out <path>  where to write the CSV",
        `                default: ${DEFAULT_OUT}`,
      ].join("\n"),
    );
    return;
  }

  const raw = await readFile(values.in, "utf8");
  const data = JSON.parse(raw);
  const prospects = Array.isArray(data.prospects) ? data.prospects : [];
  if (prospects.length === 0) throw new Error(`No prospects in ${values.in}`);

  const warnings = [];
  const rows = prospects.map((prospect) => toRow(prospect, warnings));

  // CRLF, because that is what every spreadsheet writes and what Helix's own
  // export produces.
  const csv = [HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, csv, "utf8");

  const byStage = new Map();
  for (const row of rows) byStage.set(row[8], (byStage.get(row[8]) ?? 0) + 1);
  const stageSummary = [...byStage.entries()].map(([stage, n]) => `${stage} ${n}`).join(", ");

  for (const warning of warnings) console.warn(`[import] ${warning}`);
  console.log(`[import] ${rows.length} rows -> ${values.out}`);
  console.log(`[import] stages: ${stageSummary}`);
  console.log(`[import] source unchanged: ${values.in}`);
}

main().catch((err) => {
  console.error(`[import] ${err?.message ?? err}`);
  process.exit(1);
});
