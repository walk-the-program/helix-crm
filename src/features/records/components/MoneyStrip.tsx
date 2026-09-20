/**
 * The money strip: the same four numbers, in the same order, wherever money
 * is shown on a record.
 *
 * Every figure comes from `src/db/repos/money.ts`, which is the single
 * definition of quoted, won, invoiced and collected
 * (docs/rounds/2026-09-20-round-3.md, "Money model"). Nothing here adds up a
 * line or a document — a screen that re-derives money is how two screens end
 * up disagreeing.
 *
 * One figure carries the accent fill and the rest are plain: the deal page
 * already spends its single primary block on the deal's value, so the strip
 * inherits it rather than adding a second (docs/DESIGN.md §6).
 */
import { formatBreakdown, formatMoneyTrim } from "@/lib/money";
import type { MoneyTotals } from "@/db/repos/money";

export type MoneyFigure = {
  label: string;
  cents: number;
  /** The one figure drawn as the primary block, at most one per strip. */
  primary?: boolean;
  /** The quiet second line, e.g. a deal's upfront + monthly split. */
  note?: string | null;
  testId?: string;
};

export function MoneyStrip(props: { figures: MoneyFigure[]; testId?: string }) {
  return (
    <div
      data-testid={props.testId ?? "money-strip"}
      className="flex flex-wrap items-start gap-x-[var(--space-6)] gap-y-[var(--space-3)]"
    >
      {props.figures.map((figure) => (
        <div key={figure.label} className="flex flex-col gap-[var(--space-1)]">
          <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {figure.label}
          </span>
          {figure.primary ? (
            <span
              data-testid={figure.testId}
              className="money inline-flex items-center bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-accent-text)]"
            >
              {formatMoneyTrim(figure.cents)}
            </span>
          ) : (
            <span
              data-testid={figure.testId}
              className="money text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-text)]"
            >
              {formatMoneyTrim(figure.cents)}
            </span>
          )}
          {figure.note ? (
            <span className="money text-[length:var(--text-sm)] tabular-nums text-[var(--color-text-muted)]">
              {figure.note}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The deal page's strip. Quoted is the deal's own value, so it keeps the
 * accent fill and carries the upfront + monthly breakdown when the deal has a
 * recurring part.
 */
export function DealMoneyStrip(props: {
  money: MoneyTotals | undefined;
  oneTimeCents: number;
  recurringMonthlyCents: number;
  currency?: string;
}) {
  const money = props.money;
  const breakdown =
    props.recurringMonthlyCents > 0
      ? formatBreakdown(props.oneTimeCents, props.recurringMonthlyCents, {
          currency: props.currency,
          upfrontLabel: true,
        })
      : null;

  return (
    <MoneyStrip
      testId="deal-money"
      figures={[
        {
          label: "Quoted",
          cents: money?.quotedCents ?? 0,
          primary: true,
          note: breakdown,
          testId: "deal-value",
        },
        { label: "Invoiced", cents: money?.invoicedCents ?? 0, testId: "deal-invoiced" },
        { label: "Collected", cents: money?.collectedCents ?? 0, testId: "deal-collected" },
        {
          label: "Outstanding",
          cents: money?.outstandingCents ?? 0,
          testId: "deal-outstanding",
        },
      ]}
    />
  );
}

/**
 * The lifetime strip on a contact or a company: what this customer has ever
 * been worth, with nothing highlighted — a record page's primary block belongs
 * to the record, not to a summary of it.
 */
export function CustomerMoneyStrip(props: { money: MoneyTotals | undefined }) {
  const money = props.money;
  return (
    <MoneyStrip
      testId="customer-money"
      figures={[
        { label: "Won", cents: money?.wonCents ?? 0, testId: "customer-won" },
        {
          label: "Invoiced",
          cents: money?.invoicedCents ?? 0,
          testId: "customer-invoiced",
        },
        {
          label: "Collected",
          cents: money?.collectedCents ?? 0,
          testId: "customer-collected",
        },
      ]}
    />
  );
}
