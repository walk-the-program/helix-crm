/**
 * Receivables: what customers owe, read-only.
 *
 * "Outstanding" means an invoice (never a quote), that left the building
 * (`sent` or `partial`, never a draft — nobody owes money on a piece of paper
 * that has not left the building), not fully paid and not voided, and not
 * soft-deleted: `kind = 'invoice' AND status IN ('sent', 'partial') AND
 * deleted_at IS NULL` is the whole filter, and every query in this file
 * starts from it.
 *
 * Every figure here is the BALANCE, not the total (PX-5). Before payments
 * existed an invoice was either fully owed or fully settled, so "outstanding"
 * and "the invoice's total" were the same number. A part-paid invoice breaks
 * that: it is still outstanding, but only for what is left on it, and the
 * money already collected against it must not be double-counted here AND in
 * Collected. Every row therefore carries both `totalCents` and `paidCents`,
 * and every aggregate (the aging buckets, the list) sums `totalCents -
 * paidCents`, never `totalCents` alone. `status` rides along on the row so a
 * screen can tell a plain `sent` invoice from a `partial` one ("partially
 * paid") without a second query.
 *
 * Every query takes an explicit `reference` date rather than reading the
 * clock itself, so a test can ask "what does this look like on 2026-03-15"
 * and get the same answer every time it asks.
 *
 * Money stays integer cents end to end; dates that are days (`due_on`,
 * `paid_on`) are local calendar strings, never instants.
 */
import { raw } from "@/db/client";
import { todayLocal, parseDateOnly } from "@/lib/dates";
import { mapRows, selectList, type Col } from "@/db/repos/_base";

