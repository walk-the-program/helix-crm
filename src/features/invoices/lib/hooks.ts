/**
 * Everything the invoices screens read and write.
 *
 * One query key namespace (`iqk`) and one invalidation helper, because almost
 * every action here moves a document between two lists: sending an invoice
 * takes it out of the drafts and into the unpaid section on Today, and marking
 * it paid takes it out of both. A mutation that refreshed only the screen it
 * was fired from would leave Today lying.
 *
 * `qk.today()` and `qk.deals()` are invalidated alongside, because the Today
 * section and the deal panel are owned by other features and read through
 * their own keys.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/app/queryClient";
import * as documents from "@/db/repos/documents";
import * as payments from "@/db/repos/payments";
import type { PaymentMethod } from "@/db/repos/payments";
import * as deals from "@/db/repos/deals";
import * as dealItems from "@/db/repos/dealItems";
import * as pipelines from "@/db/repos/pipelines";
import * as stages from "@/db/repos/stages";
import * as schedules from "@/db/repos/invoiceSchedules";
import { todayLocal } from "@/lib/dates";
import { readInvoiceSettings, prefixFor, type InvoiceSettings } from "@/features/invoices/lib/settings";
import { daysOverdue, type OutstandingSummary } from "@/features/invoices/lib/format";

/** The invoices feature's own query keys. */
export const iqk = {
  all: () => ["invoices"] as const,
  list: (filter?: unknown) => ["invoices", "list", filter ?? null] as const,
  one: (id: string) => ["invoices", "document", id] as const,
  forDeal: (dealId: string) => ["invoices", "deal", dealId] as const,
  schedule: (dealId: string) => ["invoices", "schedule", dealId] as const,
  unpaid: () => ["invoices", "unpaid"] as const,
  summary: () => ["invoices", "summary"] as const,
  settings: () => ["invoices", "settings"] as const,
  customerDeals: (contactId: string | null, companyId: string | null) =>
    ["invoices", "customer-deals", contactId, companyId] as const,
  aging: () => ["invoices", "aging"] as const,
} as const;

export function useInvalidateInvoices() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: iqk.all() });
    void client.invalidateQueries({ queryKey: qk.today() });
    void client.invalidateQueries({ queryKey: qk.deals() });
  };
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export function useInvoiceSettings() {
  return useQuery({
    queryKey: iqk.settings(),
    queryFn: readInvoiceSettings,
  });
}

export function useDocuments(filter: documents.DocumentFilter = {}) {
  return useQuery({
    queryKey: iqk.list(filter),
    queryFn: () => documents.list(filter, { limit: 500 }),
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: iqk.one(id),
    queryFn: () => documents.get(id),
    enabled: id.length > 0,
  });
}

export function useDealDocuments(dealId: string) {
  return useQuery({
    queryKey: iqk.forDeal(dealId),
    queryFn: () => documents.listForDeal(dealId),
    enabled: dealId.length > 0,
  });
}

/** A deal's own priced lines, for prefilling a document from it. */
export function useDealLines(dealId: string | null) {
  return useQuery({
    queryKey: ["invoices", "deal-lines", dealId] as const,
    queryFn: () => dealItems.list(dealId ?? ""),
    enabled: Boolean(dealId),
  });
}

export function useDealSchedule(dealId: string) {
  return useQuery({
    queryKey: iqk.schedule(dealId),
    queryFn: () => schedules.forDeal(dealId),
    enabled: dealId.length > 0,
  });
}

export type UnpaidRow = {
  document: documents.Document;
  overdueDays: number;
  overdue: boolean;
};

/**
 * What Today shows: sent invoices, overdue first and oldest first inside that,
 * then the ones due within the next seven days.
 *
 * A draft is deliberately not here. Today is what needs the owner now, and an
 * invoice he has not sent is not money anyone owes him yet - it is a job he
 * has not finished. It shows on /invoices under Unpaid, with the word "Draft"
 * on it, which is where that belongs.
 */
export function useUnpaidInvoices(dueWithinDays = 7) {
  return useQuery({
    queryKey: [...iqk.unpaid(), dueWithinDays] as const,
    queryFn: async (): Promise<UnpaidRow[]> => {
      const reference = todayLocal();
      const { rows } = await documents.list(
        { kind: "invoice", status: "sent" },
        { limit: 200 },
      );
      return rows
        .map((document) => {
          const overdueDays = daysOverdue(document.dueOn, reference);
          return { document, overdueDays, overdue: overdueDays > 0 };
        })
        .filter((row) => row.overdue || row.overdueDays >= -dueWithinDays)
        .sort((a, b) => {
          if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
          return b.overdueDays - a.overdueDays;
        });
    },
  });
}

