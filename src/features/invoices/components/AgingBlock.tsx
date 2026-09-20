/**
 * AR aging: what customers owe, grouped by how late it is.
 *
 * Built from `Card` / `CardRow` / `CardGroupLabel` in `@/ui` rather than
 * Today's `Panel` - this lives on a reports screen, not on Today, and the
 * house pattern for a grouped figure on a reports or record screen is the
 * card, the way `DealPage.tsx` uses it for the deal's own identity panel.
 *
 * This is the one primary block on the screen it sits on (DESIGN.md §5, §9):
 * the total owed gets the flat accent fill and the sticker shadow, drawn the
 * same way `DealPage.tsx` draws the deal value, and nothing else here is
 * coloured - an overdue bucket is not a warning, it is a row with a number in
 * it (§5 "What has no colour" names the word "overdue" explicitly). Takes no
 * required props so a second screen can mount it with one line.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardGroupLabel, CardRow } from "@/ui";
import { formatMoney } from "@/lib/money";
import { todayLocal } from "@/lib/dates";
import { iqk, useInvoiceSettings } from "@/features/invoices/lib/hooks";
import * as receivables from "@/db/repos/receivables";
import type { AgingBucket } from "@/db/repos/receivables";

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
  const { data: settings } = useInvoiceSettings();
  // A workspace set to GBP must not be shown dollars. formatMoney falls back
  // to USD when it is handed nothing, which is the wrong answer here.
  const money = (cents: number) => formatMoney(cents, settings?.currency, settings?.locale);

  const aging = data?.aging;
  const collected = data?.collected;
  const nothingOwed = !isLoading && (!aging || aging.totalCents === 0);

  return (
    <div>
      <CardGroupLabel>Money owed to you</CardGroupLabel>
      <Card>
        {isLoading ? (
          <div className="px-[var(--space-4)] py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Reading the database.
          </div>
        ) : nothingOwed ? (
          <div className="px-[var(--space-4)] py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Nothing owed to you right now.
          </div>
        ) : (
          <>
            {aging!.rows.map((row) => (
              <CardRow key={row.bucket}>
                <span className="text-[var(--color-text)]">{BUCKET_LABELS[row.bucket]}</span>
                <div className="flex items-baseline gap-[var(--space-6)]">
                  <span className="tabular w-[3ch] text-right text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    {row.count}
                  </span>
                  <span className="money w-[9ch] text-right text-[var(--color-text)]">
                    {money(row.cents)}
                  </span>
                </div>
              </CardRow>
            ))}
            {/* Extra vertical room: the accent block wears the 4px sticker
                overhang, and DESIGN.md section 3 is explicit that the offset
                needs space under it or it reads as a smear against the next
                hairline rather than as an offset card. */}
            <CardRow className="border-t border-[var(--color-border-strong)] py-[var(--space-4)]">
              <span className="font-medium text-[var(--color-text)]">Total owed</span>
              <div className="flex items-baseline gap-[var(--space-6)]">
                <span className="tabular w-[3ch] text-right text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {aging!.totalCount}
                </span>
                {/* The one primary block on this screen, drawn exactly the way
                    DealPage.tsx draws the deal value. */}
                <span className="money inline-flex items-center bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-accent-text)]">
                  {money(aging!.totalCents)}
                </span>
              </div>
            </CardRow>
          </>
        )}
      </Card>
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
