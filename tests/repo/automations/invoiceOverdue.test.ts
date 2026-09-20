/**
 * The invoice_overdue rule (disabled by default) and the daily sweep that
 * drives it. "Overdue" is status sent/partial (never draft, paid or void)
 * with a due date before the day the sweep is asked about.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "@/db/client";
import * as automations from "@/db/repos/automations";
import * as pipelines from "@/db/repos/pipelines";
import * as stages from "@/db/repos/stages";
import * as deals from "@/db/repos/deals";
import * as contacts from "@/db/repos/contacts";
import * as documents from "@/db/repos/documents";
import * as tasks from "@/db/repos/tasks";
import { addDaysToDateString, todayLocal } from "@/lib/dates";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  return all[0].id;
}

async function anOverdueInvoice(daysOverdue = 3) {
  const contact = await contacts.create({ firstName: "Dana", lastName: "Reyes" });
  const deal = await deals.create({
    title: "Fence repair",
    stageId: await firstStageId(),
    contactId: contact.id,
  });
  const invoice = await documents.create({
    kind: "invoice",
    dealId: deal.id,
    prefix: "INV",
    items: [{ name: "Labor", qty: 1, unitCents: 20_000, taxable: false }],
  });
  const sent = await documents.send(invoice.id, { dueDays: -daysOverdue });
  return { deal, contact, document: sent };
}

describe("automations: runInvoiceOverdue", () => {
  it("creates exactly one task with source automation, links and one timeline activity", async () => {
    h = await createSeededHarness();
    await automations.update("invoice_overdue", { enabled: true });
    const { deal, contact, document } = await anOverdueInvoice();
    const today = todayLocal();

    const result = await automations.runInvoiceOverdue({
      documentId: document.id,
      number: document.number,
      dealId: deal.id,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
      today,
    });
    expect(result.taskId).not.toBeNull();
    if (result.statements.length > 0) await raw.batch(result.statements);

    const task = await tasks.getOrThrow(result.taskId!);
    expect(task.source).toBe("automation");
    expect(task.title).toBe(`Invoice ${document.number} is overdue: check in with Dana Reyes`);
    expect(task.dealId).toBe(deal.id);

    const rows = await raw.query(
      `SELECT a.body AS a_body FROM activities a WHERE a.deal_id = ? AND a.kind = 'system'`,
      [deal.id],
    );
    expect(
      rows.map((r) => String(r[0])).some((b) => b.includes("because the invoice is overdue")),
    ).toBe(true);
  });

  it("does nothing the second time for the same invoice on the same day (idempotency)", async () => {
    h = await createSeededHarness();
    await automations.update("invoice_overdue", { enabled: true });
    const { deal, contact, document } = await anOverdueInvoice();
    const args = {
      documentId: document.id,
      number: document.number,
      dealId: deal.id,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
      today: todayLocal(),
    };
    const first = await automations.runInvoiceOverdue(args);
    if (first.statements.length > 0) await raw.batch(first.statements);
    const second = await automations.runInvoiceOverdue(args);
    expect(second.statements).toEqual([]);
  });

  it("creates nothing when the rule is disabled (the seeded default)", async () => {
    h = await createSeededHarness();
    const { deal, contact, document } = await anOverdueInvoice();
    const result = await automations.runInvoiceOverdue({
      documentId: document.id,
      number: document.number,
      dealId: deal.id,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
      today: todayLocal(),
    });
    expect(result.statements).toEqual([]);
  });
});

describe("automations: automationSweep", () => {
  it("does nothing at all when the rule is disabled", async () => {
    h = await createSeededHarness();
    await anOverdueInvoice();
    const created = await automations.automationSweep();
    expect(created).toBe(0);
  });

  it("creates one task per overdue invoice, none on a second sweep the same day, and one more the next day", async () => {
    h = await createSeededHarness();
    await automations.update("invoice_overdue", { enabled: true });
    await anOverdueInvoice(3);
    const today = todayLocal();

    const first = await automations.automationSweep({ today });
    expect(first).toBe(1);

    const second = await automations.automationSweep({ today });
    expect(second).toBe(0);

    const tomorrow = addDaysToDateString(today, 1);
    const third = await automations.automationSweep({ today: tomorrow });
    expect(third).toBe(1);
  });

  it("never touches a draft invoice, however overdue its due date", async () => {
    h = await createSeededHarness();
    await automations.update("invoice_overdue", { enabled: true });
    const contact = await contacts.create({ firstName: "Pat", lastName: "Kim" });
    const deal = await deals.create({
      title: "Untouched",
      stageId: await firstStageId(),
      contactId: contact.id,
    });
    await documents.create({
      kind: "invoice",
      dealId: deal.id,
      prefix: "INV",
      dueOn: addDaysToDateString(todayLocal(), -10),
      items: [{ name: "Labor", qty: 1, unitCents: 10_000, taxable: false }],
    });
    const created = await automations.automationSweep({ today: todayLocal() });
    expect(created).toBe(0);
  });
});
