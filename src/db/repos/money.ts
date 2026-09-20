/**
 * The money model: Customer → Deal → Invoice → Payment, in five numbers.
 *
 * Every screen that talks about money reads it from here, so the same word
 * means the same thing on the deal page, the customer page and the reports:
 *
 *   Quoted      what the owner offered to do, at the price he offered it:
 *               `deals.value_cents`. That is the deal's line items at their
 *               actual (discounted) price, or the figure typed on a deal that
 *               has no lines. It is the ANNUAL value - one-time plus twelve
 *               months of any recurring line - which is what the rest of the
 *               product already means by a deal's value, and what the deal
 *               strip's breakdown note spells out ("$300 upfront + $180/mo").
 *   Open        the same value, counted only while the deal is still live:
 *               not in a won stage, not in a lost stage, no `closed_at`, not
 *               deleted. This is the pipeline figure, so it uses exactly the
 *               test `reports.topCompanies` uses for its own open column and
 *               the two can never drift.
 *   Won         what the customer agreed to: `deals.value_cents` for deals
 *               sitting in a won stage.
 *   Invoiced    what was actually billed: invoice documents that left the
 *               building - `sent`, `partial` or `paid`. A draft has not been
 *               billed to anybody and a voided invoice is a billing that was
 *               taken back, so neither counts. `partial` joined the list in
 *               round PX-5: a part-paid invoice left the building exactly
 *               once, the day it was sent, and stays Invoiced for the whole
 *               of its life - taking a payment against it does not un-bill it.
 *   Collected   what the money actually landed as: the sum of PAYMENTS
 *               (PX-5). Before this round there was no payments table - an
 *               invoice was paid in full on `paid_on` or it was not, so
 *               Collected was the total of the invoices marked paid and a
 *               deposit needed two invoices (round 3's ruling R7). Now a
 *               payment is its own row, an invoice can be `partial`, and
 *               Collected is the sum of every live payment against a live
 *               invoice - a deposit and a balance payment on the same
 *               invoice both count, on the day each one actually arrived.
 *   Outstanding invoiced and not yet collected: the totals of the `sent` and
 *               `partial` invoices, minus the payments already against them.
 *               A partially paid invoice contributes only its balance, not
 *               its total - it already gave up the collected half.
 *
 * Quoted used to be the sum of the quote DOCUMENTS raised against the deal.
 * That was wrong, and wrong in the most visible place in the product: a deal
 * the board valued at $14,800 read "Quoted $0" on its own page, because a trade
 * owner prices the job on the deal and mostly never raises a separate quote
 * document at all. Round 3 defined Quoted as the deal's line items and this
 * module is now the only place that says so. Nothing read the document-based
 * figure once the strip and the reports moved over, so it is gone rather than
 * renamed; bringing it back is a `sum(d.total_cents)` over
 * `kind = 'quote' AND status NOT IN ('draft','void')`, which is what the
 * `QUOTE_DOCUMENTS` note below records.
 *
 * Dates. `closed_at` and `created_at` are ISO instants, so the deal side
 * compares against the period's own instants. `issued_on` and `paid_on` are
 * local calendar days, so the document side compares against the period's local
 * days - taking the day off the instant with `toDateInputValue`, never by
 * slicing the UTC string, which is a day out for any workspace east of UTC.
 *
 * Which date a number belongs to is its own decision, and it is the one the
 * owner would defend. Over a period there are now FOUR different clocks, which
 * is why the Revenue card has to name them:
 *
 *   Quoted and Open  the day the deal was created - the day he quoted it.
 *   Won              the day the deal closed.
 *   Invoiced         the day the invoice was issued.
 *   Collected        the day the money arrived - the PAYMENT's own `paid_on`,
 *                    never the invoice's. An invoice's cached `paid_on`
 *                    (`documents.paid_on`) is only its most recent payment,
 *                    which is right for a screen showing one invoice and wrong
 *                    for a period total: a $500 deposit in March and a $700
 *                    balance in April must land $500 in March's Collected and
 *                    $700 in April's, not $1,200 in whichever month happened
 *                    to be the last one.
 *
 * So a period's Collected can exceed its Invoiced, which is not a bug: it is
 * January's invoice being paid in February. And a deal can be Quoted in one
 * month and Won in the next, which is the normal shape of a job.
 *
 * Outstanding over a period therefore cannot be `invoiced - collected` (that
 * subtracts one period's payments from another period's bills). It is what it
 * says: the invoices issued in this period that are still unpaid, at their
 * CURRENT balance - not their balance as of the period's end. Over a deal or a
 * customer, where no period is in play, the two definitions agree exactly.
 *
 * Every payments join in this file follows the one rule every payments query
 * in the product follows: join `documents d` and require `d.deleted_at IS
 * NULL` and `p.deleted_at IS NULL`. A payment on a soft-deleted invoice must
 * not count even though the payment row itself is untouched by a document
 * soft-delete - the backfill migration (`drizzle/0006_payments.sql`) leans on
 * exactly this to bring a restored invoice's money back correctly.
 *
 * The fan-out trap. Summing `documents` or `payments` through a plain JOIN
 * multiplies a deal's or a customer's value once per row on the other side of
 * the join - a deal with three invoices would triple its own `value_cents`.
 * Every query below that needs both a deal-level (or customer-level) figure
 * and a document/payment-level figure keeps them in SEPARATE queries or joins
 * against a subquery that has already aggregated the many-side down to one row
 * per key, exactly the way `perDealMoney`'s own `m` subquery always has.
 *
 * Everything here is read-only and every figure is integer cents.
 */
