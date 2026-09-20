/**
 * "Record payment": an amount, the date it arrived, how it came in, and an
 * optional reference and note.
 *
 * This is what replaces MarkPaidDialog now that a payment is a record rather
 * than a flag (LR-PX decision PX-5). The one-click "Mark paid" on the invoice
 * page still exists and still takes no dialog - it records the balance,
 * today, in one click - but the tenth invoice is a deposit, a partial payment,
 * or a cheque entered three days after it cleared, and this dialog is the
 * whole of that record.
 *
 * The amount defaults to the remaining balance, because settling the invoice
 * in full is the common case; the owner shortens it for a deposit. The date
 * defaults to today for the same reason `MarkPaidDialog` always did.
 *
 * Field errors: `payments.create` / `payments.update` throw a `ValidationError`
 * whose `issues` name the field that is actually wrong - `fieldIssue` (copied
 * from the same pattern `DealInvoicesPanel.resolveErrorMessage` already uses
 * for its own top-level message) puts that sentence on the Amount or Date
 * field rather than a single generic banner. The overpayment refusal is an
 * `amountCents` issue and its message already names the balance
 * ("Record $700.00 or less...") - showing it on the Amount field is the whole
 * of what the packet asks for there.
 */
import { useEffect, useState } from "react";
import {
  Button,
  Combobox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
} from "@/ui";
import { methodLabel, PAYMENT_METHODS, type Payment, type PaymentMethod } from "@/db/repos/payments";
import { centsToDecimalString, formatMoney, parseMoneyToCents } from "@/lib/money";
import { todayLocal } from "@/lib/dates";
import { fieldIssue } from "@/features/invoices/lib/documentActions";
import { resolveErrorMessage } from "@/features/invoices/components/DealInvoicesPanel";

export type RecordPaymentValues = {
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
};

const METHOD_ITEMS = PAYMENT_METHODS.map((method) => ({ id: method, label: methodLabel(method) }));

export function RecordPaymentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The invoice this payment is against, for the sentence at the top. */
  documentNumber: string;
  /** What is left on the invoice - excluding the payment being edited, when
   *  editing one. */
  balanceCents: number;
  currency?: string;
  locale?: string;
  /** Set to correct an existing payment instead of recording a new one. */
  editing?: Payment | null;
  /** The method last used on this invoice, offered as the default over the
   *  fixed "check" for a repeat customer paying the same way every time. */
  lastMethod?: PaymentMethod | null;
  onConfirm: (values: RecordPaymentValues) => Promise<void>;
}) {
  const {
    open,
    onOpenChange,
    documentNumber,
    balanceCents,
    currency,
    locale,
    editing,
    lastMethod,
    onConfirm,
  } = props;

  const [amountText, setAmountText] = useState("");
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const [generalError, setGeneralError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const isEditing = editing != null;

  // Reopening on a different invoice, or switching from editing one payment
  // to recording a new one, must not carry the previous form's answers.
  useEffect(() => {
    if (!open) return;
    setAmountText(
      editing ? centsToDecimalString(editing.amountCents) : centsToDecimalString(balanceCents),
    );
    setPaidOn(editing?.paidOn ?? todayLocal());
    setMethod((editing?.method as PaymentMethod | undefined) ?? lastMethod ?? "check");
    setReference(editing?.reference ?? "");
    setNote(editing?.note ?? "");
    setAmountError(undefined);
    setDateError(undefined);
    setGeneralError(undefined);
  }, [open, editing, lastMethod, balanceCents]);

  const money = (cents: number) => formatMoney(cents, currency, locale);

  async function confirm() {
    setAmountError(undefined);
    setDateError(undefined);
    setGeneralError(undefined);

    const amountCents = parseMoneyToCents(amountText);
    if (amountCents === null || amountCents <= 0) {
      setAmountError("Enter an amount, for example 500.");
      return;
    }
    if (paidOn.trim().length === 0) {
      setDateError("Pick the date the money arrived.");
      return;
    }

    setPending(true);
    try {
      await onConfirm({
        amountCents,
        paidOn,
        method,
        reference: reference.trim().length > 0 ? reference.trim() : null,
        note: note.trim().length > 0 ? note.trim() : null,
      });
      onOpenChange(false);
    } catch (err) {
      const amountMsg = fieldIssue(err, "amountCents");
      const dateMsg = fieldIssue(err, "paidOn");
      if (amountMsg) setAmountError(amountMsg);
      if (dateMsg) setDateError(dateMsg);
      if (!amountMsg && !dateMsg) {
        setGeneralError(resolveErrorMessage(err, "That payment did not save."));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="record-payment-dialog">
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit payment on ${documentNumber}` : `Record a payment on ${documentNumber}`}</DialogTitle>
          <DialogDescription>
            {balanceCents > 0
              ? `${money(balanceCents)} is left on this invoice.`
              : "This invoice is settled."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[var(--space-4)]">
          <Field label="Amount" error={amountError}>
            <Input
              value={amountText}
              placeholder={centsToDecimalString(balanceCents)}
              aria-label="Amount"
              onChange={(event) => setAmountText(event.target.value)}
            />
          </Field>

          <Field label="Date paid" error={dateError}>
            <DatePicker aria-label="Date paid" value={paidOn} onChange={(value) => setPaidOn(value ?? todayLocal())} />
          </Field>

          <Field label="How it was paid">
            <Combobox
              value={method}
              onChange={(next) => setMethod((next as PaymentMethod | null) ?? "other")}
              items={METHOD_ITEMS}
              aria-label="How it was paid"
            />
          </Field>

          <Field label="Reference" hint="Optional. A cheque number, or the last four of a card.">
            <Input
              value={reference}
              aria-label="Reference"
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>

          <Field label="Note" hint="Optional. Anything worth remembering about this one.">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>

          {generalError ? (
            <p role="alert" className="text-[length:var(--text-sm)] text-[var(--color-danger-ink)]">
              {generalError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void confirm()}>
            {isEditing ? "Save payment" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
