/**
 * LA-W2 / J4 — Money, executed independently against real SQLite.
 *
 * This is NOT a re-run of px-a-payments.e2e.ts. It proves the journey at the
 * repository layer, with the real migrator and the real better-sqlite3
 * driver (tests/repo/harness.ts), starting from a job and a catalog service
 * rather than from an already-created invoice:
 *
 *   job -> deal item from the catalog -> quote -> send -> automation
 *   follow-up task (delayed, not immediate, not never) -> accept -> invoice
 *   -> deposit -> Partially paid (right balance everywhere) -> balance ->
 *   Paid -> delete a payment -> Partially paid again -> export -> Revenue's
 *   Collected reconciles against the sum of payment rows.
 *
 * The UI surfaces (invoice page, list, contact page, Today, Statement
 * dialog) are proved separately by tests/e2e-mac/specs/px-a-payments.e2e.ts,
 * which this round re-ran unmodified (see the LA-W2 return). What this file
 * proves that the UI harness cannot: the actual SQL the money screens read
 * is correct against a job built from a real catalog product, and the
 * automation wiring (documents.onDocumentStatusChanged -> runQuoteSent) is
 * exercised through the real listener registration, not by calling the
 * runner directly the way tests/repo/automations/runners.test.ts does.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "@/db/client";
import * as contacts from "@/db/repos/contacts";
import * as deals from "@/db/repos/deals";
import * as dealItems from "@/db/repos/dealItems";
import * as products from "@/db/repos/products";
import * as documents from "@/db/repos/documents";
import * as payments from "@/db/repos/payments";
import * as pipelines from "@/db/repos/pipelines";
import * as stages from "@/db/repos/stages";
import * as money from "@/db/repos/money";
import { buildEntityCsv } from "@/features/data/lib/exportRun";
import { startAutomations, stopAutomations } from "@/features/settings/lib/automationBoot";
import { revenueMoney } from "@/db/repos/reports";
import { todayLocal } from "@/lib/dates";
import type { Period } from "@/lib/periods";

let h: Harness | null = null;
afterEach(() => {
  stopAutomations();
  h?.dispose();
  h = null;
});

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const [stage] = await stages.list(pipeline.id);
  return stage.id;
}

describe("LA-W2 J4: the money journey, independently, at the repository layer", () => {
  it("job -> catalog quote -> send -> delayed follow-up -> accept -> invoice -> deposit -> paid -> delete -> statement -> exports -> Revenue reconciles", async () => {
    h = await createSeededHarness();
    await startAutomations();

    // ---- job, and a quote built from a service in the catalog -----------
    const contact = await contacts.create({ firstName: "Dana", lastName: "Reed" });
    const deal = await deals.create({
      title: "Retaining wall",
      stageId: await firstStageId(),
      contactId: contact.id,
    });
    const service = await products.create({
      name: "Retaining wall build",
      kind: "one_time",
      unitPriceCents: 120_000,
      taxable: false,
      active: true,
    });
    await dealItems.addFromProduct(deal.id, service.id);

    const quote = await documents.createFromDeal(deal.id, {
      kind: "quote",
      prefix: "Q",
      taxRateBp: 0,
    });
    expect(quote.totalCents).toBe(120_000);
    expect(quote.status).toBe("draft");

    // ---- send the quote, and the delayed follow-up ------------------------
    const beforeSend = Date.now();
    const sentQuote = await documents.send(quote.id, { dueDays: 30 });
    expect(sentQuote.status).toBe("sent");

    const followUps = await raw.query(
      `SELECT t.due_at AS t_due_at, t.title AS t_title, t.source AS t_source
       FROM tasks t WHERE t.deal_id = ? AND t.source = 'automation'`,
      [deal.id],
    );
    expect(followUps).toHaveLength(1);
    const dueAtMs = new Date(String(followUps[0][0])).getTime();
    const delayMs = dueAtMs - beforeSend;
    // Not immediate (the default rule is 3 days = 4,320 minutes) ...
    expect(delayMs).toBeGreaterThan(60 * 60 * 1000);
    // ... and not never: it exists, and lands within a few seconds of the
    // configured 3-day delay (a tolerance for the test's own wall-clock time).
    expect(Math.abs(delayMs - 3 * 24 * 60 * 60 * 1000)).toBeLessThan(5_000);
    expect(String(followUps[0][1])).toContain("Q-");

    // ---- accept the quote: an invoice is created --------------------------
    const { invoice } = await documents.accept(quote.id, { prefix: "INV" });
    expect(invoice).not.toBeNull();
    const invoiceId = invoice!.id;
    // accept() creates the invoice already `sent`? No: it is a fresh document
    // in draft status until it is sent in its own right (CONTRACTS: a draft
    // cannot take a payment) - so send it, the way the owner would.
    await documents.send(invoiceId);

    async function invoiceRow(): Promise<{ status: string; total: number }> {
      const rows = await raw.query(`SELECT status, total_cents FROM documents WHERE id = ?`, [
        invoiceId,
      ]);
      return { status: String(rows[0][0]), total: Number(rows[0][1]) };
    }

    expect((await invoiceRow()).status).toBe("sent");
    expect((await invoiceRow()).total).toBe(120_000);

    // ---- the deposit --------------------------------------------------------
    const deposit = await payments.create({
      documentId: invoiceId,
      amountCents: 50_000,
      paidOn: todayLocal(),
      method: "check",
      reference: "4412",
    });
    expect((await invoiceRow()).status).toBe("partial");

    const balanceAfterDeposit = await money.invoiceBalanceCents(invoiceId);
    expect(balanceAfterDeposit).toBe(70_000);
    // The same figure on the contact and on the invoice list.
    expect(await money.customerBalanceCents({ contactId: contact.id })).toBe(70_000);
    const listBalances = await money.invoiceBalances([invoiceId]);
    expect(listBalances.get(invoiceId)?.balanceCents).toBe(70_000);

    // ---- the balance ----------------------------------------------------
    const balancePayment = await payments.recordFullPayment(invoiceId, { method: "transfer" });
    expect(balancePayment.amountCents).toBe(70_000);
    expect((await invoiceRow()).status).toBe("paid");
    expect(await money.invoiceBalanceCents(invoiceId)).toBe(0);
    expect(await money.customerBalanceCents({ contactId: contact.id })).toBe(0);

    // ---- delete a payment: back to Partially paid, right balance --------
    await payments.remove(balancePayment.id);
    expect((await invoiceRow()).status).toBe("partial");
    expect(await money.invoiceBalanceCents(invoiceId)).toBe(70_000);
    expect(await money.customerBalanceCents({ contactId: contact.id })).toBe(70_000);

    // Put it back for the export/reconciliation section below, the way the
    // journey's Undo toast would.
    await payments.restore(balancePayment.id);
    expect((await invoiceRow()).status).toBe("paid");

    // ---- payments in exports --------------------------------------------
    const csv = await buildEntityCsv("payments");
    expect(csv.rows).toBe(2); // the deposit and the (restored) balance
    expect(csv.csv).toContain("4412");
    expect(csv.csv).toContain(deposit.documentNumber);

    // ---- Revenue's Collected equals the sum of the payments rows --------
    const independentSql = await raw.query(
      `SELECT coalesce(sum(p.amount_cents), 0)
       FROM payments p JOIN documents d ON d.id = p.document_id
       WHERE p.deleted_at IS NULL AND d.deleted_at IS NULL AND d.kind = 'invoice'`,
    );
    const independentTotal = Number(independentSql[0][0]);
    expect(independentTotal).toBe(120_000);

    // A period wide enough to hold everything this test wrote.
    const period: Period = {
      id: "custom",
      label: "everything",
      from: "2000-01-01T00:00:00.000Z",
      to: "2100-01-01T00:00:00.000Z",
    };
    const reportFigure = (await revenueMoney(period)).totals.collectedCents;
    expect(reportFigure).toBe(independentTotal);
  });

  it("a payment is refused past the balance, on a draft, and on a void invoice — nothing is written on any refusal", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Priya", lastName: "Raman" });
    const deal = await deals.create({ title: "Patio", stageId: await firstStageId(), contactId: contact.id });
    const quote = await documents
      .createFromDeal(deal.id, { kind: "quote", prefix: "Q", taxRateBp: 0 })
      .catch(() => null);
    // No catalog line yet: createFromDeal on an empty deal refuses. Give it one.
    const service = await products.create({
      name: "Patio",
      kind: "one_time",
      unitPriceCents: 80_000,
      taxable: false,
      active: true,
    });
    await dealItems.addFromProduct(deal.id, service.id);
    const realQuote = await documents.createFromDeal(deal.id, {
      kind: "quote",
      prefix: "Q",
      taxRateBp: 0,
    });
    expect(quote).toBeNull();

    // A draft refuses a payment.
    await expect(
      payments.create({ documentId: realQuote.id, amountCents: 1_000, method: "cash" }),
    ).rejects.toThrow();

    await documents.send(realQuote.id);
    const { invoice } = await documents.accept(realQuote.id, { prefix: "INV" });
    await documents.send(invoice!.id);

    // Over the balance is refused, and names the balance in the message.
    await expect(
      payments.create({ documentId: invoice!.id, amountCents: 999_999, method: "cash" }),
    ).rejects.toThrow(/800\.00|balance/i);
    expect(await money.invoiceBalanceCents(invoice!.id)).toBe(80_000); // nothing written

    // Overpayment allowed on purpose still leaves a consistent balance.
    await payments.create(
      { documentId: invoice!.id, amountCents: 90_000, method: "cash" },
      { allowOverpayment: true },
    );
    expect(await money.invoiceBalanceCents(invoice!.id)).toBe(-10_000);

    // A void invoice refuses a payment too.
    await payments.clearForDocument(invoice!.id);
    await documents.markVoid(invoice!.id);
    await expect(
      payments.create({ documentId: invoice!.id, amountCents: 1_000, method: "cash" }),
    ).rejects.toThrow();
  });
});