import { raw } from "@/db/client";
import { toDateInputValue } from "@/lib/periods";
import { methodLabel } from "@/db/repos/payments";

/** The five numbers, and what they leave outstanding. */
export type MoneyTotals = {
  quotedCents: number;
  openCents: number;
  wonCents: number;
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
};

export const ZERO_MONEY: MoneyTotals = {
  quotedCents: 0,
  openCents: 0,
  wonCents: 0,
  invoicedCents: 0,
  collectedCents: 0,
  outstandingCents: 0,
};

/* -------------------------------------------------------------------------- */
/* the filters, written once                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What Quoted used to mean, kept as a note rather than as code: no screen reads
 * a document-based quoted figure any more. If one ever needs "what did I send
 * out on paper", this is the filter it wants, under a name that says so
 * (`quoteDocumentsCents`), never under the word Quoted.
 *
 *   d.kind = 'quote' AND d.deleted_at IS NULL AND d.status NOT IN ('draft', 'void')
 */

/** An invoice that left the building: sent, partially paid, or paid in full. */
const INVOICED = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status IN ('sent', 'partial', 'paid')`;

/** An invoice still owed, in whole or in part. */
const OUTSTANDING = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status IN ('sent', 'partial')`;

/**
 * Any live invoice a payment can legally hang off (PX-5). `payments.create`
 * refuses a payment on a draft, a void invoice or a quote
 * (`documents.assertTakesPayments`), so in practice this and `INVOICED` cover
 * the same documents - but this is the condition the payments join itself
 * carries, so it says what it means rather than borrowing INVOICED's name for
 * a different job.
 */
const COLLECTABLE = `d.kind = 'invoice' AND d.deleted_at IS NULL`;

/**
 * A deal that is still live. Word for word the test `reports.topCompanies` and
 * `reports.openPipeline` use for their open columns, so the pipeline figure on
 * the reports and `openCents` here can never disagree.
 */
const OPEN_DEAL = `dl.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0`;

/** Every live payment, aggregated to one row per document. Join, never sum raw. */
const PAID_BY_DOCUMENT = `(
  SELECT p.document_id AS document_id, sum(p.amount_cents) AS paid_cents
  FROM payments p
  WHERE p.deleted_at IS NULL
  GROUP BY p.document_id
)`;

function sumOf(rows: unknown[][], index: number): number {
  if (rows.length === 0) return 0;
  const value = rows[0][index];
  return value === null || value === undefined ? 0 : Number(value);
}

/**
 * The three document sums over one WHERE clause on `documents d`, which every
 * lifetime question (a deal, a customer) shares. One query rather than three,
 * so the numbers are read at one instant and cannot disagree with each other.
 *
 * The payments join is pre-aggregated to one row per document
 * (`PAID_BY_DOCUMENT`) before it ever reaches `documents`, so a document with
 * several payments does not multiply its own total - the fan-out trap the
 * file header warns about.
 */
