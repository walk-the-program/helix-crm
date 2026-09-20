/**
 * "Mark paid": the date the money arrived, how it arrived, and an optional
 * note.
 *
 * Statuses here are marked by hand (D21) - Helix does not take payments and
 * does not watch a bank feed - so this dialog is the whole of the record. The
 * date defaults to today because that is what it is nine times out of ten, and
 * it is a real date field because the tenth time is a cheque that cleared on
 * Friday and is being entered on Monday.
 *
 * The method is a short list rather than free text so the reports can count
 * it, with "Other" carrying the note for everything the list does not have.
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
  Textarea,
} from "@/ui";
import { formatMoney } from "@/lib/money";
import { todayLocal } from "@/lib/dates";

export const PAYMENT_METHODS = [
  { value: "bank", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

export type MarkPaidValues = {
  paidOn: string;
  method: string;
  note: string;
};

export function MarkPaidDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The invoice being settled, for the sentence at the top. */
  number: string;
  totalCents: number;
  currency?: string;
  locale?: string;
  onConfirm: (values: MarkPaidValues) => Promise<void>;
}) {
  const { open, onOpenChange, number, totalCents, currency, locale, onConfirm } = props;
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [method, setMethod] = useState("bank");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Reopening the dialog on a different invoice must not show the last one's
  // answers, so the form resets every time it opens rather than on close.
  useEffect(() => {
    if (!open) return;
    setPaidOn(todayLocal());
    setMethod("bank");
    setNote("");
    setError(null);
  }, [open]);

  async function confirm() {
    if (paidOn.trim().length === 0) {
      setError("Pick the date the money arrived.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm({ paidOn, method, note });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="mark-paid-dialog">
        <DialogHeader>
          <DialogTitle>Mark {number} paid</DialogTitle>
          <DialogDescription>
            {formatMoney(totalCents, currency, locale)} against this invoice.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="Date paid" error={error ?? undefined}>
            <Input
              type="date"
              value={paidOn}
              onChange={(event) => setPaidOn(event.target.value)}
            />
          </Field>

          <Field label="How it was paid">
            <Select
              value={method}
              onValueChange={setMethod}
              options={PAYMENT_METHODS}
              ariaLabel="How it was paid"
            />
          </Field>

          <Field
            label="Note"
            hint="Optional. A cheque number, or which account it landed in."
          >
            <Textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void confirm()}>
            Mark paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
