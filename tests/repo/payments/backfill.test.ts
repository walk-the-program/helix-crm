/**
 * THE acceptance test for PX-5: a workspace upgraded from migration 0005 to
 * 0006 reads exactly the same money it read before the upgrade.
 *
 * A subtlety worth spelling out before the seeding code, because it shapes
 * everything below: `src/db/repos/money.ts` and `src/db/repos/receivables.ts`
 * are the CURRENT production code, and both now join the `payments` table on
 * every query. A SQLite statement that references a table is refused at
 * PREPARE time if the table does not exist yet, whether or not that branch of
 * the query would ever run - so the real `money.ts`/`receivables.ts` cannot
 * be called at all against a database that is still on migration 0005, no
 * matter what data is or isn't in it.
 *
 * So "read every figure before the upgrade" cannot mean "call today's
 * `dealMoney` before running 0006" - that call would throw "no such table:
 * payments" regardless of the seed. What it means, and what this test does,
 * is: reproduce the OLD formula (documents.status-driven, no payments table,
 * exactly what shipped before this round - see the git history of
 * `money.ts`/`receivables.ts` for the literal text) as plain SQL, run it
 * against the workspace while it is still on 0005, then run the real 0006
 * migration (which is what actually backfills a `payments` row for every
 * already-paid invoice) and call the real, current `money.ts` /
 * `receivables.ts` afterwards. If the backfill is right, the two must match
 * field by field - which is exactly what `drizzle/0006_payments.sql`'s own
 * comment promises this file proves.
 *
 * Quoted/Open/Won never move (they are pure `deals` arithmetic the migration
 * never touches) so their equality is a trivial but real check that nothing
 * about the deal side regressed; Invoiced/Collected/Outstanding are where the
 * backfill actually has to do its job.
 */
import { afterEach, describe, expect, it } from "vitest";
import { raw, setDriver } from "../../../src/db/client";
import { migrate, type MigrationSource } from "../../../src/db/migrator";
import { __resetWriteLockForTests } from "../../../src/db/writeLock";
import { createTestDriver, type TestDriver } from "../driver";
import { diskMigrationSource } from "../harness";
import * as documents from "../../../src/db/repos/documents";
import * as payments from "../../../src/db/repos/payments";
import * as deals from "../../../src/db/repos/deals";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as money from "../../../src/db/repos/money";
import { bucketFor, AGING_BUCKETS, type Aging } from "../../../src/db/repos/receivables";
import * as receivables from "../../../src/db/repos/receivables";
import { toDateInputValue } from "../../../src/lib/periods";
import { nowIso } from "../../../src/lib/dates";

/* -------------------------------------------------------------------------- */
/* a driver stopped at a chosen migration                                     */
/* -------------------------------------------------------------------------- */

let driver: TestDriver | null = null;
afterEach(() => {
  __resetWriteLockForTests();
  driver?.dispose();
  driver = null;
});

async function sourceThroughTag(tag: string): Promise<MigrationSource> {
  const all = await diskMigrationSource.list();
  const index = all.findIndex((f) => f.tag === tag);
  if (index === -1) throw new Error(`No migration is tagged ${tag}.`);
  const files = all.slice(0, index + 1);
  return { async list() { return files; } };
}

/**
 * Boots a fresh in-memory database on exactly the migrations through `tag`,
 * then applies the same first-boot seed (one pipeline, six stages, four
 * sources) every real workspace gets - `pipelines`/`stages`/`sources` predate
 * migration 0005 by a wide margin, so this is safe well before payments
 * exists.
 */
async function bootAt(tag: string): Promise<void> {
  __resetWriteLockForTests();
  driver = createTestDriver(":memory:");
  setDriver(driver);
  await migrate({ source: await sourceThroughTag(tag), backup: false });
  const { seedWorkspace } = await import("../../../src/db/repos/seed");
  await seedWorkspace();
}

/** Applies every migration from where the database currently sits through `tag`. */
async function upgradeThrough(tag: string): Promise<void> {
  await migrate({ source: await sourceThroughTag(tag), backup: false });
}

/* -------------------------------------------------------------------------- */
/* the OLD formula, reproduced as plain SQL (see the file header)             */
/* -------------------------------------------------------------------------- */

