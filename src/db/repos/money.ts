/**
 * The money model: Customer → Deal → Invoice → Payment, in four numbers.
 *
 * Every screen that talks about money reads it from here, so the same word
 * means the same thing on the deal page, the customer page and the reports:
 *
 *   Quoted      what was offered to the customer: quote documents that left
 *               the building (never a draft, never a voided quote), whatever
 *               the customer said afterwards. A declined quote was still
 *               quoted.
 *   Won         what the business agreed to do: `deals.value_cents` for deals
 *               sitting in a won stage. This is the deal's annual value
 *               (one-time + twelve months of recurring), which is what the
 *               rest of the product already means by a deal's value.
 *   Invoiced    what was actually billed: invoice documents that left the
 *               building - `sent` or `paid`. A draft has not been billed to
 *               anybody and a voided invoice is a billing that was taken
 *               back, so neither counts.
 *   Collected   what the money landed as: invoices marked paid. There is no
 *               payments table in this schema - an invoice is paid in full on
 *               `paid_on` or it is not paid - so Collected is the total of the
 *               paid invoices and part payments do not exist yet.
 *   Outstanding invoiced and not yet collected.
 *
 * Dates. `closed_at` is an ISO instant, so the won side compares against the
 * period's own instants. `issued_on` and `paid_on` are local calendar days, so
 * the document side compares against the period's local days - taking the day
 * off the instant with `toDateInputValue`, never by slicing the UTC string,
 * which is a day out for any workspace east of UTC.
 *
 * Which date a number belongs to is its own decision, and it is the one the
 * owner would defend: Quoted and Invoiced fall in the period they were issued
 * in, Collected falls in the period the money arrived in, and Won falls in the
 * period the deal closed in. So a period's Collected can exceed its Invoiced,
 * which is not a bug: it is January's invoice being paid in February.
 *
 * Outstanding over a period therefore cannot be `invoiced - collected` (that
 * subtracts one period's payments from another period's bills). It is what it
 * says: the invoices issued in this period that are still unpaid. Over a deal
 * or a customer, where no period is in play, the two definitions agree exactly.
 *
 * Everything here is read-only and every figure is integer cents.
 */
import { raw } from "@/db/client";
import { toDateInputValue } from "@/lib/periods";

/** The four numbers, and what they leave outstanding. */
export type MoneyTotals = {
  quotedCents: number;
  wonCents: number;
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
};

export const ZERO_MONEY: MoneyTotals = {
  quotedCents: 0,
  wonCents: 0,
  invoicedCents: 0,
  collectedCents: 0,
  outstandingCents: 0,
};

/* -------------------------------------------------------------------------- */
/* the filters, written once                                                  */
/* -------------------------------------------------------------------------- */

/** A quote the customer actually received. */
const QUOTED = `d.kind = 'quote' AND d.deleted_at IS NULL AND d.status NOT IN ('draft', 'void')`;

/** An invoice the customer actually received. */
const INVOICED = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status IN ('sent', 'paid')`;

/** An invoice that was paid. */
const COLLECTED = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status = 'paid' AND d.paid_on IS NOT NULL`;

