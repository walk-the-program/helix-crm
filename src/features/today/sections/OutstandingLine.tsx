/**
 * "3 unpaid, $2,150.00 outstanding, 1 part paid, 1 overdue by 12 days."
 *
 * One sentence under Today's Unpaid invoices section: what the owner is
 * actually owed, once the money already banked has come off. Before payments
 * existed (LR-PX-A), "outstanding" meant the total of every sent invoice, so
 * a $3,000 job with a $1,500 deposit already paid still read as $3,000 owed
 * — a number that made him chase a customer who had paid him that morning.
 * `useOutstandingSummary` now sums BALANCES and counts the partly paid ones,
 * and this is where Today says so.
 *
 * The sentence itself is `summarySentence`, the invoices feature's own
 * wording, called rather than copied: the Invoices screen prints the same
 * string from the same function, so the two screens cannot drift into two
 * different accounts of the same money.
 *
 * It renders nothing at all when there is nothing outstanding and nothing
 * drafted. A line that says "Nothing outstanding." every day is a line he
 * stops reading, and the section above it already says "nothing unpaid" in
 * that state.
 */
import { Link } from "wouter";
import { useFormats } from "@/app/formats";
import {
  summarySentence,
  type OutstandingSummary,
} from "@/features/invoices/lib/format";
import { useOutstandingSummary } from "@/features/invoices/lib/hooks";

/** Whether there is a fact worth a sentence. */
export function hasOutstandingToSay(
  summary: OutstandingSummary | undefined,
): summary is OutstandingSummary {
  if (!summary) return false;
  return summary.sentCount > 0;
}

export function OutstandingLine() {
  const { data } = useOutstandingSummary();
  const formats = useFormats();

  if (!hasOutstandingToSay(data)) return null;

  return (
    <p
      data-testid="today-outstanding"
      className="pt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
    >
      {summarySentence(data, formats.currency, formats.locale)}{" "}
      <Link
        href="/reports/receivables"
        className="text-[var(--color-text)] underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
      >
        Open receivables
      </Link>
    </p>
  );
}
