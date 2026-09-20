/**
 * Quotes and invoices: one table, two kinds (D21, D22).
 *
 *   quote:    [draft] --send--> [sent] --accept--> [accepted] -> an invoice
 *                                     \--decline-> [declined]
 *   invoice:  [draft] --send--> [sent] --paid----> [paid]
 *   either:                             --void----> [void]
 *
 * A document is a record of what was sent. Its lines are copied in from the
 * deal rather than referenced, and once it leaves draft nothing about it can
 * be edited but its status - editing the deal afterwards must not rewrite a
 * piece of paper the customer is already holding.
 *
 * Numbering comes from `document_sequences`, a counter row per kind, bumped
 * inside the same transaction that writes the document. A counter rather than
 * max(number)+1 because the number is text with a prefix in it, and because a
 * voided invoice must never hand its number back out. The write lock
 * serialises every caller, so two creates at once get consecutive numbers with
 * no gap and no collision.
 *
 * Money is integer cents and tax is basis points, so no float ever touches a
 * total. Dates that are days (`issued_on`, `due_on`, `valid_until`, `paid_on`)
 * are local calendar strings; `sent_at` is an instant, which is the same
 * convention the rest of the schema uses.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withTransaction, withWrite } from "@/db/writeLock";
import { NotFoundError, ValidationError } from "@/db/errors";
import { nowIso, todayLocal, addDaysToDateString } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import * as deals from "@/db/repos/deals";
import * as settings from "@/db/repos/settings";
import { vocabularyFor, DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";
import * as activities from "@/db/repos/activities";
import { contains } from "@/db/repos/_pickers";
import {
  countRows,
  insertStatement,
  logWrite,
  mapRows,
  pageClause,
  parseOrThrow,
  purgeRow,
  restoreRow,
  selectList,
  softDeleteRow,
  trimmedOrNull,
  updateStatement,
  type Bindable,
  type Col,
  type Page,
  type Statement,
} from "@/db/repos/_base";

/* -------------------------------------------------------------------------- */
/* shapes                                                                     */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_KINDS = ["quote", "invoice"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "void"] as const;
/**
 * An invoice's five states. `partial` is the one the payments table added
 * (PX-5): an invoice with money against it that does not yet cover the total.
 * It is derived, never typed - `recomputeInvoiceStatus` writes it from the sum
 * of the invoice's payments, so no screen can put an invoice into a state its
 * payments do not justify. Quotes are unchanged; a quote never has payments.
 */
export const INVOICE_STATUSES = ["draft", "sent", "partial", "paid", "void"] as const;
/** The published invoice status type (LR-PX contract 5). */
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type DocumentStatus =
  | (typeof QUOTE_STATUSES)[number]
  | (typeof INVOICE_STATUSES)[number];

export type LineKind = "one_time" | "recurring";
export type LineInterval = "month" | "year" | null;

export type DocumentItem = {
  id: string;
  documentId: string;
  name: string;
  description: string | null;
  qty: number;
  unitCents: number;
  taxable: boolean;
  kind: string;
  interval: string | null;
  position: number;
};

