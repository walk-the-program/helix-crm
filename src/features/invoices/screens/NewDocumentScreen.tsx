/**
 * A quote or invoice built from scratch, for work that never went through a
 * deal — the "somebody called and asked for a price" path.
 *
 * The non-obvious decision: the totals block is this screen's one primary
 * block (the flat accent fill with the sticker shadow, same treatment as the
 * deal value on DealPage.tsx), so the submit button — "Create invoice" /
 * "Create quote" — is `variant="secondary"`, the same trade-off InvoicesScreen
 * makes for its own header action.
 *
 * The catalog feature is being built alongside this one in
 * `src/features/catalog` and may not exist yet, or may be mid-edit. This file
 * therefore never imports it statically — a static import would fail this
 * screen's build the moment their file does not parse. It is dynamically
 * imported once, on mount, inside a try/catch; if the import rejects or the
 * module does not export a usable `CatalogPicker`, the "Add from your
 * services" button simply never appears, and the custom-line path below is
 * unaffected either way.
 */
import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Plus, Trash } from "@/ui/icons";
import {
  Button,
  Checkbox,
  Field,
  FormRow,
  IconButton,
  Input,
  PageHeader,
  Select,
  Textarea,
  toast,
} from "@/ui";
import { computeTotals } from "@/db/repos/documents";
import type { NewDocumentItem, TotalsInput } from "@/db/repos/documents";
import { centsToDecimalString, formatMoney, parseMoneyToCents } from "@/lib/money";
import { addDaysToDateString, todayLocal } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { useCreateDocument, useInvoiceSettings } from "@/features/invoices/lib/hooks";
import { formatTaxRate } from "@/features/invoices/lib/settings";
import { CompanyPicker, ContactPicker } from "@/features/records/components/Pickers";

const KIND_OPTIONS = [
  { value: "invoice", label: "Invoice" },
  { value: "quote", label: "Quote" },
];

const DEFAULT_VALID_DAYS = 30;

type Line = {
  id: string;
  description: string;
  qty: string;
  unitPrice: string;
  taxable: boolean;
};

type LineErrors = {
  description?: string;
  qty?: string;
  unitPrice?: string;
};

function blankLine(): Line {
  return { id: newId(), description: "", qty: "1", unitPrice: "0.00", taxable: false };
}

/**
 * The shape this screen assumes the catalog's picker takes, since the
 * catalog feature has not shipped one yet. If their real component's props
 * differ, the `typeof candidate === "function"` check below still protects
 * this screen — it only renders what actually imported — but the render may
 * need a follow-up once their contract is final.
 */
type CatalogItem = {
  name: string;
  unitCents: number;
  taxable?: boolean;
};

type CatalogPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: CatalogItem) => void;
};

