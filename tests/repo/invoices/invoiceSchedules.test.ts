/**
 * The recurring invoice schedule.
 *
 * Two things are being pinned here. The date arithmetic, because billing on
 * the 31st has to mean the 28th of February and then the 31st of March again
 * rather than drifting three days later every month; and the catch-up, because
 * a workspace nobody opened for a quarter must produce one invoice per missed
 * month, each dated to the month it belonged to, not one lump the owner cannot
 * explain to his customer.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as schedules from "../../../src/db/repos/invoiceSchedules";
import * as documents from "../../../src/db/repos/documents";
import * as deals from "../../../src/db/repos/deals";
import * as stages from "../../../src/db/repos/stages";
import * as pipelines from "../../../src/db/repos/pipelines";
import { newId } from "../../../src/lib/ids";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const ISSUE = { prefix: "INV", taxRateBp: 0, dueDays: 14 };

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  return (await stages.list(pipeline.id))[0].id;
}

async function addDealItem(
  dealId: string,
  values: {
    name: string;
    actualUnitCents: number;
    kind?: "one_time" | "recurring";
    interval?: "month" | "year" | null;
    position?: number;
  },
): Promise<void> {
  await raw.execute(
    `INSERT INTO deal_items
       (id, deal_id, name, kind, interval, qty, suggested_unit_cents, actual_unit_cents, taxable, position)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?)`,
    [
      newId(),
      dealId,
      values.name,
      values.kind ?? "one_time",
      values.interval ?? null,
      values.actualUnitCents,
      values.actualUnitCents,
      values.position ?? 0,
    ],
  );
}

/** A deal with one monthly line, and the recurring start date on it. */
async function monthlyDeal(startedOn: string, cents = 12_500): Promise<string> {
  const deal = await deals.create({
    title: "Monthly grounds care",
    stageId: await firstStageId(),
  });
  await addDealItem(deal.id, {
    name: "Monthly grounds care",
    actualUnitCents: cents,
    kind: "recurring",
    interval: "month",
  });
  await raw.execute(`UPDATE deals SET recurring_started_on = ? WHERE id = ?`, [
    startedOn,
    deal.id,
  ]);
  return deal.id;
}

/* -------------------------------------------------------------------------- */

describe("invoiceSchedules: date arithmetic", () => {
  it("advances a month and clamps to the end of a short one", () => {
    expect(schedules.advanceIssueDate("2026-01-15", "month")).toBe("2026-02-15");
    expect(schedules.advanceIssueDate("2026-01-31", "month")).toBe("2026-02-28");
    expect(schedules.advanceIssueDate("2028-01-31", "month")).toBe("2028-02-29");
    expect(schedules.advanceIssueDate("2026-03-31", "month")).toBe("2026-04-30");
  });

  it("does not let a clamped date drift on the following month", () => {
    // 31 Jan -> 28 Feb, and the NEXT step is 28 March, not 31 March. The date
    // is carried from the row it advances, so once it clamps it stays clamped;
    // this test records that, because the alternative is a bill date that
    // wanders and neither answer is obviously right.
    const feb = schedules.advanceIssueDate("2026-01-31", "month");
    expect(schedules.advanceIssueDate(feb, "month")).toBe("2026-03-28");
  });

  it("advances a year and clamps 29 February", () => {
    expect(schedules.advanceIssueDate("2026-06-01", "year")).toBe("2027-06-01");
    expect(schedules.advanceIssueDate("2028-02-29", "year")).toBe("2029-02-28");
  });

  it("returns an unparseable date unchanged rather than throwing", () => {
    expect(schedules.advanceIssueDate("not-a-date", "month")).toBe("not-a-date");
  });

  it("counts how many periods are owed as of a reference day", () => {
    expect(schedules.dueCount("2026-09-01", "month", "2026-08-31")).toBe(0);
    expect(schedules.dueCount("2026-09-01", "month", "2026-09-01")).toBe(1);
    expect(schedules.dueCount("2026-06-01", "month", "2026-09-15")).toBe(4);
    expect(schedules.dueCount("2024-01-01", "year", "2026-09-15")).toBe(3);
  });
});

