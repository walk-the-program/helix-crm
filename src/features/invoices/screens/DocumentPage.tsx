/**
 * One quote or one invoice.
 *
 *   draft   -> edit the lines, Send
 *   sent    -> Mark paid (invoice) / Accept or Decline (quote), Void
 *   settled -> read only, with the PDF still one click away
 *
 * The status is what decides which controls exist, so the page never shows a
 * button that will be refused: the repository's transition table is the same
 * rule, and `canTransition` is what both of them ask.
 *
 * Statuses are marked by hand (D21). Nothing here talks to a bank or takes a
 * payment; "Send" means the owner is about to email the PDF himself, which is
 * why it opens the file rather than just changing a word on the screen.
 *
 * The one primary block is the total. The actions in the header are all
 * secondary, which is deliberate - DESIGN.md allows the brand primary once per
 * view, and on a page about money the money is what earns it.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, DownloadSimple, Envelope, Prohibit, Trash } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  CardGroupLabel,
  CardRow,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  toast,
} from "@/ui";
import { canTransition, get as getDocument } from "@/db/repos/documents";
import { normalizeMethod } from "@/db/repos/payments";
import { useFormats } from "@/app/formats";
import {
  customerLabel,
  dueLabel,
  isOverdue,
  statusLabel,
  statusTone,
} from "@/features/invoices/lib/format";
import {
  useAcceptQuote,
  useDeclineQuote,
  useDocument,
  useInvoiceSettings,
  useMarkPaid,
  useReplaceItems,
  useDeleteDocument,
  useMarkUnpaid,
  useSendDocument,
  useUpdateDocument,
  useVoidDocument,
} from "@/features/invoices/lib/hooks";
import {
  DocumentLines,
  toNewItems,
  useDraftLines,
} from "@/features/invoices/components/DocumentLines";
import { billToTitle } from "@/features/invoices/lib/billTo";
import {
  anyBusy,
  isBusy,
  statusChoices,
  statusIsFixed,
  type BusyState,
} from "@/features/invoices/lib/documentActions";
import { MarkPaidDialog, PAYMENT_METHODS } from "@/features/invoices/components/MarkPaidDialog";

/**
 * The words the owner picked, not the value the row stores.
 *
 * "Paid Sep 20, 2026 · bank" is the database talking. He chose "Bank
 * transfer" from a list of five and that is what the page should read back to
 * him. An unknown value (an import, an older build) prints as it is rather
 * than disappearing.
 */
function paymentMethodLabel(value: string): string {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value;
}

/**
 * A label/value row. `CardRow` is a bare flex row with a hairline under it, so
 * the two halves are supplied here rather than as props - the kit deliberately
 * does not fix what goes in a row.
 */
function DetailRow(props: { label: string; children: React.ReactNode }) {
  return (
    <CardRow>
      <span className="flex-none text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        {props.label}
      </span>
      <span className="min-w-0 truncate text-right">{props.children}</span>
    </CardRow>
  );
}