/* -------------------------------------------------------------------------- */
/* aging buckets                                                              */
/* -------------------------------------------------------------------------- */

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Whole days from `dueOn` to `reference`. Positive means past due. */
function daysPastDue(dueOn: string | null, reference: string): number {
  if (!dueOn) return 0;
  const due = parseDateOnly(dueOn);
  const now = parseDateOnly(reference);
  if (!due || !now) return 0;
  return Math.round((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Which bucket an invoice falls in. Pure, exported, and unit-testable.
 *
 * No due date, or a due date today or later, is "current" - the clock on an
 * invoice starts only once it is actually late. The boundaries are the
 * owner's own reading of them and are inclusive as written: 30 days over is
 * still "1-30", 31 tips it into "31-60", 90 is the last day of "61-90", and
 * 91 is "90+".
 */
export function bucketFor(dueOn: string | null, reference: string): AgingBucket {
  const late = daysPastDue(dueOn, reference);
  if (late <= 0) return "current";
  if (late <= 30) return "1-30";
  if (late <= 60) return "31-60";
  if (late <= 90) return "61-90";
  return "90+";
}

/* -------------------------------------------------------------------------- */
/* the outstanding set                                                       */
/* -------------------------------------------------------------------------- */

type OutstandingBaseRow = {
  id: string;
  number: string;
  dueOn: string | null;
  totalCents: number;
  paidCents: number;
  status: string;
  companyName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
};

const OUTSTANDING_COLS: readonly Col<OutstandingBaseRow>[] = [
  ["id", "d.id", "text"],
  ["number", "d.number", "text"],
  ["dueOn", "d.due_on", "textNull"],
  ["totalCents", "d.total_cents", "int"],
  ["paidCents", "coalesce(pay.paid_cents, 0)", "int"],
  ["status", "d.status", "text"],
  ["companyName", "co.name", "textNull"],
  ["contactFirstName", "c.first_name", "textNull"],
  ["contactLastName", "c.last_name", "textNull"],
];

/**
 * The rows both `aging` and `outstanding` are built from. A draft is not
 * money anyone owes yet, and `paid` and `void` are settled, so only
 * `kind = 'invoice' AND status IN ('sent', 'partial') AND deleted_at IS NULL`
 * counts. The payments join is pre-aggregated to one row per document before
 * it reaches this query, so an invoice with two payments does not double its
 * own row.
 */
async function outstandingRows(): Promise<OutstandingBaseRow[]> {
  const rows = await raw.query(
    `SELECT ${selectList(OUTSTANDING_COLS, "d")}
     FROM documents d
     LEFT JOIN contacts c ON c.id = d.contact_id
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN (
       SELECT p.document_id AS document_id, sum(p.amount_cents) AS paid_cents
       FROM payments p WHERE p.deleted_at IS NULL GROUP BY p.document_id
     ) pay ON pay.document_id = d.id
     WHERE d.kind = 'invoice' AND d.status IN ('sent', 'partial') AND d.deleted_at IS NULL`,
  );
  return mapRows(OUTSTANDING_COLS, rows);
}

/** The company name, else the contact's name, else "No customer". */
function customerFor(row: {
  companyName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
}): string {
  if (row.companyName) return row.companyName;
  const person = [row.contactFirstName ?? "", row.contactLastName ?? ""]
    .join(" ")
    .trim();
  return person.length > 0 ? person : "No customer";
}

/* -------------------------------------------------------------------------- */
/* aging                                                                     */
/* -------------------------------------------------------------------------- */

export type AgingRow = { bucket: AgingBucket; count: number; cents: number };
export type Aging = { rows: AgingRow[]; totalCents: number; totalCount: number };

/**
 * The five aging buckets, always all five and always in `AGING_BUCKETS`
 * order, including the empty ones at zero. Each bucket sums the BALANCE of
 * the invoices in it, not their total - a `partial` invoice contributes only
 * what is left owed, since the rest already left through Collected.
 *
 * The bucketing happens here in TypeScript, over rows already fetched, not in
 * SQL with a CASE over julianday. SQLite's date functions run in UTC and this
 * product's due dates are local calendar days, so a SQL bucketing "fix" would
 * quietly shift every invoice near a day boundary into the wrong bucket. Do
 * not "optimise" this into a GROUP BY.
 */
export async function aging(reference: string = todayLocal()): Promise<Aging> {
  const base = await outstandingRows();

  const totals = new Map<AgingBucket, { count: number; cents: number }>(
    AGING_BUCKETS.map((bucket) => [bucket, { count: 0, cents: 0 }]),
  );
  for (const row of base) {
    const entry = totals.get(bucketFor(row.dueOn, reference))!;
    entry.count += 1;
    entry.cents += row.totalCents - row.paidCents;
  }

  const rows = AGING_BUCKETS.map((bucket) => ({ bucket, ...totals.get(bucket)! }));
  return {
    rows,
    totalCents: rows.reduce((sum, r) => sum + r.cents, 0),
    totalCount: rows.reduce((sum, r) => sum + r.count, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* the list                                                                  */
/* -------------------------------------------------------------------------- */

export type ReceivableRow = {
  id: string;
  number: string;
  customer: string;
  dueOn: string | null;
  daysOverdue: number;
  totalCents: number;
  /** Added PX-5: what has already come in against this invoice. */
  paidCents: number;
  /** Added PX-5: `totalCents - paidCents` - what the row actually represents. */
  balanceCents: number;
  /** Added PX-5: "sent" or "partial", so a screen can say "partially paid". */
  status: string;
};

/**
 * Every unpaid or partly-paid sent invoice with who owes it, oldest due date
 * first. A due date of null cannot happen in practice - `documents.send`
 * always stamps one on an invoice - but it sorts to the end rather than
 * crashing the compare if it ever does.
 */
export async function outstanding(reference: string = todayLocal()): Promise<ReceivableRow[]> {
  const base = await outstandingRows();
  return base
    .map((row) => ({
      id: row.id,
      number: row.number,
      customer: customerFor(row),
      dueOn: row.dueOn,
      daysOverdue: daysPastDue(row.dueOn, reference),
      totalCents: row.totalCents,
      paidCents: row.paidCents,
      balanceCents: row.totalCents - row.paidCents,
      status: row.status,
    }))
    .sort((a, b) => {
      if (a.dueOn === b.dueOn) return 0;
      if (a.dueOn === null) return 1;
      if (b.dueOn === null) return -1;
      return a.dueOn < b.dueOn ? -1 : 1;
    });
}

/* -------------------------------------------------------------------------- */
/* collected                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The money that actually landed inside the calendar month of `reference`
 * (PX-5): the sum of live payments, on live invoices, whose OWN `paid_on`
 * falls in that month - never the invoice's cached `paid_on`, which is only
 * its most recent payment and would misplace a deposit taken in an earlier
 * month. `count` is the number of DISTINCT invoices that received money in
 * the month, which is what the sentence on screen ("collected this month...
 * across N invoices") actually claims - an invoice paid in two instalments
 * inside the same month is one invoice, not two.
 */
export async function collectedThisMonth(
  reference: string = todayLocal(),
): Promise<{ count: number; cents: number }> {
  const monthPrefix = reference.slice(0, 7);
  const rows = await raw.query(
    `SELECT count(DISTINCT p.document_id) AS collected_count, coalesce(sum(p.amount_cents), 0) AS collected_cents
     FROM payments p
     JOIN documents d ON d.id = p.document_id
     WHERE p.deleted_at IS NULL AND d.deleted_at IS NULL AND d.kind = 'invoice'
       AND p.paid_on LIKE ?`,
    [`${monthPrefix}%`],
  );
  if (rows.length === 0) return { count: 0, cents: 0 };
  return { count: Number(rows[0][0]), cents: Number(rows[0][1]) };
}
