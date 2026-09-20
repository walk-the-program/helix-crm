/**
 * Receivables (/reports/receivables): AR aging and every invoice behind it.
 *
 * `AgingBlock` already owns the screen's one primary block - the total owed,
 * the flat accent fill (DESIGN.md §5, §9) - so nothing else here is coloured.
 * The table underneath is the same list rule as the rest of the product: a
 * hairline between rows, no zebra striping, no vertical rules, no row rails,
 * numbers right-aligned in tabular figures.
 *
 * The route lives in this feature but the page is a report, so it wears the
 * reports feature's own `ReportsFrame`: that is what carries the tab strip
 * across Overview, Revenue, Deals, Contacts and companies and this screen, and
 * it supplies the page header, which is why there is no `PageHeader` here.
 * Without it this tab was a dead end - the owner could reach Receivables and
 * had no way back to the other reports.
 *
 * "Copy as CSV" (F-LB-19) on the outstanding list below builds its text
 * through `receivablesCsv` in `lib/format.ts`, which calls the same `toCsv` /
 * `centsToDecimalString` helpers every report card's own button uses - the
 * header row is exactly the five column labels above, and the amount pastes
 * as a plain decimal, not a formatted currency string.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Button,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  toast,
} from "@/ui";
import { formatMoney } from "@/lib/money";
import { formatDateDisplay, todayLocal } from "@/lib/dates";
import * as receivables from "@/db/repos/receivables";
import { ReportsFrame } from "@/features/leads";
import { AgingBlock } from "@/features/invoices/components/AgingBlock";
import { useInvoiceSettings } from "@/features/invoices/lib/hooks";
import { receivablesCsv } from "@/features/invoices/lib/format";

function useOutstandingList() {
  return useQuery({
    queryKey: ["invoices", "receivables", "outstanding"],
    queryFn: () => receivables.outstanding(todayLocal()),
  });
}

export function ReceivablesScreen() {
  const { data: rows, isLoading } = useOutstandingList();
  const { data: settings } = useInvoiceSettings();

  async function handleCopyCsv() {
    if (!rows) return;
    try {
      await navigator.clipboard.writeText(receivablesCsv(rows));
      toast.success("Copied the report to the clipboard");
    } catch {
      toast.error("The clipboard refused it.");
    }
  }

  return (
    <ReportsFrame
      active="receivables"
      title="Receivables"
      subtitle="What customers owe you, and how late it is."
    >
      <AgingBlock />

      {isLoading ? (
        <p className="py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Reading the database.
        </p>
      ) : !rows || rows.length === 0 ? (
        // AgingBlock above already says "Nothing owed to you right now" for
        // this exact case - the outstanding list is empty precisely when the
        // aging total is zero, since both read the same sent-and-unpaid set
        // (src/db/repos/receivables.ts). A second empty state here would just
        // repeat it (F-LB-11c).
        null
      ) : (
        <div className="flex flex-col gap-[var(--space-2)]">
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => void handleCopyCsv()}>
              Copy as CSV
            </Button>
          </div>
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
        </div>
      )}
    </ReportsFrame>
  );
}