/** The one sentence at the top of the list and of Today's section. */
export function useOutstandingSummary() {
  return useQuery({
    queryKey: iqk.summary(),
    queryFn: async (): Promise<OutstandingSummary> => {
      const reference = todayLocal();
      const { rows } = await documents.list(
        { kind: "invoice", unpaidOnly: true },
        { limit: 1000 },
      );
      let sentCount = 0;
      let outstandingCents = 0;
      let overdueCount = 0;
      let worstOverdueDays = 0;
      let draftCount = 0;

      for (const row of rows) {
        if (row.status === "draft") {
          draftCount += 1;
          continue;
        }
        sentCount += 1;
        outstandingCents += row.totalCents;
        const days = daysOverdue(row.dueOn, reference);
        if (days > 0) {
          overdueCount += 1;
          worstOverdueDays = Math.max(worstOverdueDays, days);
        }
      }

      return { sentCount, outstandingCents, overdueCount, worstOverdueDays, draftCount };
    },
  });
}

/**
 * The deals a document could belong to: everything of this customer, open work
 * first.
 *
 * Both links are asked separately and merged rather than filtered together.
 * `deals.list({ contactId, companyId })` ANDs the two, which would hide the
 * deal booked against the company before anyone put a name to it - and that is
 * exactly the deal a new invoice for that company usually belongs to.
 */
export function useCustomerDeals(contactId: string | null, companyId: string | null) {
  return useQuery({
    queryKey: iqk.customerDeals(contactId, companyId),
    enabled: Boolean(contactId || companyId),
    queryFn: async (): Promise<deals.Deal[]> => {
      const results = await Promise.all([
        contactId ? deals.list({ contactId }, { limit: 50 }) : null,
        companyId ? deals.list({ companyId }, { limit: 50 }) : null,
      ]);
      const seen = new Map<string, deals.Deal>();
      for (const result of results) {
        for (const deal of result?.rows ?? []) seen.set(deal.id, deal);
      }
      return [...seen.values()].sort((a, b) => {
        const aOpen = !a.stageIsWon && !a.stageIsLost;
        const bOpen = !b.stageIsWon && !b.stageIsLost;
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

async function settingsNow(): Promise<InvoiceSettings> {
  return readInvoiceSettings();
}

export function useCreateFromDeal() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: async (input: {
      dealId: string;
      kind: "quote" | "invoice";
      lines?: documents.LineSelection;
      creditPriorInvoices?: boolean;
    }) => {
      const settings = await settingsNow();
      return documents.createFromDeal(input.dealId, {
        kind: input.kind,
        lines: input.lines,
        prefix: prefixFor(input.kind, settings),
        taxRateBp: settings.taxRateBp,
        dueDays: settings.dueDays,
        paymentInstructions: settings.paymentInstructions || null,
        creditPriorInvoices: input.creditPriorInvoices,
      });
    },
    onSuccess: invalidate,
  });
}

/** What is left to bill on a deal, for the deposit dialog and the balance nudge. */
export function useRemainingOneTime(dealId: string) {
  return useQuery({
    queryKey: ["invoices", "remaining", dealId] as const,
    queryFn: () => documents.remainingOneTime(dealId),
    enabled: dealId.length > 0,
  });
}

/** A deposit invoice: part of the deal's one-time value, billed now (R7). */
export function useCreateDeposit() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: async (input: { dealId: string; amountCents: number }) => {
      const settings = await settingsNow();
      return documents.createDeposit(input.dealId, {
        amountCents: input.amountCents,
        prefix: prefixFor("invoice", settings),
        dueDays: settings.dueDays,
        paymentInstructions: settings.paymentInstructions || null,
      });
    },
    onSuccess: invalidate,
  });
}

export function useCreateDocument() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: async (input: Omit<documents.NewDocument, "prefix" | "taxRateBp"> & {
      taxRateBp?: number;
    }) => {
      const settings = await settingsNow();
      return documents.create({
        ...input,
        prefix: prefixFor(input.kind, settings),
        taxRateBp: input.taxRateBp ?? settings.taxRateBp,
        paymentInstructions:
          input.paymentInstructions ?? (settings.paymentInstructions || null),
      });
    },
    onSuccess: invalidate,
  });
}

