/**
 * A quote or invoice built from scratch, for work that never went through a
 * deal page - the "somebody called and asked for a price" path.
 *
 * Three things about this screen are deliberate.
 *
 * It uses `DocumentLines`, the same editor the document page uses, rather than
 * a table of its own. It used to have its own: the same five columns, its own
 * validation, its own "Add a line", and none of the catalog. Two editors for
 * the same rows is how they drift, and the one the owner sees first is the one
 * that has to teach him what a line is - so both are now the one component,
 * with the services picker behind "Add a line" in both.
 *
 * Every document belongs to a deal (round 3, criterion 20). The customer is
 * picked first, the deal second, and the deal is what the document's stored
 * contact and company come from - the repository copies them, so a document
 * and its deal can never name two different customers. When there is no deal
 * yet, "New deal for ..." in the picker creates one from what is already on
 * this screen, carrying these lines as its services, and links it.
 *
 * The totals block is this screen's one primary block, so the submit button -
 * "Create invoice" / "Create quote" - is `variant="secondary"`, the same
 * trade-off InvoicesScreen makes for its own header action.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "@/ui/icons";
import {
  Button,
  Field,
  FormRow,
  PageHeader,
  Select,
  Textarea,
  toast,
} from "@/ui";
import { computeTotals } from "@/db/repos/documents";
import type { TotalsInput } from "@/db/repos/documents";
import { formatMoney } from "@/lib/money";
import { addDaysToDateString, todayLocal } from "@/lib/dates";
import {
  useCreateDealForDocument,
  useCreateDocument,
  useCustomerDeals,
  useDealLines,
  useInvoiceSettings,
  useSyncDealLines,
} from "@/features/invoices/lib/hooks";
import { formatTaxRate } from "@/features/invoices/lib/settings";
import { summarizeTaxLines, taxRowLabel } from "@/features/invoices/lib/taxLabel";
import {
  DocumentLines,
  fromDealItems,
  toNewItems,
  type DraftLine,
} from "@/features/invoices/components/DocumentLines";
import { Combobox, DatePicker, type ComboboxItem } from "@/features/invoices/lib/pickers";
import { CompanyPicker, ContactPicker } from "@/features/records/components/Pickers";

const KIND_OPTIONS = [
  { value: "invoice", label: "Invoice" },
  { value: "quote", label: "Quote" },
];

const DEFAULT_VALID_DAYS = 30;

export function NewDocumentScreen() {
  const [, navigate] = useLocation();
  const { data: settings } = useInvoiceSettings();
  const createDocument = useCreateDocument();
  const createDeal = useCreateDealForDocument();

  const [kind, setKind] = useState<"invoice" | "quote">("invoice");
  const [contactId, setContactId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [dealError, setDealError] = useState<string | null>(null);

  const [issuedOn, setIssuedOn] = useState<string | null>(todayLocal());
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [dueTouched, setDueTouched] = useState(false);
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [validUntilTouched, setValidUntilTouched] = useState(false);

  // No blank row before a customer is chosen. The screen used to open with an
  // empty line above three empty pickers, asking the owner to price work for a
  // customer he had not named yet (F-LB-13). The first row arrives with the
  // deal, or when he asks for one.
  const [lines, setLines] = useState<DraftLine[]>([]);
  /** Deal line ids this document is not carrying, which must survive a save. */
  const [keptDealLineIds, setKeptDealLineIds] = useState<string[]>([]);
  /** True once the owner has changed the lines himself. */
  const [linesTouched, setLinesTouched] = useState(false);

  const [notes, setNotes] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: customerDeals } = useCustomerDeals(contactId, companyId);
  const { data: dealLines } = useDealLines(dealId);
  const syncDealLines = useSyncDealLines();

  // Due date defaults to issued plus the workspace's payment terms, and stays
  // in sync with the issue date until the owner picks his own.
  useEffect(() => {
    if (kind !== "invoice" || dueTouched || !issuedOn) return;
    setDueOn(addDaysToDateString(issuedOn, settings?.dueDays ?? 14));
  }, [kind, issuedOn, settings?.dueDays, dueTouched]);

  useEffect(() => {
    if (kind !== "quote" || validUntilTouched || !issuedOn) return;
    setValidUntil(addDaysToDateString(issuedOn, DEFAULT_VALID_DAYS));
  }, [kind, issuedOn, validUntilTouched]);

  // The default payment instructions from Settings > Invoices. They prefill
  // and stay editable: the override is per document, and typing over them
  // never writes the setting back.
  useEffect(() => {
    if (paymentTouched || !settings) return;
    setPaymentInstructions(settings.paymentInstructions);
  }, [settings, paymentTouched]);

  // A deal belongs to one customer, so changing the customer drops a deal that
  // is no longer theirs rather than quietly filing the invoice under the wrong
  // job.
  useEffect(() => {
    if (!dealId || !customerDeals) return;
    if (!customerDeals.some((deal) => deal.id === dealId)) setDealId(null);
  }, [dealId, customerDeals]);

  /**
   * The deal already knows what the work is, so picking it fills the lines
   * instead of asking the owner to type them again. Same selection rule the
   * deal page's own "Create invoice" uses: a quote carries the whole
   * agreement, an invoice carries the one-time lines because the recurring
   * ones are billed by the schedule.
   *
   * It stops as soon as he has edited anything, so a prefill can never eat
   * work he has already done.
   */
  useEffect(() => {
    if (linesTouched || !dealId || !dealLines) return;
    const selection = kind === "quote" ? "all" : "one_time";
    const filled = fromDealItems(dealLines, selection);
    setLines(filled);
    setKeptDealLineIds(
      dealLines
        .filter((item) => selection === "all" || item.kind === "recurring")
        .map((item) => item.id),
    );
  }, [dealId, dealLines, kind, linesTouched]);

  // Dropping the deal drops what it filled in, unless the owner has since made
  // the lines his own.
  useEffect(() => {
    if (dealId || linesTouched) return;
    setLines([]);
    setKeptDealLineIds([]);
  }, [dealId, linesTouched]);

  function changeLines(next: DraftLine[]) {
    setLinesTouched(true);
    setLines(next);
  }

  const dealItems = useMemo<ComboboxItem[]>(
    () =>
      (customerDeals ?? []).map((deal) => ({
        id: deal.id,
        label: deal.title,
        detail: `${deal.stageName} · ${formatMoney(deal.valueCents, deal.currency, settings?.locale)}`,
      })),
    [customerDeals, settings?.locale],
  );

  const totals = useMemo(() => {
    const inputs: TotalsInput[] = (toNewItems(lines) ?? []).map((item) => ({
      qty: item.qty ?? 1,
      unitCents: item.unitCents ?? 0,
      taxable: item.taxable ?? false,
    }));
    return computeTotals(inputs, settings?.taxRateBp ?? 0);
  }, [lines, settings?.taxRateBp]);

  const taxRow = useMemo(() => {
    const summary = summarizeTaxLines(
      (toNewItems(lines) ?? []).map((item) => ({
        taxable: item.taxable ?? false,
        amountCents: (item.qty ?? 1) * (item.unitCents ?? 0),
      })),
    );
    return taxRowLabel(summary, totals.taxCents, settings ? formatTaxRate(settings.taxRateBp) : "", (cents) =>
      formatMoney(cents, settings?.currency, settings?.locale),
    );
  }, [lines, totals.taxCents, settings]);

  /** The deal this document will belong to, creating one if it has to. */
  async function resolveDealId(): Promise<string | null> {
    if (dealId) return dealId;
    setDealError("Pick the job this belongs to, or start a new one.");
    return null;
  }

  async function startDeal(title: string) {
    const items = toNewItems(lines);
    const named = title.trim().length > 0 ? title.trim() : (items?.[0]?.name ?? "New work");
    try {
      const deal = await createDeal.mutateAsync({
        title: named,
        kind,
        contactId,
        companyId,
        lines: (items ?? []).map((item) => ({
          name: item.name,
          description: item.description ?? null,
          qty: item.qty ?? 1,
          unitCents: item.unitCents ?? 0,
          taxable: item.taxable ?? false,
          kind: item.kind ?? "one_time",
          interval: item.interval ?? null,
        })),
      });
      setDealId(deal.id);
      setDealError(null);
      toast.success(`Started ${deal.title}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That job was not created.");
    }
  }

  async function handleSubmit() {
    let hasError = false;

    if (!contactId && !companyId) {
      setCustomerError("Pick a contact or a company.");
      hasError = true;
    } else {
      setCustomerError(null);
    }

    const items = toNewItems(lines);
    if (!items) {
      toast.error("Every line needs a description, a quantity and an amount.");
      hasError = true;
    }

    const deal = await resolveDealId();
    if (!deal) hasError = true;
    if (hasError || !items || !deal) return;

    setSaving(true);
    try {
      // The deal is where a deal's money is defined (round 3 rev 4, §23), so
      // anything typed here goes back onto it before the document is raised.
      // Without this the document and its deal disagree, and after D1 that
      // shows as Quoted $0 beside a real Invoiced figure on the same job.
      if (linesTouched) {
        try {
          await syncDealLines.mutateAsync({
            dealId: deal,
            lines: items.map((item, index) => ({
              dealItemId: lines[index]?.dealItemId,
              name: item.name,
              description: item.description ?? null,
              qty: item.qty ?? 1,
              unitCents: item.unitCents ?? 0,
              taxable: item.taxable ?? false,
              kind: item.kind ?? "one_time",
              interval: item.interval ?? null,
            })),
            keep: keptDealLineIds,
          });
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : "The job's services were not updated, so this was not saved.",
          );
          return;
        }
      }

      const created = await createDocument.mutateAsync({
        kind,
        dealId: deal,
        items,
        issuedOn,
        dueOn: kind === "invoice" ? dueOn : null,
        validUntil: kind === "quote" ? validUntil : null,
        notes: notes.trim().length > 0 ? notes : null,
        paymentInstructions:
          paymentInstructions.trim().length > 0 ? paymentInstructions : null,
      });
      navigate(`/invoices/${created.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : `That ${kind} did not save. Check the lines and try again.`,
      );
    } finally {
      setSaving(false);
    }
  }

  const customerChosen = Boolean(contactId || companyId);

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
        title="New invoice"
      />

      <div className="grid grid-cols-1 gap-[var(--space-6)] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-[var(--space-6)]">
          <FormRow>
            <div className="w-[200px]">
              <label
                htmlFor="doc-kind"
                className="block text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
              >
                Kind
              </label>
              <Select
                id="doc-kind"
                ariaLabel="Kind"
                value={kind}
                options={KIND_OPTIONS}
                onValueChange={(value) => setKind(value as "invoice" | "quote")}
              />
            </div>

            <div className="grid grid-cols-2 gap-[var(--space-4)]">
              <Field label="Contact">
                <ContactPicker
                  id="doc-contact"
                  label="Contact"
                  value={contactId}
                  onChange={(id, contact) => {
                    setContactId(id);
                    // Walker: "if I pick one then it should automatically fill
                    // the company." It fills rather than locks - a person can
                    // be invoiced privately for work at a company address.
                    if (contact?.companyId) setCompanyId(contact.companyId);
                    if (id || companyId) setCustomerError(null);
                  }}
                />
              </Field>
              <Field label="Company" error={customerError ?? undefined}>
                <CompanyPicker
                  id="doc-company"
                  label="Company"
                  value={companyId}
                  onChange={(id) => {
                    setCompanyId(id);
                    if (id || contactId) setCustomerError(null);
                  }}
                />
              </Field>
            </div>

            <Field
              label="Job"
              error={dealError ?? undefined}
              hint={
                customerChosen
                  ? "Every invoice belongs to a job, so the money lands against the work."
                  : "Pick the customer first, then the job."
              }
            >
              <Combobox
                id="doc-deal"
                aria-label="Job"
                disabled={!customerChosen}
                value={dealId}
                items={dealItems}
                clearable
                placeholder="Search this customer's jobs"
                emptyText="No job yet for this customer."
                createLabel={(query) =>
                  query.trim().length > 0 ? `New job “${query.trim()}”` : "New job for this"
                }
                onCreate={(query) => void startDeal(query)}
                onChange={(id) => {
                  setDealId(id);
                  if (id) setDealError(null);
                }}
              />
            </Field>

            <div className="grid grid-cols-2 gap-[var(--space-4)]">
              <Field label="Issued">
                <DatePicker
                  aria-label="Issued"
                  value={issuedOn}
                  onChange={setIssuedOn}
                />
              </Field>
              {kind === "invoice" ? (
                <Field label="Due">
                  <DatePicker
                    aria-label="Due"
                    value={dueOn}
                    clearable
                    onChange={(value) => {
                      setDueTouched(true);
                      setDueOn(value);
                    }}
                  />
                </Field>
              ) : (
                <Field label="Valid until">
                  <DatePicker
                    aria-label="Valid until"
                    value={validUntil}
                    clearable
                    onChange={(value) => {
                      setValidUntilTouched(true);
                      setValidUntil(value);
                    }}
                  />
                </Field>
              )}
            </div>
          </FormRow>

          <div>
            <div className="flex items-center justify-between pb-[var(--space-2)]">
              <span className="section-label">Lines</span>
            </div>
            <DocumentLines
              lines={lines}
              onChange={changeLines}
              editable
              taxRateBp={settings?.taxRateBp ?? 0}
              currency={settings?.currency}
              locale={settings?.locale}
            />
          </div>

          <FormRow>
            <Field label="Notes">
              <Textarea
                value={notes}
                placeholder="Anything the customer should know"
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            <Field
              label="Payment instructions"
              hint="From Settings > Invoices. Change them here for this one document."
            >
              <Textarea
                value={paymentInstructions}
                onChange={(event) => {
                  setPaymentTouched(true);
                  setPaymentInstructions(event.target.value);
                }}
              />
            </Field>
          </FormRow>
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-4)] xl:self-start">
          <div className="flex flex-col gap-[var(--space-2)]">
            <div className="flex items-center justify-between text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              <span>Subtotal</span>
              <span className="money">
                {formatMoney(totals.subtotalCents, settings?.currency, settings?.locale)}
              </span>
            </div>
            {taxRow.show ? (
              <div className="flex items-center justify-between text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                <span>{taxRow.label}</span>
                <span className="money">
                  {formatMoney(totals.taxCents, settings?.currency, settings?.locale)}
                </span>
              </div>
            ) : null}

            {/* The one primary block on this screen: the total, flat-filled,
                the same treatment DealPage.tsx gives the deal value. Because
                this is the primary, the submit button below is secondary. */}
            <div className="mt-[var(--space-2)] flex items-center justify-between bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-3)]">
              <span className="text-[length:var(--text-base)] font-medium text-[var(--color-accent-text)]">
                Total
              </span>
              <span className="money text-[length:var(--text-subhead)] font-semibold tabular-nums text-[var(--color-accent-text)]">
                {formatMoney(totals.totalCents, settings?.currency, settings?.locale)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-[var(--space-2)]">
            <Button variant="secondary" onClick={() => navigate("/invoices")}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              loading={saving}
              loadingLabel={kind === "invoice" ? "Creating invoice…" : "Creating quote…"}
              onClick={() => void handleSubmit()}
            >
              {kind === "invoice" ? "Create invoice" : "Create quote"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
