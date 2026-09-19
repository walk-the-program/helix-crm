/**
 * Proves docs/PLAN.md item 7's claim - "results in under 50 ms on 10k
 * contacts" - against the real FTS5 index (drizzle/0001_search.sql) through
 * the real search repository (src/db/repos/search.ts).
 *
 * The 10,000 contacts are seeded the way docs/PLAN.md says the CSV import
 * seeds them: contacts.createStatements(...) built up front, sent as batches
 * of 500 through raw.batch(...), inside one raw.begin()/raw.commit() so the
 * whole load is a single transaction (each batch nests as a SAVEPOINT once
 * the transaction is open - see driver.ts). Nothing here writes to
 * search_docs or search_index directly; the same triggers that back a single
 * contacts.create() call (see ../search.test.ts) do the indexing, just at
 * 10k-row scale, which is the point: if the triggers ever get slow or stop
 * firing under bulk load, this is where it would show up.
 *
 * contacts.createStatements() already covers phones and emails (it calls the
 * same phoneRows()/emailRows() helpers create() does) and skips the change
 * log, which is exactly what bulk-loading 10k rows needs - contacts.create()
 * would take the write lock and log a change_log row per call and blow the
 * 30s hook timeout.
 *
 * Every field is derived from the row index, not from Math.random(): a
 * failure reproduces from the index alone, and the fixture is auditable by
 * reading the generator functions below.
 *
 * What this does NOT prove: this is better-sqlite3 running in the same
 * process as the test, not the Rust pipe crossing an IPC boundary to a
 * separately compiled SQLite build on a customer's laptop. It measures
 * whether the SQL plan and the FTS5 index (bm25 ranking + the unicode61
 * tokenizer) stay fast at 10k rows - not the Tauri invoke() round trip, cold
 * disk cache, or a slower CPU. A pass here means the index shape is sound,
 * not that the on-screen number in the shipped app will match it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw, type BatchStatement } from "../../../src/db/client";
import * as search from "../../../src/db/repos/search";
import * as contacts from "../../../src/db/repos/contacts";
import { insertStatement } from "../../../src/db/repos/_base";
import { newId } from "../../../src/lib/ids";
import { nowIso } from "../../../src/lib/dates";

/* -------------------------------------------------------------------------- */
/* fixture generation - every field derives from the row index                */
/* -------------------------------------------------------------------------- */

const TOTAL_CONTACTS = 10_000;
const BATCH_SIZE = 500;

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph",
  "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Nancy",
  "Matthew", "Lisa", "Anthony",
] as const;

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson",
  "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez",
  "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis",
  "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres",
  "Nguyen", "Hill", "Flores",
] as const;

const COMPANY_NAMES = [
  "Anchor Fabrication", "Bluepeak Logistics", "Cedarline Roofing",
  "Driftwood Media", "Eastgate Analytics", "Fernbank Robotics",
  "Granite Hollow Supply", "Harborlight Insurance", "Ironvale Construction",
  "Junction Freight", "Kestrel Biotech", "Lonestar Utilities",
  "Meridian Outfitters", "Northfork Energy", "Overlook Hospitality",
  "Pinehurst Realty", "Quarrystone Materials", "Ridgeline Security",
  "Silverton Foods", "Timberline Systems",
] as const;

const AREA_CODES = [
  "202", "212", "213", "305", "312", "404", "415", "512", "617", "702", "818",
  "929",
] as const;

// One contact, planted near the middle of the range, with a surname that
// exists nowhere else in the fixture - proves an exact, single-hit match.
const RARE_SURNAME = "Kilbrennan";
const RARE_INDEX = 5000;

// A dozen contacts sharing a second invented surname - proves the index
// returns the whole cluster, not just the first page of it.
const CLUSTER_SURNAME = "Ashgrove";
const CLUSTER_START = 3000;
const CLUSTER_SIZE = 12;
const CLUSTER_INDICES = Array.from(
  { length: CLUSTER_SIZE },
  (_, k) => CLUSTER_START + k,
);

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function nameFor(i: number): { firstName: string; lastName: string } {
  if (i === RARE_INDEX) {
    return { firstName: FIRST_NAMES[i % FIRST_NAMES.length], lastName: RARE_SURNAME };
  }
  if (CLUSTER_INDICES.includes(i)) {
    return { firstName: FIRST_NAMES[i % FIRST_NAMES.length], lastName: CLUSTER_SURNAME };
  }
  // Cycling through both pools means the same first+last combination repeats
  // every FIRST_NAMES.length * LAST_NAMES.length rows (here, every 1,000), so
  // a two-token "first last" query is selective (~10 hits) instead of either
  // trivial or a full scan.
  return {
    firstName: FIRST_NAMES[i % FIRST_NAMES.length],
    lastName: LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length],
  };
}

