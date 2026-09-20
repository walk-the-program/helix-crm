/**
 * "/settings/invoices" — numbering, tax rate, payment terms and the details
 * printed on every invoice and quote.
 *
 * Four grouped inset lists in the same System Settings idiom as the rest of
 * Settings (see `SettingsLayout`'s own docstring): numbering, tax and terms,
 * payment instructions, and a read-only look at the business block that
 * prints above them all. That last one is deliberately read-only here — the
 * Workspace screen owns Address and Tax ID, because a value printed on every
 * invoice and every contact export should have exactly one place it is
 * edited, not two screens that can quietly disagree.
 *
 * A tax rate is stored as basis points (`invoices.taxRateBp`; 825 is 8.25%)
 * so no float ever touches money. The owner never sees a basis point: the
 * field reads and writes a plain percentage, converted with integer maths in
 * `parseTaxRateInput` / `bpToPercentString` below.
 *
 * Every field saves the moment the owner leaves it — the same pattern the
 * Workspace screen uses for its format pickers — so there is nothing here to
 * spend the page's one primary button on, and this screen has none.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { CardRow, Field, Input, Textarea, toast } from "@/ui";
import {
  SettingsGroup,
  SettingsLoading,
  SettingsScreenFrame,
  SettingsValueRow,
} from "@/features/settings/components/SettingsLayout";
import { iqk, useInvoiceSettings } from "@/features/invoices/lib/hooks";
import {
  businessPaymentInstructions,
  invoiceDueDays,
  invoicePrefix,
  invoiceTaxRateBp,
  quotePrefix,
} from "@/features/invoices/lib/settings";

/** "8.25" from 825, with integer division and modulo so nothing drifts. */
function bpToPercentString(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** 825 from "8.25", or the sentence that says why the value did not save. */
function parseTaxRateInput(raw: string): { ok: true; bp: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, bp: 0 };
  if (trimmed.startsWith("-")) {
    return { ok: false, message: "Enter a rate of zero or more." };
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, message: "Enter a number, like 8.25." };
  }
  const bp = Math.round(Number(trimmed) * 100);
  if (bp > 10_000) {
    return { ok: false, message: "Enter a rate of 100 or less." };
  }
  return { ok: true, bp };
}

/**
 * A text field with a fixed unit sitting beside it ("%", "days"). A plain
 * child of `Field`, so `Field`'s own `id` / `aria-describedby` / `aria-invalid`
 * land on this component and are forwarded to the real input inside it,
 * exactly as they would on a bare `Input`.
 */
function UnitInput(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  value: string;
  invalid?: boolean;
  suffix: string;
  placeholder?: string;
  testId: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const { id, value, invalid, suffix, placeholder, testId, onChange, onBlur } = props;
  return (
    <div className="flex items-center gap-[var(--space-2)]">
      <Input
        id={id}
        inputMode="decimal"
        className="tabular max-w-[7rem]"
        value={value}
        invalid={invalid}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        data-testid={testId}
      />
      <span
        className="text-[length:var(--text-base)] text-[var(--color-text-muted)]"
        aria-hidden="true"
      >
        {suffix}
      </span>
    </div>
  );
}

