/**
 * Receivables (/reports/receivables): AR aging and every invoice behind it.
 *
 * `AgingBlock` already owns the screen's one primary block - the total owed,
 * flat-filled with the accent and the sticker shadow (DESIGN.md §5, §9) - so
 * nothing else here is coloured. The table underneath is the same list rule
 * as the rest of the product: a hairline between rows, no zebra striping, no
 * vertical rules, no row rails, numbers right-aligned in tabular figures.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  EmptyState,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/ui";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay, todayLocal } from "@/lib/dates";
import * as receivables from "@/db/repos/receivables";
import { AgingBlock } from "@/features/invoices/components/AgingBlock";
import { useInvoiceSettings } from "@/features/invoices/lib/hooks";

function useOutstandingList() {
  return useQuery({
    queryKey: ["invoices", "receivables", "outstanding"],
    queryFn: () => receivables.outstanding(todayLocal()),
  });
}

export function ReceivablesScreen() {
  const { data: rows, isLoading } = useOutstandingList();
  const { data: settings } = useInvoiceSettings();

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        title="Receivables"
        subtitle="What customers owe you, and how late it is."
      />

      <AgingBlock />

      {isLoading ? (
        <p className="py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Reading the database.
        </p>
      ) : !rows || rows.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          description="Every invoice you have sent has been paid."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-[16%]">Number</TH>
              <TH className="w-[34%]">Customer</TH>
              <TH className="w-[16%]">Due</TH>
              <TH className="w-[14%]" align="right">Days over</TH>
              <TH className="w-[20%]" align="right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD primary>
                  <Link
                    href={`/invoices/${row.id}`}
                    className="block truncate text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                    title={row.number}
                  >
                    {row.number}
                  </Link>
                </TD>
                <TD muted>
                  <span className="block truncate" title={row.customer}>
                    {row.customer}
                  </span>
                </TD>
                <TD className="tabular whitespace-nowrap">{formatDateDisplay(row.dueOn)}</TD>
                <TD align="right" className="tabular">
                  {row.daysOverdue > 0 ? row.daysOverdue : "—"}
                </TD>
                <TD align="right" className="money">
                  {formatMoney(row.totalCents, settings?.currency, settings?.locale)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
