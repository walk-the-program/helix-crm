/**
 * The settings a document needs, read through the repository's typed registry.
 *
 * All seven keys are registered in `src/db/repos/settings.ts`, so this file is
 * a thin named accessor over `settings.get` / `settings.set` rather than the
 * `defineExtraSetting` escape hatch a feature reaches for when its keys are
 * not in the registry yet. The accessor objects survive because the settings
 * screen binds a field to one of them by name, and a field wants one thing
 * with a `get` and a `set` on it rather than a string key it could misspell.
 *
 * The keys carry dots because that is what is stored; renaming one would
 * orphan every row already written.
 */
import * as settings from "@/db/repos/settings";

type Accessor<T> = {
  key: string;
  defaultValue: T;
  get(): Promise<T>;
  set(value: T): Promise<void>;
};

function accessor<K extends settings.SettingKey>(
  key: K,
  defaultValue: settings.SettingValue<K>,
): Accessor<settings.SettingValue<K>> {
  return {
    key,
    defaultValue,
    get: () => settings.get(key),
    set: (value) => settings.set(key, value),
  };
}

/** The business block at the top of every document. */
export const businessAddress = accessor("business.address", "");
export const businessTaxId = accessor("business.taxId", "");
export const businessPaymentInstructions = accessor("business.paymentInstructions", "");

/** Numbering, tax and terms. */
export const invoicePrefix = accessor("invoices.prefix", "INV");
export const quotePrefix = accessor("quotes.prefix", "QUO");
/** Basis points: 825 is 8.25%. An integer, so no float touches money. */
export const invoiceTaxRateBp = accessor("invoices.taxRateBp", 0);
export const invoiceDueDays = accessor("invoices.dueDays", 14);

export type InvoiceSettings = {
  invoicePrefix: string;
  quotePrefix: string;
  taxRateBp: number;
  dueDays: number;
  businessName: string;
  businessAddress: string;
  businessTaxId: string;
  paymentInstructions: string;
  ownerEmail: string;
  ownerPhone: string;
  currency: string;
  locale: string;
};

/** Everything a document needs, in one read. */
export async function readInvoiceSettings(): Promise<InvoiceSettings> {
  const [
    prefix,
    qPrefix,
    taxRateBp,
    dueDays,
    address,
    taxId,
    payment,
    businessName,
    ownerEmail,
    ownerPhone,
    currency,
    locale,
  ] = await Promise.all([
    settings.get("invoices.prefix"),
    settings.get("quotes.prefix"),
    settings.get("invoices.taxRateBp"),
    settings.get("invoices.dueDays"),
    settings.get("business.address"),
    settings.get("business.taxId"),
    settings.get("business.paymentInstructions"),
    settings.get("business.name"),
    settings.get("owner.email"),
    settings.get("owner.phone"),
    settings.get("currency"),
    settings.get("locale"),
  ]);

  return {
    invoicePrefix: prefix,
    quotePrefix: qPrefix,
    taxRateBp,
    dueDays,
    businessName: businessName || "Your business",
    businessAddress: address,
    businessTaxId: taxId,
    paymentInstructions: payment,
    ownerEmail,
    ownerPhone,
    currency,
    locale,
  };
}

/** The prefix for a kind, so a caller does not branch on it in four places. */
export function prefixFor(kind: "quote" | "invoice", settingsRow: InvoiceSettings): string {
  return kind === "quote" ? settingsRow.quotePrefix : settingsRow.invoicePrefix;
}

/** "8.25%" from 825, with no trailing zeros the owner did not type. */
export function formatTaxRate(bp: number): string {
  const percent = bp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