/** An invoice that was billed and is still owed. */
const OUTSTANDING = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status = 'sent'`;

function sumOf(rows: unknown[][], index: number): number {
  if (rows.length === 0) return 0;
  const value = rows[0][index];
  return value === null || value === undefined ? 0 : Number(value);
}

/**
 * The four document sums over one WHERE clause on `documents d`, which every
 * lifetime question (a deal, a customer) shares. One query rather than four,
 * so the numbers are read at one instant and cannot disagree with each other.
 */
async function documentSums(
  scope: string,
  params: (string | number | null)[],
): Promise<{ quoted: number; invoiced: number; collected: number; outstanding: number }> {
  const rows = await raw.query(
    `SELECT coalesce(sum(CASE WHEN ${QUOTED}      THEN d.total_cents ELSE 0 END), 0) AS quoted_cents,
            coalesce(sum(CASE WHEN ${INVOICED}    THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
            coalesce(sum(CASE WHEN ${COLLECTED}   THEN d.total_cents ELSE 0 END), 0) AS collected_cents,
            coalesce(sum(CASE WHEN ${OUTSTANDING} THEN d.total_cents ELSE 0 END), 0) AS outstanding_cents
     FROM documents d
     WHERE ${scope}`,
    params,
  );
  return {
    quoted: sumOf(rows, 0),
    invoiced: sumOf(rows, 1),
    collected: sumOf(rows, 2),
    outstanding: sumOf(rows, 3),
  };
}

/** Won value over one WHERE clause on `deals dl` joined to its stage. */
async function wonSum(scope: string, params: (string | number | null)[]): Promise<number> {
  const rows = await raw.query(
    `SELECT coalesce(sum(dl.value_cents), 0) AS won_cents
     FROM deals dl JOIN stages s ON s.id = dl.stage_id
     WHERE dl.deleted_at IS NULL AND s.is_won = 1 AND ${scope}`,
    params,
  );
  return sumOf(rows, 0);
}

/* -------------------------------------------------------------------------- */
/* one deal                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything ever quoted, won, invoiced and collected against one deal.
 *
 * Documents count through `documents.deal_id`, which is the link the round-3
 * rule makes required on new documents. A document written before that rule,
 * with no deal on it, belongs to the customer but not to any deal, so it shows
 * up in `customerMoney` and not here - which is the honest answer rather than
 * guessing a deal for it.
 */
export async function dealMoney(dealId: string): Promise<MoneyTotals> {
  const [docs, won] = await Promise.all([
    documentSums(`d.deal_id = ?`, [dealId]),
    wonSum(`dl.id = ?`, [dealId]),
  ]);
  return {
    quotedCents: docs.quoted,
    wonCents: won,
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

  const [docs, won] = await Promise.all([
    documentSums(shape.replaceAll("%PREFIX%", "d"), [...params]),
    wonSum(shape.replaceAll("%PREFIX%", "dl"), [...params]),
  ]);
  return {
    quotedCents: docs.quoted,
    wonCents: won,
    invoicedCents: docs.invoiced,
    collectedCents: docs.collected,
    outstandingCents: docs.outstanding,
  };
}

/* -------------------------------------------------------------------------- */
/* a period                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The period's four numbers, each on its own date.
 *
 * `from` and `to` are the half-open ISO instants a `Period` carries. The
 * document dates are calendar days, so they are compared against the period's
 * own local days.
 */
export async function periodMoney(from: string, to: string): Promise<MoneyTotals> {
  const fromDay = toDateInputValue(from);
  const toDay = toDateInputValue(to);

  const [rows, won] = await Promise.all([
    raw.query(
      `SELECT coalesce(sum(CASE WHEN ${QUOTED}   AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS quoted_cents,
              coalesce(sum(CASE WHEN ${INVOICED} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
              coalesce(sum(CASE WHEN ${COLLECTED} AND d.paid_on  >= ? AND d.paid_on  < ? THEN d.total_cents ELSE 0 END), 0) AS collected_cents,
              coalesce(sum(CASE WHEN ${OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS outstanding_cents
       FROM documents d`,
      [fromDay, toDay, fromDay, toDay, fromDay, toDay, fromDay, toDay],
    ),
    wonSum(`dl.closed_at IS NOT NULL AND dl.closed_at >= ? AND dl.closed_at < ?`, [from, to]),
  ]);

  return {
    quotedCents: sumOf(rows, 0),
    wonCents: won,
    invoicedCents: sumOf(rows, 1),
    collectedCents: sumOf(rows, 2),
    outstandingCents: sumOf(rows, 3),
  };
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
 * One row per deal that had money move in the period: won in it, quoted in it,
 * invoiced in it, or paid in it. A deal that had none of those is not a row,
 * because a table of zeroes is not a report.
 *
 * The document sums are computed in a subquery per deal rather than by joining
 * documents to deals and summing - a deal with three invoices would otherwise
 * multiply its own `value_cents` by three, which is the classic fan-out that
 * makes a money report wrong in a way nobody notices for a month.
 */
export async function perDealMoney(from: string, to: string): Promise<PerDealMoneyRow[]> {
  const fromDay = toDateInputValue(from);
  const toDay = toDateInputValue(to);
  // Parameters bind in the order the `?` are written: the won CASE is in the
  // select list, so its pair of instants comes first, then the subquery's four
  // pairs of days.
  const params = [
    from, to,
    fromDay, toDay,
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
            coalesce(m.quoted_cents, 0)             AS m_quoted_cents,
            coalesce(m.invoiced_cents, 0)           AS m_invoiced_cents,
            coalesce(m.collected_cents, 0)          AS m_collected_cents,
            coalesce(m.outstanding_cents, 0)        AS m_outstanding_cents,
            CASE WHEN s.is_won = 1 AND dl.closed_at IS NOT NULL
                      AND dl.closed_at >= ? AND dl.closed_at < ?
                 THEN dl.value_cents ELSE 0 END     AS dl_won_cents
     FROM deals dl
     JOIN stages s ON s.id = dl.stage_id
     LEFT JOIN companies co ON co.id = dl.company_id
     LEFT JOIN contacts c ON c.id = dl.contact_id
     LEFT JOIN (
       SELECT d.deal_id AS deal_id,
              sum(CASE WHEN ${QUOTED}      AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END) AS quoted_cents,
              sum(CASE WHEN ${INVOICED}    AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END) AS invoiced_cents,
              sum(CASE WHEN ${COLLECTED}   AND d.paid_on   >= ? AND d.paid_on   < ? THEN d.total_cents ELSE 0 END) AS collected_cents,
              sum(CASE WHEN ${OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END) AS outstanding_cents
       FROM documents d
       WHERE d.deal_id IS NOT NULL
       GROUP BY d.deal_id
     ) m ON m.deal_id = dl.id
     WHERE dl.deleted_at IS NULL
     ORDER BY dl.closed_at DESC, dl.title ASC`,
    params,
  );

  return rows
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
        invoicedCents: Number(r[8]),
        collectedCents: Number(r[9]),
        outstandingCents: Number(r[10]),
        wonCents: Number(r[11]),
      };
    })
    .filter(
      (row) =>
        row.quotedCents !== 0 ||
        row.invoicedCents !== 0 ||
        row.collectedCents !== 0 ||
        row.outstandingCents !== 0 ||
        row.wonCents !== 0,
    );
}
