/**
 * "Deposit invoice": bill part of the job now, the rest when it is done.
 *
 * Helix has no payments table - an invoice is paid in full on `paid_on` or it
 * is not paid - so "half down" had nowhere to live. An owner taking a deposit
 * had to either mark the whole invoice paid, which overstates Collected and
 * empties Receivables, or leave it unpaid, which understates Collected and
 * lets the full amount go overdue (CPO audit, F-LB-7). Ruling R7: no schema
 * change, two invoices instead.
 *
 * So this raises the first one. The percentage is the way an owner actually
 * says it - "half down", "a third up front" - and the amount is there for the
 * tenth time, when he agreed a round number. Whichever he uses, the figure he
 * is about to invoice is spelled out underneath before he commits to it,
 * because the whole point of the feature is that the two invoices add up.
 *
 * The balance is not raised here. It is the ordinary "Create invoice" on the
 * panel, later, once the work is done - and it carries the deal's lines in
 * full and then subtracts this one by number, which is what makes the pair sum
 * to the job's one-time value to the cent.
 */
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
} from "@/ui";
import { formatMoney, parseMoneyToCents } from "@/lib/money";

const PERCENT_OPTIONS = [
  { value: "25", label: "25%" },
  { value: "33", label: "A third" },
  { value: "50", label: "Half" },
  { value: "75", label: "75%" },
  { value: "custom", label: "An amount" },
];

/** Round to the cent, never up past what is left. */
export function depositCentsFor(
  choice: string,
  amountText: string,
  remainingCents: number,
): number | null {
  if (choice === "custom") {
    const cents = parseMoneyToCents(amountText);
    return cents === null || cents <= 0 ? null : cents;
  }
  const percent = Number.parseInt(choice, 10);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return Math.round((remainingCents * percent) / 100);
}

export function DepositDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The deal's one-time value less anything already billed against it. */
  remainingCents: number;
  currency?: string;
  locale?: string;
  onConfirm: (amountCents: number) => Promise<void>;
}) {
  const { open, onOpenChange, remainingCents, currency, locale, onConfirm } = props;
  const [choice, setChoice] = useState("50");
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChoice("50");
    setAmountText("");
    setError(null);
  }, [open]);

  const money = (cents: number) => formatMoney(cents, currency, locale);
  const depositCents = depositCentsFor(choice, amountText, remainingCents);
  const balanceCents = depositCents === null ? null : remainingCents - depositCents;

  async function confirm() {
    if (depositCents === null) {
      setError("Enter an amount, for example 500.");
      return;
    }
    if (depositCents > remainingCents) {
      setError(`That is more than the ${money(remainingCents)} left on this job.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(depositCents);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="deposit-dialog">
        <DialogHeader>
          <DialogTitle>Invoice a deposit</DialogTitle>
          <DialogDescription>
            {money(remainingCents)} of this job has not been invoiced yet.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="How much up front">
            <Select
              value={choice}
              onValueChange={setChoice}
              options={PERCENT_OPTIONS}
              ariaLabel="How much up front"
            />
          </Field>

          {choice === "custom" ? (
            <Field label="Amount" error={error ?? undefined}>
              <Input
                value={amountText}
                placeholder="500"
                aria-label="Amount"
                onChange={(event) => setAmountText(event.target.value)}
              />
            </Field>
          ) : null}

          <p
            data-testid="deposit-split"
            className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          >
            {depositCents === null || balanceCents === null ? (
              "Pick how much to ask for and the split shows here."
            ) : (
              <>
                Invoice {money(depositCents)} now. {money(balanceCents)} is left for the
                balance invoice when the work is done.
              </>
            )}
          </p>
          {choice !== "custom" && error ? (
            <p className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]">{error}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void confirm()}>
            Invoice the deposit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