/**
 * "New deal for this": the deal a from-scratch invoice belongs to, carrying
 * the same lines the invoice is about to carry.
 *
 * WHICH STAGE depends on what is being raised, and getting it wrong is not
 * cosmetic. Raising an INVOICE means the work is done and is being billed, so
 * the job is won; it used to land in the first stage ("New lead"), where it sat
 * in the open pipeline inflating Open value while simultaneously being invoiced
 * and collected, and Won stayed at zero for ever because nothing ever set
 * `closed_at`. A QUOTE is the opposite: the work has not been agreed yet, so
 * the first stage is exactly right. A workspace with no won stage at all falls
 * back to the first one rather than refusing to make the deal.
 *
 * The deal and its lines are written through the repositories one after the
 * other rather than folded into a single transaction. `dealItems.add` owns
 * two things a feature file has no business reimplementing - the next position
 * on the deal, and the recompute that keeps a deal's value and its lines from
 * disagreeing - and it takes the write lock itself, so it cannot be called
 * from inside a transaction that already holds it.
 */
export function useCreateDealForDocument() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      /** What is being raised against it, which decides the stage. */
      kind: "invoice" | "quote";
      contactId: string | null;
      companyId: string | null;
      lines: { name: string; description: string | null; qty: number; unitCents: number; taxable: boolean; kind: "one_time" | "recurring"; interval: "month" | "year" | null }[];
    }) => {
      const pipeline = await pipelines.getDefaultOrThrow();
      const all = await stages.list(pipeline.id);
      const first = all[0] ?? null;
      const won = all.find((stage) => stage.isWon) ?? null;
      const stage = input.kind === "invoice" ? (won ?? first) : first;
      if (!stage) throw new Error("This workspace has no stages to put a deal in.");

      const settings = await settingsNow();
      const deal = await deals.create({
        title: input.title,
        stageId: stage.id,
        currency: settings.currency,
        contactId: input.contactId,
        companyId: input.companyId,
      });

      // `deals.create` always writes `closed_at: null`, even into a won stage,
      // so a deal made this way needs the move to stamp it. Without it the
      // deal is won with no close date and every period report leaves it out.
      if (stage.isWon) await deals.moveToStage(deal.id, stage.id);

      for (const line of input.lines) {
        await dealItems.add({
          dealId: deal.id,
          name: line.name,
          description: line.description,
          kind: line.kind,
          interval: line.kind === "recurring" ? (line.interval ?? "month") : null,
          qty: line.qty,
          suggestedUnitCents: line.unitCents,
          actualUnitCents: line.unitCents,
          taxable: line.taxable,
        });
      }

      return deal;
    },
    onSuccess: invalidate,
  });
}

/**
 * Push the document editor's lines back onto the deal they came from.
 *
 * Round 3 revision 4 §23 is explicit: the deal's services panel is the ONLY
 * place a deal's money is defined, and invoices and quotes pull their lines
 * from the deal. The New document screen broke that rule quietly - lines typed
 * against an EXISTING deal went on the document alone, so the deal's value
 * stayed at whatever it was and the deal page could read Quoted $0 beside
 * Invoiced $5,000 for the same job (F-LB-13).
 *
 * It is a diff, not a rewrite. A line that came from the deal keeps its id, so
 * an edit is an UPDATE and the line keeps its `product_id` - the Services
 * page's deal counts and the catalog price history hang off that. A line the
 * owner typed is added; a line he deleted is removed. Each call goes through
 * the `dealItems` repository, which owns the recompute that keeps the deal's
 * value and its lines from disagreeing, so nothing here writes `value_cents`.
 *
 * `keep` is the lines the document is NOT carrying - an invoice takes the
 * one-time lines only, and the deal's monthly line must survive that.
 */
