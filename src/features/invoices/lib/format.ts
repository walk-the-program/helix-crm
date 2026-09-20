/**
 * The words this feature puts on a screen, in one file so no two screens
 * describe the same state differently.
 *
 * An invoice is money someone owes you, so the copy is calm and specific:
 * "3 unpaid, $4,150 outstanding, 1 overdue by 12 days" rather than a warning.
 * DESIGN.md section 5 says the word "overdue" has no colour; it is the words
 * and the position at the top of a list that carry the weight.
 *
 * The CSV builders at the bottom (F-LB-19) live here rather than inline in
 * the components so the exact columns and number formatting are unit
 * testable without rendering anything - they call the same `toCsv` /
 * `centsToDecimalString` helpers every other report card's own "Copy as
 * CSV" button uses.
 */
import { formatMoney, centsToDecimalString } from "@/lib/money";
import { parseDateOnly, todayLocal, formatDateDisplay } from "@/lib/dates";
import { toCsv } from "@/features/leads/lib/reportKeys";
import type { Aging, ReceivableRow } from "@/db/repos/receivables";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "brand"
  | "secondary"
  | "highlight"
  | "success"
  | "warning"
  | "danger";

/** The word on a status pill. Sentence case, always a word, never a colour alone. */
export function statusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "paid":
      return "Paid";
    case "void":
      return "Void";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    default:
      return status;
  }
}

/**
 * The tint a status pill wears. Only two states carry a semantic colour -
 * paid (success) and declined (danger) - because those are the two the owner
 * reads as an outcome. Everything else is neutral: a sent invoice is the
 * normal state of an invoice, not an alarm.
 */
export function statusTone(status: string): BadgeTone {
  if (status === "paid" || status === "accepted") return "success";
  if (status === "declined") return "danger";
  return "neutral";
}