function areaCodeFor(i: number): string {
  return AREA_CODES[i % AREA_CODES.length];
}

/** The last four digits are the row index itself, so they are unique across
 * all 10,000 rows - handy for an unambiguous "numeric fragment" query. */
function phoneFor(i: number): string {
  return `(${areaCodeFor(i)}) 555-${String(i).padStart(4, "0")}`;
}

function emailFor(i: number, firstName: string, lastName: string): string {
  return `${slug(`${firstName}.${lastName}.${i}`)}@example.com`;
}

type CompanyRow = { id: string; name: string };

/** A small pool of real company rows, so "on some contacts" means an actual
 * FK to `companies`, not a free-text field (contacts has no such column -
 * search reads the company name back through the join, see search_contacts_ai
 * in drizzle/0001_search.sql). */
function companyStatements(): { rows: CompanyRow[]; statements: BatchStatement[] } {
  const at = nowIso();
  const rows: CompanyRow[] = [];
  const statements = COMPANY_NAMES.map((name) => {
    const id = newId();
    rows.push({ id, name });
    return insertStatement("companies", {
      id,
      name,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
  });
  return { rows, statements };
}

type ContactFixture = {
  statements: BatchStatement[];
  rareId: string;
  clusterIds: string[];
};

function contactStatements(companyRows: CompanyRow[]): ContactFixture {
  const statements: BatchStatement[] = [];
  let rareId = "";
  const clusterIds: string[] = [];

  for (let i = 0; i < TOTAL_CONTACTS; i++) {
    const { firstName, lastName } = nameFor(i);
    const hasCompany = i % 4 === 0; // "some" contacts have a company
    const hasPhone = i % 10 !== 0; // "most" contacts have a phone
    const company = hasCompany ? companyRows[i % companyRows.length] : null;

    const built = contacts.createStatements({
      firstName,
      lastName,
      companyId: company ? company.id : null,
      emails: [{ email: emailFor(i, firstName, lastName), isPrimary: true }],
      phones: hasPhone ? [{ raw: phoneFor(i), isPrimary: true }] : [],
    });

    statements.push(...built.statements);
    if (i === RARE_INDEX) rareId = built.id;
    if (CLUSTER_INDICES.includes(i)) clusterIds.push(built.id);
  }

  return { statements, rareId, clusterIds };
}

/* -------------------------------------------------------------------------- */
/* timing helper                                                              */
/* -------------------------------------------------------------------------- */

const TIMED_RUNS = 7;
const BUDGET_MS = 50;

/** One discarded warm-up run (statement preparation, page cache), then the
 * median of TIMED_RUNS - a median shrugs off one slow tick from the test
 * runner's own GC or scheduling in a way a mean or a min cannot. */
async function medianDuration<T>(
  fn: () => Promise<T[]>,
): Promise<{ medianMs: number; resultCount: number }> {
  await fn();

  const durations: number[] = [];
  let resultCount = 0;
  for (let i = 0; i < TIMED_RUNS; i++) {
    const start = performance.now();
    const result = await fn();
    durations.push(performance.now() - start);
    resultCount = result.length;
  }

  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const medianMs =
    durations.length % 2 === 0
      ? (durations[mid - 1] + durations[mid]) / 2
      : durations[mid];
  return { medianMs, resultCount };
}

function logTable(rows: { label: string; medianMs: number; count: number }[]): void {
  console.log(`${"query".padEnd(28)}${"median ms".padStart(12)}${"hits".padStart(8)}`);
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(28)}${r.medianMs.toFixed(3).padStart(12)}${String(r.count).padStart(8)}`,
    );
  }
}

// A contact that is neither the rare plant nor in the cluster, used to derive
// the "two-token" and "phone fragment" queries below from the same
// index-driven generator as everything else.
const SAMPLE_INDEX = 4242;
const sampleName = nameFor(SAMPLE_INDEX);
const SAMPLE_TWO_TOKEN = `${sampleName.firstName} ${sampleName.lastName}`;
const SAMPLE_PHONE_FRAGMENT = String(SAMPLE_INDEX).padStart(4, "0");

const QUERIES: { label: string; text: string }[] = [
  { label: "rare surname", text: RARE_SURNAME },
  { label: "common first name", text: FIRST_NAMES[0] },
  { label: "two-token first+last", text: SAMPLE_TWO_TOKEN },
  { label: "numeric phone fragment", text: SAMPLE_PHONE_FRAGMENT },
  { label: "prefix 'joh'", text: "joh" },
];

/* -------------------------------------------------------------------------- */
/* the suite                                                                  */
/* -------------------------------------------------------------------------- */

describe("search: FTS5 stays under the 50 ms budget at 10k contacts (docs/PLAN.md item 7)", () => {
  let h: Harness | null = null;
  let rareId = "";
  let clusterIds: string[] = [];

  beforeAll(async () => {
    h = await createSeededHarness();

    const { rows: companyRows, statements: companyStmts } = companyStatements();
    const built = contactStatements(companyRows);
    rareId = built.rareId;
    clusterIds = built.clusterIds;

    // Companies first (they carry no dependency), then contacts - contacts
    // reference company_id under foreign_keys = ON, and SQLite checks that
    // immediately per statement, not just at commit, so every company row
    // must exist before the first contact statement that points at it. Both
    // land in a single combined list so that invariant holds across batch
    // boundaries too.
    const allStatements: BatchStatement[] = [...companyStmts, ...built.statements];

    const seedStart = performance.now();
    await raw.begin();
    try {
      for (let offset = 0; offset < allStatements.length; offset += BATCH_SIZE) {
        await raw.batch(allStatements.slice(offset, offset + BATCH_SIZE));
      }
      await raw.commit();
    } catch (err) {
      await raw.rollback();
      throw err;
    }
    const seedMs = performance.now() - seedStart;
    console.log(
      `[search10k] seeded ${TOTAL_CONTACTS} contacts + ${COMPANY_NAMES.length} companies ` +
        `(${allStatements.length} statements) in ${seedMs.toFixed(1)} ms`,
    );
  });

  afterAll(() => {
    h?.dispose();
    h = null;
  });

  it("populates the FTS index for every seeded contact", async () => {
    const counts = await search.indexCounts();
    const contactCount = counts.find((c) => c.entityType === "contact")?.count ?? 0;
    expect(
      contactCount,
      "search_docs reports 0 (or too few) contact rows - the insert triggers in " +
        "drizzle/0001_search.sql did not fire, so any timing number below would be " +
        "measuring an empty index, not a real one",
    ).toBeGreaterThanOrEqual(TOTAL_CONTACTS);
  });

  it("finds the one contact with the rare surname, and only that one", async () => {
    const hits = await search.search(RARE_SURNAME);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entityId).toBe(rareId);
    expect(hits[0]?.entityType).toBe("contact");
  });

  it("finds every contact in the known cluster", async () => {
    const hits = await search.search(CLUSTER_SURNAME, { limit: CLUSTER_SIZE + 5 });
    expect(hits).toHaveLength(CLUSTER_SIZE);
    expect(new Set(hits.map((h2) => h2.entityId))).toEqual(new Set(clusterIds));
  });

  it("groups the cluster's hits under the contact type in searchGrouped", async () => {
    const groups = await search.searchGrouped(CLUSTER_SURNAME, {
      limit: CLUSTER_SIZE + 5,
      perType: CLUSTER_SIZE + 5,
    });
    expect(groups.map((g) => g.entityType)).toEqual(["contact"]);
    const [group] = groups;
    expect(group?.hits).toHaveLength(CLUSTER_SIZE);
    for (const hit of group?.hits ?? []) {
      expect(hit.entityType).toBe("contact");
    }
  });

  it("keeps the median under 50 ms for every representative query", async () => {
    const rows: { label: string; medianMs: number; count: number }[] = [];
    for (const q of QUERIES) {
      const { medianMs, resultCount } = await medianDuration(() => search.search(q.text));
      rows.push({ label: q.label, medianMs, count: resultCount });
    }

    logTable(rows);

    for (const r of rows) {
      expect(
        r.medianMs,
        `"${r.label}" median was ${r.medianMs.toFixed(3)} ms across ${TIMED_RUNS} runs ` +
          `(${r.count} hits) - docs/PLAN.md item 7 claims under ${BUDGET_MS} ms`,
      ).toBeLessThan(BUDGET_MS);
    }
  });
});