const OLD_INVOICED = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status IN ('sent', 'paid')`;
const OLD_COLLECTED = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status = 'paid' AND d.paid_on IS NOT NULL`;
const OLD_OUTSTANDING = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status = 'sent'`;
const OPEN_DEAL = `dl.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0`;

type LegacyMoney = {
  quotedCents: number;
  openCents: number;
  wonCents: number;
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
};

function sumOf(rows: unknown[][], index: number): number {
  if (rows.length === 0) return 0;
  const value = rows[0][index];
  return value === null || value === undefined ? 0 : Number(value);
}

async function legacyDocumentSums(scope: string, params: (string | number | null)[]) {
  const rows = await raw.query(
    `SELECT coalesce(sum(CASE WHEN ${OLD_INVOICED}    THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
            coalesce(sum(CASE WHEN ${OLD_COLLECTED}   THEN d.total_cents ELSE 0 END), 0) AS collected_cents,
            coalesce(sum(CASE WHEN ${OLD_OUTSTANDING} THEN d.total_cents ELSE 0 END), 0) AS outstanding_cents
     FROM documents d WHERE ${scope}`,
    params,
  );
  return { invoiced: sumOf(rows, 0), collected: sumOf(rows, 1), outstanding: sumOf(rows, 2) };
}

async function legacyDealValueSums(scope: string, params: (string | number | null)[]) {
  const rows = await raw.query(
    `SELECT coalesce(sum(dl.value_cents), 0) AS quoted_cents,
            coalesce(sum(CASE WHEN ${OPEN_DEAL} THEN dl.value_cents ELSE 0 END), 0) AS open_cents,
            coalesce(sum(CASE WHEN s.is_won = 1 THEN dl.value_cents ELSE 0 END), 0) AS won_cents
     FROM deals dl JOIN stages s ON s.id = dl.stage_id
     WHERE dl.deleted_at IS NULL AND ${scope}`,
    params,
  );
  return { quoted: sumOf(rows, 0), open: sumOf(rows, 1), won: sumOf(rows, 2) };
}

async function legacyDealMoney(dealId: string): Promise<LegacyMoney> {
  const [docs, value] = await Promise.all([
    legacyDocumentSums(`d.deal_id = ?`, [dealId]),
    legacyDealValueSums(`dl.id = ?`, [dealId]),
  ]);
  return {
    quotedCents: value.quoted,
    openCents: value.open,
    wonCents: value.won,
    invoicedCents: docs.invoiced,
    collectedCents: docs.collected,
    outstandingCents: docs.outstanding,
  };
}

async function legacyCustomerMoney(ref: { contactId?: string | null; companyId?: string | null }): Promise<LegacyMoney> {
  const contactId = ref.contactId ?? null;
  const companyId = ref.companyId ?? null;
  if (contactId === null && companyId === null) {
    return { quotedCents: 0, openCents: 0, wonCents: 0, invoicedCents: 0, collectedCents: 0, outstandingCents: 0 };
  }
  const clauses: string[] = [];
  const params: (string | null)[] = [];
  if (contactId !== null) {
    clauses.push(`%PREFIX%.contact_id = ?`);
    params.push(contactId);
  }
  if (companyId !== null) {
    clauses.push(`%PREFIX%.company_id = ?`);
    params.push(companyId);
  }
  const shape = `(${clauses.join(" OR ")})`;
  const [docs, value] = await Promise.all([
    legacyDocumentSums(shape.replaceAll("%PREFIX%", "d"), [...params]),
    legacyDealValueSums(shape.replaceAll("%PREFIX%", "dl"), [...params]),
  ]);
  return {
    quotedCents: value.quoted,
    openCents: value.open,
    wonCents: value.won,
    invoicedCents: docs.invoiced,
    collectedCents: docs.collected,
    outstandingCents: docs.outstanding,
  };
}

async function legacyPeriodMoney(from: string, to: string): Promise<LegacyMoney> {
  const fromDay = toDateInputValue(from);
  const toDay = toDateInputValue(to);
  const [docRows, dealRows] = await Promise.all([
    raw.query(
      `SELECT coalesce(sum(CASE WHEN ${OLD_INVOICED} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
              coalesce(sum(CASE WHEN ${OLD_COLLECTED} AND d.paid_on  >= ? AND d.paid_on  < ? THEN d.total_cents ELSE 0 END), 0) AS collected_cents,
              coalesce(sum(CASE WHEN ${OLD_OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS outstanding_cents
       FROM documents d`,
      [fromDay, toDay, fromDay, toDay, fromDay, toDay],
    ),
    raw.query(
      `SELECT coalesce(sum(CASE WHEN dl.created_at >= ? AND dl.created_at < ? THEN dl.value_cents ELSE 0 END), 0) AS quoted_cents,
              coalesce(sum(CASE WHEN ${OPEN_DEAL} AND dl.created_at >= ? AND dl.created_at < ? THEN dl.value_cents ELSE 0 END), 0) AS open_cents,
              coalesce(sum(CASE WHEN s.is_won = 1 AND dl.closed_at IS NOT NULL AND dl.closed_at >= ? AND dl.closed_at < ? THEN dl.value_cents ELSE 0 END), 0) AS won_cents
       FROM deals dl JOIN stages s ON s.id = dl.stage_id WHERE dl.deleted_at IS NULL`,
      [from, to, from, to, from, to],
    ),
  ]);
  return {
    quotedCents: sumOf(dealRows, 0),
    openCents: sumOf(dealRows, 1),
    wonCents: sumOf(dealRows, 2),
    invoicedCents: sumOf(docRows, 0),
    collectedCents: sumOf(docRows, 1),
    outstandingCents: sumOf(docRows, 2),
  };
}

const NO_DEAL_ROW_ID = "__no_deal__";

function hasMoney(row: LegacyMoney): boolean {
  return (
    row.quotedCents !== 0 ||
    row.openCents !== 0 ||
    row.wonCents !== 0 ||
    row.invoicedCents !== 0 ||
    row.collectedCents !== 0 ||
    row.outstandingCents !== 0
  );
}

type LegacyDealRow = LegacyMoney & { dealId: string };

async function legacyPerDealMoney(from: string, to: string): Promise<LegacyDealRow[]> {
  const fromDay = toDateInputValue(from);
  const toDay = toDateInputValue(to);
  const params = [from, to, from, to, from, to, fromDay, toDay, fromDay, toDay, fromDay, toDay];

  const rows = await raw.query(
    `SELECT dl.id AS dl_id,
            CASE WHEN dl.created_at >= ? AND dl.created_at < ? THEN dl.value_cents ELSE 0 END AS dl_quoted_cents,
            CASE WHEN ${OPEN_DEAL} AND dl.created_at >= ? AND dl.created_at < ? THEN dl.value_cents ELSE 0 END AS dl_open_cents,
            CASE WHEN s.is_won = 1 AND dl.closed_at IS NOT NULL AND dl.closed_at >= ? AND dl.closed_at < ? THEN dl.value_cents ELSE 0 END AS dl_won_cents,
            coalesce(m.invoiced_cents, 0) AS m_invoiced_cents,
            coalesce(m.collected_cents, 0) AS m_collected_cents,
            coalesce(m.outstanding_cents, 0) AS m_outstanding_cents
     FROM deals dl
     JOIN stages s ON s.id = dl.stage_id
     LEFT JOIN (
       SELECT d.deal_id AS deal_id,
              sum(CASE WHEN ${OLD_INVOICED} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END) AS invoiced_cents,
              sum(CASE WHEN ${OLD_COLLECTED} AND d.paid_on >= ? AND d.paid_on < ? THEN d.total_cents ELSE 0 END) AS collected_cents,
              sum(CASE WHEN ${OLD_OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END) AS outstanding_cents
       FROM documents d WHERE d.deal_id IS NOT NULL GROUP BY d.deal_id
     ) m ON m.deal_id = dl.id
     WHERE dl.deleted_at IS NULL
     ORDER BY dl.closed_at DESC, dl.title ASC`,
    params,
  );

  const dealRows: LegacyDealRow[] = rows
    .map((r) => ({
      dealId: String(r[0]),
      quotedCents: Number(r[1]),
      openCents: Number(r[2]),
      wonCents: Number(r[3]),
      invoicedCents: Number(r[4]),
      collectedCents: Number(r[5]),
      outstandingCents: Number(r[6]),
    }))
    .filter(hasMoney);

  const orphanRows = await raw.query(
    `SELECT coalesce(sum(CASE WHEN ${OLD_INVOICED} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
            coalesce(sum(CASE WHEN ${OLD_COLLECTED} AND d.paid_on >= ? AND d.paid_on < ? THEN d.total_cents ELSE 0 END), 0) AS collected_cents,
            coalesce(sum(CASE WHEN ${OLD_OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS outstanding_cents
     FROM documents d
     LEFT JOIN deals dl ON dl.id = d.deal_id
     WHERE d.deal_id IS NULL OR dl.id IS NULL OR dl.deleted_at IS NOT NULL`,
    [fromDay, toDay, fromDay, toDay, fromDay, toDay],
  );
  const orphan: LegacyDealRow = {
    dealId: NO_DEAL_ROW_ID,
    quotedCents: 0,
    openCents: 0,
    wonCents: 0,
    invoicedCents: sumOf(orphanRows, 0),
    collectedCents: sumOf(orphanRows, 1),
    outstandingCents: sumOf(orphanRows, 2),
  };
  return hasMoney(orphan) ? [...dealRows, orphan] : dealRows;
}

async function legacyAging(reference: string): Promise<Aging> {
  const rows = await raw.query(
    `SELECT d.due_on AS d_due_on, d.total_cents AS d_total_cents
     FROM documents d
     WHERE d.kind = 'invoice' AND d.status = 'sent' AND d.deleted_at IS NULL`,
  );
  const totals = new Map(AGING_BUCKETS.map((b) => [b, { count: 0, cents: 0 }]));
  for (const row of rows) {
    const dueOn = row[0] === null || row[0] === undefined ? null : String(row[0]);
    const totalCents = Number(row[1]);
    const entry = totals.get(bucketFor(dueOn, reference))!;
    entry.count += 1;
    entry.cents += totalCents;
  }
  const bucketRows = AGING_BUCKETS.map((bucket) => ({ bucket, ...totals.get(bucket)! }));
  return {
    rows: bucketRows,
    totalCents: bucketRows.reduce((s, r) => s + r.cents, 0),
    totalCount: bucketRows.reduce((s, r) => s + r.count, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* comparisons that name the figure that drifted                             */
/* -------------------------------------------------------------------------- */

function expectMoneyEqual(label: string, before: LegacyMoney, after: LegacyMoney): void {
  (Object.keys(before) as (keyof LegacyMoney)[]).forEach((key) => {
    expect(
      after[key],
      `${label}.${key} drifted across the 0005 -> 0006 upgrade (before ${before[key]}, after ${after[key]})`,
    ).toBe(before[key]);
  });
}

function expectAgingEqual(before: Aging, after: Aging): void {
  expect(after.totalCents, `aging.totalCents drifted (before ${before.totalCents}, after ${after.totalCents})`).toBe(
    before.totalCents,
  );
  expect(after.totalCount, "aging.totalCount drifted").toBe(before.totalCount);
  for (const bucket of AGING_BUCKETS) {
    const b = before.rows.find((r) => r.bucket === bucket)!;
    const a = after.rows.find((r) => r.bucket === bucket)!;
    expect(a.cents, `aging[${bucket}].cents drifted (before ${b.cents}, after ${a.cents})`).toBe(b.cents);
    expect(a.count, `aging[${bucket}].count drifted (before ${b.count}, after ${a.count})`).toBe(b.count);
  }
}

/* -------------------------------------------------------------------------- */
/* seeding, on 0005 only                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The first stage `seedWorkspace()` made, read directly rather than through
 * `stages.list()` / `pipelines.getDefaultOrThrow()`: those repos are shared
 * with other in-flight work and their current queries already select columns
 * (`stages.follow_up_days`, from LR-PX-C's automations migration) that do not
 * exist yet at 0005 - same "current code assumes the current schema" problem
 * the file header explains for `money.ts`. A plain `SELECT id` needs nothing
 * but the columns that have existed since the very first migration.
 */
async function firstStageId(): Promise<string> {
  const rows = await raw.query(`SELECT id FROM stages ORDER BY position ASC LIMIT 1`);
  return String(rows[0][0]);
}

type SeedRefs = {
  deals: Record<string, string>;
  customers: { label: string; ref: { contactId?: string | null; companyId?: string | null } }[];
  paidInvoices: { id: string; totalCents: number; paidOn: string; skipped?: boolean }[];
};

/**
 * Builds the workspace's pre-upgrade shape by hand: several deals, a draft, a
 * sent, a void invoice, and every edge case the backfill has to survive - a
 * zero-total paid invoice, a paid invoice whose deal is later trashed, a paid
 * invoice with no deal at all, a soft-deleted paid invoice, and two paid
 * invoices on the same customer in different months.
 *
 * `documents.create` and `documents.send` are used wherever they are safe
 * (neither touches `payments`); the legacy `status = 'paid'` / `'void'`
 * states, the null-deal edit and the deal trash are all written with raw SQL,
 * because that is literally what a pre-payments Helix wrote directly - the
 * *current* `documents.ts` no longer offers a `markPaid()` that does not
 * assume a payments table exists.
 */
async function seedLegacyWorkspace(): Promise<SeedRefs> {
  const stageId = await firstStageId();
  const at = nowIso();

  async function invoiceOn(dealId: string, totalCents: number, issuedOn: string, dueOn: string) {
    const created = await documents.create({
      kind: "invoice",
      dealId,
      prefix: "INV",
      taxRateBp: 0,
      issuedOn,
      dueOn,
      items: [{ name: "Service", qty: 1, unitCents: totalCents, taxable: false }],
    });
    return documents.send(created.id, { at: `${issuedOn}T09:00:00.000Z` });
  }

  async function markPaidLegacy(documentId: string, paidOn: string): Promise<void> {
    await raw.execute(
      `UPDATE documents SET status = 'paid', paid_on = ?, paid_method = 'card', paid_note = NULL, updated_at = ? WHERE id = ?`,
      [paidOn, at, documentId],
    );
  }

  async function markVoidLegacy(documentId: string): Promise<void> {
    await raw.execute(`UPDATE documents SET status = 'void', updated_at = ? WHERE id = ?`, [at, documentId]);
  }

  // 1. A contact whose invoice is sent and never paid.
  const alice = await contacts.create({ firstName: "Alice", lastName: "Sent-Only" });
  const dealAlice = await deals.create({ title: "Alice job", stageId, contactId: alice.id });
  await invoiceOn(dealAlice.id, 7_500, "2026-03-01", "2026-03-15");

  // 2. A contact with a draft invoice only - never billed.
  const bob = await contacts.create({ firstName: "Bob", lastName: "Draft-Only" });
  const dealBob = await deals.create({ title: "Bob job", stageId, contactId: bob.id });
  await documents.create({
    kind: "invoice",
    dealId: dealBob.id,
    prefix: "INV",
    taxRateBp: 0,
    items: [{ name: "Service", qty: 1, unitCents: 5_000, taxable: false }],
  });

  // 3. Acme: two invoices, paid in two different months - the case that most
  //    directly tests Collected being counted by payment day, not invoice day.
  const acme = await companies.create({ name: "Acme Co" });
  const dealAcme = await deals.create({ title: "Acme job", stageId, companyId: acme.id });
  const acmeJan = await invoiceOn(dealAcme.id, 10_000, "2026-01-05", "2026-01-19");
  await markPaidLegacy(acmeJan.id, "2026-01-15");
  const acmeFeb = await invoiceOn(dealAcme.id, 20_000, "2026-02-01", "2026-02-15");
  await markPaidLegacy(acmeFeb.id, "2026-02-20");

  // 4. A void invoice.
  const voidCo = await companies.create({ name: "Void Co" });
  const dealVoid = await deals.create({ title: "Void Co job", stageId, companyId: voidCo.id });
  const voidInvoice = await invoiceOn(dealVoid.id, 3_000, "2026-01-10", "2026-01-24");
  await markVoidLegacy(voidInvoice.id);

  // 5. A paid invoice whose deal is later soft-deleted.
  const trashCo = await companies.create({ name: "Trash Co" });
  const dealTrash = await deals.create({ title: "Trash Co job", stageId, companyId: trashCo.id });
  const trashInvoice = await invoiceOn(dealTrash.id, 4_000, "2026-01-12", "2026-01-26");
  await markPaidLegacy(trashInvoice.id, "2026-01-20");
  await raw.execute(`UPDATE deals SET deleted_at = ?, updated_at = ? WHERE id = ?`, [at, at, dealTrash.id]);

  // 6. A paid invoice with no deal at all (deal_id nulled out, as a document
  //    written before round 3's "every document belongs to a deal" rule would
  //    read).
  const noDealGuy = await contacts.create({ firstName: "No", lastName: "Deal" });
  const dealNoDeal = await deals.create({ title: "No-deal source job", stageId, contactId: noDealGuy.id });
  const noDealInvoice = await invoiceOn(dealNoDeal.id, 2_000, "2026-01-08", "2026-01-22");
  await markPaidLegacy(noDealInvoice.id, "2026-01-18");
  await raw.execute(`UPDATE documents SET deal_id = NULL, updated_at = ? WHERE id = ?`, [at, noDealInvoice.id]);

  // 7. A paid invoice with a zero total - the backfill skips this one outright.
  const zeroCo = await companies.create({ name: "Zero Co" });
  const dealZero = await deals.create({ title: "Zero Co job", stageId, companyId: zeroCo.id });
  const zeroInvoice = await invoiceOn(dealZero.id, 0, "2026-01-03", "2026-01-17");
  await markPaidLegacy(zeroInvoice.id, "2026-01-04");

  // 8. A soft-deleted paid invoice - its money must count nowhere, before or after.
  const softDelCo = await companies.create({ name: "Soft-Deleted Invoice Co" });
  const dealSoftDel = await deals.create({ title: "Soft-deleted invoice job", stageId, companyId: softDelCo.id });
  const softDelInvoice = await invoiceOn(dealSoftDel.id, 6_000, "2026-01-06", "2026-01-20");
  await markPaidLegacy(softDelInvoice.id, "2026-01-25");
  await documents.softDelete(softDelInvoice.id);

  return {
    deals: {
      alice: dealAlice.id,
      bob: dealBob.id,
      acme: dealAcme.id,
      voidCo: dealVoid.id,
      trashCo: dealTrash.id,
      noDeal: dealNoDeal.id,
      zeroCo: dealZero.id,
      softDelCo: dealSoftDel.id,
    },
    customers: [
      { label: "Alice (contact)", ref: { contactId: alice.id } },
      { label: "Acme Co", ref: { companyId: acme.id } },
      { label: "Void Co", ref: { companyId: voidCo.id } },
      { label: "Trash Co", ref: { companyId: trashCo.id } },
      { label: "No Deal Guy (contact)", ref: { contactId: noDealGuy.id } },
      { label: "Zero Co", ref: { companyId: zeroCo.id } },
      { label: "Soft-Deleted Invoice Co", ref: { companyId: softDelCo.id } },
    ],
    paidInvoices: [
      { id: acmeJan.id, totalCents: 10_000, paidOn: "2026-01-15" },
      { id: acmeFeb.id, totalCents: 20_000, paidOn: "2026-02-20" },
      { id: trashInvoice.id, totalCents: 4_000, paidOn: "2026-01-20" },
      { id: noDealInvoice.id, totalCents: 2_000, paidOn: "2026-01-18" },
      { id: zeroInvoice.id, totalCents: 0, paidOn: "2026-01-04", skipped: true },
      { id: softDelInvoice.id, totalCents: 6_000, paidOn: "2026-01-25" },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* the test                                                                   */
/* -------------------------------------------------------------------------- */

// Wide enough to catch every deal's created_at (today, whenever the suite
// runs) and every hand-picked invoice/payment date above.
const WIDE_PERIOD = { from: "2000-01-01T00:00:00.000Z", to: "2099-01-01T00:00:00.000Z" };
// January only - narrower than WIDE_PERIOD, and it splits Acme's two invoices
// (Jan/Feb) across the boundary, which is the case that most matters here.
const JANUARY = { from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" };
const AGING_REFERENCE = "2026-04-01";

describe("0005 -> 0006: every money figure survives the payments backfill", () => {
  it("dealMoney, customerMoney, periodMoney, perDealMoney and receivables.aging are identical before and after", async () => {
    await bootAt("0005_lead_dedup");
    const seed = await seedLegacyWorkspace();

    // ---- BEFORE: the legacy (documents.status-driven) formula, on 0005. ----
    const beforeByDeal = new Map<string, LegacyMoney>();
    for (const [label, dealId] of Object.entries(seed.deals)) {
      beforeByDeal.set(label, await legacyDealMoney(dealId));
    }
    const beforeByCustomer = new Map<string, LegacyMoney>();
    for (const { label, ref } of seed.customers) {
      beforeByCustomer.set(label, await legacyCustomerMoney(ref));
    }
    const beforeWide = await legacyPeriodMoney(WIDE_PERIOD.from, WIDE_PERIOD.to);
    const beforeJanuary = await legacyPeriodMoney(JANUARY.from, JANUARY.to);
    const beforePerDeal = await legacyPerDealMoney(WIDE_PERIOD.from, WIDE_PERIOD.to);
    const beforeAging = await legacyAging(AGING_REFERENCE);

    // A sanity floor on the "before" snapshot itself: if seeding silently
    // failed and every figure read zero, the before/after comparison below
    // would still trivially pass (0 === 0) without proving anything. Pin a
    // few real numbers first so a seeding regression fails loudly, here,
    // rather than showing up as a false green on the real assertions.
    expect(beforeByDeal.get("acme")).toEqual({
      quotedCents: 0, openCents: 0, wonCents: 0,
      invoicedCents: 30_000, collectedCents: 30_000, outstandingCents: 0,
    });
    expect(beforeByDeal.get("alice")).toEqual({
      quotedCents: 0, openCents: 0, wonCents: 0,
      invoicedCents: 7_500, collectedCents: 0, outstandingCents: 7_500,
    });
    // The soft-deleted invoice's $6,000 never counts (before or after): both
    // the legacy and the current formula require `d.deleted_at IS NULL`.
    expect(beforeJanuary.collectedCents).toBe(10_000 + 4_000 + 2_000 + 0); // Feb's payment falls outside January
    expect(beforeWide.collectedCents).toBe(10_000 + 20_000 + 4_000 + 2_000 + 0);
    expect(beforeAging.totalCents).toBe(7_500); // only Alice's invoice is still `sent`

    // ---- Run the actual migration under test. ----
    await upgradeThrough("0006_payments");

    // ---- AFTER: the real, current production code. ----
    for (const [label, dealId] of Object.entries(seed.deals)) {
      expectMoneyEqual(`dealMoney(${label})`, beforeByDeal.get(label)!, await money.dealMoney(dealId));
    }
    for (const { label, ref } of seed.customers) {
      expectMoneyEqual(`customerMoney(${label})`, beforeByCustomer.get(label)!, await money.customerMoney(ref));
    }
    expectMoneyEqual("periodMoney(wide)", beforeWide, await money.periodMoney(WIDE_PERIOD.from, WIDE_PERIOD.to));
    expectMoneyEqual("periodMoney(january)", beforeJanuary, await money.periodMoney(JANUARY.from, JANUARY.to));

    const afterPerDeal = await money.perDealMoney(WIDE_PERIOD.from, WIDE_PERIOD.to);
    expect(
      afterPerDeal.map((r) => r.dealId),
      "perDealMoney's row set or ordering drifted across the upgrade",
    ).toEqual(beforePerDeal.map((r) => r.dealId));
    beforePerDeal.forEach((row, i) => {
      expectMoneyEqual(`perDealMoney[${row.dealId}]`, row, afterPerDeal[i]);
    });
    // The orphan row must actually have appeared - it is the row proving the
    // trashed-deal invoice and the no-deal invoice both still add up.
    expect(afterPerDeal.some((r) => r.dealId === money.NO_DEAL_ROW_ID)).toBe(true);

    expectAgingEqual(beforeAging, await receivables.aging(AGING_REFERENCE));
  });

  it("every already-paid invoice now has exactly one payment for its total, on its own paid_on, method 'other' - except the zero-total one, which the backfill skips", async () => {
    await bootAt("0005_lead_dedup");
    const seed = await seedLegacyWorkspace();
    await upgradeThrough("0006_payments");

    for (const invoice of seed.paidInvoices) {
      const rows = await payments.listForDocument(invoice.id);
      if (invoice.skipped) {
        expect(rows, `the zero-total invoice ${invoice.id} should have no backfilled payment`).toEqual([]);
        continue;
      }
      expect(rows, `invoice ${invoice.id} should have exactly one backfilled payment`).toHaveLength(1);
      expect(rows[0].amountCents, `backfilled amount for ${invoice.id}`).toBe(invoice.totalCents);
      expect(rows[0].paidOn, `backfilled paid_on for ${invoice.id}`).toBe(invoice.paidOn);
      expect(rows[0].method, `backfilled method for ${invoice.id}`).toBe("other");
    }
  });
});
