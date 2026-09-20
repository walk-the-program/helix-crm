/**
 * Payments: the money that actually arrived (LR-PX decision PX-5).
 *
 *   invoice --- payment (deposit, $500, check 4412, 12 Mar) ---> partial
 *           \-- payment (balance, $700, transfer, 29 Mar) -----> paid
 *
 * Before this table an invoice was paid or it was not, so a deposit needed two
 * invoices and "what came in this month" was the total of the invoices marked
 * paid rather than the money that landed. Everything the owner needs to answer
 * "what does this customer still owe me" now comes off these rows.
 *
 * Three rules hold the model together, and all three are enforced here rather
 * than in a screen:
 *
 *   1. An invoice's status is DERIVED. Nobody types "paid"; the status is
 *      whatever `documents.deriveInvoiceStatus` says the payments justify, and
 *      it is recomputed inside the same write as every create, edit and
 *      delete. Delete the last payment and the invoice is owed again.
 *   2. A payment cannot exceed the balance unless the caller says so on
 *      purpose (`allowOverpayment`). The refusal names the balance, because
 *      "that is too much" without the number is useless to somebody holding a
 *      check.
 *   3. Nothing happens to a draft or a void invoice. A draft has not been
 *      billed to anybody; a void invoice is a billing that was taken back.
 *
 * Deleting is a soft delete like every other record, so the undo toast can put
 * a payment back, and the status recomputes both ways.
 *
 * Not indexed for search: a payment has no name and no words of its own worth
 * matching - searching "4412" for a check number would need the FTS triggers
 * this table deliberately does not have. It is reached through its invoice,
 * its customer or its job, which are all indexed.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withTransaction } from "@/db/writeLock";
import { NotFoundError, ValidationError } from "@/db/errors";
import { nowIso, todayLocal } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import * as activities from "@/db/repos/activities";
import * as documents from "@/db/repos/documents";
import * as settings from "@/db/repos/settings";
import {
  insertStatement,
  logWrite,
  mapRows,
  parseOrThrow,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  stampNew,
  trimmedOrNull,
  updateStatement,
  type Col,
} from "@/db/repos/_base";

/* -------------------------------------------------------------------------- */
/* shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** The five ways a trade owner gets paid, and the catch-all. */
export const PAYMENT_METHODS = ["cash", "check", "card", "transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  transfer: "Bank transfer",
  other: "Other",
};

/** The word on a row. Sentence case, and never the raw database value. */
export function methodLabel(method: string): string {
  return METHOD_LABELS[method as PaymentMethod] ?? "Other";
}

/**
 * Turn whatever a caller has into one of the five methods.
 *
 * `documents.paid_method` was free text before this table existed, so the app
 * already holds words like "bank", "cheque", "ACH" and "Venmo". The dialog
 * only ever offers the five, but the example workspace, an import and the old
 * column all arrive with prose, and the CHECK constraint would refuse it.
 * Anything unrecognised is "other", which is honest rather than a guess.
 */
export function normalizeMethod(value: string | null | undefined): PaymentMethod {
  const text = (value ?? "").trim().toLowerCase();
  if (text.length === 0) return "other";
  if (text.includes("cash")) return "cash";
  if (text.includes("check") || text.includes("cheque")) return "check";
  if (text.includes("card") || text.includes("visa") || text.includes("amex")) return "card";
  if (
    text.includes("transfer") ||
    text.includes("bank") ||
    text.includes("ach") ||
    text.includes("wire") ||
    text.includes("zelle") ||
    text.includes("venmo")
  ) {
    return "transfer";
  }
  return "other";
}

