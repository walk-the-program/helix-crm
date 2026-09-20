/**
 * AR aging: what customers owe, grouped by how late it is.
 *
 * A real `<table>`, from the kit (F-LB-D8). It was a `Card` of `CardRow`s with
 * hand-measured `w-[3ch]` and `w-[9ch]` spans faking columns, which meant the
 * one money table on Receivables was the one money table in the product that
 * got none of the kit's treatment: no `TH` semantics for a screen reader, no
 * shared numeric alignment, and no `dashZero`, so an empty bucket printed
 * "$0.00" where every other period table in Reports now prints an em dash.
 * Five buckets are always rendered, including the empty ones, because the
 * shape of the ageing is the report - a gap at "Over 90 days" is the number
 * the owner is looking for.
 *
 * This is the one primary block on the screen it sits on (DESIGN.md §5, §9):
 * the total owed gets the flat accent fill, drawn the same way
 * `DealPage.tsx` draws the deal value, and nothing else here is
 * coloured - an overdue bucket is not a warning, it is a row with a number in
 * it (§5 "What has no colour" names the word "overdue" explicitly). Takes no
 * required props so a second screen can mount it with one line.
 *
 * "Copy as CSV" (F-LB-19) builds its text through `agingCsv` in
 * `lib/format.ts`, which calls the same `toCsv` / `centsToDecimalString`
 * helpers every report card's own button already uses, so this aging table
 * pastes the same way the rest of Reports does: money as a plain decimal, not
 * a formatted "$1,234.56" string a spreadsheet would read as text.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  CardGroupLabel,
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  toast,
} from "@/ui";
import { useFormats } from "@/app/formats";
import { todayLocal } from "@/lib/dates";
import { iqk } from "@/features/invoices/lib/hooks";
import * as receivables from "@/db/repos/receivables";
import type { AgingBucket } from "@/db/repos/receivables";
import { agingCsv } from "@/features/invoices/lib/format";

const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Not yet due",
  "1-30": "1 to 30 days",
  "31-60": "31 to 60 days",
  "61-90": "61 to 90 days",
  "90+": "Over 90 days",
};

function useAging() {
  return useQuery({
    queryKey: iqk.aging(),
    queryFn: async () => {
      const reference = todayLocal();
      const [aging, collected] = await Promise.all([
        receivables.aging(reference),
        receivables.collectedThisMonth(reference),
      ]);
      return { aging, collected };
    },
  });
}

export function AgingBlock() {
  const { data, isLoading } = useAging();
  // A workspace set to GBP must not be shown dollars. formatMoney falls back
  // to USD when it is handed nothing, which is the wrong answer here - so
  // this reads the workspace's own currency and locale through useFormats().
  const formats = useFormats();
  const money = (cents: number) => formats.money(cents);

  const aging = data?.aging;
  const collected = data?.collected;
  const nothingOwed = !isLoading && (!aging || aging.totalCents === 0);

  async function handleCopyCsv() {
    if (!aging) return;
    try {
      await navigator.clipboard.writeText(agingCsv(aging, (bucket) => BUCKET_LABELS[bucket]));
      toast.success("Copied the report to the clipboard");
    } catch {
      toast.error("The clipboard refused it.");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <CardGroupLabel>Money owed to you</CardGroupLabel>
        {nothingOwed ? null : (
          <Button variant="ghost" size="sm" onClick={() => void handleCopyCsv()}>
            Copy as CSV
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className="py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Reading the database.
        </p>
      ) : nothingOwed ? (
        <EmptyState variant="quiet" title="Nothing owed to you right now." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-[56%]">How late</TH>
              <TH className="w-[14%]" align="right">
                Invoices
              </TH>
              <TH className="w-[30%]" align="right">
                Amount
              </TH>
            </TR>
          </THead>
          <TBody>
            {aging!.rows.map((row) => (
              <TR key={row.bucket}>
                <TD primary>{BUCKET_LABELS[row.bucket]}</TD>
                <TD align="right" muted dashZero={row.count === 0}>
                  {row.count === 0 ? "—" : row.count}
                </TD>
                <TD align="right" className="money" dashZero={row.cents === 0}>
                  {row.cents === 0 ? "—" : money(row.cents)}
                </TD>
              </TR>
            ))}
            {/* The total is the screen's one primary block, drawn the way
                DealPage.tsx draws the deal value. It sits in the table rather
                than under it so the figure lines up with the column it totals
                - the whole point of making this a table. */}
            <TR className="border-t border-[var(--color-border-strong)]">
              <TD primary>Total owed</TD>
              <TD align="right" muted>
                {aging!.totalCount}
              </TD>
              <TD align="right">
                <span className="money inline-flex items-center bg-[var(--color-accent)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-accent-text)]">
                  {money(aging!.totalCents)}
                </span>
              </TD>
            </TR>
          </TBody>
        </Table>
      )}
      {/* "Collected this month: $0.00 across 0 invoices" is not a fact worth
          printing - it is silent, the same way the aging card above says
          nothing at all rather than "Nothing owed: $0.00" (F-LB-11c). */}
      {collected && collected.count > 0 ? (
        <p className="mt-[var(--space-2)] px-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Collected this month: {money(collected.cents)} across {collected.count}{" "}
          invoice{collected.count === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}
