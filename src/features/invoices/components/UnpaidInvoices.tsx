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
 */
import { useLocation } from "wouter";
import { CheckCircle } from "@/ui/icons";
import { Badge, Button, toast } from "@/ui";
import { Row, Section } from "@/features/today/components/Section";
import { formatMoney } from "@/lib/money";
import { todayLocal } from "@/lib/dates";
import {
  useInvoiceSettings,
  useMarkPaid,
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
              onSuccess: () => toast.success(`Marked ${row.document.number} paid.`),
              onError: () => toast.error(`${row.document.number} did not save.`),
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

export function UnpaidInvoicesSection() {
  const { data, isLoading } = useUnpaidInvoices();
  const { data: settings } = useInvoiceSettings();
  const rows = data ?? [];

  return (
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
            badge={<Badge tone="neutral">{dueLabel(row.document.dueOn)}</Badge>}
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
  );
}