/** Whole days from `dueOn` to `reference`. Positive means past due. */
export function daysOverdue(dueOn: string | null, reference: string = todayLocal()): number {
  if (!dueOn) return 0;
  const due = parseDateOnly(dueOn);
  const now = parseDateOnly(reference);
  if (!due || !now) return 0;
  return Math.round((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
}

export function isOverdue(
  document: { status: string; kind: string; dueOn: string | null },
  reference: string = todayLocal(),
): boolean {
  if (document.kind !== "invoice" || document.status !== "sent") return false;
  return daysOverdue(document.dueOn, reference) > 0;
}

/** "Overdue by 12 days", "Due today", "Due in 4 days". */
export function dueLabel(dueOn: string | null, reference: string = todayLocal()): string {
  if (!dueOn) return "No due date";
  const days = daysOverdue(dueOn, reference);
  if (days > 0) return days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`;
  if (days === 0) return "Due today";
  const ahead = Math.abs(days);
  return ahead === 1 ? "Due in 1 day" : `Due in ${ahead} days`;
}

/** "per month" / "per year" on a recurring line. */
export function intervalLabel(kind: string, interval: string | null): string {
  if (kind !== "recurring") return "";
  return interval === "year" ? "per year" : "per month";
}

export type OutstandingSummary = {
  /** Invoices that are sent and not yet paid. */
  sentCount: number;
  outstandingCents: number;
  overdueCount: number;
  /** The worst one, for the sentence. */
  worstOverdueDays: number;
  draftCount: number;
};

/**
 * The one sentence the list and Today both print. Specific numbers, no
 * adjectives, and it never says anything it cannot show a row for.
 */
export function summarySentence(
  summary: OutstandingSummary,
  currency?: string,
  locale?: string,
): string {
  if (summary.sentCount === 0 && summary.draftCount === 0) {
    return "Nothing outstanding.";
  }

  const parts: string[] = [];
  if (summary.sentCount > 0) {
    parts.push(`${summary.sentCount} unpaid`);
    parts.push(`${formatMoney(summary.outstandingCents, currency, locale)} outstanding`);
  }
  if (summary.overdueCount === 1 && summary.worstOverdueDays > 0) {
    parts.push(
      `1 overdue by ${summary.worstOverdueDays} ${
        summary.worstOverdueDays === 1 ? "day" : "days"
      }`,
    );
  } else if (summary.overdueCount > 1) {
    parts.push(
      `${summary.overdueCount} overdue, the oldest by ${summary.worstOverdueDays} days`,
    );
  }
  if (summary.draftCount > 0) {
    parts.push(`${summary.draftCount} still a draft`);
  }
  return `${parts.join(", ")}.`;
}

/** Who a document is for, in the one line a row has room for. */
export function customerLabel(document: {
  companyName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
}): string {
  const person = [document.contactFirstName ?? "", document.contactLastName ?? ""]
    .join(" ")
    .trim();
  if (document.companyName && person) return `${document.companyName} · ${person}`;
  return document.companyName || person || "No customer yet";
}

/** The file name a PDF is offered under: the number, and nothing else. */
export function pdfFileName(numberText: string): string {
  return `${numberText.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
}

/* -------------------------------------------------------------------------- */
/* F-LB-11: which empty state is true                                        */
/* -------------------------------------------------------------------------- */

/**
 * Whether the workspace has ever raised a document - any kind, any status,
 * including a draft, a quote or a void. `total` is the unfiltered count the
 * Invoices screen's own "all documents" query already reads; `undefined`
 * means that count has not loaded yet, and this assumes true rather than
 * flashing the first-invoice state on a workspace that has plenty.
 */
export function hasAnyDocuments(total: number | undefined): boolean {
  return total === undefined ? true : total > 0;
}

export const NOTHING_OUTSTANDING_TITLE = "Nothing outstanding";
export const NOTHING_OUTSTANDING_DESCRIPTION = "Every invoice you have sent has been paid.";
export const NO_INVOICES_YET_TITLE = "No invoices yet";

/**
 * "Raise one from a job" / "...a deal" / "...a quote" - whichever word the
 * workspace has chosen for its `deals` table (F-LB-D22). The sentence used to
 * say "job" unconditionally, which was wrong the moment a workspace kept the
 * default "Deals" vocabulary or switched to "Quotes": the one screen that
 * introduces the concept named it differently from the sidebar that sent the
 * owner there.
 */
export function noInvoicesYetDescription(vocabularyLower: string): string {
  return `An invoice is the bill you send when the work is done. Raise one from a ${vocabularyLower}, or start one here.`;
}

/**
 * The words for the Unpaid tab's empty state. "Nothing outstanding" is only
 * true once at least one invoice has existed to be paid; a workspace that has
 * never raised one gets the first-invoice state instead (F-LB-11a/b).
 */
export function unpaidEmptyCopy(
  documentsExist: boolean,
  vocabularyLower: string,
): { title: string; description: string } {
  return documentsExist
    ? { title: NOTHING_OUTSTANDING_TITLE, description: NOTHING_OUTSTANDING_DESCRIPTION }
    : { title: NO_INVOICES_YET_TITLE, description: noInvoicesYetDescription(vocabularyLower) };
}

/* -------------------------------------------------------------------------- */
/* F-LB-19: "Copy as CSV" for the two receivables views                      */
/* -------------------------------------------------------------------------- */

/**
 * The AR aging table as CSV: the five buckets in their fixed order, then the
 * total row, matching `AgingBlock`'s own rows exactly. `bucketLabel` is
 * injected rather than imported so this stays free of any component import -
 * `AgingBlock.tsx` passes its own `BUCKET_LABELS`.
 */
export function agingCsv(
  aging: Aging,
  bucketLabel: (bucket: Aging["rows"][number]["bucket"]) => string,
): string {
  return toCsv(
    ["Bucket", "Invoices", "Amount"],
    [
      ...aging.rows.map((row) => [bucketLabel(row.bucket), row.count, centsToDecimalString(row.cents)]),
      ["Total owed", aging.totalCount, centsToDecimalString(aging.totalCents)],
    ],
  );
}

/**
 * The outstanding-invoices list as CSV. The header row is the same five
 * labels `ReceivablesScreen`'s table renders; "Days over" keeps the table's
 * own em dash for a row that is not yet late, and "Amount" is a plain decimal
 * rather than a formatted currency string, so it pastes as a number.
 */
export function receivablesCsv(rows: ReceivableRow[], locale?: string): string {
  return toCsv(
    ["Number", "Customer", "Due", "Days over", "Amount"],
    rows.map((row) => [
      row.number,
      row.customer,
      formatDateDisplay(row.dueOn, locale),
      row.daysOverdue > 0 ? row.daysOverdue : "—",
      centsToDecimalString(row.totalCents),
    ]),
  );
}
