/**
 * Unpaid invoices: everything sent and not yet paid, overdue first.
 *
 * Built from Today's own `Section` and `Row` (DESIGN.md §5, §9). Today's one
 * primary block is the Due now count, already spent, so this section's count
 * stays plain tabular text - `emphasis` is never set here. "Overdue" carries
 * no colour of its own (§5 "What has no colour" names the word explicitly):
 * the badge is always neutral and the words - "Overdue by 12 days" - do the
 * work, the same way DueNow's own rows do it.
 *
 * `useUnpaidInvoices` already returns overdue rows first (worst first) and
 * then the rows due within the window, soonest first, so this component only
 * renders what it is given.
 *
 * An empty section collapses to one line rather than a panel
 * (docs/STATUS.md's complaint about three empty panels stacked on Today) -
 * see `Section`'s `emptyInline`.
 *
 * It also carries the drafts line, because drafts are the other half of the
 * same question and they arrive without being asked for. `scheduleRunner` runs
 * about two seconds after the app opens and raises a DRAFT invoice for every
 * recurring schedule that is due; nothing told the owner, so the invoice sat
 * there unsent, earning nothing, indistinguishable from one he made himself
 * (CPO audit, F-LB-10). A draft is not money owed - it counts nowhere and it
 * is not a row here - so it is one sentence under the section rather than a
 * section of its own.
 */
import { Link, useLocation } from "wouter";
import { CheckCircle } from "@/ui/icons";
import { Badge, Button, toast } from "@/ui";
import { Row, Section } from "@/features/today/components/Section";
import { formatMoney } from "@/lib/money";
import { todayLocal } from "@/lib/dates";
import {
  useInvoiceSettings,
  useMarkPaid,
  useOutstandingSummary,
  useUnpaidInvoices,
  type UnpaidRow,
} from "@/features/invoices/lib/hooks";
import { customerLabel, dueLabel } from "@/features/invoices/lib/format";

function RowActions({ row }: { row: UnpaidRow }) {
  const [, navigate] = useLocation();
  const markPaid = useMarkPaid();

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        iconLeft={<CheckCircle size={16} weight="bold" aria-hidden="true" />}
        loading={markPaid.isPending}
        loadingLabel="Saving"
        onClick={() => {
          markPaid.mutate(
            { id: row.document.id, paidOn: todayLocal() },
            {
              onSuccess: () =>
                toast.success(`Marked ${row.document.number} paid.`),
              onError: () =>
                toast.error(`${row.document.number} did not save.`),
            },
          );
        }}
      >
        Mark paid
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/invoices/${row.document.id}`)}
      >
        Open
      </Button>
    </>
  );
}

/**
 * "2 invoices are drafted and not sent yet." Nothing when there are none.
 *
 * Deliberately not a count of "things to do": a draft the owner is still
 * writing is a perfectly good state, and this only has to make sure he knows
 * it exists before he wonders why a customer never paid.
 */
function DraftsLine() {
  const { data } = useOutstandingSummary();
  const drafts = data?.draftCount ?? 0;
  if (drafts === 0) return null;

  return (
    <p
      data-testid="unsent-drafts"
      className="pt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
    >
      {drafts === 1
        ? "1 invoice is drafted and not sent yet."
        : `${drafts} invoices are drafted and not sent yet.`}{" "}
      <Link
        href="/invoices"
        className="text-[var(--color-text)] underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
      >
        Open invoices
      </Link>
    </p>
  );
}

export function UnpaidInvoicesSection() {
  const { data, isLoading } = useUnpaidInvoices();
  const { data: settings } = useInvoiceSettings();
  const rows = data ?? [];

  // The drafts line sits outside `Section` rather than inside it: Section puts
  // its children in a `<ul>`, and drops them altogether when it collapses to
  // one line - and an unsent draft is exactly as worth knowing about when
  // nothing is unpaid as when something is. The wrapper keeps the two as one
  // child of Today's stack so the line tucks under the section instead of
  // floating a full gap below it.
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <Section
        id="unpaid-invoices"
        title="Unpaid invoices"
        count={rows.length}
        isLoading={isLoading}
        isEmpty={rows.length === 0}
        emptyInline={{ text: "nothing unpaid" }}
      >
        {rows.map((row) => {
          const name = customerLabel(row.document);
          // The badge already says when it is due, so the sub-line says what it
          // is instead. The same sentence twice on one row is noise.
          const subtitle = row.document.dealTitle
            ? `${row.document.number} · ${row.document.dealTitle}`
            : row.document.number;
          return (
            <Row
              key={row.document.id}
              badge={
                <Badge tone="neutral">{dueLabel(row.document.dueOn)}</Badge>
              }
              title={name}
              titleText={name}
              subtitle={subtitle}
              subtitleText={subtitle}
              money={formatMoney(
                row.document.totalCents,
                settings?.currency,
                settings?.locale,
              )}
              actions={<RowActions row={row} />}
            />
          );
        })}
      </Section>
      <DraftsLine />
    </div>
  );
}