/** A document with the three names a screen always needs beside it. */
export type Document = {
  id: string;
  kind: string;
  number: string;
  dealId: string | null;
  dealTitle: string | null;
  contactId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  companyId: string | null;
  companyName: string | null;
  status: string;
  issuedOn: string | null;
  dueOn: string | null;
  validUntil: string | null;
  subtotalCents: number;
  taxRateBp: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  paymentInstructions: string | null;
  convertedToId: string | null;
  sentAt: string | null;
  paidOn: string | null;
  paidMethod: string | null;
  paidNote: string | null;
  pdfPath: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type DocumentWithItems = { document: Document; items: DocumentItem[] };

export type DocumentFilter = {
  kind?: DocumentKind;
  status?: DocumentStatus;
  /** Invoices that are neither paid nor void: draft and sent. */
  unpaidOnly?: boolean;
  dealId?: string;
  contactId?: string;
  companyId?: string;
  search?: string;
  includeDeleted?: boolean;
};

const DOC_COLS: readonly Col<Document>[] = [
  ["id", "d.id", "text"],
  ["kind", "d.kind", "text"],
  ["number", "d.number", "text"],
  ["dealId", "d.deal_id", "textNull"],
  ["dealTitle", "dl.title", "textNull"],
  ["contactId", "d.contact_id", "textNull"],
  ["contactFirstName", "c.first_name", "textNull"],
  ["contactLastName", "c.last_name", "textNull"],
  ["companyId", "d.company_id", "textNull"],
  ["companyName", "co.name", "textNull"],
  ["status", "d.status", "text"],
  ["issuedOn", "d.issued_on", "textNull"],
  ["dueOn", "d.due_on", "textNull"],
  ["validUntil", "d.valid_until", "textNull"],
  ["subtotalCents", "d.subtotal_cents", "int"],
  ["taxRateBp", "d.tax_rate_bp", "int"],
  ["taxCents", "d.tax_cents", "int"],
  ["totalCents", "d.total_cents", "int"],
  ["notes", "d.notes", "textNull"],
  ["paymentInstructions", "d.payment_instructions", "textNull"],
  ["convertedToId", "d.converted_to_id", "textNull"],
  ["sentAt", "d.sent_at", "textNull"],
  ["paidOn", "d.paid_on", "textNull"],
  ["paidMethod", "d.paid_method", "textNull"],
  ["paidNote", "d.paid_note", "textNull"],
  ["pdfPath", "d.pdf_path", "textNull"],
  ["createdAt", "d.created_at", "text"],
  ["updatedAt", "d.updated_at", "text"],
  ["deletedAt", "d.deleted_at", "textNull"],
];

const ITEM_COLS: readonly Col<DocumentItem>[] = [
  ["id", "i.id", "text"],
  ["documentId", "i.document_id", "text"],
  ["name", "i.name", "text"],
  ["description", "i.description", "textNull"],
  ["qty", "i.qty", "int"],
  ["unitCents", "i.unit_cents", "int"],
  ["taxable", "i.taxable", "bool"],
  ["kind", "i.kind", "text"],
  ["interval", "i.interval", "textNull"],
  ["position", "i.position", "int"],
];

const DOC_FROM = `FROM documents d
  LEFT JOIN deals dl ON dl.id = d.deal_id
  LEFT JOIN contacts c ON c.id = d.contact_id
  LEFT JOIN companies co ON co.id = d.company_id`;

/* -------------------------------------------------------------------------- */
/* totals                                                                     */
/* -------------------------------------------------------------------------- */

export type TotalsInput = {
  qty: number;
  unitCents: number;
  taxable: boolean;
};

export type Totals = {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Subtotal, tax and total from the lines and one rate.
 *
 * Tax is charged on the taxable lines only and is rounded once, on the whole
 * taxable subtotal, rather than per line - rounding each line and adding them
 * up is how an invoice ends up a cent away from the customer's own arithmetic.
 * Basis points, integer division, half-up: 8.25% of $100.00 is 825 cents.
 */
export function computeTotals(items: TotalsInput[], taxRateBp: number): Totals {
  let subtotalCents = 0;
  let taxableCents = 0;
  for (const item of items) {
    const line = Math.round(item.qty * item.unitCents);
    subtotalCents += line;
    if (item.taxable) taxableCents += line;
  }
  const rate = Math.max(0, Math.trunc(taxRateBp));
  const taxCents = Math.round((taxableCents * rate) / 10_000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/** "per month" / "per year" — what a recurring line says on a quote. */
export function intervalSuffix(kind: string, interval: string | null): string {
  if (kind !== "recurring") return "";
  if (interval === "year") return "per year";
  return "per month";
}

/* -------------------------------------------------------------------------- */
/* activity                                                                   */
/* -------------------------------------------------------------------------- */

export type DocumentActivityEvent =
  | "created"
  | "sent"
  | "paid"
  | "unpaid"
  | "void"
  | "accepted"
  | "declined";

/**
 * The one line each event writes to the deal's (and its contact's and
 * company's) timeline. Pure and DB-free on purpose, so it is unit-testable
 * without a harness: the actual write is a `systemStatement` built from this
 * string plus the ids, folded into the same batch as the document write that
 * caused it (see `insertDocument`, `setStatus` and `accept`).
 *
 * "accepted" names the invoice the quote became when it produced one, in the
 * same sentence, rather than that invoice also getting its own "created"
 * line - one user action is one line on the timeline, not two.
 */
export function documentActivityBody(
  event: DocumentActivityEvent,
  input: {
    kind: string;
    number: string;
    totalCents: number;
    currency?: string;
    locale?: string;
    method?: string | null;
    becameNumber?: string | null;
  },
): string {
  const label = input.kind === "quote" ? "Quote" : "Invoice";
  const money = () => formatMoney(input.totalCents, input.currency, input.locale);

  switch (event) {
    case "created":
      return `${label} ${input.number} created · ${money()}`;
    case "sent":
      return `${label} ${input.number} sent · ${money()}`;
    case "paid":
      return input.method ? `Paid ${money()} by ${input.method}` : `Paid ${money()}`;
    case "unpaid":
      return `${label} ${input.number} marked unpaid · ${money()} owed again`;
    case "void":
      return `${label} ${input.number} voided`;
    case "accepted":
      return input.becameNumber
        ? `${label} ${input.number} accepted · became ${input.becameNumber}`
        : `${label} ${input.number} accepted`;
    case "declined":
      return `${label} ${input.number} declined`;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* numbering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What this workspace calls a deal, for the handful of messages the owner
 * reads out of this layer.
 *
 * The repository cannot call `useVocabulary` - it is not React - and it must
 * not import `src/app`, a layering rule nothing in `src/db` breaks. The pure
 * table now lives in `src/lib/vocabulary.ts` for exactly this, and the setting
 * is an ordinary `settings.get` this module already makes for currency and
 * locale. A workspace that has never chosen falls back to Deals, and a read
 * that fails falls back rather than turning a validation message into a crash.
 */
async function vocabulary(): Promise<Vocabulary> {
  try {
    return vocabularyFor(await settings.get("vocabulary"));
  } catch {
    return DEFAULT_VOCABULARY;
  }
}

/** "INV-2026-0007". The year is the issue year; the counter is per kind. */
export function formatNumber(prefix: string, year: number, counter: number): string {
  const safePrefix = (prefix || "").trim() || "DOC";
  return `${safePrefix}-${year}-${String(counter).padStart(4, "0")}`;
}

/**
 * Read the counter for a kind and hand back both the number and the statement
 * that bumps it. The caller is already inside the transaction that writes the
 * document, so the read and the bump cannot straddle another create.
 */
async function takeNumber(
  kind: DocumentKind,
  prefix: string,
  year: number,
): Promise<{ number: string; statements: Statement[] }> {
  const rows = await raw.query(
    `SELECT s.next_number AS s_next_number FROM document_sequences s WHERE s.kind = ?`,
    [kind],
  );
  const counter = rows.length > 0 ? Number(rows[0][0]) : 1;
  const statements: Statement[] =
    rows.length > 0
      ? [
          {
            sql: `UPDATE document_sequences SET next_number = ? WHERE kind = ?`,
            params: [counter + 1, kind],
          },
        ]
      : [
          {
            sql: `INSERT INTO document_sequences (kind, next_number) VALUES (?, ?)`,
            params: [kind, counter + 1],
          },
        ];
  return { number: formatNumber(prefix, year, counter), statements };
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function get(id: string): Promise<DocumentWithItems | null> {
  const rows = await raw.query(
    `SELECT ${selectList(DOC_COLS, "d")} ${DOC_FROM} WHERE d.id = ?`,
    [id],
  );
  if (rows.length === 0) return null;
  const document = mapRows(DOC_COLS, rows)[0];
  return { document, items: await listItems(id) };
}

export async function getOrThrow(id: string): Promise<DocumentWithItems> {
  const found = await get(id);
  if (!found) throw new NotFoundError("document", id);
  return found;
}

export async function listItems(documentId: string): Promise<DocumentItem[]> {
  const rows = await raw.query(
    `SELECT ${selectList(ITEM_COLS, "i")} FROM document_items i
     WHERE i.document_id = ? ORDER BY i.position ASC, i.rowid ASC`,
    [documentId],
  );
  return mapRows(ITEM_COLS, rows);
}

function whereFor(filter: DocumentFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!filter.includeDeleted) clauses.push("d.deleted_at IS NULL");
  if (filter.kind) {
    clauses.push("d.kind = ?");
    params.push(filter.kind);
  }
  if (filter.status) {
    clauses.push("d.status = ?");
    params.push(filter.status);
  }
  if (filter.unpaidOnly) {
    clauses.push("d.kind = 'invoice' AND d.status IN ('draft', 'sent', 'partial')");
  }
  if (filter.dealId) {
    clauses.push("d.deal_id = ?");
    params.push(filter.dealId);
  }
  if (filter.contactId) {
    clauses.push("d.contact_id = ?");
    params.push(filter.contactId);
  }
  if (filter.companyId) {
    clauses.push("d.company_id = ?");
    params.push(filter.companyId);
  }
  const search = (filter.search ?? "").trim();
  if (search.length > 0) {
    // Escaped and paired with ESCAPE '\', or a literal % or _ the owner
    // typed acts as a wildcard instead of matching itself (LR-SEC packet
    // item 5; see companies.ts's whereFor for the fuller note).
    clauses.push(
      `(d.number LIKE ? ESCAPE '\\' OR co.name LIKE ? ESCAPE '\\' OR c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' OR dl.title LIKE ? ESCAPE '\\')`,
    );
    const like = contains(search);
    params.push(like, like, like, like, like);
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

/**
 * Newest first, by issue date and then by creation. A document with no issue
 * date is a draft, and a draft belongs at the top of the list it is in.
 *
 * The COALESCE compares a date-only string against a full ISO timestamp, which
 * is fine and is not an accident: both start with YYYY-MM-DD, so the string
 * comparison is a date comparison, and a date-only value sorts before any
 * timestamp on the same day. That is the order this list wants anyway.
 */
export async function list(
  filter: DocumentFilter = {},
  page?: Page,
): Promise<{ rows: Document[]; total: number }> {
  const where = whereFor(filter);
  const limit = pageClause(page);
  const rows = await raw.query(
    `SELECT ${selectList(DOC_COLS, "d")} ${DOC_FROM}${where.sql}
     ORDER BY COALESCE(d.issued_on, d.created_at) DESC, d.created_at DESC${limit.sql}`,
    [...where.params, ...limit.params],
  );
  const total = await countRows(
    `SELECT COUNT(*) ${DOC_FROM}${where.sql}`,
    where.params,
  );
  return { rows: mapRows(DOC_COLS, rows), total };
}

/** Every document raised against one deal, newest first. The deal panel. */
export async function listForDeal(dealId: string): Promise<Document[]> {
  const { rows } = await list({ dealId }, { limit: 200 });
  return rows;
}

/* -------------------------------------------------------------------------- */
/* creating                                                                   */
/* -------------------------------------------------------------------------- */

export const newDocumentItemSchema = z.object({
  name: z.string().min(1, "A line needs a description."),
  description: z.string().nullable().optional(),
  qty: z.number().int().min(1, "A line needs a quantity of at least 1.").default(1),
  unitCents: z.number().int().default(0),
  taxable: z.boolean().default(false),
  kind: z.enum(["one_time", "recurring"]).default("one_time"),
  interval: z.enum(["month", "year"]).nullable().optional(),
});

export type NewDocumentItem = z.input<typeof newDocumentItemSchema>;

export const newDocumentSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  // Money model (round 3): every document belongs to a deal. Required, not
  // advisory - see `insertDocument`, the one place that turns this into a
  // customer.
  // Noun-free on purpose: a zod message is built once at module load, so it
  // cannot ask the workspace what it calls a deal. The vocabulary-aware
  // sentence is the one `insertDocument` throws a few lines down, which is the
  // path every caller with a real (or missing) deal id actually takes.
  dealId: z.string().min(1, "Pick what this document is for."),
  // Still accepted on input, but advisory only: `insertDocument` always
  // overwrites these from the deal, so a document and its deal can never
  // disagree about who it is for. Kept in the type so a caller that still
  // reads them off a contact/company picker does not need to strip them.
  contactId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  items: z.array(newDocumentItemSchema).min(1, "A document needs at least one line."),
  /** Basis points. 825 is 8.25%. */
  taxRateBp: z.number().int().min(0).default(0),
  /** The prefix the number is built from, read from settings by the caller. */
  prefix: z.string().default("INV"),
  issuedOn: z.string().nullable().optional(),
  dueOn: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  paymentInstructions: z.string().nullable().optional(),
});

export type NewDocument = z.input<typeof newDocumentSchema>;

/**
 * The one path that is allowed to skip the deal rule: `accept()` converting a
 * quote into its invoice. A quote written before this round may have no deal
 * at all, and accepting it must still be able to raise its invoice - carrying
 * the quote's own `dealId` across exactly as it is (null included), never
 * inventing one just to satisfy the schema.
 */
const convertedDocumentSchema = newDocumentSchema.extend({
  dealId: z.string().nullable().default(null),
});

type ParsedDocument = z.output<typeof newDocumentSchema>;
/** `insertDocument`'s own parameter shape: a parsed document whose dealId may
 * be null, which is true of both `ParsedDocument` (never null in practice,
 * since the public schema requires one) and the looser conversion schema. */
type ParsedDocumentLoose = Omit<ParsedDocument, "dealId"> & { dealId: string | null };

function itemRows(
  documentId: string,
  items: z.output<typeof newDocumentItemSchema>[],
): Statement[] {
  return items.map((item, index) =>
    insertStatement("document_items", {
      id: newId(),
      documentId,
      name: item.name.trim(),
      description: trimmedOrNull(item.description ?? null),
      qty: item.qty,
      unitCents: item.unitCents,
      taxable: item.taxable,
      kind: item.kind,
      interval: item.kind === "recurring" ? (item.interval ?? "month") : null,
      position: index,
    }),
  );
}

/**
 * Create a document with its lines, its number and its totals, in one
 * transaction. Everything else in this file that creates a document goes
 * through here, including the invoice an accepted quote turns into.
 */
export async function create(input: NewDocument): Promise<Document> {
  const parsed = parseOrThrow(newDocumentSchema, input);
  return withTransaction(async () => {
    const { id } = await insertDocument(parsed);
    const created = await get(id);
    if (!created) throw new NotFoundError("document", id);
    return created.document;
  }, `Creating a ${input.kind}`);
}

/**
 * The body of `create`, for a caller that already holds the transaction.
 *
 * `options.inheritCustomer` (default true) is the one knob that enforces the
 * money model: when true, the document's contact and company are read off
 * its deal and whatever the caller passed for them is ignored outright - one
 * customer of record, so a document and its deal can never disagree. It is
 * false for exactly one caller, `accept()`'s own conversion of a quote that
 * predates this rule and may have no deal at all; that path carries the
 * quote's own stored contact and company across instead.
 *
 * `options.skipCreatedActivity` is for the same caller: the invoice an
 * accepted quote turns into does not get its own "created" line on the
 * timeline, because `accept()` already writes one "accepted" line that names
 * it - one user action, one line.
 */
async function insertDocument(
  parsed: ParsedDocumentLoose,
  extra: { convertedToId?: string | null } = {},
  options: { inheritCustomer?: boolean; skipCreatedActivity?: boolean } = {},
): Promise<{ id: string; number: string }> {
  const inheritCustomer = options.inheritCustomer ?? true;

  let contactId: string | null;
  let companyId: string | null;
  if (inheritCustomer) {
    if (!parsed.dealId) {
      const words = await vocabulary();
      throw new ValidationError(`A document belongs to a ${words.lower}.`, [
        { path: "dealId", message: `Pick the ${words.lower} this document is for.` },
      ]);
    }
    const deal = await deals.getOrThrow(parsed.dealId);
    contactId = deal.contactId;
    companyId = deal.companyId;
  } else {
    contactId = parsed.contactId ?? null;
    companyId = parsed.companyId ?? null;
  }

  const at = nowIso();
  const issuedOn = parsed.issuedOn ?? null;
  const year = Number((issuedOn ?? todayLocal()).slice(0, 4)) || new Date().getFullYear();
  const { number, statements: sequence } = await takeNumber(
    parsed.kind,
    parsed.prefix,
    year,
  );
  const totals = computeTotals(
    parsed.items.map((item) => ({
      qty: item.qty,
      unitCents: item.unitCents,
      taxable: item.taxable,
    })),
    parsed.taxRateBp,
  );

  const id = newId();
  const row = {
    id,
    kind: parsed.kind,
    number,
    dealId: parsed.dealId,
    contactId,
    companyId,
    status: "draft",
    issuedOn,
    dueOn: parsed.dueOn ?? null,
    validUntil: parsed.validUntil ?? null,
    subtotalCents: totals.subtotalCents,
    taxRateBp: parsed.taxRateBp,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    notes: trimmedOrNull(parsed.notes ?? null),
    paymentInstructions: trimmedOrNull(parsed.paymentInstructions ?? null),
    convertedToId: extra.convertedToId ?? null,
    sentAt: null,
    paidOn: null,
    paidMethod: null,
    paidNote: null,
    pdfPath: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };

  const statements: Statement[] = [
    ...sequence,
    insertStatement("documents", row),
    ...itemRows(id, parsed.items),
  ];

  if (!options.skipCreatedActivity) {
    const [currency, locale] = await Promise.all([
      settings.get("currency"),
      settings.get("locale"),
    ]);
    const activity = activities.systemStatement({
      body: documentActivityBody("created", {
        kind: parsed.kind,
        number,
        totalCents: totals.totalCents,
        currency,
        locale,
      }),
      dealId: row.dealId,
      contactId,
      companyId,
    });
    statements.push({ sql: activity.sql, params: activity.params });
  }

  await raw.batch(statements);
  await logWrite("document", id, "create", null, row);
  return { id, number };
}

/* -------------------------------------------------------------------------- */
/* creating from a deal                                                       */
/* -------------------------------------------------------------------------- */

export type DealLine = {
  name: string;
  description: string | null;
  qty: number;
  actualUnitCents: number;
  taxable: boolean;
  kind: string;
  interval: string | null;
};

/**
 * Which of a deal's lines a document carries.
 *
 * A quote shows the whole agreement, recurring lines included and annotated
 * with their interval, because that is what the customer is being asked to
 * agree to. An invoice for the work bills the one-time lines - the recurring
 * ones are billed by the schedule, month by month, and putting them on the
 * first invoice as well would bill them twice.
 */
export type LineSelection = "all" | "one_time" | "recurring";

export function selectLines(lines: DealLine[], selection: LineSelection): DealLine[] {
  if (selection === "all") return lines;
  if (selection === "recurring") return lines.filter((l) => l.kind === "recurring");
  return lines.filter((l) => l.kind !== "recurring");
}

async function dealLines(dealId: string): Promise<DealLine[]> {
  const rows = await raw.query(
    `SELECT di.name AS di_name, di.description AS di_description, di.qty AS di_qty,
            di.actual_unit_cents AS di_actual_unit_cents, di.taxable AS di_taxable,
            di.kind AS di_kind, di.interval AS di_interval
     FROM deal_items di
     WHERE di.deal_id = ? AND di.deleted_at IS NULL
     ORDER BY di.position ASC, di.rowid ASC`,
    [dealId],
  );
  return rows.map((row) => ({
    name: String(row[0] ?? ""),
    description: row[1] === null || row[1] === undefined ? null : String(row[1]),
    qty: Number(row[2] ?? 1),
    actualUnitCents: Number(row[3] ?? 0),
    taxable: Number(row[4] ?? 0) !== 0,
    kind: String(row[5] ?? "one_time"),
    interval: row[6] === null || row[6] === undefined ? null : String(row[6]),
  }));
}

export type FromDealOptions = {
  kind: DocumentKind;
  /** Defaults to "all" for a quote and "one_time" for an invoice. */
  lines?: LineSelection;
  prefix: string;
  taxRateBp: number;
  dueDays?: number;
  validDays?: number;
  paymentInstructions?: string | null;
  notes?: string | null;
  issuedOn?: string;
  /**
   * Take what has already been billed against this deal off the total, as one
   * negative line naming the invoices it credits.
   *
   * This is how a deposit works without a payments table (CPO audit, F-LB-7,
   * ruling R7). The owner raises a deposit invoice for half the job now; when
   * the work is done, the balance invoice carries the deal's one-time lines in
   * full and then subtracts what the deposit already billed, so the two
   * invoices add up to the deal's one-time value to the cent and Invoiced is
   * never double-counted.
   *
   * It credits every sent or paid invoice on the deal, not a document flagged
   * "deposit" - there is no such flag and there does not need to be one. Two
   * partial invoices credit as naturally as one, and a voided invoice credits
   * nothing, because it billed nothing.
   */
  creditPriorInvoices?: boolean;
};

/** What has already been billed against a deal: sent and paid, never draft or void. */
async function priorInvoiced(
  dealId: string,
): Promise<{ cents: number; numbers: string[] }> {
  const rows = await raw.query(
    `SELECT d.number AS d_number, d.total_cents AS d_total_cents
     FROM documents d
     WHERE d.deal_id = ? AND d.kind = 'invoice' AND d.deleted_at IS NULL
       AND d.status IN ('sent', 'paid')
     ORDER BY d.issued_on ASC, d.rowid ASC`,
    [dealId],
  );
  return {
    cents: rows.reduce((sum, row) => sum + Number(row[1] ?? 0), 0),
    numbers: rows.map((row) => String(row[0])),
  };
}

/**
 * Raise a quote or an invoice from a deal, copying its lines at the price the
 * deal actually agreed (`actual_unit_cents`, not the catalog's suggestion).
 */
export async function createFromDeal(
  dealId: string,
  options: FromDealOptions,
): Promise<Document> {
  const selection: LineSelection =
    options.lines ?? (options.kind === "quote" ? "all" : "one_time");
  const lines = selectLines(await dealLines(dealId), selection);
  if (lines.length === 0) {
    const words = await vocabulary();
    throw new ValidationError("There is nothing to put on this document.", [
      {
        path: "items",
        message:
          selection === "recurring"
            ? `This ${words.lower} has no monthly or yearly services on it.`
            : `This ${words.lower} has no services on it yet. Add one first.`,
      },
    ]);
  }

  const issuedOn = options.issuedOn ?? todayLocal();

  const extraItems: NewDocumentItem[] = [];
  if (options.creditPriorInvoices) {
    const prior = await priorInvoiced(dealId);
    if (prior.cents > 0) {
      extraItems.push({
        name: `Less already invoiced (${prior.numbers.join(", ")})`,
        // Not taxable: the credit takes money off the total, and taxing a
        // negative line would hand back tax that was never charged on it.
        taxable: false,
        qty: 1,
        unitCents: -prior.cents,
        kind: "one_time",
        interval: null,
      });
    }
  }

  // contactId/companyId are not passed here: `create` -> `insertDocument`
  // always takes them from the deal itself, so fetching them here as well
  // would be redundant, dead-reading code.
  return create({
    kind: options.kind,
    dealId,
    prefix: options.prefix,
    taxRateBp: options.taxRateBp,
    issuedOn,
    dueOn:
      options.kind === "invoice"
        ? addDaysToDateString(issuedOn, options.dueDays ?? 14)
        : null,
    validUntil:
      options.kind === "quote"
        ? addDaysToDateString(issuedOn, options.validDays ?? 30)
        : null,
    notes: options.notes ?? null,
    paymentInstructions: options.paymentInstructions ?? null,
    items: [
      ...lines.map((line) => ({
        name: line.name,
        description: line.description,
        qty: line.qty,
        unitCents: line.actualUnitCents,
        taxable: line.taxable,
        kind: line.kind === "recurring" ? ("recurring" as const) : ("one_time" as const),
        interval:
          line.kind === "recurring"
            ? line.interval === "year"
              ? ("year" as const)
              : ("month" as const)
            : null,
      })),
      ...extraItems,
    ],
  });
}

/**
 * A deposit: one invoice for part of the deal's one-time value, now.
 *
 * Deliberately one line rather than a percentage of each line. An owner asks
 * for "half down" or "five hundred up front", not for half of the mulch and
 * half of the edging, and one line is what the customer can read. The balance
 * invoice is an ordinary `createFromDeal` with `creditPriorInvoices`, which is
 * what makes the two add up.
 *
 * Tax sits on the balance invoice, not here: the deposit line is untaxed and
 * the balance carries the deal's real taxable lines at their full value, so
 * the tax the customer pays across the two is the tax on the job.
 */
export async function createDeposit(
  dealId: string,
  options: {
    amountCents: number;
    prefix: string;
    dueDays?: number;
    paymentInstructions?: string | null;
    issuedOn?: string;
  },
): Promise<Document> {
  if (!Number.isInteger(options.amountCents) || options.amountCents <= 0) {
    throw new ValidationError("A deposit needs an amount.", [
      { path: "amountCents", message: "Enter how much to ask for up front." },
    ]);
  }
  const lines = selectLines(await dealLines(dealId), "one_time");
  const oneTimeCents = lines.reduce(
    (sum, line) => sum + Math.round(line.qty * line.actualUnitCents),
    0,
  );
  if (lines.length === 0) {
    const words = await vocabulary();
    throw new ValidationError("There is nothing to take a deposit on.", [
      {
        path: "items",
        message: `This ${words.lower} has no one-off services on it yet. Add one first.`,
      },
    ]);
  }
  const prior = await priorInvoiced(dealId);
  const remaining = oneTimeCents - prior.cents;
  if (options.amountCents > remaining) {
    throw new ValidationError("That is more than the job is worth.", [
      {
        path: "amountCents",
        message:
          prior.cents > 0
            ? `Only ${formatMoney(remaining)} of this job has not been invoiced yet.`
            : `This job is worth ${formatMoney(oneTimeCents)}.`,
      },
    ]);
  }

  const issuedOn = options.issuedOn ?? todayLocal();
  return create({
    kind: "invoice",
    dealId,
    prefix: options.prefix,
    taxRateBp: 0,
    issuedOn,
    dueOn: addDaysToDateString(issuedOn, options.dueDays ?? 14),
    paymentInstructions: options.paymentInstructions ?? null,
    items: [
      {
        name: "Deposit",
        description: "Part payment up front. The balance is invoiced when the work is done.",
        qty: 1,
        unitCents: options.amountCents,
        taxable: false,
        kind: "one_time",
        interval: null,
      },
    ],
  });
}

/** The deal's one-time value, and what is left to bill after sent and paid invoices. */
export async function remainingOneTime(
  dealId: string,
): Promise<{ oneTimeCents: number; invoicedCents: number; remainingCents: number }> {
  const lines = selectLines(await dealLines(dealId), "one_time");
  const oneTimeCents = lines.reduce(
    (sum, line) => sum + Math.round(line.qty * line.actualUnitCents),
    0,
  );
  const prior = await priorInvoiced(dealId);
  return {
    oneTimeCents,
    invoicedCents: prior.cents,
    remainingCents: oneTimeCents - prior.cents,
  };
}

/* -------------------------------------------------------------------------- */
/* editing, while it is still a draft                                         */
/* -------------------------------------------------------------------------- */

function assertDraft(document: Document): void {
  if (document.status !== "draft") {
    throw new ValidationError("That has already been sent, so its lines are fixed.", [
      {
        path: "status",
        message:
          "A sent document is a record of what the customer received. Void it and raise a new one instead.",
      },
    ]);
  }
}

/** Replace every line on a draft and rewrite its totals. Draft only. */
export async function replaceItems(
  id: string,
  items: NewDocumentItem[],
): Promise<Document> {
  const parsed = parseOrThrow(z.array(newDocumentItemSchema).min(1), items);
  return withTransaction(async () => {
    const current = await getOrThrow(id);
    assertDraft(current.document);
    const totals = computeTotals(
      parsed.map((item) => ({
        qty: item.qty,
        unitCents: item.unitCents,
        taxable: item.taxable,
      })),
      current.document.taxRateBp,
    );
    const at = nowIso();
    await raw.batch([
      { sql: `DELETE FROM document_items WHERE document_id = ?`, params: [id] },
      ...itemRows(id, parsed),
      updateStatement("documents", id, { ...totals, updatedAt: at }),
    ]);
    await logWrite("document", id, "update", current.document, { ...totals });
    const next = await get(id);
    if (!next) throw new NotFoundError("document", id);
    return next.document;
  }, "Saving the lines");
}

// contactId, companyId and dealId are deliberately absent: the money model
// says a document's customer and its deal are one and the same thing, always
// read off the deal (see `insertDocument`), and `syncCustomerFromDeal` is the
// only path allowed to rewrite contact_id/company_id on an existing document.
// A patch cannot reintroduce disagreement through the back door.
export type DocumentPatch = {
  dueOn?: string | null;
  validUntil?: string | null;
  issuedOn?: string | null;
  notes?: string | null;
  paymentInstructions?: string | null;
  taxRateBp?: number;
};

/**
 * Edit the head of a draft. The tax rate is here because changing it changes
 * the totals, which is why this recomputes them rather than trusting the row.
 */
export async function update(id: string, patch: DocumentPatch): Promise<Document> {
  return withTransaction(async () => {
    const current = await getOrThrow(id);
    assertDraft(current.document);
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    if (patch.dueOn !== undefined) values.dueOn = patch.dueOn;
    if (patch.validUntil !== undefined) values.validUntil = patch.validUntil;
    if (patch.issuedOn !== undefined) values.issuedOn = patch.issuedOn;
    if (patch.notes !== undefined) values.notes = trimmedOrNull(patch.notes);
    if (patch.paymentInstructions !== undefined) {
      values.paymentInstructions = trimmedOrNull(patch.paymentInstructions);
    }
    if (patch.taxRateBp !== undefined) {
      values.taxRateBp = Math.max(0, Math.trunc(patch.taxRateBp));
      const totals = computeTotals(
        current.items.map((item) => ({
          qty: item.qty,
          unitCents: item.unitCents,
          taxable: item.taxable,
        })),
        values.taxRateBp as number,
      );
      Object.assign(values, totals);
    }
    await raw.execute(...statementParts(updateStatement("documents", id, values)));
    await logWrite("document", id, "update", current.document, values);
    const next = await get(id);
    if (!next) throw new NotFoundError("document", id);
    return next.document;
  }, "Saving the document");
}

function statementParts(statement: {
  sql: string;
  params: unknown[];
}): [string, unknown[]] {
  return [statement.sql, statement.params];
}

/** What `syncCustomerFromDeal` did, so the caller can tell the owner. */
export type CustomerSyncResult = {
  /** Drafts whose bill-to was rewritten. */
  changed: number;
  /** Documents the customer has already seen, left exactly as they were. */
  keptNumbers: string[];
};

/**
 * Re-copy the deal's customer onto its DRAFT documents. Called after a deal's
 * contact or company is edited; safe to call when nothing changed.
 *
 * Drafts only, and that is the whole point of this function's second half.
 * `assertDraft` above refuses to touch a sent document's lines because "a sent
 * document is a record of what the customer received" - and this used to
 * rewrite the bill-to on sent and paid invoices anyway, with no status test at
 * all. Correcting a deal's customer, or merging two contacts, silently
 * re-addressed invoices that were already in somebody's hands, while the PDF
 * on disk kept the old name. The two rules are now the same rule.
 *
 * A draft whose bill-to does change also loses its `pdf_path`: the file that
 * was rendered is addressed to the wrong customer, so the next Download has to
 * make a new one rather than open the stale one.
 */
export async function syncCustomerFromDeal(dealId: string): Promise<CustomerSyncResult> {
  return withTransaction(async () => {
    const deal = await deals.getOrThrow(dealId);
    // `list` already excludes soft-deleted rows by default (no
    // `includeDeleted`), which is what leaves a trashed document alone.
    const { rows } = await list({ dealId }, { limit: 5000 });
    const at = nowIso();
    let changed = 0;
    const keptNumbers: string[] = [];
    for (const doc of rows) {
      if (doc.contactId === deal.contactId && doc.companyId === deal.companyId) {
        continue;
      }
      if (doc.status !== "draft") {
        keptNumbers.push(doc.number);
        continue;
      }
      const values = {
        contactId: deal.contactId,
        companyId: deal.companyId,
        pdfPath: null,
        updatedAt: at,
      };
      await raw.execute(...statementParts(updateStatement("documents", doc.id, values)));
      await logWrite("document", doc.id, "update", doc, values);
      changed += 1;
    }
    return { changed, keptNumbers };
  }, "Syncing the customer from the deal");
}

/** Record where the PDF was written. Allowed in any status. */
export async function setPdfPath(id: string, pdfPath: string): Promise<void> {
  await withWrite(async () => {
    await raw.execute(`UPDATE documents SET pdf_path = ?, updated_at = ? WHERE id = ?`, [
      pdfPath,
      nowIso(),
      id,
    ]);
  }, "Saving the PDF path");
}

/* -------------------------------------------------------------------------- */
/* status                                                                     */
/* -------------------------------------------------------------------------- */

/** What a listener is told when a document changes status. */
export type DocumentStatusChange = {
  document: Document;
  from: DocumentStatus;
  to: DocumentStatus;
};

export type DocumentStatusListener = (event: DocumentStatusChange) => Promise<void>;

const statusListeners = new Set<DocumentStatusListener>();

/**
 * Be told when a document changes status (LR-PX contract 2).
 *
 * Listeners run inside the same write as the status change, in registration
 * order, after the row and its timeline line are written and before the write
 * lock is released - so a rule that creates a task ("this quote was sent, chase
 * it on Friday") either lands with the status or not at all, and a listener
 * that throws fails the whole write rather than leaving a half-applied rule.
 *
 * Registration is process-local and idempotent per listener function; the
 * returned function removes it. Nothing here touches payments: this is the seam
 * for automations, and the payment recompute is a direct call, not a listener.
 */
export function onDocumentStatusChanged(listener: DocumentStatusListener): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

async function notifyStatusChanged(event: DocumentStatusChange): Promise<void> {
  if (statusListeners.size === 0) return;
  for (const listener of [...statusListeners]) {
    await listener(event);
  }
}

/** Every move the product allows, as data, so the rule is one table. */
const TRANSITIONS: Record<string, Record<string, string[]>> = {
  quote: {
    draft: ["sent", "void"],
    sent: ["accepted", "declined", "void"],
    accepted: ["void"],
    declined: ["void"],
    void: [],
  },
  invoice: {
    draft: ["sent", "void"],
    // A sent invoice can take a payment, which lands it in `partial` or, when
    // the payment covers the total, straight in `paid`. Both moves are written
    // by `recomputeInvoiceStatus` rather than typed by anybody, and both are
    // reversible, because deleting the payment has to be able to walk them
    // back.
    sent: ["partial", "paid", "void"],
    partial: ["sent", "paid", "void"],
    // Paid is not the end of the road. Marking the wrong invoice paid, or
    // paying it on the wrong date, is the commonest mistake there is on this
    // screen, and before this it was unrecoverable: Collected, the deal strip,
    // the customer's lifetime figures and every period report stayed wrong for
    // ever, because a document cannot be edited, deleted or re-marked. Going
    // back to `sent` clears the payment; voiding it writes the whole billing
    // off. Both are one confirmation and both leave a timeline line, so the
    // history still says what happened.
    paid: ["partial", "sent", "void"],
    void: [],
  },
};

export function canTransition(
  kind: string,
  from: string,
  to: string,
): boolean {
  return (TRANSITIONS[kind]?.[from] ?? []).includes(to);
}

function assertTransition(document: Document, to: string): void {
  if (canTransition(document.kind, document.status, to)) return;
  throw new ValidationError(
    `A ${document.status} ${document.kind} cannot be marked ${to}.`,
    [{ path: "status", message: `${document.number} is ${document.status}.` }],
  );
}

/**
 * Every caller of `setStatus` passes a `to` that is also one of
 * `DocumentActivityEvent`'s status-move names ("sent", "paid", "void",
 * "declined"), so the status value doubles as the event name for the one
 * timeline line each of these writes alongside the document row, in the same
 * batch. "created" and "accepted" are written by `insertDocument` and
 * `accept` respectively, not here.
 */
async function setStatus(
  id: string,
  to: string,
  extra: Record<string, unknown>,
  label: string,
  event?: DocumentActivityEvent,
): Promise<Document> {
  return withWrite(async () => {
    const current = await getOrThrow(id);
    assertTransition(current.document, to);
    const values = { status: to, updatedAt: nowIso(), ...extra };

    const [currency, locale] = await Promise.all([
      settings.get("currency"),
      settings.get("locale"),
    ]);
    const rawMethod = (extra as { paidMethod?: unknown }).paidMethod;
    const method = typeof rawMethod === "string" || rawMethod === null ? rawMethod : null;
    const activity = activities.systemStatement({
      body: documentActivityBody(event ?? (to as DocumentActivityEvent), {
        kind: current.document.kind,
        number: current.document.number,
        totalCents: current.document.totalCents,
        currency,
        locale,
        method,
      }),
      dealId: current.document.dealId,
      contactId: current.document.contactId,
      companyId: current.document.companyId,
    });

    await raw.batch([updateStatement("documents", id, values), activity]);
    await logWrite("document", id, "update", current.document, values);
    const next = await get(id);
    if (!next) throw new NotFoundError("document", id);
    await notifyStatusChanged({
      document: next.document,
      from: current.document.status as DocumentStatus,
      to: to as DocumentStatus,
    });
    return next.document;
  }, label);
}

/**
 * Mark it sent. This stamps the instant and, on an invoice with no due date
 * yet, sets one - "sent" is the moment the clock on the money starts.
 */
export async function send(
  id: string,
  options: { dueDays?: number; at?: string } = {},
): Promise<Document> {
  const current = await getOrThrow(id);
  const at = options.at ?? nowIso();
  const issuedOn = current.document.issuedOn ?? todayLocal();
  const extra: Record<string, unknown> = { sentAt: at, issuedOn };
  if (current.document.kind === "invoice" && !current.document.dueOn) {
    extra.dueOn = addDaysToDateString(issuedOn, options.dueDays ?? 14);
  }
  return setStatus(id, "sent", extra, "Marking it sent");
}

/* -------------------------------------------------------------------------- */
/* payments: the status is derived, never typed                               */
/* -------------------------------------------------------------------------- */

/**
 * What has been paid against one invoice, in cents.
 *
 * Lives here rather than in `payments.ts` so that the status derivation - the
 * rule that decides whether an invoice reads sent, partially paid or paid -
 * has no import back into the payments repository. `payments.ts` depends on
 * this file; this file depends on nothing of its own.
 */
export async function paidCentsFor(documentId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT coalesce(sum(p.amount_cents), 0) AS paid_cents
     FROM payments p WHERE p.document_id = ? AND p.deleted_at IS NULL`,
    [documentId],
  );
  const value = rows[0]?.[0];
  return value === null || value === undefined ? 0 : Number(value);
}

/** The same sum for a list of invoices, one query. Empty ids answer empty. */
export async function paidCentsForMany(
  documentIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (documentIds.length === 0) return out;
  const placeholders = documentIds.map(() => "?").join(", ");
  const rows = await raw.query(
    `SELECT p.document_id AS p_document_id, coalesce(sum(p.amount_cents), 0) AS paid_cents
     FROM payments p
     WHERE p.deleted_at IS NULL AND p.document_id IN (${placeholders})
     GROUP BY p.document_id`,
    [...documentIds],
  );
  for (const row of rows) out.set(String(row[0]), Number(row[1] ?? 0));
  return out;
}

/**
 * The rule, in one pure function so it can be unit tested and so no screen
 * ever invents its own version of it (LR-PX contract 5):
 *
 *   payments >= total   paid
 *   0 < payments < total partially paid
 *   payments = 0        sent
 *
 * `>=` rather than `=` is deliberate. An overpayment is allowed explicitly
 * (`payments.create` with `allowOverpayment`), and when it happens the invoice
 * is certainly not still owed.
 */
export function deriveInvoiceStatus(
  totalCents: number,
  paidCents: number,
): "sent" | "partial" | "paid" {
  if (paidCents >= totalCents) return "paid";
  if (paidCents > 0) return "partial";
  return "sent";
}

/**
 * Whether this document can take a payment at all, with the sentence to show
 * the owner when it cannot.
 *
 * A draft has not been billed to anybody yet, so money against it would be
 * money against nothing - the error says to send it first, because that is the
 * one action that fixes it. A void invoice is a billing that was taken back. A
 * quote is not a bill.
 */
export function assertTakesPayments(document: Document): void {
  if (document.kind !== "invoice") {
    throw new ValidationError("Only an invoice can take a payment.", [
      { path: "documentId", message: `${document.number} is a quote.` },
    ]);
  }
  if (document.status === "draft") {
    throw new ValidationError(
      `${document.number} is still a draft. Send it before recording a payment.`,
      [{ path: "documentId", message: "A draft has not been billed to anybody yet." }],
    );
  }
  if (document.status === "void") {
    throw new ValidationError(
      `${document.number} is void, so there is nothing to pay.`,
      [{ path: "documentId", message: "A voided invoice is a billing that was taken back." }],
    );
  }
}

/**
 * Write the status the payments justify, and nothing else.
 *
 * Called by `payments.ts` inside the same write as every payment create,
 * update and delete, which is what makes "delete the last payment and the
 * invoice is owed again" true rather than aspirational.
 *
 * It writes no timeline line: the payment write already wrote the one line
 * that describes what the owner did ("Paid $500.00 by check - $700.00 still
 * owed"), and a second line saying the status moved would be the same event
 * twice. It does keep `paid_on` and `paid_method` on the document in step,
 * because they are what the invoice PDF and the older reports read; they are
 * now a cache of the payments, cleared the moment the invoice is not settled.
 *
 * A document that is not an invoice, or is a draft or void, is left alone.
 */
export async function recomputeInvoiceStatus(
  documentId: string,
  options: { batchId?: string } = {},
): Promise<Document> {
  const current = await getOrThrow(documentId);
  const document = current.document;
  if (document.kind !== "invoice") return document;
  if (document.status === "draft" || document.status === "void") return document;

  const paidCents = await paidCentsFor(documentId);
  const to = deriveInvoiceStatus(document.totalCents, paidCents);

  const settled = to === "paid";
  const latest = settled ? await latestPaymentFacts(documentId) : null;
  const values: Record<string, unknown> = {
    status: to,
    paidOn: latest?.paidOn ?? null,
    paidMethod: latest?.method ?? null,
    updatedAt: nowIso(),
  };
  if (
    document.status === to &&
    document.paidOn === values.paidOn &&
    document.paidMethod === values.paidMethod
  ) {
    return document;
  }

  await raw.execute(...statementTuple(updateStatement("documents", documentId, values)));
  await logWrite("document", documentId, "update", document, values, options.batchId);
  const next = await get(documentId);
  if (!next) throw new NotFoundError("document", documentId);
  if (document.status !== to) {
    await notifyStatusChanged({
      document: next.document,
      from: document.status as DocumentStatus,
      to: to as DocumentStatus,
    });
  }
  return next.document;
}

function statementTuple(statement: Statement): [string, Bindable[]] {
  return [statement.sql, statement.params as Bindable[]];
}

/** The day and the method of the most recent payment on an invoice. */
async function latestPaymentFacts(
  documentId: string,
): Promise<{ paidOn: string; method: string } | null> {
  const rows = await raw.query(
    `SELECT p.paid_on AS p_paid_on, p.method AS p_method
     FROM payments p
     WHERE p.document_id = ? AND p.deleted_at IS NULL
     ORDER BY p.paid_on DESC, p.created_at DESC
     LIMIT 1`,
    [documentId],
  );
  const row = rows[0];
  if (!row) return null;
  return { paidOn: String(row[0]), method: String(row[1]) };
}

/**
 * Void: the document stands, its number is spent, and nothing is owed.
 *
 * An invoice with money against it cannot be voided. Voiding it would leave
 * payments pointing at a billing the product says was taken back, and the
 * owner's Collected figure would quietly disagree with his bank. The error
 * names the way out: remove the payments first, then void it.
 */
export async function markVoid(id: string): Promise<Document> {
  const current = await getOrThrow(id);
  if (current.document.kind === "invoice") {
    const paid = await paidCentsFor(id);
    if (paid > 0) {
      throw new ValidationError(
        `${current.document.number} has payments against it, so it cannot be voided.`,
        [
          {
            path: "status",
            message: "Remove the payments on it first, then void it.",
          },
        ],
      );
    }
  }
  return setStatus(id, "void", {}, "Voiding it");
}

export async function decline(id: string): Promise<Document> {
  return setStatus(id, "declined", {}, "Marking it declined");
}

/**
 * Accept a quote, which is the one status change that creates something: the
 * invoice the customer now owes, carrying the quote's own lines. Both writes
 * are one transaction, so a failure leaves neither.
 *
 * Only the one-time lines cross over. A recurring line on an accepted quote is
 * what `invoiceSchedules` bills, month by month; billing it here as well would
 * charge the first month twice. A quote that is nothing but recurring lines
 * therefore accepts without an invoice, and answers `invoice: null`.
 */
export async function accept(
  id: string,
  options: { prefix: string; dueDays?: number; paymentInstructions?: string | null },
): Promise<{ quote: Document; invoice: Document | null }> {
  return withTransaction(async () => {
    const current = await getOrThrow(id);
    if (current.document.kind !== "quote") {
      throw new ValidationError("Only a quote can be accepted.", [
        { path: "kind", message: `${current.document.number} is an invoice.` },
      ]);
    }
    assertTransition(current.document, "accepted");

    const oneTime = current.items.filter((item) => item.kind !== "recurring");
    let invoiceId: string | null = null;
    let invoiceNumber: string | null = null;

    if (oneTime.length > 0) {
      const issuedOn = todayLocal();
      const createdInvoice = await insertDocument(
        parseOrThrow(convertedDocumentSchema, {
          kind: "invoice",
          dealId: current.document.dealId,
          contactId: current.document.contactId,
          companyId: current.document.companyId,
          prefix: options.prefix,
          taxRateBp: current.document.taxRateBp,
          issuedOn,
          dueOn: addDaysToDateString(issuedOn, options.dueDays ?? 14),
          notes: current.document.notes,
          paymentInstructions:
            options.paymentInstructions ?? current.document.paymentInstructions,
          items: oneTime.map((item) => ({
            name: item.name,
            description: item.description,
            qty: item.qty,
            unitCents: item.unitCents,
            taxable: item.taxable,
            kind: "one_time" as const,
            interval: null,
          })),
        }),
        {},
        // This is the one conversion path that predates the deal rule (rule
        // 4): the quote's own dealId may be null, so its customer cannot be
        // re-derived from a deal - the invoice carries the quote's own
        // contact and company across instead, exactly as it did before this
        // round. Its "created" line is skipped because the "accepted" line
        // below names it in the same sentence.
        { inheritCustomer: false, skipCreatedActivity: true },
      );
      invoiceId = createdInvoice.id;
      invoiceNumber = createdInvoice.number;
    }

    const values = {
      status: "accepted",
      convertedToId: invoiceId,
      updatedAt: nowIso(),
    };
    const [currency, locale] = await Promise.all([
      settings.get("currency"),
      settings.get("locale"),
    ]);
    const activity = activities.systemStatement({
      body: documentActivityBody("accepted", {
        kind: current.document.kind,
        number: current.document.number,
        totalCents: current.document.totalCents,
        currency,
        locale,
        becameNumber: invoiceNumber,
      }),
      dealId: current.document.dealId,
      contactId: current.document.contactId,
      companyId: current.document.companyId,
    });
    await raw.batch([updateStatement("documents", id, values), activity]);
    await logWrite("document", id, "update", current.document, values);

    const quote = await get(id);
    const invoice = invoiceId ? await get(invoiceId) : null;
    if (!quote) throw new NotFoundError("document", id);
    // `accept` writes its own status rather than going through `setStatus`
    // (it creates the invoice in the same transaction), so it announces the
    // move itself - otherwise a rule watching for "accepted" would never fire.
    await notifyStatusChanged({
      document: quote.document,
      from: current.document.status as DocumentStatus,
      to: "accepted",
    });
    return { quote: quote.document, invoice: invoice?.document ?? null };
  }, "Accepting the quote");
}

/* -------------------------------------------------------------------------- */
/* delete                                                                     */
/* -------------------------------------------------------------------------- */

export async function softDelete(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => softDeleteRow("documents", "document", id, options.batchId),
    "Deleting a document",
  );
}

export async function restore(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => restoreRow("documents", "document", id, options.batchId),
    "Restoring a document",
  );
}

export async function purge(
  id: string,
  options: { batchId?: string } = {},
): Promise<void> {
  await withWrite(
    () => purgeRow("documents", "document", id, options.batchId),
    "Purging a document",
  );
}