async function documentSums(
  scope: string,
  params: (string | number | null)[],
): Promise<{ invoiced: number; collected: number; outstanding: number }> {
  const rows = await raw.query(
    `SELECT coalesce(sum(CASE WHEN ${INVOICED}    THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
            coalesce(sum(CASE WHEN ${COLLECTABLE} THEN coalesce(pay.paid_cents, 0) ELSE 0 END), 0) AS collected_cents,
            coalesce(sum(CASE WHEN ${OUTSTANDING} THEN d.total_cents - coalesce(pay.paid_cents, 0) ELSE 0 END), 0) AS outstanding_cents
     FROM documents d
     LEFT JOIN ${PAID_BY_DOCUMENT} pay ON pay.document_id = d.id
     WHERE ${scope}`,
    params,
  );
  return {
    invoiced: sumOf(rows, 0),
    collected: sumOf(rows, 1),
    outstanding: sumOf(rows, 2),
  };
}

/**
 * Quoted, Open and Won over one WHERE clause on `deals dl` joined to its stage.
 *
 * All three are `value_cents` under different tests, so they come out of one
 * query: a deal counts once towards Quoted whatever its stage, towards Open
 * while it is live, and towards Won once it sits in a won stage. Open and Won
 * are mutually exclusive by construction; Quoted covers both and the lost ones
 * too, because a lost deal was still quoted.
 */
async function dealValueSums(
  scope: string,
  params: (string | number | null)[],
): Promise<{ quoted: number; open: number; won: number }> {
  const rows = await raw.query(
    `SELECT coalesce(sum(dl.value_cents), 0) AS quoted_cents,
            coalesce(sum(CASE WHEN ${OPEN_DEAL}  THEN dl.value_cents ELSE 0 END), 0) AS open_cents,
            coalesce(sum(CASE WHEN s.is_won = 1  THEN dl.value_cents ELSE 0 END), 0) AS won_cents
     FROM deals dl JOIN stages s ON s.id = dl.stage_id
     WHERE dl.deleted_at IS NULL AND ${scope}`,
    params,
  );
  return { quoted: sumOf(rows, 0), open: sumOf(rows, 1), won: sumOf(rows, 2) };
}

/* -------------------------------------------------------------------------- */
/* one deal                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything quoted, won, invoiced and collected against one deal.
 *
 * Documents count through `documents.deal_id`, which is the link the round-3
 * rule makes required on new documents. A document written before that rule,
 * with no deal on it, belongs to the customer but not to any deal, so it shows
 * up in `customerMoney` and not here - which is the honest answer rather than
 * guessing a deal for it.
 *
 * A soft-deleted deal answers zero on all three of its own value figures,
 * because a deal in the trash is not money the owner has.
 */
