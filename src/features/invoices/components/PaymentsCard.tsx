/**
 * Payments: the running story of what has come in against one invoice.
 *
 * Shown on the invoice page for every invoice, whatever its status - a draft
 * or a void one shows the one sentence that says why a new payment cannot be
 * recorded (`paymentsBlockedReason`) rather than a button that would throw,
 * but a void invoice that was partly paid before it was voided still shows
 * its history, because that money did arrive.
 *
 * The table is oldest first, like `payments.listForDocument` already reads
 * them, so the Balance column reads top to bottom the way the job's money
 * actually moved. Remove is soft and reversible: the toast carries Undo for
 * ten seconds and undo calls `payments.restore` directly
 * (`useRestorePayment`) rather than `changeLog.undoBatch` - LR-PX-A's
 * decision, because only the payments repository's own `restore` recomputes
 * the invoice's status.
 */
import { useState } from "react";
import { PencilSimple, Trash } from "@/ui/icons";
import {
  Button,
  CardGroupLabel,
  EmptyState,
  IconButton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  toast,
} from "@/ui";
import type { Document } from "@/db/repos/documents";
import type { Payment, PaymentMethod } from "@/db/repos/payments";
import { methodLabel } from "@/db/repos/payments";
import { useFormats } from "@/app/formats";
import {
  balanceLabel,
  paidOfLabel,
  paymentsBlockedReason,
  paymentsRunningBalance,
} from "@/features/invoices/lib/format";
import { resolveErrorMessage } from "@/features/invoices/components/DealInvoicesPanel";
import {
  usePaymentsForDocument,
  useRecordPayment,
  useRemovePayment,
  useRestorePayment,
  useUpdatePayment,
} from "@/features/invoices/lib/hooks";
import { RecordPaymentDialog, type RecordPaymentValues } from "@/features/invoices/components/RecordPaymentDialog";

export function PaymentsCard(props: { document: Document }) {
  const { document } = props;
  const formats = useFormats();
  const { data, isLoading } = usePaymentsForDocument(document.id);
  const recordPayment = useRecordPayment();
  const updatePayment = useUpdatePayment();
  const removePayment = useRemovePayment();
  const restorePayment = useRestorePayment();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);

  if (document.kind !== "invoice") return null;

  const rows = data ?? [];
  const paidCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const balanceCents = document.totalCents - paidCents;
  const runningBalances = paymentsRunningBalance(
    document.totalCents,
    rows.map((row) => row.amountCents),
  );
  const lastMethod = (rows[rows.length - 1]?.method as PaymentMethod | undefined) ?? null;
  const blockedReason = paymentsBlockedReason(document);
  const canRecordNew = blockedReason === null && balanceCents > 0;

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(payment: Payment) {
    setEditing(payment);
    setDialogOpen(true);
  }

  async function onConfirm(values: RecordPaymentValues) {
    if (editing) {
      await updatePayment.mutateAsync({
        id: editing.id,
        patch: {
          amountCents: values.amountCents,
          paidOn: values.paidOn,
          method: values.method,
          reference: values.reference,
          note: values.note,
        },
      });
      toast.success(`Changed the payment on ${document.number}.`);
      return;
    }
    await recordPayment.mutateAsync({ documentId: document.id, ...values });
    toast.success(`Recorded ${formats.money(values.amountCents)} on ${document.number}.`);
  }

  async function onRemove(payment: Payment) {
    try {
      await removePayment.mutateAsync(payment.id);
      toast.undo(`Removed the ${formats.money(payment.amountCents)} payment.`, () => {
        restorePayment.mutate(payment.id, {
          onError: (err) => toast.error(resolveErrorMessage(err, "That payment could not be put back.")),
        });
      });
    } catch (err) {
      toast.error(resolveErrorMessage(err, "That payment could not be removed."));
    }
  }

  // Balance for the dialog: the invoice's balance, plus back the amount of
  // whichever payment is being edited - the repository's own overpayment
  // check already excludes it, and the dialog's description should say the
  // same number.
  const dialogBalance = editing ? balanceCents + editing.amountCents : balanceCents;

  const headerLine =
    rows.length > 0 && balanceCents <= 0
      ? "Paid in full"
      : `Paid ${paidOfLabel(paidCents, document.totalCents, formats.currency, formats.locale)} · ${balanceLabel(balanceCents, formats.currency, formats.locale)}`;

  return (
    <div>
      <CardGroupLabel>Payments</CardGroupLabel>

      {blockedReason && rows.length === 0 ? (
        <EmptyState variant="quiet" title={blockedReason} />
      ) : (
        <>
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] pb-[var(--space-3)]">
              <p className="text-[length:var(--text-base)] text-[var(--color-text)]">{headerLine}</p>
              {canRecordNew ? (
                <Button variant="secondary" size="sm" onClick={openNew}>
                  Record payment
                </Button>
              ) : null}
            </div>
          ) : null}

          {blockedReason && rows.length > 0 ? (
            <p className="pb-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              {blockedReason}
            </p>
          ) : null}

          {isLoading ? (
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Reading the database.
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              variant="quiet"
              title="No payments recorded yet."
              description="Record one once money comes in."
              action={
                <Button variant="secondary" size="sm" onClick={openNew}>
                  Record payment
                </Button>
              }
            />
          ) : (
            <Table data-testid="payments-table">
              <THead>
                <TR>
                  <TH className="w-[16%]">Date</TH>
                  <TH className="w-[18%]">Method</TH>
                  <TH className="w-[22%]">Reference</TH>
                  <TH className="w-[16%]" align="right">Amount</TH>
                  <TH className="w-[16%]" align="right">Balance</TH>
                  <TH className="w-[12%]" align="right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row, index) => (
                  <TR key={row.id}>
                    <TD className="tabular whitespace-nowrap">{formats.date(row.paidOn)}</TD>
                    <TD muted>{methodLabel(row.method)}</TD>
                    <TD muted>
                      <span className="block truncate" title={row.reference ?? undefined}>
                        {row.reference || "—"}
                      </span>
                    </TD>
                    <TD align="right" className="money">
                      {formats.money(row.amountCents)}
                    </TD>
                    <TD align="right" dashZero={runningBalances[index] === 0} className="money">
                      {formats.moneyOrDash(runningBalances[index])}
                    </TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-[var(--space-1)]">
                        <IconButton
                          label="Edit payment"
                          icon={<PencilSimple size={16} weight="bold" aria-hidden="true" />}
                          size="sm"
                          onClick={() => openEdit(row)}
                        />
                        <IconButton
                          label="Remove payment"
                          icon={<Trash size={16} weight="bold" aria-hidden="true" />}
                          variant="danger"
                          size="sm"
                          onClick={() => void onRemove(row)}
                        />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      <RecordPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        documentNumber={document.number}
        balanceCents={dialogBalance}
        currency={formats.currency}
        locale={formats.locale}
        editing={editing}
        lastMethod={lastMethod}
        onConfirm={onConfirm}
      />
    </div>
  );
}