describe("invoiceSchedules: creating", () => {
  it("starts one on a won deal with a recurring line, from its start date", async () => {
    h = await createSeededHarness();
    const dealId = await monthlyDeal("2026-10-01");
    const schedule = await schedules.ensureForWonDeal(dealId, "2026-09-19");
    expect(schedule).not.toBeNull();
    expect(schedule?.interval).toBe("month");
    // The service starts in October, so the first bill does too - not on the
    // day the deal closed.
    expect(schedule?.nextIssueOn).toBe("2026-10-01");
  });

  it("falls back to today when the deal has no start date", async () => {
    h = await createSeededHarness();
    const deal = await deals.create({ title: "Care plan", stageId: await firstStageId() });
    await addDealItem(deal.id, {
      name: "Monthly",
      actualUnitCents: 5_000,
      kind: "recurring",
      interval: "month",
    });
    const schedule = await schedules.ensureForWonDeal(deal.id, "2026-09-19");
    expect(schedule?.nextIssueOn).toBe("2026-09-19");
  });

  it("does nothing for a deal with no recurring lines", async () => {
    h = await createSeededHarness();
    const deal = await deals.create({ title: "One off", stageId: await firstStageId() });
    await addDealItem(deal.id, { name: "Install", actualUnitCents: 40_000 });
    expect(await schedules.ensureForWonDeal(deal.id)).toBeNull();
  });

  it("is idempotent, so the deal page can call it on every win", async () => {
    h = await createSeededHarness();
    const dealId = await monthlyDeal("2026-10-01");
    const first = await schedules.ensureForWonDeal(dealId, "2026-09-19");
    const second = await schedules.ensureForWonDeal(dealId, "2026-09-19");
    expect(second?.id).toBe(first?.id);
    expect(await schedules.list()).toHaveLength(1);
  });

  it("bills monthly when a deal mixes a monthly line with a yearly one", async () => {
    h = await createSeededHarness();
    const deal = await deals.create({ title: "Mixed", stageId: await firstStageId() });
    await addDealItem(deal.id, {
      name: "Yearly certificate",
      actualUnitCents: 20_000,
      kind: "recurring",
      interval: "year",
      position: 0,
    });
    await addDealItem(deal.id, {
      name: "Monthly checks",
      actualUnitCents: 4_000,
      kind: "recurring",
      interval: "month",
      position: 1,
    });
    expect(await schedules.intervalForDeal(deal.id)).toBe("month");
  });

  it("bills yearly when every recurring line is yearly", async () => {
    h = await createSeededHarness();
    const deal = await deals.create({ title: "Annual", stageId: await firstStageId() });
    await addDealItem(deal.id, {
      name: "Annual service",
      actualUnitCents: 20_000,
      kind: "recurring",
      interval: "year",
    });
    expect(await schedules.intervalForDeal(deal.id)).toBe("year");
    const schedule = await schedules.ensureForWonDeal(deal.id, "2026-09-19");
    expect(schedule?.interval).toBe("year");
  });
});

describe("invoiceSchedules: issueDue", () => {
  it("raises one draft invoice and moves the date on", async () => {
    h = await createSeededHarness();
    const dealId = await monthlyDeal("2026-09-01", 12_500);
    const schedule = await schedules.ensureForWonDeal(dealId, "2026-09-01");

    const result = await schedules.issueDue("2026-09-19", ISSUE);
    expect(result.failed).toHaveLength(0);
    expect(result.issued).toHaveLength(1);
    expect(result.issued[0].issuedOn).toBe("2026-09-01");

    const invoice = await documents.getOrThrow(result.issued[0].documentId);
    expect(invoice.document.status).toBe("draft");
    expect(invoice.document.totalCents).toBe(12_500);
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0].kind).toBe("recurring");
    expect(invoice.document.dueOn).toBe("2026-09-15");

    const after = await schedules.get(schedule?.id ?? "");
    expect(after?.nextIssueOn).toBe("2026-10-01");
    expect(after?.lastIssuedOn).toBe("2026-09-01");
  });

  it("issues nothing before the date arrives", async () => {
    h = await createSeededHarness();
    const dealId = await monthlyDeal("2026-10-01");
    await schedules.ensureForWonDeal(dealId, "2026-09-19");
    const result = await schedules.issueDue("2026-09-19", ISSUE);
    expect(result.issued).toHaveLength(0);
  });

  it("catches up one invoice per missed month, each dated to its own month", async () => {
    h = await createSeededHarness();
    const dealId = await monthlyDeal("2026-06-01", 10_000);
    await schedules.ensureForWonDeal(dealId, "2026-06-01");

    const result = await schedules.issueDue("2026-09-15", ISSUE);
    expect(result.issued.map((i) => i.issuedOn)).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
    // Four invoices, four consecutive numbers, no gap.
    expect(result.issued.map((i) => i.number)).toEqual([
      "INV-2026-0001",
      "INV-2026-0002",
      "INV-2026-0003",
      "INV-2026-0004",
    ]);
    const { total } = await documents.list({ kind: "invoice" });
    expect(total).toBe(4);
  });

  it("catches up a yearly schedule the same way", async () => {
    h = await createSeededHarness();
    const deal = await deals.create({ title: "Annual", stageId: await firstStageId() });
    await addDealItem(deal.id, {
      name: "Annual inspection",
      actualUnitCents: 30_000,
      kind: "recurring",
      interval: "year",
    });
    await raw.execute(`UPDATE deals SET recurring_started_on = ? WHERE id = ?`, [
      "2024-03-01",
      deal.id,
    ]);
    const schedule = await schedules.ensureForWonDeal(deal.id, "2024-03-01");

    const result = await schedules.issueDue("2026-09-15", ISSUE);
    expect(result.issued.map((i) => i.issuedOn)).toEqual([
      "2024-03-01",
      "2025-03-01",
      "2026-03-01",
    ]);
    expect((await schedules.get(schedule?.id ?? ""))?.nextIssueOn).toBe("2027-03-01");
  });

  it("clamps a month-end schedule through February and does not lose a month", async () => {
    h = await createSeededHarness();
    const dealId = await monthlyDeal("2026-01-31", 8_000);
    await schedules.ensureForWonDeal(dealId, "2026-01-31");
    const result = await schedules.issueDue("2026-04-30", ISSUE);
    expect(result.issued.map((i) => i.issuedOn)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-28",
      "2026-04-28",
    ]);
  });

  it("skips a paused schedule and a deleted one", async () => {
    h = await createSeededHarness();
    const paused = await schedules.ensureForWonDeal(await monthlyDeal("2026-09-01"), "2026-09-01");
    await schedules.setActive(paused?.id ?? "", false);

    const removed = await schedules.ensureForWonDeal(
      await monthlyDeal("2026-09-01"),
      "2026-09-01",
    );
    await schedules.softDelete(removed?.id ?? "");

    const result = await schedules.issueDue("2026-09-19", ISSUE);
    expect(result.issued).toHaveLength(0);
  });

  it("reports a schedule whose deal lost its recurring lines without taking the run down", async () => {
    h = await createSeededHarness();
    const brokenDeal = await monthlyDeal("2026-09-01");
    const broken = await schedules.ensureForWonDeal(brokenDeal, "2026-09-01");
    await raw.execute(`DELETE FROM deal_items WHERE deal_id = ?`, [brokenDeal]);

    const goodDeal = await monthlyDeal("2026-09-01", 7_500);
    await schedules.ensureForWonDeal(goodDeal, "2026-09-01");

    const result = await schedules.issueDue("2026-09-19", ISSUE);
    expect(result.failed.map((f) => f.scheduleId)).toEqual([broken?.id]);
    // The healthy one still billed.
    expect(result.issued).toHaveLength(1);
    expect(result.issued[0].dealId).toBe(goodDeal);
  });
});