export async function dealMoney(dealId: string): Promise<MoneyTotals> {
  const [docs, value] = await Promise.all([
    documentSums(`d.deal_id = ?`, [dealId]),
    dealValueSums(`dl.id = ?`, [dealId]),
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

/* -------------------------------------------------------------------------- */
/* one customer                                                               */
/* -------------------------------------------------------------------------- */

export type CustomerRef = { contactId?: string | null; companyId?: string | null };

/**
 * Everything for a customer, which is a contact, a company, or a contact at a
 * company.
 *
 * When both ids are given the match is an OR, not an AND: a deal recorded
 * against the company alone and a deal recorded against the person are both
 * that customer's money. The OR runs inside one query, so a row carrying both
 * ids is counted once.
 *
 * An empty reference is not "everything" - it is nobody, and the honest answer
 * is zero rather than the whole workspace's money.
 */
export async function customerMoney(ref: CustomerRef): Promise<MoneyTotals> {
  const contactId = ref.contactId ?? null;
  const companyId = ref.companyId ?? null;
  if (contactId === null && companyId === null) return { ...ZERO_MONEY };

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
    documentSums(shape.replaceAll("%PREFIX%", "d"), [...params]),
    dealValueSums(shape.replaceAll("%PREFIX%", "dl"), [...params]),
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

/**
 * What one customer still owes, across every `sent` or `partial` invoice of
 * theirs - the balance, not the total, so a part-paid invoice contributes only
 * what is left on it. An empty reference answers zero, the same rule
 * `customerMoney` follows.
 */
export async function customerBalanceCents(ref: CustomerRef): Promise<number> {
  const contactId = ref.contactId ?? null;
  const companyId = ref.companyId ?? null;
  if (contactId === null && companyId === null) return 0;

  const clauses: string[] = [];
  const params: (string | null)[] = [];
  if (contactId !== null) {
    clauses.push(`d.contact_id = ?`);
    params.push(contactId);
  }
  if (companyId !== null) {
    clauses.push(`d.company_id = ?`);
    params.push(companyId);
  }

  const rows = await raw.query(
    `SELECT coalesce(sum(CASE WHEN ${OUTSTANDING} THEN d.total_cents - coalesce(pay.paid_cents, 0) ELSE 0 END), 0) AS balance_cents
     FROM documents d
     LEFT JOIN ${PAID_BY_DOCUMENT} pay ON pay.document_id = d.id
     WHERE (${clauses.join(" OR ")})`,
    params,
  );
  return sumOf(rows, 0);
}

/* -------------------------------------------------------------------------- */
/* one invoice's balance                                                      */
/* -------------------------------------------------------------------------- */

export type InvoiceBalance = {
  documentId: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
};

/**
 * Every requested invoice's total, its live payments, and what is left - one
 * query, for a list screen's Balance column. An id this workspace has never
 * heard of, or one with no payments at all, is simply absent from the docs
 * table read (never happens for a real id) or reads `paidCents: 0` (the
 * ordinary case for an unpaid `sent` invoice).
 */
export async function invoiceBalances(
  documentIds: readonly string[],
): Promise<Map<string, InvoiceBalance>> {
  const out = new Map<string, InvoiceBalance>();
  if (documentIds.length === 0) return out;
  const placeholders = documentIds.map(() => "?").join(", ");
  const rows = await raw.query(
    `SELECT d.id AS d_id, d.total_cents AS d_total_cents, coalesce(pay.paid_cents, 0) AS paid_cents
     FROM documents d
     LEFT JOIN ${PAID_BY_DOCUMENT} pay ON pay.document_id = d.id
     WHERE d.id IN (${placeholders})`,
    [...documentIds],
  );
  for (const row of rows) {
    const documentId = String(row[0]);
    const totalCents = Number(row[1] ?? 0);
    const paidCents = Number(row[2] ?? 0);
    out.set(documentId, {
      documentId,
      totalCents,
      paidCents,
      balanceCents: totalCents - paidCents,
    });
  }
  return out;
}

/** One invoice's balance: its total less its live payments. 0 for an unknown id. */
export async function invoiceBalanceCents(documentId: string): Promise<number> {
  const map = await invoiceBalances([documentId]);
  return map.get(documentId)?.balanceCents ?? 0;
}

/* -------------------------------------------------------------------------- */
/* a period                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The period's five numbers, each on its own clock (see the four clocks in the
 * file comment).
 *
 * `from` and `to` are the half-open ISO instants a `Period` carries. The deal
 * dates are instants and compare against them directly; the document dates are
 * calendar days, so they are compared against the period's own local days.
 *
 * Collected is driven from `payments`, not `documents`: a payment counts in
 * whichever period its OWN `paid_on` falls in, never the period its invoice
 * was issued in or the period the invoice's cached `paid_on` happens to sit
 * in (PX-5's whole point - a deposit and a balance can land in different
 * months). Invoiced and Outstanding stay driven from `documents.issued_on`,
 * because those two answer "what did I bill in this period", not "what came
 * in".
 */
export async function periodMoney(from: string, to: string): Promise<MoneyTotals> {
  const fromDay = toDateInputValue(from);
  const toDay = toDateInputValue(to);

  const [docRows, dealRows] = await Promise.all([
    raw.query(
      `SELECT coalesce(sum(CASE WHEN ${INVOICED} AND d.issued_on >= ? AND d.issued_on < ?
                                 THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
              coalesce(sum(CASE WHEN ${OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ?
                                 THEN d.total_cents - coalesce(pay.paid_cents, 0) ELSE 0 END), 0) AS outstanding_cents,
              coalesce(sum(CASE WHEN ${COLLECTABLE} THEN coalesce(pay_period.paid_cents, 0) ELSE 0 END), 0) AS collected_cents
       FROM documents d
       LEFT JOIN ${PAID_BY_DOCUMENT} pay ON pay.document_id = d.id
       LEFT JOIN (
         SELECT p.document_id AS document_id, sum(p.amount_cents) AS paid_cents
         FROM payments p
         WHERE p.deleted_at IS NULL AND p.paid_on >= ? AND p.paid_on < ?
         GROUP BY p.document_id
       ) pay_period ON pay_period.document_id = d.id`,
      [fromDay, toDay, fromDay, toDay, fromDay, toDay],
    ),
    raw.query(
      `SELECT coalesce(sum(CASE WHEN dl.created_at >= ? AND dl.created_at < ?
                                THEN dl.value_cents ELSE 0 END), 0) AS quoted_cents,
              coalesce(sum(CASE WHEN ${OPEN_DEAL} AND dl.created_at >= ? AND dl.created_at < ?
                                THEN dl.value_cents ELSE 0 END), 0) AS open_cents,
              coalesce(sum(CASE WHEN s.is_won = 1 AND dl.closed_at IS NOT NULL
                                 AND dl.closed_at >= ? AND dl.closed_at < ?
                                THEN dl.value_cents ELSE 0 END), 0) AS won_cents
       FROM deals dl JOIN stages s ON s.id = dl.stage_id
       WHERE dl.deleted_at IS NULL`,
      [from, to, from, to, from, to],
    ),
  ]);

  return {
    quotedCents: sumOf(dealRows, 0),
    openCents: sumOf(dealRows, 1),
    wonCents: sumOf(dealRows, 2),
    invoicedCents: sumOf(docRows, 0),
    collectedCents: sumOf(docRows, 2),
    outstandingCents: sumOf(docRows, 1),
  };
}

/* -------------------------------------------------------------------------- */
/* payments by method, for a period                                          */
/* -------------------------------------------------------------------------- */

export type PaymentsByMethodRow = { method: string; count: number; cents: number };

/**
 * The period's payments grouped by how they came in, biggest first. A method
 * nobody used in the period is simply absent - the amount CHECK on `payments`
 * forbids a zero or negative row, so every group in the result already has
 * money in it, and there is nothing to filter out by hand.
 */
export async function paymentsByMethod(from: string, to: string): Promise<PaymentsByMethodRow[]> {
  const fromDay = toDateInputValue(from);
  const toDay = toDateInputValue(to);
  const rows = await raw.query(
    `SELECT p.method AS p_method, count(*) AS p_count, sum(p.amount_cents) AS p_cents
     FROM payments p
     JOIN documents d ON d.id = p.document_id
     WHERE p.deleted_at IS NULL AND d.deleted_at IS NULL AND d.kind = 'invoice'
       AND p.paid_on >= ? AND p.paid_on < ?
     GROUP BY p.method
     ORDER BY p_cents DESC, p.method ASC`,
    [fromDay, toDay],
  );
  return rows.map((r) => ({
    method: String(r[0]),
    count: Number(r[1]),
    cents: Number(r[2]),
  }));
}

/* -------------------------------------------------------------------------- */
/* a customer statement                                                      */
/* -------------------------------------------------------------------------- */

export type StatementRow = {
  kind: "invoice" | "payment";
  /** The invoice's `issued_on` for a charge row, the payment's `paid_on` for a payment row. */
  on: string;
  documentId: string;
  number: string;
  /** The invoice's own number for a charge; the method (plus a reference) for a payment. */
  label: string;
  chargeCents: number;
  paidCents: number;
  /** The running balance after this row. */
  balanceCents: number;
};

/**
 * A customer statement for one inclusive local range: "1 March to 31 March",
 * the way a printed statement is asked for, not a half-open instant range.
 *
 * Every invoice that left the building (`sent`, `partial` or `paid`) and was
 * issued in the window is a charge row; every live payment against any of the
 * customer's invoices, paid in the window, is a payment row. Both sets also
 * read what happened BEFORE the window, purely to fold into
 * `openingBalanceCents` - everything charged before `fromDay` less everything
 * paid before `fromDay` - which is what makes the running balance on the first
 * printed row correct rather than starting from zero as if the customer's
 * history began on the 1st.
 *
 * An empty `CustomerRef` answers zeros and no rows, the same rule every other
 * function in this file follows.
 */
export async function statementRows(
  ref: CustomerRef,
  fromDay: string,
  toDay: string,
): Promise<{
  openingBalanceCents: number;
  rows: StatementRow[];
  closingBalanceCents: number;
  chargedCents: number;
  paidCents: number;
}> {
  const contactId = ref.contactId ?? null;
  const companyId = ref.companyId ?? null;
  if (contactId === null && companyId === null) {
    return { openingBalanceCents: 0, rows: [], closingBalanceCents: 0, chargedCents: 0, paidCents: 0 };
  }

  const clauses: string[] = [];
  const params: (string | null)[] = [];
  if (contactId !== null) {
    clauses.push(`d.contact_id = ?`);
    params.push(contactId);
  }
  if (companyId !== null) {
    clauses.push(`d.company_id = ?`);
    params.push(companyId);
  }
  const customerScope = `(${clauses.join(" OR ")})`;

  const [invoiceRows, paymentRows] = await Promise.all([
    raw.query(
      `SELECT d.id AS d_id, d.number AS d_number, d.issued_on AS d_issued_on, d.total_cents AS d_total_cents
       FROM documents d
       WHERE d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status IN ('sent', 'partial', 'paid')
         AND d.issued_on IS NOT NULL AND ${customerScope}
       ORDER BY d.issued_on ASC, d.number ASC`,
      params,
    ),
    raw.query(
      `SELECT p.paid_on AS p_paid_on, p.document_id AS p_document_id, d.number AS d_number,
              p.amount_cents AS p_amount_cents, p.method AS p_method, p.reference AS p_reference
       FROM payments p
       JOIN documents d ON d.id = p.document_id
       WHERE p.deleted_at IS NULL AND d.deleted_at IS NULL AND d.kind = 'invoice' AND ${customerScope}
       ORDER BY p.paid_on ASC, d.number ASC`,
      params,
    ),
  ]);

  let openingChargedBefore = 0;
  let openingPaidBefore = 0;
  const rows: StatementRow[] = [];

  for (const r of invoiceRows) {
    const issuedOn = String(r[2]);
    const totalCents = Number(r[3]);
    if (issuedOn < fromDay) {
      openingChargedBefore += totalCents;
      continue;
    }
    if (issuedOn > toDay) continue;
    rows.push({
      kind: "invoice",
      on: issuedOn,
      documentId: String(r[0]),
      number: String(r[1]),
      label: String(r[1]),
      chargeCents: totalCents,
      paidCents: 0,
      balanceCents: 0,
    });
  }

  for (const r of paymentRows) {
    const paidOn = String(r[0]);
    const amountCents = Number(r[3]);
    if (paidOn < fromDay) {
      openingPaidBefore += amountCents;
      continue;
    }
    if (paidOn > toDay) continue;
    const method = String(r[4]);
    const reference = r[5] === null || r[5] === undefined ? null : String(r[5]);
    rows.push({
      kind: "payment",
      on: paidOn,
      documentId: String(r[1]),
      number: String(r[2]),
      label: reference ? `${methodLabel(method)} ${reference}` : methodLabel(method),
      chargeCents: 0,
      paidCents: amountCents,
      balanceCents: 0,
    });
  }

  // Same day: the charge comes before the payment against it, because that is
  // the order the money actually moved in. Ties beyond that go by number.
  rows.sort((a, b) => {
    if (a.on !== b.on) return a.on < b.on ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
    if (a.number !== b.number) return a.number < b.number ? -1 : 1;
    return 0;
  });

  const openingBalanceCents = openingChargedBefore - openingPaidBefore;
  let running = openingBalanceCents;
  let chargedCents = 0;
  let paidCents = 0;
  for (const row of rows) {
    running += row.chargeCents - row.paidCents;
    row.balanceCents = running;
    chargedCents += row.chargeCents;
    paidCents += row.paidCents;
  }

  return { openingBalanceCents, rows, closingBalanceCents: running, chargedCents, paidCents };
}

/* -------------------------------------------------------------------------- */
/* the period, deal by deal                                                   */
/* -------------------------------------------------------------------------- */

export type PerDealMoneyRow = MoneyTotals & {
  dealId: string;
  title: string;
  /** The company if there is one, else the contact, else null. */
  customerName: string | null;
  contactId: string | null;
  companyId: string | null;
  /** When the deal was won, or null while it is still open. */
  closedAt: string | null;
};

/**
 * One row per deal that had money move in the period: quoted in it (the deal
 * was created in it), won in it, invoiced in it, or paid in it. A deal that had
 * none of those is not a row, because a table of zeroes is not a report.
 *
 * The document and payment sums are each computed in their own per-deal
 * subquery rather than by joining documents or payments straight to deals and
 * summing - a deal with three invoices, or an invoice with two payments, would
 * otherwise multiply its own `value_cents` (the classic fan-out that makes a
 * money report wrong in a way nobody notices for a month). Collected is
 * summed straight off `payments.deal_id` - copied onto the payment from its
 * document at the moment it is written, exactly so this query needs one join
 * fewer - rather than through `documents`, and still requires the document's
 * own `deleted_at IS NULL` so a payment on a trashed invoice does not count.
 *
 * Quoted and Open are period-scoped here, not lifetime, for the same reason the
 * headline scopes them: the row has to sum to the figure above it. A deal
 * created last year and invoiced this month is a row, with Quoted $0 and its
 * invoice - which is the truthful reading of "what moved this month".
 */
export async function perDealMoney(from: string, to: string): Promise<PerDealMoneyRow[]> {
  const fromDay = toDateInputValue(from);
  const toDay = toDateInputValue(to);
  // Parameters bind in the order the `?` are written: the three deal CASEs are
  // in the select list, so their pairs of instants come first, then the two
  // per-deal subqueries' pairs of days.
  const params = [
    from, to,
    from, to,
    from, to,
    fromDay, toDay,
    fromDay, toDay,
    fromDay, toDay,
  ];

  const rows = await raw.query(
    `SELECT dl.id                                   AS dl_id,
            dl.title                                AS dl_title,
            dl.contact_id                           AS dl_contact_id,
            dl.company_id                           AS dl_company_id,
            dl.closed_at                            AS dl_closed_at,
            co.name                                 AS co_name,
            trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) AS c_name,
            CASE WHEN dl.created_at >= ? AND dl.created_at < ?
                 THEN dl.value_cents ELSE 0 END     AS dl_quoted_cents,
            CASE WHEN ${OPEN_DEAL} AND dl.created_at >= ? AND dl.created_at < ?
                 THEN dl.value_cents ELSE 0 END     AS dl_open_cents,
            CASE WHEN s.is_won = 1 AND dl.closed_at IS NOT NULL
                      AND dl.closed_at >= ? AND dl.closed_at < ?
                 THEN dl.value_cents ELSE 0 END     AS dl_won_cents,
            coalesce(m.invoiced_cents, 0)           AS m_invoiced_cents,
            coalesce(col.collected_cents, 0)        AS m_collected_cents,
            coalesce(m.outstanding_cents, 0)        AS m_outstanding_cents
     FROM deals dl
     JOIN stages s ON s.id = dl.stage_id
     LEFT JOIN companies co ON co.id = dl.company_id
     LEFT JOIN contacts c ON c.id = dl.contact_id
     LEFT JOIN (
       SELECT d.deal_id AS deal_id,
              sum(CASE WHEN ${INVOICED}    AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END) AS invoiced_cents,
              sum(CASE WHEN ${OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents - coalesce(pay.paid_cents, 0) ELSE 0 END) AS outstanding_cents
       FROM documents d
       LEFT JOIN ${PAID_BY_DOCUMENT} pay ON pay.document_id = d.id
       WHERE d.deal_id IS NOT NULL
       GROUP BY d.deal_id
     ) m ON m.deal_id = dl.id
     LEFT JOIN (
       SELECT p.deal_id AS deal_id, sum(p.amount_cents) AS collected_cents
       FROM payments p
       JOIN documents d2 ON d2.id = p.document_id
       WHERE p.deleted_at IS NULL AND d2.deleted_at IS NULL AND d2.kind = 'invoice'
         AND p.deal_id IS NOT NULL AND p.paid_on >= ? AND p.paid_on < ?
       GROUP BY p.deal_id
     ) col ON col.deal_id = dl.id
     WHERE dl.deleted_at IS NULL
     ORDER BY dl.closed_at DESC, dl.title ASC`,
    params,
  );

  const dealRows = rows
    .map((r) => {
      const companyName = r[5] === null || r[5] === undefined ? null : String(r[5]);
      const contactName = r[6] === null || r[6] === undefined ? "" : String(r[6]).trim();
      return {
        dealId: String(r[0]),
        title: String(r[1]),
        contactId: r[2] === null || r[2] === undefined ? null : String(r[2]),
        companyId: r[3] === null || r[3] === undefined ? null : String(r[3]),
        closedAt: r[4] === null || r[4] === undefined ? null : String(r[4]),
        customerName: companyName ?? (contactName.length > 0 ? contactName : null),
        quotedCents: Number(r[7]),
        openCents: Number(r[8]),
        wonCents: Number(r[9]),
        invoicedCents: Number(r[10]),
        collectedCents: Number(r[11]),
        outstandingCents: Number(r[12]),
      };
    })
    .filter((row) => hasMoney(row));

  const orphan = await orphanRow(fromDay, toDay);
  return orphan ? [...dealRows, orphan] : dealRows;
}

function hasMoney(row: MoneyTotals): boolean {
  return (
    row.quotedCents !== 0 ||
    row.openCents !== 0 ||
    row.wonCents !== 0 ||
    row.invoicedCents !== 0 ||
    row.collectedCents !== 0 ||
    row.outstandingCents !== 0
  );
}

/** The id `perDealMoney` gives the catch-all row, so a caller can key on it. */
export const NO_DEAL_ROW_ID = "__no_deal__";

/**
 * The one row that makes the table add up: every document in the period whose
 * deal is missing.
 *
 * Two ways a document gets here, both reachable by hand. A document raised
 * before round 3 made a deal compulsory has `deal_id` NULL. And a deal that is
 * soft-deleted after its invoice was sent still owns the document, but is
 * filtered out of the table by `dl.deleted_at IS NULL` above - so the money is
 * real, it is in the headline `periodMoney` returns, and it belonged to no
 * visible row. A reader who added the column up got a different answer from the
 * figure printed over it, with nothing on screen to explain the gap.
 *
 * It carries no deal value: a trashed deal is not Quoted, Open or Won, and a
 * document with no deal never had a value to carry. Only the billed money.
 * Collected is read off `payments.deal_id` directly (null, or pointing at a
 * now-trashed deal) rather than through `documents`, the same shortcut
 * `perDealMoney`'s own `col` subquery takes.
 */
async function orphanRow(fromDay: string, toDay: string): Promise<PerDealMoneyRow | null> {
  const [docRows, payRows] = await Promise.all([
    raw.query(
      `SELECT coalesce(sum(CASE WHEN ${INVOICED}    AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
              coalesce(sum(CASE WHEN ${OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents - coalesce(pay.paid_cents, 0) ELSE 0 END), 0) AS outstanding_cents
       FROM documents d
       LEFT JOIN ${PAID_BY_DOCUMENT} pay ON pay.document_id = d.id
       LEFT JOIN deals dl ON dl.id = d.deal_id
       WHERE d.deal_id IS NULL OR dl.id IS NULL OR dl.deleted_at IS NOT NULL`,
      [fromDay, toDay, fromDay, toDay],
    ),
    raw.query(
      `SELECT coalesce(sum(p.amount_cents), 0) AS collected_cents
       FROM payments p
       JOIN documents d2 ON d2.id = p.document_id
       LEFT JOIN deals dl ON dl.id = p.deal_id
       WHERE p.deleted_at IS NULL AND d2.deleted_at IS NULL AND d2.kind = 'invoice'
         AND (p.deal_id IS NULL OR dl.id IS NULL OR dl.deleted_at IS NOT NULL)
         AND p.paid_on >= ? AND p.paid_on < ?`,
      [fromDay, toDay],
    ),
  ]);

  const row: PerDealMoneyRow = {
    dealId: NO_DEAL_ROW_ID,
    title: "No job",
    customerName: null,
    contactId: null,
    companyId: null,
    closedAt: null,
    quotedCents: 0,
    openCents: 0,
    wonCents: 0,
    invoicedCents: sumOf(docRows, 0),
    collectedCents: sumOf(payRows, 0),
    outstandingCents: sumOf(docRows, 1),
  };
  return hasMoney(row) ? row : null;
}