export type Payment = {
  id: string;
  documentId: string;
  /** "INV-2026-0004", so a row can name its invoice without a second query. */
  documentNumber: string;
  documentKind: string;
  documentStatus: string;
  documentTotalCents: number;
  dealId: string | null;
  dealTitle: string | null;
  contactId: string | null;
  companyId: string | null;
  amountCents: number;
  paidOn: string;
  method: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const PAYMENT_COLS: readonly Col<Payment>[] = [
  ["id", "p.id", "text"],
  ["documentId", "p.document_id", "text"],
  ["documentNumber", "d.number", "text"],
  ["documentKind", "d.kind", "text"],
  ["documentStatus", "d.status", "text"],
  ["documentTotalCents", "d.total_cents", "int"],
  ["dealId", "p.deal_id", "textNull"],
  ["dealTitle", "dl.title", "textNull"],
  ["contactId", "d.contact_id", "textNull"],
  ["companyId", "d.company_id", "textNull"],
  ["amountCents", "p.amount_cents", "int"],
  ["paidOn", "p.paid_on", "text"],
  ["method", "p.method", "text"],
  ["reference", "p.reference", "textNull"],
  ["note", "p.note", "textNull"],
  ["createdAt", "p.created_at", "text"],
  ["updatedAt", "p.updated_at", "text"],
  ["deletedAt", "p.deleted_at", "textNull"],
];

const PAYMENT_FROM = `FROM payments p
  JOIN documents d ON d.id = p.document_id
  LEFT JOIN deals dl ON dl.id = p.deal_id`;

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const amountField = z
  .number({ message: "Enter an amount." })
  .int("An amount is in whole cents.")
  .positive("A payment has to be more than zero.");

const paidOnField = z
  .string()
  .regex(DATE_ONLY, "Use a date like 2026-03-12.")
  .refine((value) => value <= todayLocal(), {
    message: "A payment cannot be dated in the future.",
  });

export const newPaymentSchema = z.object({
  documentId: z.string().min(1, "Choose an invoice."),
  amountCents: amountField,
  paidOn: paidOnField.default(() => todayLocal()),
  method: z.enum(PAYMENT_METHODS, { message: "Choose how it was paid." }),
  reference: z.string().trim().max(120, "Keep the reference short.").nullish(),
  note: z.string().trim().max(2000, "Keep the note short.").nullish(),
});

export type NewPayment = z.input<typeof newPaymentSchema>;

export const paymentPatchSchema = z.object({
  amountCents: amountField.optional(),
  paidOn: paidOnField.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(2000).nullish(),
});

export type PaymentPatch = z.input<typeof paymentPatchSchema>;

export type WriteOptions = {
  batchId?: string;
  /**
   * Let the payment take the invoice past its total. Off by default: an
   * amount bigger than the balance is almost always a typo, and the refusal
   * tells the owner what the balance actually is. A genuine overpayment - the
   * customer rounded up, or paid two invoices with one check - is a deliberate
   * call with this set.
   */
  allowOverpayment?: boolean;
};

/* -------------------------------------------------------------------------- */
/* reading                                                                    */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<Payment | null> {
  const rows = await raw.query(
    `SELECT ${selectList(PAYMENT_COLS, "p")} ${PAYMENT_FROM} WHERE p.id = ?`,
    [id],
  );
  return mapRows(PAYMENT_COLS, rows)[0] ?? null;
}

export async function getOrThrow(id: string): Promise<Payment> {
  const payment = await get(id);
  if (!payment) throw new NotFoundError("payment", id);
  return payment;
}

/** Oldest first: a payments list reads as the story of the job's money. */
export async function listForDocument(documentId: string): Promise<Payment[]> {
  const rows = await raw.query(
    `SELECT ${selectList(PAYMENT_COLS, "p")} ${PAYMENT_FROM}
     WHERE p.document_id = ? AND p.deleted_at IS NULL
     ORDER BY p.paid_on ASC, p.created_at ASC`,
    [documentId],
  );
  return mapRows(PAYMENT_COLS, rows);
}

/** Every payment against one job, newest first. */
export async function listForDeal(dealId: string): Promise<Payment[]> {
  const rows = await raw.query(
    `SELECT ${selectList(PAYMENT_COLS, "p")} ${PAYMENT_FROM}
     WHERE p.deal_id = ? AND p.deleted_at IS NULL AND d.deleted_at IS NULL
     ORDER BY p.paid_on DESC, p.created_at DESC`,
    [dealId],
  );
  return mapRows(PAYMENT_COLS, rows);
}

export type CustomerRef = { contactId?: string | null; companyId?: string | null };
export type DayRange = { fromDay?: string; toDay?: string };

/**
 * Every payment from one customer, newest first, optionally inside a period.
 *
 * A customer is a contact, a company, or a contact at a company, and the match
 * is an OR for the same reason `money.customerMoney`'s is: a payment against
 * the company and a payment against the person are both this customer's money.
 * An empty reference is nobody, and answers nothing rather than the whole
 * workspace.
 *
 * `fromDay` is inclusive and `toDay` is inclusive - these are the two days a
 * statement period is printed with, not a half-open instant range.
 */
export async function listForCustomer(
  ref: CustomerRef,
  range: DayRange = {},
): Promise<Payment[]> {
  const contactId = ref.contactId ?? null;
  const companyId = ref.companyId ?? null;
  if (contactId === null && companyId === null) return [];

  const or: string[] = [];
  const params: (string | null)[] = [];
  if (contactId !== null) {
    or.push("d.contact_id = ?");
    params.push(contactId);
  }
  if (companyId !== null) {
    or.push("d.company_id = ?");
    params.push(companyId);
  }
  const clauses = [
    "p.deleted_at IS NULL",
    "d.deleted_at IS NULL",
    `(${or.join(" OR ")})`,
  ];
  if (range.fromDay) {
    clauses.push("p.paid_on >= ?");
    params.push(range.fromDay);
  }
  if (range.toDay) {
    clauses.push("p.paid_on <= ?");
    params.push(range.toDay);
  }

  const rows = await raw.query(
    `SELECT ${selectList(PAYMENT_COLS, "p")} ${PAYMENT_FROM}
     WHERE ${clauses.join(" AND ")}
     ORDER BY p.paid_on DESC, p.created_at DESC`,
    params,
  );
  return mapRows(PAYMENT_COLS, rows);
}

/** What is still owed on one invoice: its total less its live payments. */
export async function balanceCentsFor(documentId: string): Promise<number> {
  const current = await documents.getOrThrow(documentId);
  const paid = await documents.paidCentsFor(documentId);
  return current.document.totalCents - paid;
}

/* -------------------------------------------------------------------------- */
/* the timeline line                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The one line a payment writes to the job's (and the customer's) timeline.
 *
 * Pure, so the wording is unit-testable without a database. One line per
 * action: the status change the payment causes writes nothing of its own,
 * because the owner did one thing and the timeline should say so once.
 */
export function paymentActivityBody(
  event: "recorded" | "changed" | "removed",
  input: {
    amountCents: number;
    balanceCents: number;
    number: string;
    method?: string | null;
    currency?: string;
    locale?: string;
  },
): string {
  const money = (cents: number) => formatMoney(cents, input.currency, input.locale);
  const settled = input.balanceCents <= 0;
  const owed = settled
    ? `${input.number} is settled`
    : `${money(input.balanceCents)} still owed on ${input.number}`;

  switch (event) {
    case "recorded": {
      const how = input.method ? ` by ${methodLabel(input.method).toLowerCase()}` : "";
      return `Paid ${money(input.amountCents)}${how} · ${owed}`;
    }
    case "changed":
      return `Payment changed to ${money(input.amountCents)} · ${owed}`;
    case "removed":
      return `Payment of ${money(input.amountCents)} removed · ${owed}`;
  }
}

async function formats(): Promise<{ currency: string; locale: string }> {
  const [currency, locale] = await Promise.all([
    settings.get("currency"),
    settings.get("locale"),
  ]);
  return { currency: currency ?? "USD", locale: locale ?? "en-US" };
}

/* -------------------------------------------------------------------------- */
/* writing                                                                    */
/* -------------------------------------------------------------------------- */

function assertWithinBalance(
  input: { amountCents: number; balanceCents: number; number: string },
  options: WriteOptions,
  formatted: { currency: string; locale: string },
): void {
  if (options.allowOverpayment === true) return;
  if (input.amountCents <= input.balanceCents) return;
  const balance = formatMoney(input.balanceCents, formatted.currency, formatted.locale);
  const amount = formatMoney(input.amountCents, formatted.currency, formatted.locale);
  throw new ValidationError(
    `${balance} is left on ${input.number}, so ${amount} is more than the balance.`,
    [
      {
        path: "amountCents",
        message:
          input.balanceCents <= 0
            ? `${input.number} is already paid in full.`
            : `Record ${balance} or less, or split it across the invoices it covers.`,
      },
    ],
  );
}

/**
 * Record a payment against an invoice.
 *
 * Everything happens in one transaction: the row, the timeline line, the undo
 * entry and the invoice's recomputed status. A refusal leaves nothing behind.
 */
export async function create(
  input: NewPayment,
  options: WriteOptions = {},
): Promise<Payment> {
  const parsed = parseOrThrow(newPaymentSchema, input);

  return withTransaction(async () => {
    const current = await documents.getOrThrow(parsed.documentId);
    const invoice = current.document;
    documents.assertTakesPayments(invoice);

    const alreadyPaid = await documents.paidCentsFor(invoice.id);
    const formatted = await formats();
    assertWithinBalance(
      {
        amountCents: parsed.amountCents,
        balanceCents: invoice.totalCents - alreadyPaid,
        number: invoice.number,
      },
      options,
      formatted,
    );

    const stamp = stampNew();
    const values = {
      ...stamp,
      documentId: invoice.id,
      dealId: invoice.dealId,
      amountCents: parsed.amountCents,
      paidOn: parsed.paidOn,
      method: parsed.method,
      reference: trimmedOrNull(parsed.reference ?? null),
      note: trimmedOrNull(parsed.note ?? null),
      deletedAt: null,
    };

    const balanceAfter = invoice.totalCents - (alreadyPaid + parsed.amountCents);
    const activity = activities.systemStatement({
      body: paymentActivityBody("recorded", {
        amountCents: parsed.amountCents,
        balanceCents: balanceAfter,
        number: invoice.number,
        method: parsed.method,
        ...formatted,
      }),
      dealId: invoice.dealId,
      contactId: invoice.contactId,
      companyId: invoice.companyId,
    });

    const statement = insertStatement("payments", values);
    await raw.batch([statement, activity]);
    await logWrite("payment", stamp.id, "create", null, values, options.batchId);
    await documents.recomputeInvoiceStatus(invoice.id, { batchId: options.batchId });

    return getOrThrow(stamp.id);
  }, "Recording a payment");
}

/**
 * The one-click "Mark paid": a payment for whatever is left, dated today.
 *
 * This is what the button on the invoice page and on Today now does. It is the
 * same write as any other payment, so an invoice marked paid this way has a
 * payment row behind it like every other, and the Revenue report counts it on
 * the day it was actually taken.
 */
export async function recordFullPayment(
  documentId: string,
  input: { paidOn?: string; method?: PaymentMethod; reference?: string | null; note?: string | null } = {},
  options: WriteOptions = {},
): Promise<Payment> {
  const balance = await balanceCentsFor(documentId);
  if (balance <= 0) {
    const current = await documents.getOrThrow(documentId);
    throw new ValidationError(`${current.document.number} is already paid in full.`, [
      { path: "amountCents", message: "There is nothing left to record." },
    ]);
  }
  return create(
    {
      documentId,
      amountCents: balance,
      paidOn: input.paidOn ?? todayLocal(),
      method: input.method ?? "other",
      reference: input.reference ?? null,
      note: input.note ?? null,
    },
    options,
  );
}

/** Correct a payment: the amount, the day, how it came in, its reference. */
export async function update(
  id: string,
  patch: PaymentPatch,
  options: WriteOptions = {},
): Promise<Payment> {
  const parsed = parseOrThrow(paymentPatchSchema, patch);

  return withTransaction(async () => {
    const before = await getOrThrow(id);
    const current = await documents.getOrThrow(before.documentId);
    const invoice = current.document;

    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (parsed.amountCents !== undefined) values.amountCents = parsed.amountCents;
    if (parsed.paidOn !== undefined) values.paidOn = parsed.paidOn;
    if (parsed.method !== undefined) values.method = parsed.method;
    if (parsed.reference !== undefined) values.reference = trimmedOrNull(parsed.reference);
    if (parsed.note !== undefined) values.note = trimmedOrNull(parsed.note);

    const amountAfter = parsed.amountCents ?? before.amountCents;
    const others = (await documents.paidCentsFor(invoice.id)) - before.amountCents;
    const formatted = await formats();
    assertWithinBalance(
      {
        amountCents: amountAfter,
        balanceCents: invoice.totalCents - others,
        number: invoice.number,
      },
      options,
      formatted,
    );

    const balanceAfter = invoice.totalCents - (others + amountAfter);
    const activity = activities.systemStatement({
      body: paymentActivityBody("changed", {
        amountCents: amountAfter,
        balanceCents: balanceAfter,
        number: invoice.number,
        method: parsed.method ?? before.method,
        ...formatted,
      }),
      dealId: invoice.dealId,
      contactId: invoice.contactId,
      companyId: invoice.companyId,
    });

    await raw.batch([updateStatement("payments", id, values), activity]);
    await logWrite("payment", id, "update", before, values, options.batchId);
    await documents.recomputeInvoiceStatus(invoice.id, { batchId: options.batchId });

    return getOrThrow(id);
  }, "Changing a payment");
}

/**
 * Remove a payment. Soft, so the undo toast can put it back, and the invoice's
 * status walks back with it: delete the balance payment and the invoice reads
 * partially paid again; delete the last one and it is simply owed.
 */
export async function remove(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withTransaction(async () => {
    const before = await getOrThrow(id);
    const current = await documents.getOrThrow(before.documentId);
    const invoice = current.document;

    await softDeleteRow("payments", "payment", id, options.batchId);

    const remaining = await documents.paidCentsFor(invoice.id);
    const formatted = await formats();
    const activity = activities.systemStatement({
      body: paymentActivityBody("removed", {
        amountCents: before.amountCents,
        balanceCents: invoice.totalCents - remaining,
        number: invoice.number,
        ...formatted,
      }),
      dealId: invoice.dealId,
      contactId: invoice.contactId,
      companyId: invoice.companyId,
    });
    await raw.batch([activity]);
    await documents.recomputeInvoiceStatus(invoice.id, { batchId: options.batchId });
  }, "Removing a payment");
}

/** Put a removed payment back, and recompute the invoice behind it. */
export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withTransaction(async () => {
    const payment = await get(id);
    if (!payment) throw new NotFoundError("payment", id);
    await restoreRow("payments", "payment", id, options.batchId);
    await documents.recomputeInvoiceStatus(payment.documentId, {
      batchId: options.batchId,
    });
  }, "Restoring a payment");
}

/** Permanent. Only the trash sweep calls this. */
export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withTransaction(async () => {
    const payment = await get(id);
    await purgeRow("payments", "payment", id, options.batchId);
    if (payment) {
      await documents.recomputeInvoiceStatus(payment.documentId, {
        batchId: options.batchId,
      });
    }
  }, "Purging a payment");
}

/**
 * Take every payment off an invoice: what "this was not paid after all" means
 * now that payment is a record rather than a flag. One batch, one undo.
 */
export async function clearForDocument(
  documentId: string,
  options: { batchId?: string } = {},
): Promise<number> {
  const existing = await listForDocument(documentId);
  for (const payment of existing) {
    await remove(payment.id, options);
  }
  return existing.length;
}
