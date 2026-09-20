/**
 * Speed to lead: the `lead_arrived` rule, fired from the real lead-apply path.
 *
 * `tests/repo/automations` proves the runner itself. This file proves the call
 * site, which is the thing the owner actually experiences: a lead lands from
 * the website and a follow-up task is waiting on Today, linked to the customer
 * and the job, with the record's timeline saying why it is there.
 *
 * The three properties that matter here are the ones a call site can get wrong
 * and a runner cannot: the task is written inside the SAME transaction as the
 * lead (so a rolled-back lead leaves no orphan reminder), a re-poll of the same
 * lead does not add a second one, and switching the rule off means nothing is
 * written at all.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as automations from "../../../src/db/repos/automations";
import * as tasks from "../../../src/db/repos/tasks";
import { applyLeadPage, prepareApply } from "../../../src/features/leads/lib/applyLeads";
import type { Lead } from "../../../src/features/leads/lib/types";

const SITE = "https://sorensenlandscaping.com";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createSeededHarness();
});

afterEach(() => {
  h?.dispose();
  h = null;
});

function lead(overrides: Partial<Lead> & { id: string }): Lead {
  return {
    createdAt: "2026-03-01T15:04:05.000Z",
    name: "Dana Whitcomb",
    email: "dana@example.com",
    phone: "(801) 555-0142",
    service: "Sprinkler repair",
    message: "Zone 3 will not shut off.",
    pageUrl: "https://sorensenlandscaping.com/contact",
    ...overrides,
  };
}

async function apply(leads: Lead[]) {
  const context = await prepareApply();
  if (!context) throw new Error("No stage to apply leads into.");
  return applyLeadPage(leads, SITE, context);
}

/** Every task a rule wrote, newest first. */
async function automationTasks() {
  const { rows } = await tasks.list({ source: "automation" });
  return rows;
}

describe("the lead_arrived rule, through applyLeadPage", () => {
  it("writes one follow-up task for a new lead, linked to the customer and the job", async () => {
    const result = await apply([lead({ id: "lead-1" })]);
    expect(result.created).toBe(1);

    const written = await automationTasks();
    expect(written).toHaveLength(1);
    const task = written[0];
    expect(task.source).toBe("automation");
    expect(task.title).toBe("Call Dana Whitcomb about their request");
    expect(task.dealId).toBe(result.dealIds[0]);
    expect(task.contactId).not.toBeNull();
    expect(task.doneAt).toBeNull();
    // The default rule is 60 minutes out, so the reminder has a time on it
    // rather than only a day: speed to lead is measured in hours.
    expect(task.dueAt).not.toBeNull();
    expect(task.dueOn).not.toBeNull();
  });

  it("leaves a timeline entry on the record saying what Helix did", async () => {
    const result = await apply([lead({ id: "lead-1" })]);
    const rows = await raw.query(
      `SELECT a.body AS a_body FROM activities a
       WHERE a.deal_id = ? AND a.body LIKE 'Helix added a follow-up%'`,
      [result.dealIds[0]],
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0][0])).toContain("Call Dana Whitcomb about their request");
  });

  it("does not write a second task when the same lead is polled again", async () => {
    await apply([lead({ id: "lead-1" })]);
    const second = await apply([lead({ id: "lead-1" })]);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await automationTasks()).toHaveLength(1);
  });

  it("writes one task per lead on a page of several", async () => {
    await apply([
      lead({ id: "lead-1" }),
      lead({ id: "lead-2", name: "Marcus Vela", email: "marcus@example.com", phone: "(801) 555-0188" }),
      lead({ id: "lead-3", name: "Priya Raman", email: "priya@example.com", phone: "(801) 555-0199" }),
    ]);
    const written = await automationTasks();
    expect(written).toHaveLength(3);
    expect(written.map((t) => t.title).sort()).toEqual([
      "Call Dana Whitcomb about their request",
      "Call Marcus Vela about their request",
      "Call Priya Raman about their request",
    ]);
  });

  it("writes nothing at all when the rule is switched off", async () => {
    await automations.update("lead_arrived", { enabled: false });
    const result = await apply([lead({ id: "lead-1" })]);
    expect(result.created).toBe(1);
    expect(await automationTasks()).toHaveLength(0);
  });

  it("honours a rewritten title and delay", async () => {
    await automations.update("lead_arrived", {
      delayMinutes: 15,
      titleTemplate: "Ring {name} back about {job}",
    });
    const result = await apply([lead({ id: "lead-1" })]);
    const written = await automationTasks();
    expect(written).toHaveLength(1);
    expect(written[0].title).toContain("Ring Dana Whitcomb back about ");
    expect(written[0].dealId).toBe(result.dealIds[0]);
  });
});
