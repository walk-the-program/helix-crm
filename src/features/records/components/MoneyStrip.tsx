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
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardGroupLabel,
  CardRow,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  toast,
} from "@/ui";
import { formatBreakdown, formatMoneyTrim } from "@/lib/money";
import { todayLocal } from "@/lib/dates";
import { useFormats } from "@/app/formats";
import * as money from "@/db/repos/money";
import type { CustomerRef, MoneyTotals } from "@/db/repos/money";
import * as paymentsRepo from "@/db/repos/payments";
import { methodLabel } from "@/db/repos/payments";
import { paidOfLabel } from "@/features/invoices/lib/format";

export type MoneyFigure = {
  label: string;
  cents: number;
  /** The one figure drawn as the primary block, at most one per strip. */
  primary?: boolean;
  /** The quiet second line, e.g. a deal's upfront + monthly split. */
  note?: string | null;
  testId?: string;
  /**
   * Render this text instead of the formatted `cents` value - e.g.
   * "$500.00 of $1,200.00" under the "Collected" label when a deal is only
   * partly collected (packet task 6). `cents` still drives nothing else here;
   * a caller that sets this owns the whole sentence.
   */
  valueText?: string | null;
};

export function MoneyStrip(props: {
  figures: MoneyFigure[];
  testId?: string;
  /** The record's own currency; the workspace's is the fallback. */
  currency?: string;
}) {
  // `formatMoneyTrim` used to be called here with no currency and no locale at
  // all, so the most prominent money in the product - the deal page's four
  // figures - printed US dollars in a CAD workspace whatever the settings
  // said. `Formats` has no trimming variant, so the trim stays and the
  // workspace's currency and locale are handed to it.
  const formats = useFormats();
  const currency = props.currency ?? formats.currency;
  const money = (cents: number) => formatMoneyTrim(cents, currency, formats.locale);
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
              {figure.valueText ?? money(figure.cents)}
            </span>
          ) : (
            <span
              data-testid={figure.testId}
              className="money text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-text)]"
            >
              {figure.valueText ?? money(figure.cents)}
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
 *
 * On a WON deal the same figure is labelled "Won", because that is what it
 * now is. The strip used to read Quoted on a won job, and it read it from the
 * sum of quote DOCUMENTS rather than the deal's value, so a won $1,450 job
 * showed $0 in all four figures and nothing on the screen said it had been
 * won at all (CPO audit, F-LA-3; ruling R5 settled Quoted = value_cents).
 */
export function DealMoneyStrip(props: {
  money: MoneyTotals | undefined;
  oneTimeCents: number;
  recurringMonthlyCents: number;
  currency?: string;
  isWon?: boolean;
}) {
  const money = props.money;
  const breakdown =
    props.recurringMonthlyCents > 0
      ? formatBreakdown(props.oneTimeCents, props.recurringMonthlyCents, {
          currency: props.currency,
          upfrontLabel: true,
        })
      : null;

  // "Collected $X of $Y" once a job is only partly paid (packet task 6): the
  // label already says Collected, so this is just the fraction, not a whole
  // sentence repeating the word.
  const collectedCents = money?.collectedCents ?? 0;
  const invoicedCents = money?.invoicedCents ?? 0;
  const partlyCollected = collectedCents > 0 && collectedCents < invoicedCents;

  return (
    <MoneyStrip
      testId="deal-money"
      currency={props.currency}
      figures={[
        {
          label: props.isWon ? "Won" : "Quoted",
          cents: money?.quotedCents ?? 0,
          primary: true,
          note: breakdown,
          testId: "deal-value",
        },
        { label: "Invoiced", cents: invoicedCents, testId: "deal-invoiced" },
        {
          label: "Collected",
          cents: collectedCents,
          valueText: partlyCollected
            ? paidOfLabel(collectedCents, invoicedCents, props.currency)
            : null,
          testId: "deal-collected",
        },
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
 *
 * Open leads the four, because a customer with a live job and nothing closed
 * yet is not worth nothing. The strip used to open on Won, so a contact with a
 * $14,800 job in flight read $0 · $0 · $0 — every figure honest, and the
 * screen still wrong about the person (CPO audit, F-LA-14; ruling R1 added
 * `openCents`).
 */
export function CustomerMoneyStrip(props: {
  money: MoneyTotals | undefined;
  /** What this customer still owes, across every invoice (packet task 5). */
  balanceCents?: number;
}) {
  const money = props.money;
  return (
    <MoneyStrip
      testId="customer-money"
      figures={[
        { label: "Open", cents: money?.openCents ?? 0, testId: "customer-open" },
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
        {
          label: "Balance",
          cents: props.balanceCents ?? 0,
          testId: "customer-balance",
        },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* LR-PX-A / W2: the customer's balance and their recent payments             */
/* -------------------------------------------------------------------------- */

/** What this contact or company still owes, across every invoice. */
export function useCustomerBalance(ref: CustomerRef) {
  const contactId = ref.contactId ?? null;
  const companyId = ref.companyId ?? null;
  return useQuery({
    queryKey: ["money", "customer-balance", contactId, companyId] as const,
    queryFn: () => money.customerBalanceCents({ contactId, companyId }),
    enabled: contactId !== null || companyId !== null,
  });
}

/** The customer's most recent payments, newest first, trimmed to `limit`. */
function useCustomerPayments(ref: CustomerRef, limit: number) {
  const contactId = ref.contactId ?? null;
  const companyId = ref.companyId ?? null;
  return useQuery({
    queryKey: ["invoices", "customer-payments", contactId, companyId] as const,
    queryFn: async () => {
      const rows = await paymentsRepo.listForCustomer({ contactId, companyId });
      return rows.slice(0, limit);
    },
    enabled: contactId !== null || companyId !== null,
  });
}

/**
 * The period picker behind "Statement…": two dates, defaulting to this month,
 * then `saveStatementPdf` (W3's file - `src/features/invoices/lib/
 * statementFile.ts`). Loaded dynamically, the way `DocumentPage.writePdf`
 * already loads `pdfFile.ts`: nothing needs pdf-lib until the owner asks for
 * one.
 */
function StatementDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  companyId: string | null;
  name: string;
}) {
  const { open, onOpenChange, contactId, companyId, name } = props;
  const [fromDay, setFromDay] = useState<string | null>(null);
  const [toDay, setToDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const today = todayLocal();
    setFromDay(`${today.slice(0, 7)}-01`);
    setToDay(today);
    setError(null);
  }, [open]);

  async function confirm() {
    if (!fromDay || !toDay) {
      setError("Pick a start and an end date.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { saveStatementPdf } = await import("@/features/invoices/lib/statementFile");
      const result = await saveStatementPdf({
        ref: { contactId, companyId },
        name,
        fromDay,
        toDay,
      });
      if (result.path) {
        toast.success(`Saved ${result.path.split(/[\\/]/).pop()}`);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That statement could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="statement-dialog">
        <DialogHeader>
          <DialogTitle>Statement for {name}</DialogTitle>
          <DialogDescription>Choose the period the statement covers.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="From">
            <DatePicker aria-label="From" value={fromDay} onChange={setFromDay} />
          </Field>
          <Field label="To" error={error ?? undefined}>
            <DatePicker aria-label="To" value={toDay} onChange={setToDay} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void confirm()}>
            Save statement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The money card's payments half: a short list of what this customer has
 * recently paid, and the way to a full statement. Kept short on purpose - the
 * full story is what the statement is for (packet task 5).
 */
export function CustomerPaymentsCard(props: {
  contactId?: string | null;
  companyId?: string | null;
  /** The customer's display name, for the statement's title and file name. */
  name: string;
}) {
  const contactId = props.contactId ?? null;
  const companyId = props.companyId ?? null;
  const formats = useFormats();
  const { data: payments } = useCustomerPayments({ contactId, companyId }, 5);
  const [statementOpen, setStatementOpen] = useState(false);
  const rows = payments ?? [];

  return (
    <div>
      <CardGroupLabel>Payments</CardGroupLabel>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            variant="quiet"
            title="Nothing recorded from this customer yet."
            action={
              <Button variant="secondary" size="sm" onClick={() => setStatementOpen(true)}>
                Statement…
              </Button>
            }
          />
        ) : (
          <>
            {rows.map((payment) => (
              <CardRow key={payment.id}>
                <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {formats.date(payment.paidOn)} · {payment.documentNumber} ·{" "}
                  {methodLabel(payment.method)}
                </span>
                <span className="money flex-none text-right text-[length:var(--text-base)] text-[var(--color-text)]">
                  {formats.money(payment.amountCents)}
                </span>
              </CardRow>
            ))}
            <CardRow className="justify-end">
              <Button variant="ghost" size="sm" onClick={() => setStatementOpen(true)}>
                Statement…
              </Button>
            </CardRow>
          </>
        )}
      </Card>

      <StatementDialog
        open={statementOpen}
        onOpenChange={setStatementOpen}
        contactId={contactId}
        companyId={companyId}
        name={props.name}
      />
    </div>
  );
}
