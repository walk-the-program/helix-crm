/**
 * The three fixed rules that read directly from the automations table
 * (lead_arrived, quote_sent) plus the per-stage rule, which reads its
 * settings straight off the stage instead. Each covers: fires once, fires no
 * second time for the same subject, and does nothing when disabled/unset.
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

async function aContact(name = "Dana Reyes") {
  const [firstName, ...rest] = name.split(" ");
  return contacts.create({ firstName, lastName: rest.join(" ") });
}

async function aDealWithContact(title = "Kitchen rewire") {
  const contact = await aContact();
  const deal = await deals.create({
    title,
    stageId: await firstStageId(),
    contactId: contact.id,
  });
  return { deal, contact };
}

async function applyStatements(
  statements: automations.AutomationResult["statements"],
): Promise<void> {
  if (statements.length > 0) await raw.batch(statements);
}

async function systemActivityBodies(dealId: string): Promise<string[]> {
  const rows = await raw.query(
    `SELECT a.body AS a_body FROM activities a WHERE a.deal_id = ? AND a.kind = 'system'`,
    [dealId],
  );
  return rows.map((r) => String(r[0]));
}

describe("automations: runLeadArrived", () => {
  it("creates exactly one task with source automation, the right due instant, links and one timeline activity", async () => {
    h = await createSeededHarness();
    const { deal, contact } = await aDealWithContact();
    const now = "2026-09-20T12:00:00.000Z";

    const result = await automations.runLeadArrived({
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
      now,
    });
    expect(result.taskId).not.toBeNull();
    await applyStatements(result.statements);

    const task = await tasks.getOrThrow(result.taskId!);
    expect(task.source).toBe("automation");
    expect(task.title).toBe("Call Dana Reyes about their request");
    expect(task.dealId).toBe(deal.id);
    expect(task.contactId).toBe(contact.id);
    expect(task.dueAt).toBe(new Date(Date.parse(now) + 60 * 60_000).toISOString());

    const bodies = await systemActivityBodies(deal.id);
    expect(
      bodies.some(
        (b) => b.includes("Helix added a follow-up") && b.includes("because a new lead arrived"),
      ),
    ).toBe(true);
  });

  it("does nothing the second time for the same deal (idempotency)", async () => {
    h = await createSeededHarness();
    const { deal, contact } = await aDealWithContact();
    const first = await automations.runLeadArrived({
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
    });
    await applyStatements(first.statements);

    const second = await automations.runLeadArrived({
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
    });
    expect(second.statements).toEqual([]);
    expect(second.taskId).toBeNull();

    const { rows } = await tasks.list({ dealId: deal.id, source: "automation" });
    expect(rows).toHaveLength(1);
  });

  it("creates nothing at all when the rule is disabled", async () => {
    h = await createSeededHarness();
    await automations.update("lead_arrived", { enabled: false });
    const { deal, contact } = await aDealWithContact();
    const result = await automations.runLeadArrived({
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
    });
    expect(result.statements).toEqual([]);
    expect(result.taskId).toBeNull();
    const { rows } = await tasks.list({ dealId: deal.id });
    expect(rows).toHaveLength(0);
  });
});

describe("automations: runQuoteSent", () => {
  async function aSentQuote() {
    const { deal, contact } = await aDealWithContact("Deck rebuild");
    const quote = await documents.create({
      kind: "quote",
      dealId: deal.id,
      prefix: "QUO",
      items: [{ name: "Labor", qty: 1, unitCents: 50_000, taxable: false }],
    });
    const sent = await documents.send(quote.id);
    return { deal, contact, document: sent };
  }

  it("creates exactly one task with source automation, the right due instant, links and one timeline activity", async () => {
    h = await createSeededHarness();
    const { deal, contact, document } = await aSentQuote();
    const now = "2026-09-20T12:00:00.000Z";

    const result = await automations.runQuoteSent({
      documentId: document.id,
      number: document.number,
      dealId: deal.id,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
      dealTitle: deal.title,
      now,
    });
    expect(result.taskId).not.toBeNull();
    await applyStatements(result.statements);

    const task = await tasks.getOrThrow(result.taskId!);
    expect(task.source).toBe("automation");
    expect(task.title).toBe(`Follow up on quote ${document.number} with Dana Reyes`);
    expect(task.dueAt).toBe(new Date(Date.parse(now) + 4320 * 60_000).toISOString());

    const bodies = await systemActivityBodies(deal.id);
    expect(bodies.some((b) => b.includes("because the quote was sent"))).toBe(true);
  });

  it("does nothing the second time for the same document (idempotency)", async () => {
    h = await createSeededHarness();
    const { deal, contact, document } = await aSentQuote();
    const first = await automations.runQuoteSent({
      documentId: document.id,
      number: document.number,
      dealId: deal.id,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
    });
    await applyStatements(first.statements);
    const second = await automations.runQuoteSent({
      documentId: document.id,
      number: document.number,
      dealId: deal.id,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
    });
    expect(second.statements).toEqual([]);
  });

  it("creates nothing when the rule is disabled", async () => {
    h = await createSeededHarness();
    await automations.update("quote_sent", { enabled: false });
    const { deal, contact, document } = await aSentQuote();
    const result = await automations.runQuoteSent({
      documentId: document.id,
      number: document.number,
      dealId: deal.id,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
    });
    expect(result.statements).toEqual([]);
  });
});

describe("automations: runStageEntered", () => {
  it("fires when the stage has a follow-up rule, and creates the task and its activity", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.create({
      pipelineId: pipeline.id,
      name: "Scheduled",
      followUpDays: 2,
      followUpTitle: "Call after the walkthrough",
    });
    const { deal, contact } = await aDealWithContact("Roof repair");
    const enteredAt = "2026-09-20T09:00:00.000Z";

    const result = await automations.runStageEntered({
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
      stageId: stage.id,
      stageName: stage.name,
      followUpDays: stage.followUpDays,
      followUpTitle: stage.followUpTitle,
      enteredAt,
      now: enteredAt,
    });
    expect(result.taskId).not.toBeNull();
    await applyStatements(result.statements);

    const task = await tasks.getOrThrow(result.taskId!);
    expect(task.source).toBe("automation");
    expect(task.title).toBe("Call after the walkthrough");
    expect(task.dueAt).toBe(
      new Date(Date.parse(enteredAt) + 2 * 1440 * 60_000).toISOString(),
    );

    const bodies = await systemActivityBodies(deal.id);
    expect(bodies.some((b) => b.includes("because this job moved to Scheduled"))).toBe(true);
  });

  it("does not fire when the stage has no follow-up rule (NULL follow_up_days)", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.create({ pipelineId: pipeline.id, name: "No rule" });
    const { deal, contact } = await aDealWithContact();

    const result = await automations.runStageEntered({
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
      stageId: stage.id,
      stageName: stage.name,
      followUpDays: stage.followUpDays,
      followUpTitle: stage.followUpTitle,
      enteredAt: "2026-09-20T09:00:00.000Z",
    });
    expect(result.statements).toEqual([]);
    expect(result.taskId).toBeNull();
  });

  it("does not fire twice for the same deal entering the same stage on the same day", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const stage = await stages.create({
      pipelineId: pipeline.id,
      name: "Scheduled",
      followUpDays: 2,
      followUpTitle: "Call after the walkthrough",
    });
    const { deal, contact } = await aDealWithContact();
    const enteredAt = "2026-09-20T09:00:00.000Z";
    const args = {
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: contact.id,
      companyId: null,
      customerName: "Dana Reyes",
      stageId: stage.id,
      stageName: stage.name,
      followUpDays: stage.followUpDays,
      followUpTitle: stage.followUpTitle,
      enteredAt,
    };
    const first = await automations.runStageEntered(args);
    await applyStatements(first.statements);
    const second = await automations.runStageEntered(args);
    expect(second.statements).toEqual([]);
  });
});
