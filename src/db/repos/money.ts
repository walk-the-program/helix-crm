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
 *               building - `sent` or `paid`. A draft has not been billed to
 *               anybody and a voided invoice is a billing that was taken
 *               back, so neither counts.
 *   Collected   what the money landed as: invoices marked paid. There is no
 *               payments table in this schema - an invoice is paid in full on
 *               `paid_on` or it is not paid - so Collected is the total of the
 *               paid invoices and part payments do not exist yet. A deposit is
 *               taken by raising a deposit invoice and a balance invoice, not
 *               by part-paying one.
 *   Outstanding invoiced and not yet collected.
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
 *   Collected        the day the money arrived.
 *
 * So a period's Collected can exceed its Invoiced, which is not a bug: it is
 * January's invoice being paid in February. And a deal can be Quoted in one
 * month and Won in the next, which is the normal shape of a job.
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

/** An invoice the customer actually received. */
const INVOICED = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status IN ('sent', 'paid')`;

/** An invoice that was paid. */
const COLLECTED = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status = 'paid' AND d.paid_on IS NOT NULL`;

/** An invoice that was billed and is still owed. */
const OUTSTANDING = `d.kind = 'invoice' AND d.deleted_at IS NULL AND d.status = 'sent'`;

/**
 * A deal that is still live. Word for word the test `reports.topCompanies` and
 * `reports.openPipeline` use for their open columns, so the pipeline figure on
 * the reports and `openCents` here can never disagree.
 */
const OPEN_DEAL = `dl.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0`;

function sumOf(rows: unknown[][], index: number): number {
  if (rows.length === 0) return 0;
  const value = rows[0][index];
  return value === null || value === undefined ? 0 : Number(value);
}

/**
 * The three document sums over one WHERE clause on `documents d`, which every
 * lifetime question (a deal, a customer) shares. One query rather than three,
 * so the numbers are read at one instant and cannot disagree with each other.
 */
async function documentSums(
  scope: string,
  params: (string | number | null)[],
): Promise<{ invoiced: number; collected: number; outstanding: number }> {
  const rows = await raw.query(
    `SELECT coalesce(sum(CASE WHEN ${INVOICED}    THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
            coalesce(sum(CASE WHEN ${COLLECTED}   THEN d.total_cents ELSE 0 END), 0) AS collected_cents,
            coalesce(sum(CASE WHEN ${OUTSTANDING} THEN d.total_cents ELSE 0 END), 0) AS outstanding_cents
     FROM documents d
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
 */
export async function periodMoney(from: string, to: string): Promise<MoneyTotals> {
  const fromDay = toDateInputValue(from);
  const toDay = toDateInputValue(to);

  const [docRows, dealRows] = await Promise.all([
    raw.query(
      `SELECT coalesce(sum(CASE WHEN ${INVOICED} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
              coalesce(sum(CASE WHEN ${COLLECTED} AND d.paid_on  >= ? AND d.paid_on  < ? THEN d.total_cents ELSE 0 END), 0) AS collected_cents,
              coalesce(sum(CASE WHEN ${OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS outstanding_cents
       FROM documents d`,
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
    collectedCents: sumOf(docRows, 1),
    outstandingCents: sumOf(docRows, 2),
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
 * One row per deal that had money move in the period: quoted in it (the deal
 * was created in it), won in it, invoiced in it, or paid in it. A deal that had
 * none of those is not a row, because a table of zeroes is not a report.
 *
 * The document sums are computed in a subquery per deal rather than by joining
 * documents to deals and summing - a deal with three invoices would otherwise
 * multiply its own `value_cents` by three, which is the classic fan-out that
 * makes a money report wrong in a way nobody notices for a month.
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
  // in the select list, so their pairs of instants come first, then the
  // subquery's three pairs of days.
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
            coalesce(m.collected_cents, 0)          AS m_collected_cents,
            coalesce(m.outstanding_cents, 0)        AS m_outstanding_cents
     FROM deals dl
     JOIN stages s ON s.id = dl.stage_id
     LEFT JOIN companies co ON co.id = dl.company_id
     LEFT JOIN contacts c ON c.id = dl.contact_id
     LEFT JOIN (
       SELECT d.deal_id AS deal_id,
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
 */
async function orphanRow(fromDay: string, toDay: string): Promise<PerDealMoneyRow | null> {
  const rows = await raw.query(
    `SELECT coalesce(sum(CASE WHEN ${INVOICED}    AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS invoiced_cents,
            coalesce(sum(CASE WHEN ${COLLECTED}   AND d.paid_on   >= ? AND d.paid_on   < ? THEN d.total_cents ELSE 0 END), 0) AS collected_cents,
            coalesce(sum(CASE WHEN ${OUTSTANDING} AND d.issued_on >= ? AND d.issued_on < ? THEN d.total_cents ELSE 0 END), 0) AS outstanding_cents
     FROM documents d
     LEFT JOIN deals dl ON dl.id = d.deal_id
     WHERE d.deal_id IS NULL OR dl.id IS NULL OR dl.deleted_at IS NOT NULL`,
    [fromDay, toDay, fromDay, toDay, fromDay, toDay],
  );

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
    invoicedCents: sumOf(rows, 0),
    collectedCents: sumOf(rows, 1),
    outstandingCents: sumOf(rows, 2),
  };
  return hasMoney(row) ? row : null;
}