export function useSyncDealLines() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: async (input: {
      dealId: string;
      lines: {
        dealItemId?: string;
        name: string;
        description: string | null;
        qty: number;
        unitCents: number;
        taxable: boolean;
        kind: "one_time" | "recurring";
        interval: "month" | "year" | null;
      }[];
      /** Deal line ids the document never showed, which must not be removed. */
      keep: string[];
    }) => {
      const existing = await dealItems.list(input.dealId);
      const kept = new Set(input.keep);
      const seen = new Set<string>();

      for (const line of input.lines) {
        const current = line.dealItemId
          ? existing.find((item) => item.id === line.dealItemId)
          : undefined;
        if (current) {
          seen.add(current.id);
          const unchanged =
            current.name === line.name &&
            (current.description ?? null) === line.description &&
            current.qty === line.qty &&
            current.actualUnitCents === line.unitCents &&
            current.taxable === line.taxable;
          if (unchanged) continue;
          await dealItems.update(current.id, {
            name: line.name,
            description: line.description,
            qty: line.qty,
            actualUnitCents: line.unitCents,
            taxable: line.taxable,
          });
          continue;
        }
        await dealItems.add({
          dealId: input.dealId,
          name: line.name,
          description: line.description,
          kind: line.kind,
          interval: line.kind === "recurring" ? (line.interval ?? "month") : null,
          qty: line.qty,
          suggestedUnitCents: line.unitCents,
          actualUnitCents: line.unitCents,
          taxable: line.taxable,
        });
      }

      for (const item of existing) {
        if (seen.has(item.id) || kept.has(item.id)) continue;
        await dealItems.remove(item.id);
      }
    },
    onSuccess: invalidate,
  });
}

export function useReplaceItems() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: (input: { id: string; items: documents.NewDocumentItem[] }) =>
      documents.replaceItems(input.id, input.items),
    onSuccess: invalidate,
  });
}

export function useUpdateDocument() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: (input: { id: string; patch: documents.DocumentPatch }) =>
      documents.update(input.id, input.patch),
    onSuccess: invalidate,
  });
}

export function useSendDocument() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: async (id: string) => {
      const settings = await settingsNow();
      return documents.send(id, { dueDays: settings.dueDays });
    },
    onSuccess: invalidate,
  });
}

/**
 * "Mark paid": record a payment for whatever is left, dated today.
 *
 * The one-click action survives the payments table - it is still one click -
 * but it now writes a payment like any other rather than setting a flag, so
 * the Revenue report counts the money on the day it was taken and the invoice
 * can be walked back by removing that payment.
 */
export function useMarkPaid() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: (input: {
      id: string;
      paidOn?: string;
      method?: PaymentMethod;
      reference?: string | null;
      note?: string | null;
    }) =>
      payments.recordFullPayment(input.id, {
        paidOn: input.paidOn,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
      }),
    onSuccess: invalidate,
  });
}

export function useVoidDocument() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: (id: string) => documents.markVoid(id),
    onSuccess: invalidate,
  });
}

/**
 * Undo a payment recorded by mistake: every payment off the invoice, and it is
 * owed again. The status follows the payments, so this is one write rather
 * than a status edit that the payments would immediately contradict.
 */
export function useMarkUnpaid() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: (id: string) => payments.clearForDocument(id),
    onSuccess: invalidate,
  });
}

/**
 * Delete a DRAFT into the trash.
 *
 * Only a draft: a sent or paid document is a record of something a customer
 * received and is written off with Void, which keeps the number spent. A draft
 * was never anybody's but the owner's, and before this a draft raised by
 * accident - or raised for him by the billing schedule - could only be voided,
 * so it sat on the list for ever with the word Void on it (F-LB-23).
 */
export function useDeleteDocument() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: (id: string) => documents.softDelete(id),
    onSuccess: invalidate,
  });
}

export function useAcceptQuote() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: async (id: string) => {
      const settings = await settingsNow();
      const result = await documents.accept(id, {
        prefix: settings.invoicePrefix,
        dueDays: settings.dueDays,
        paymentInstructions: settings.paymentInstructions || null,
      });
      // Accepting a quote for a recurring service is what starts the billing
      // schedule. It runs after the accept transaction has committed, never
      // inside it: the write lock is not reentrant.
      if (result.quote.dealId) {
        await schedules.ensureForWonDeal(result.quote.dealId);
      }
      return result;
    },
    onSuccess: invalidate,
  });
}

export function useDeclineQuote() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: (id: string) => documents.decline(id),
    onSuccess: invalidate,
  });
}

export function useIssueScheduledInvoice() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const settings = await settingsNow();
      return schedules.issueOne(scheduleId, {
        prefix: settings.invoicePrefix,
        taxRateBp: settings.taxRateBp,
        dueDays: settings.dueDays,
        paymentInstructions: settings.paymentInstructions || null,
      });
    },
    onSuccess: invalidate,
  });
}

export function useStartSchedule() {
  const invalidate = useInvalidateInvoices();
  return useMutation({
    mutationFn: (dealId: string) => schedules.ensureForWonDeal(dealId),
    onSuccess: invalidate,
  });
}