describe("invoiceSchedules: issueOne", () => {
  it('is what "Create this month\'s invoice" does, and moves the date on once', async () => {
    h = await createSeededHarness();
    const dealId = await monthlyDeal("2026-09-01", 9_900);
    const schedule = await schedules.ensureForWonDeal(dealId, "2026-09-01");

    const invoice = await schedules.issueOne(schedule?.id ?? "", ISSUE);
    expect(invoice.status).toBe("draft");
    expect(invoice.totalCents).toBe(9_900);
    expect(invoice.issuedOn).toBe("2026-09-01");

    const after = await schedules.get(schedule?.id ?? "");
    expect(after?.nextIssueOn).toBe("2026-10-01");
    expect(after?.lastIssuedOn).toBe("2026-09-01");
  });
});

describe("invoiceSchedules: ensureForWonDeals", () => {
  it("gives every won deal with recurring lines a schedule, and skips the rest", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const all = await stages.list(pipeline.id);
    const won = all.find((s) => s.isWon);
    expect(won).toBeTruthy();

    // Won, recurring: gets one.
    const wonRecurring = await monthlyDeal("2026-09-01");
    await deals.moveToStage(wonRecurring, won!.id);

    // Won, but one-time only: gets nothing.
    const wonOneTime = await deals.create({
      title: "One-off rewire",
      stageId: await firstStageId(),
    });
    await addDealItem(wonOneTime.id, { name: "Rewire", actualUnitCents: 90_000 });
    await deals.moveToStage(wonOneTime.id, won!.id);

    // Recurring, but still open: not won, so not yet.
    const openRecurring = await monthlyDeal("2026-09-01");

    const created = await schedules.ensureForWonDeals("2026-09-19");
    expect(created).toHaveLength(1);
    expect(created[0].dealId).toBe(wonRecurring);
    expect(await schedules.forDeal(wonOneTime.id)).toBeNull();
    expect(await schedules.forDeal(openRecurring)).toBeNull();
  });

  it("does not give a deal a second schedule on the next pass", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const won = (await stages.list(pipeline.id)).find((s) => s.isWon)!;
    const dealId = await monthlyDeal("2026-09-01");
    await deals.moveToStage(dealId, won.id);

    expect(await schedules.ensureForWonDeals("2026-09-19")).toHaveLength(1);
    expect(await schedules.ensureForWonDeals("2026-09-19")).toHaveLength(0);
    expect(await schedules.list()).toHaveLength(1);
  });
});