export function DocumentPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data, isLoading } = useDocument(id);
  const { data: settings } = useInvoiceSettings();
  const formats = useFormats();

  const document = data?.document ?? null;
  const items = data?.items;
  const editable = document?.status === "draft";
  const [lines, setLines] = useDraftLines(items, Boolean(editable));

  // Null means "showing what is stored"; a string means the owner has typed.
  // It is cleared whenever the route moves to another document, because wouter
  // reuses this component instance across :id changes and the note from the
  // last invoice would otherwise appear on the next one.
  const [notes, setNotes] = useState<string | null>(null);
  useEffect(() => {
    setNotes(null);
  }, [id]);

  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unpaying, setUnpaying] = useState(false);
  // ONE action at a time, named. A single shared boolean used to put a
  // spinner on every button in the header at once; see documentActions.ts.
  const [busy, setBusy] = useState<BusyState>(null);

  const replaceItems = useReplaceItems();
  const updateDocument = useUpdateDocument();
  const send = useSendDocument();
  const markPaid = useMarkPaid();
  const voidIt = useVoidDocument();
  const markUnpaid = useMarkUnpaid();
  const deleteDocument = useDeleteDocument();
  const accept = useAcceptQuote();
  const decline = useDeclineQuote();

  if (isLoading) {
    return (
      <div className="flex items-center gap-[var(--space-2)] p-[var(--space-6)]">
        <Spinner /> <span className="text-[var(--color-text-muted)]">Loading</span>
      </div>
    );
  }

  if (!document || !settings) {
    return (
      <EmptyState
        title="That document is gone"
        description="It may have been deleted."
        action={
          <Button variant="primary" onClick={() => navigate("/invoices")}>
            Back to invoices
          </Button>
        }
      />
    );
  }

  const isQuote = document.kind === "quote";
  const noun = isQuote ? "quote" : "invoice";
  const money = (cents: number) => formats.money(cents);

  async function saveLines() {
    const next = toNewItems(lines);
    if (!next) {
      toast.error("Every line needs a description, a quantity and an amount.");
      return false;
    }
    try {
      await replaceItems.mutateAsync({ id, items: next });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Those lines did not save.");
      return false;
    }
  }

  /** Render, save and open the PDF. Used by Send and by Download. */
  async function writePdf(openAfter: boolean): Promise<string | null> {
    if (!document || !settings) return null;
    // Re-read rather than trust the render's copy: Send saves the lines and
    // flips the status immediately before this runs, and the PDF has to show
    // what was actually stored, not what was on screen a moment ago.
    const fresh = await getDocument(document.id);
    if (!fresh) return null;
    // pdf-lib and the four embedded brand faces behind this module are the
    // second-heaviest thing in the bundle, and nothing needs them until the
    // owner asks for a PDF. Imported here, at the only call site, rather than
    // at the top of a screen that mounts whenever a document is opened.
    const { saveDocumentPdf } = await import("@/features/invoices/lib/pdfFile");
    const result = await saveDocumentPdf(fresh.document, fresh.items, settings, {
      openAfter,
    });
    return result.path;
  }

  async function onSend() {
    setBusy("send");
    try {
      if (editable && !(await saveLines())) return;
      await send.mutateAsync(id);
      const path = await writePdf(true);
      toast.success(
        path
          ? `Marked ${document?.number} sent, and opened the PDF.`
          : `Marked ${document?.number} sent.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `That ${noun} did not send.`);
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    setBusy("download");
    try {
      const path = await writePdf(false);
      if (path) toast.success(`Saved ${path.split(/[\\/]/).pop()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The PDF could not be written.");
    } finally {
      setBusy(null);
    }
  }

  async function onAccept() {
    setBusy("accept");
    try {
      const result = await accept.mutateAsync(id);
      if (result.invoice) {
        toast.success(`Accepted. ${result.invoice.number} is ready to send.`);
        navigate(`/invoices/${result.invoice.id}`);
      } else {
        toast.success("Accepted. The monthly billing starts from here.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * The Status control. An invoice handed over on paper still has to become
   * "sent", and before this the only way to get there was the Send button,
   * which also writes and opens a PDF. This moves the document and nothing
   * else - same repository call, same dates, no file.
   *
   * "Paid", "Accepted" and "Declined" hand off to the same dialogs the buttons
   * use, because the money needs a date and a method and a declined quote is
   * worth one confirmation.
   */
  async function onStatusPicked(next: string) {
    if (!document || next === document.status) return;
    if (next === "paid") {
      setPaying(true);
      return;
    }
    if (next === "declined") {
      setDeclining(true);
      return;
    }
    if (next === "accepted") {
      await onAccept();
      return;
    }
    if (next !== "sent") return;

    // Going back to "sent" from "paid" is an undo, not a send: it clears the
    // payment rather than stamping a new sent date, and it is worth one
    // confirmation because it moves money off the reports.
    if (document.status === "paid") {
      setUnpaying(true);
      return;
    }

    setBusy("status");
    try {
      if (editable && !(await saveLines())) return;
      await send.mutateAsync(id);
      toast.success(`Marked ${document.number} sent.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That status did not save.");
    } finally {
      setBusy(null);
    }
  }

  const overdue = isOverdue(document);
  /**
   * Send writes the PDF, opens it and marks the document sent. It belongs to a
   * DRAFT and nothing else.
   *
   * `canTransition(kind, status, "sent")` is not the right test any more:
   * phase one made paid -> sent legal so a payment recorded by mistake could be
   * undone (F-LB-4), and that quietly put a Send button back on every paid
   * invoice. Pressing it would have re-sent the PDF and stamped a new sent
   * date while leaving `paid_on` behind - a paid invoice, in the sent column,
   * with a payment date. The way back from paid is the Status control, which
   * asks for confirmation and clears the payment.
   */
  const canSend = document.status === "draft";
  const canPay = canTransition(document.kind, document.status, "paid");
  /**
   * Void keeps the document and spends its number, which is the honest record
   * of a billing that was taken back. A DRAFT was never sent to anybody, so
   * there is nothing to take back and nothing to preserve - it is deleted
   * instead. Offering both on a draft asked the owner to choose between two
   * words for "get rid of it" with consequences he has no way to guess.
   */
  const canVoid =
    document.status !== "draft" && canTransition(document.kind, document.status, "void");
  const canAccept = canTransition(document.kind, document.status, "accepted");
  const statusOptions = statusChoices(document.kind, document.status);
  const statusFixed = statusIsFixed(document.kind, document.status);

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        breadcrumb={
          <Link
            href="/invoices"
            className="inline-flex w-fit items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-faint)] no-underline hover:text-[var(--color-text)] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            <ArrowLeft size={14} weight="bold" aria-hidden="true" /> Invoices
          </Link>
        }
        title={document.number}
        subtitle={customerLabel(document)}
        actions={
          <>
            <Button
              variant="secondary"
              iconLeft={<DownloadSimple size={16} weight="bold" aria-hidden="true" />}
              loading={isBusy(busy, "download")}
              disabled={anyBusy(busy)}
              onClick={() => void onDownload()}
            >
              Download PDF
            </Button>
            {canSend ? (
              <Button
                variant="secondary"
                iconLeft={<Envelope size={16} weight="bold" aria-hidden="true" />}
                loading={isBusy(busy, "send")}
                disabled={anyBusy(busy)}
                onClick={() => void onSend()}
              >
                Send
              </Button>
            ) : null}
            {canAccept ? (
              <>
                <Button
                  variant="secondary"
                  loading={isBusy(busy, "accept")}
                  disabled={anyBusy(busy)}
                  onClick={() => void onAccept()}
                >
                  Accepted
                </Button>
                <Button variant="secondary" disabled={anyBusy(busy)} onClick={() => setDeclining(true)}>
                  Declined
                </Button>
              </>
            ) : null}
            {canPay ? (
              <Button variant="secondary" disabled={anyBusy(busy)} onClick={() => setPaying(true)}>
                Mark paid
              </Button>
            ) : null}
            {canVoid ? (
              <Button
                variant="destructive"
                iconLeft={<Prohibit size={16} weight="bold" aria-hidden="true" />}
                disabled={anyBusy(busy)}
                onClick={() => setVoiding(true)}
              >
                Void
              </Button>
            ) : null}
            {/* A draft was never anybody's but the owner's, so it can be
                thrown away. Anything he has sent is written off with Void,
                which keeps the number spent (F-LB-23). */}
            {document.status === "draft" ? (
              <Button
                variant="destructive"
                iconLeft={<Trash size={16} weight="bold" aria-hidden="true" />}
                disabled={anyBusy(busy)}
                onClick={() => setDeleting(true)}
              >
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        {/* The one primary block on this page: what the document is worth. */}
        <span
          data-testid="document-total"
          className="money inline-flex items-center bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-accent-text)]"
        >
          {money(document.totalCents)}
        </span>
        {statusFixed ? (
          <Badge tone={statusTone(document.status)}>{statusLabel(document.status)}</Badge>
        ) : (
          <div
            className="flex items-center gap-[var(--space-2)]"
            data-testid="document-status"
          >
            <span className="section-label">Status</span>
            {/* A two-line paragraph explaining what a draft is used to sit
                under the header for ever (direction rule 3, no permanent
                instructions). It is gone rather than relocated: a draft
                already announces itself three ways - the Status reads Draft,
                the lines are editable fields, and a Save changes button sits
                under them. The consequence of sending is on the Send button,
                which is where a consequence belongs. The long form is a Help
                entry, which lead-platform owns. */}
            <Select
              aria-label="Status"
              className="w-[150px]"
              value={document.status}
              options={statusOptions}
              disabled={anyBusy(busy)}
              onValueChange={(next) => void onStatusPicked(next)}
            />
          </div>
        )}
        {isQuote ? <Badge>Quote</Badge> : null}
        {overdue ? (
          <span className="tabular text-[length:var(--text-sm)] font-medium text-[var(--color-text)]">
            {dueLabel(document.dueOn)}
          </span>
        ) : null}
        {document.dealId && document.dealTitle ? (
          <Link
            href={`/deals/${document.dealId}`}
            className="text-[length:var(--text-sm)] text-[var(--color-link)] underline-offset-2 hover:underline"
          >
            {document.dealTitle}
          </Link>
        ) : null}
      </div>

      {document.convertedToId ? (
        <p className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          This quote became{" "}
          <Link
            href={`/invoices/${document.convertedToId}`}
            className="text-[var(--color-link)] underline-offset-2 hover:underline"
          >
            an invoice
          </Link>
          .
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-[var(--space-5)] xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 flex flex-col gap-[var(--space-5)]">
          <div>
            <CardGroupLabel>Lines</CardGroupLabel>
            <DocumentLines
              lines={lines}
              onChange={setLines}
              editable={Boolean(editable)}
              taxRateBp={document.taxRateBp}
              currency={formats.currency}
              locale={formats.locale}
            />
            {editable ? (
              <div className="mt-[var(--space-3)] flex items-center gap-[var(--space-3)]">
                <Button
                  variant="secondary"
                  loading={replaceItems.isPending}
                  disabled={anyBusy(busy)}
                  onClick={() => {
                    void saveLines().then((ok) => {
                      if (ok) toast.success("Saved the lines.");
                    });
                  }}
                >
                  Save changes
                </Button>
              </div>
            ) : null}
          </div>

          <div>
            <CardGroupLabel>Notes</CardGroupLabel>
            {editable ? (
              <Textarea
                rows={3}
                aria-label="Notes"
                placeholder="Anything the customer should read on the document."
                value={notes ?? document.notes ?? ""}
                onChange={(event) => setNotes(event.target.value)}
                onBlur={() => {
                  if (notes === null || notes === (document.notes ?? "")) return;
                  void updateDocument
                    .mutateAsync({ id, patch: { notes } })
                    .then(() => toast.success("Saved the note."))
                    .catch(() => toast.error("That note did not save."));
                }}
              />
            ) : (
              <p className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
                {document.notes || "No note on this one."}
              </p>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-5)]">
          <div>
            {/* Subtotal, tax and total are deliberately NOT repeated here.
                The lines table carries them in its own footer and the block at
                the top of the page carries the total; a third copy is filler,
                and filler is what DESIGN.md section 11 rules out. */}
            <CardGroupLabel>Details</CardGroupLabel>
            <Card>
              {/* "Bill to", not "Customer": this is the exact line the PDF
                  prints at the top of the block, resolved by the same
                  function, so the screen cannot promise a name the document
                  does not carry. */}
              <DetailRow label="Bill to">
                {billToTitle({
                  contactName: [document.contactFirstName ?? "", document.contactLastName ?? ""]
                    .join(" ")
                    .trim(),
                  companyName: document.companyName,
                })}
              </DetailRow>
              <DetailRow label="Issued">
                {formats.date(document.issuedOn) || "Not yet"}
              </DetailRow>
              {isQuote ? (
                <DetailRow label="Valid until">
                  {formats.date(document.validUntil) || "No end date"}
                </DetailRow>
              ) : (
                <DetailRow label="Due">
                  {document.dueOn
                    ? document.paidOn || document.status === "void"
                      ? formats.date(document.dueOn)
                      : `${formats.date(document.dueOn)} · ${dueLabel(document.dueOn)}`
                    : "No due date"}
                </DetailRow>
              )}
              {document.paidOn ? (
                <DetailRow label="Paid">
                  {formats.date(document.paidOn)}
                  {document.paidMethod ? ` · ${paymentMethodLabel(document.paidMethod)}` : ""}
                </DetailRow>
              ) : null}
              {document.pdfPath ? (
                <DetailRow label="PDF">
                  <span
                    className="truncate text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
                    title={document.pdfPath}
                  >
                    {document.pdfPath.split(/[\\/]/).pop()}
                  </span>
                </DetailRow>
              ) : null}
            </Card>
          </div>

          {document.paymentInstructions ? (
            <div>
              <CardGroupLabel>How to pay</CardGroupLabel>
              <Card>
                <CardRow className="items-stretch">
                  <p className="whitespace-pre-line text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    {document.paymentInstructions}
                  </p>
                </CardRow>
              </Card>
            </div>
          ) : null}
        </div>
      </div>

      <MarkPaidDialog
        open={paying}
        onOpenChange={setPaying}
        number={document.number}
        totalCents={document.totalCents}
        currency={formats.currency}
        locale={formats.locale}
        onConfirm={async (values) => {
          await markPaid.mutateAsync({
            id,
            paidOn: values.paidOn,
            method: normalizeMethod(values.method),
            note: values.note,
          });
          toast.success(`Marked ${document.number} paid.`);
        }}
      />

      <ConfirmDialog
        open={voiding}
        onOpenChange={setVoiding}
        title={`Void ${document.number}?`}
        description={`It stays on the list with the word "Void" on it, and nothing is owed. The number is not handed out again.`}
        confirmLabel={`Void this ${noun}`}
        destructive
        onConfirm={async () => {
          try {
            await voidIt.mutateAsync(id);
            toast.success(`Voided ${document.number}.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "That did not void.");
          }
        }}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${document.number}?`}
        description="It goes to the trash, where you can put it back. Nothing was sent, so nobody is expecting it."
        confirmLabel={`Delete this ${noun}`}
        destructive
        onConfirm={async () => {
          try {
            await deleteDocument.mutateAsync(id);
            toast.success(`Deleted ${document.number}.`);
            navigate("/invoices");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "That was not deleted.");
          }
        }}
      />

      <ConfirmDialog
        open={unpaying}
        onOpenChange={setUnpaying}
        title={`Mark ${document.number} unpaid?`}
        description="The payment comes off, and the invoice is owed again. It goes back on Receivables and out of what you have collected."
        confirmLabel="Mark unpaid"
        destructive
        onConfirm={async () => {
          try {
            await markUnpaid.mutateAsync(id);
            toast.success(`${document.number} is owed again.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "That did not save.");
          }
        }}
      />

      <ConfirmDialog
        open={declining}
        onOpenChange={setDeclining}
        title={`Mark ${document.number} declined?`}
        description="The quote stays on the list so you can see what was asked for."
        confirmLabel="Mark declined"
        onConfirm={async () => {
          try {
            await decline.mutateAsync(id);
            toast.success(`Marked ${document.number} declined.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "That did not save.");
          }
        }}
      />
    </div>
  );
}