export function InvoiceSettingsScreen() {
  const client = useQueryClient();
  const { data, isLoading } = useInvoiceSettings();

  const [prefixInput, setPrefixInput] = useState("");
  const [quotePrefixInput, setQuotePrefixInput] = useState("");
  const [taxRateInput, setTaxRateInput] = useState("");
  const [taxRateError, setTaxRateError] = useState<string | null>(null);
  const [dueDaysInput, setDueDaysInput] = useState("");
  const [paymentInstructionsInput, setPaymentInstructionsInput] = useState("");

  useEffect(() => {
    if (!data) return;
    setPrefixInput(data.invoicePrefix);
    setQuotePrefixInput(data.quotePrefix);
    setTaxRateInput(bpToPercentString(data.taxRateBp));
    setDueDaysInput(String(data.dueDays));
    setPaymentInstructionsInput(data.paymentInstructions);
  }, [data]);

  async function refresh() {
    await client.invalidateQueries({ queryKey: iqk.settings() });
  }

  async function saveInvoicePrefix() {
    const trimmed = prefixInput.trim();
    setPrefixInput(trimmed);
    if (data && trimmed === data.invoicePrefix) return;
    await invoicePrefix.set(trimmed);
    await refresh();
    toast.success("Saved your invoice prefix");
  }

  async function saveQuotePrefix() {
    const trimmed = quotePrefixInput.trim();
    setQuotePrefixInput(trimmed);
    if (data && trimmed === data.quotePrefix) return;
    await quotePrefix.set(trimmed);
    await refresh();
    toast.success("Saved your quote prefix");
  }

  async function saveTaxRate() {
    const parsed = parseTaxRateInput(taxRateInput);
    if (!parsed.ok) {
      setTaxRateError(parsed.message);
      return;
    }
    setTaxRateError(null);
    setTaxRateInput(bpToPercentString(parsed.bp));
    if (data && parsed.bp === data.taxRateBp) return;
    await invoiceTaxRateBp.set(parsed.bp);
    await refresh();
    toast.success("Saved your tax rate");
  }

  async function saveDueDays() {
    const trimmed = dueDaysInput.trim();
    const parsed = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || !Number.isFinite(parsed) || parsed > 365) {
      if (data) setDueDaysInput(String(data.dueDays));
      return;
    }
    if (data && parsed === data.dueDays) return;
    await invoiceDueDays.set(parsed);
    await refresh();
    toast.success("Saved your payment terms");
  }

  async function savePaymentInstructions() {
    const trimmed = paymentInstructionsInput.trim();
    setPaymentInstructionsInput(trimmed);
    if (data && trimmed === data.paymentInstructions) return;
    await businessPaymentInstructions.set(trimmed);
    await refresh();
    toast.success("Saved your payment instructions");
  }

  if (isLoading || !data) {
    return (
      <SettingsScreenFrame title="Invoices" testId="settings-invoices">
        <SettingsLoading>Reading your invoice settings…</SettingsLoading>
      </SettingsScreenFrame>
    );
  }

  const thisYear = new Date().getFullYear();
  const hasAddress = data.businessAddress.trim().length > 0;
  const hasTaxId = data.businessTaxId.trim().length > 0;

  return (
    <SettingsScreenFrame
      title="Invoices"
      subtitle="Numbering, tax and the details printed on every invoice and quote."
      testId="settings-invoices"
    >
      <SettingsGroup label="Numbering">
        <CardRow className="block py-[var(--space-3)]">
          <Field
            label="Invoice prefix"
            htmlFor="invoice-prefix"
            hint={`Next number: ${prefixInput}-${thisYear}-0001`}
          >
            <Input
              id="invoice-prefix"
              value={prefixInput}
              onChange={(e) => setPrefixInput(e.target.value)}
              onBlur={() => void saveInvoicePrefix()}
              placeholder="INV"
              data-testid="invoice-prefix-input"
            />
          </Field>
        </CardRow>
        <CardRow className="block py-[var(--space-3)]">
          <Field
            label="Quote prefix"
            htmlFor="quote-prefix"
            hint={`Next number: ${quotePrefixInput}-${thisYear}-0001`}
          >
            <Input
              id="quote-prefix"
              value={quotePrefixInput}
              onChange={(e) => setQuotePrefixInput(e.target.value)}
              onBlur={() => void saveQuotePrefix()}
              placeholder="QUO"
              data-testid="quote-prefix-input"
            />
          </Field>
        </CardRow>
      </SettingsGroup>

      <SettingsGroup label="Tax and payment terms">
        <CardRow className="block py-[var(--space-3)]">
          <Field
            label="Tax rate"
            htmlFor="invoice-tax-rate"
            error={taxRateError ?? undefined}
            hint="Charged on the lines you mark taxable. Leave it at 0 if you do not charge tax."
          >
            <UnitInput
              value={taxRateInput}
              invalid={Boolean(taxRateError)}
              suffix="%"
              placeholder="0"
              testId="invoice-tax-rate-input"
              onChange={(value) => {
                setTaxRateInput(value);
                if (taxRateError) setTaxRateError(null);
              }}
              onBlur={() => void saveTaxRate()}
            />
          </Field>
        </CardRow>
        <CardRow className="block py-[var(--space-3)]">
          <Field
            label="Payment terms"
            htmlFor="invoice-due-days"
            hint="A new invoice is due this many days after you send it."
          >
            <UnitInput
              value={dueDaysInput}
              suffix="days"
              placeholder="14"
              testId="invoice-due-days-input"
              onChange={setDueDaysInput}
              onBlur={() => void saveDueDays()}
            />
          </Field>
        </CardRow>
      </SettingsGroup>

      <SettingsGroup label="Payment instructions">
        <CardRow className="block py-[var(--space-3)]">
          <Field
            label="Payment instructions"
            htmlFor="invoice-payment-instructions"
            hint="Printed at the bottom of every invoice. Your bank details, or how you would like to be paid."
          >
            <Textarea
              id="invoice-payment-instructions"
              value={paymentInstructionsInput}
              onChange={(e) => setPaymentInstructionsInput(e.target.value)}
              onBlur={() => void savePaymentInstructions()}
              placeholder="Pay by bank transfer to account ..."
              data-testid="invoice-payment-instructions-input"
            />
          </Field>
        </CardRow>
      </SettingsGroup>

      <SettingsGroup
        label="Business details"
        footnote={
          <>
            Your address and tax ID are on the{" "}
            <Link
              href="/settings/workspace"
              className="text-[var(--color-text)] underline underline-offset-2 hover:no-underline"
            >
              Workspace screen
            </Link>
            .
          </>
        }
      >
        {hasAddress ? (
          <SettingsValueRow label="Address">
            <span className="whitespace-pre-line">{data.businessAddress}</span>
          </SettingsValueRow>
        ) : null}
        {hasTaxId ? <SettingsValueRow label="Tax ID">{data.businessTaxId}</SettingsValueRow> : null}
        {!hasAddress && !hasTaxId ? (
          <SettingsValueRow label="Address">
            <span className="text-[var(--color-text-faint)]">Not set yet.</span>
          </SettingsValueRow>
        ) : null}
      </SettingsGroup>
    </SettingsScreenFrame>
  );
}