export function NewDocumentScreen() {
  const [, navigate] = useLocation();
  const { data: settings } = useInvoiceSettings();
  const createDocument = useCreateDocument();

  const [kind, setKind] = useState<"invoice" | "quote">("invoice");
  const [contactId, setContactId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);

  const [issuedOn, setIssuedOn] = useState(todayLocal());
  const [dueOn, setDueOn] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  const [validUntilTouched, setValidUntilTouched] = useState(false);

  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [lineErrors, setLineErrors] = useState<Record<string, LineErrors>>({});

  const [notes, setNotes] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // Due date defaults to issued + the workspace's due-days setting, and
  // stays in sync with the issue date until the owner types over it.
  useEffect(() => {
    if (kind !== "invoice" || dueTouched) return;
    setDueOn(addDaysToDateString(issuedOn, settings?.dueDays ?? 14));
  }, [kind, issuedOn, settings?.dueDays, dueTouched]);

  useEffect(() => {
    if (kind !== "quote" || validUntilTouched) return;
    setValidUntil(addDaysToDateString(issuedOn, DEFAULT_VALID_DAYS));
  }, [kind, issuedOn, validUntilTouched]);

  useEffect(() => {
    if (paymentTouched || !settings) return;
    setPaymentInstructions(settings.paymentInstructions);
  }, [settings, paymentTouched]);

  // The catalog picker, loaded once its module says it has one. Dynamic and
  // wrapped in try/catch on purpose — see the file comment.
  const [CatalogPicker, setCatalogPicker] = useState<ComponentType<CatalogPickerProps> | null>(
    null,
  );
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("@/features/catalog")
      .then((mod) => {
        if (cancelled) return;
        const candidate = (mod as unknown as { CatalogPicker?: unknown }).CatalogPicker;
        if (typeof candidate === "function") {
          setCatalogPicker(() => candidate as ComponentType<CatalogPickerProps>);
        }
      })
      .catch(() => {
        // No catalog feature yet, or it does not build today. The custom-line
        // path below still works, so this is not an error worth surfacing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const inputs: TotalsInput[] = lines.map((line) => ({
      qty: Math.max(0, Math.trunc(Number(line.qty) || 0)),
      unitCents: parseMoneyToCents(line.unitPrice) ?? 0,
      taxable: line.taxable,
    }));
    return computeTotals(inputs, settings?.taxRateBp ?? 0);
  }, [lines, settings?.taxRateBp]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, blankLine()]);
  }

  function addLineFromCatalog(item: CatalogItem) {
    setLines((current) => [
      ...current,
      {
        id: newId(),
        description: item.name,
        qty: "1",
        unitPrice: centsToDecimalString(item.unitCents),
        taxable: item.taxable ?? false,
      },
    ]);
    setCatalogOpen(false);
  }

  function removeLine(id: string) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.id !== id) : current));
  }

  async function handleSubmit() {
    let hasError = false;

    if (!contactId && !companyId) {
      setCustomerError("Pick a contact or a company.");
      hasError = true;
    } else {
      setCustomerError(null);
    }

    const nextLineErrors: Record<string, LineErrors> = {};
    const items: NewDocumentItem[] = [];

    for (const line of lines) {
      const errors: LineErrors = {};
      const name = line.description.trim();
      if (name.length === 0) errors.description = "A line needs a description.";

      const qty = Number(line.qty);
      if (!Number.isInteger(qty) || qty < 1) {
        errors.qty = "A line needs a quantity of at least 1.";
      }

      const unitCents = parseMoneyToCents(line.unitPrice);
      if (unitCents === null) errors.unitPrice = "Enter an amount, for example 1500.";

      if (Object.keys(errors).length > 0) {
        nextLineErrors[line.id] = errors;
        hasError = true;
      } else {
        items.push({ name, qty, unitCents: unitCents as number, taxable: line.taxable });
      }
    }

    setLineErrors(nextLineErrors);
    if (hasError) return;

    setSaving(true);
    try {
      const created = await createDocument.mutateAsync({
        kind,
        contactId,
        companyId,
        items,
        issuedOn,
        dueOn: kind === "invoice" ? (dueOn.trim().length > 0 ? dueOn : null) : null,
        validUntil: kind === "quote" ? (validUntil.trim().length > 0 ? validUntil : null) : null,
        notes: notes.trim().length > 0 ? notes : null,
        paymentInstructions: paymentInstructions.trim().length > 0 ? paymentInstructions : null,
      });
      navigate(`/invoices/${created.id}`);
    } catch {
      toast.error(`That ${kind} did not save. Check the lines and try again.`);
    } finally {
      setSaving(false);
    }
  }

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
                  onChange={(id) => {
                    setContactId(id);
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

            <div className="grid grid-cols-2 gap-[var(--space-4)]">
              <Field label="Issued">
                <Input
                  type="date"
                  value={issuedOn}
                  onChange={(event) => setIssuedOn(event.target.value)}
                />
              </Field>
              {kind === "invoice" ? (
                <Field label="Due">
                  <Input
                    type="date"
                    value={dueOn}
                    onChange={(event) => {
                      setDueTouched(true);
                      setDueOn(event.target.value);
                    }}
                  />
                </Field>
              ) : (
                <Field label="Valid until">
                  <Input
                    type="date"
                    value={validUntil}
                    onChange={(event) => {
                      setValidUntilTouched(true);
                      setValidUntil(event.target.value);
                    }}
                  />
                </Field>
              )}
            </div>
          </FormRow>

          <div>
            <div className="flex items-center justify-between pb-[var(--space-2)]">
              <span className="section-label">Lines</span>
              <div className="flex items-center gap-[var(--space-2)]">
                {CatalogPicker ? (
                  <Button variant="secondary" size="sm" onClick={() => setCatalogOpen(true)}>
                    Add from your services
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
                  onClick={addLine}
                >
                  Add a line
                </Button>
              </div>
            </div>

            <div className="border border-[var(--color-border)]">
              <div className="section-label flex h-[var(--control-h)] items-center gap-[var(--space-3)] border-b border-[var(--color-border)] px-[var(--space-3)]">
                <span className="flex-1">Description</span>
                <span className="w-[64px] text-right">Qty</span>
                <span className="w-[120px] text-right">Unit price</span>
                <span className="w-[70px] text-center">Taxable</span>
                <span className="w-[var(--control-h-sm)]" aria-hidden="true" />
              </div>
              {lines.map((line, index) => {
                const errors = lineErrors[line.id];
                return (
                  <div
                    key={line.id}
                    className="flex items-start gap-[var(--space-3)] border-b border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`line-desc-${line.id}`} className="sr-only">
                        Description, line {index + 1}
                      </label>
                      <Input
                        id={`line-desc-${line.id}`}
                        value={line.description}
                        placeholder="Mulch and edging"
                        invalid={Boolean(errors?.description)}
                        onChange={(event) => updateLine(line.id, { description: event.target.value })}
                      />
                      {errors?.description ? (
                        <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-danger-ink)]">
                          {errors.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="w-[64px]">
                      <label htmlFor={`line-qty-${line.id}`} className="sr-only">
                        Quantity, line {index + 1}
                      </label>
                      <Input
                        id={`line-qty-${line.id}`}
                        className="tabular text-right"
                        inputMode="numeric"
                        value={line.qty}
                        invalid={Boolean(errors?.qty)}
                        onChange={(event) => updateLine(line.id, { qty: event.target.value })}
                      />
                      {errors?.qty ? (
                        <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-danger-ink)]">
                          {errors.qty}
                        </p>
                      ) : null}
                    </div>
                    <div className="w-[120px]">
                      <label htmlFor={`line-price-${line.id}`} className="sr-only">
                        Unit price, line {index + 1}
                      </label>
                      <Input
                        id={`line-price-${line.id}`}
                        className="money text-right"
                        inputMode="decimal"
                        value={line.unitPrice}
                        invalid={Boolean(errors?.unitPrice)}
                        onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}
                      />
                      {errors?.unitPrice ? (
                        <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-danger-ink)]">
                          {errors.unitPrice}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex w-[70px] justify-center">
                      <Checkbox
                        ariaLabel={`Taxable, line ${index + 1}`}
                        checked={line.taxable}
                        onCheckedChange={(checked) => updateLine(line.id, { taxable: checked })}
                      />
                    </div>
                    <div className="flex w-[var(--control-h-sm)] justify-center">
                      <IconButton
                        label="Remove line"
                        icon={<Trash size={16} weight="bold" aria-hidden="true" />}
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length === 1}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <FormRow>
            <Field label="Notes">
              <Textarea
                value={notes}
                placeholder="Anything the customer should know"
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            <Field label="Payment instructions">
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
              <span className="money">{formatMoney(totals.subtotalCents, settings?.currency, settings?.locale)}</span>
            </div>
            <div className="flex items-center justify-between text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              <span>Tax{settings ? ` (${formatTaxRate(settings.taxRateBp)})` : ""}</span>
              <span className="money">{formatMoney(totals.taxCents, settings?.currency, settings?.locale)}</span>
            </div>

            {/* The one primary block on this screen: the total, flat-filled,
                with the accent sticker shadow as its single detail — the same
                treatment DealPage.tsx gives the deal value. Because this is
                the primary, the submit button below is secondary. */}
            <div className="mt-[var(--space-2)] flex items-center justify-between bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-3)] shadow-[var(--shadow-sticker)]">
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

      {CatalogPicker ? (
        <CatalogPicker
          open={catalogOpen}
          onOpenChange={setCatalogOpen}
          onSelect={addLineFromCatalog}
        />
      ) : null}
    </div>
  );
}
