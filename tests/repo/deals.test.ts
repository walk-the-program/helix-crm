import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import * as deals from "../../src/db/repos/deals";
import * as stages from "../../src/db/repos/stages";
import * as pipelines from "../../src/db/repos/pipelines";
import * as activities from "../../src/db/repos/activities";
import { ValidationError } from "../../src/db/errors";
import type { Stage } from "../../src/db/repos/stages";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function seededStages(): Promise<Record<string, Stage>> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  const byName: Record<string, Stage> = {};
  for (const s of all) byName[s.name] = s;
  return byName;
}

describe("deals: create", () => {
  it("writes a deal_stage_events row for the initial stage and stamps stage_entered_at", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "New deal", stageId: byName.New.id });
    expect(deal.stageEnteredAt).toBeTruthy();

    const events = await deals.listStageEvents(deal.id);
    expect(events).toHaveLength(1);
    expect(events[0].fromStageId).toBeNull();
    expect(events[0].toStageId).toBe(byName.New.id);
  });
});

describe("deals: moveToStage", () => {
  it("writes one event per move and updates stage_entered_at", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Movable", stageId: byName.New.id });
    expect(deal.stageEnteredAt).toBeTruthy();

    const moved = await deals.moveToStage(deal.id, byName.Contacted.id);
    expect(moved.stageId).toBe(byName.Contacted.id);
    expect(moved.stageEnteredAt).toBeTruthy();

    const events = await deals.listStageEvents(deal.id);
    expect(events).toHaveLength(2);
    expect(events[1].fromStageId).toBe(byName.New.id);
    expect(events[1].toStageId).toBe(byName.Contacted.id);
    // stage_entered_at is stamped to the same moment the move event recorded.
    expect(moved.stageEnteredAt).toBe(events[1].at);
  });

  it("does not write an event when the target is the stage it is already in", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Stationary", stageId: byName.New.id });

    await deals.moveToStage(deal.id, byName.New.id);

    const events = await deals.listStageEvents(deal.id);
    expect(events).toHaveLength(1);
  });

  it("throws ValidationError moving into Lost without a reason", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Losing", stageId: byName.New.id });

    await expect(deals.moveToStage(deal.id, byName.Lost.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const stillOpen = await deals.getOrThrow(deal.id);
    expect(stillOpen.stageId).toBe(byName.New.id);
    expect(stillOpen.closedAt).toBeNull();
  });

  it("succeeds moving into Lost with a reason, and sets closed_at", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Lost deal", stageId: byName.New.id });

    const lost = await deals.moveToStage(deal.id, byName.Lost.id, {
      outcomeReason: "Too expensive",
    });
    expect(lost.stageId).toBe(byName.Lost.id);
    expect(lost.closedAt).not.toBeNull();
    expect(lost.outcomeReason).toBe("Too expensive");
  });

  it("sets closed_at moving into Won", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Won deal", stageId: byName.New.id });

    const won = await deals.moveToStage(deal.id, byName.Won.id);
    expect(won.closedAt).not.toBeNull();
  });

  it("reopen into an open stage clears closed_at and outcome_reason", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Reopenable", stageId: byName.New.id });
    await deals.moveToStage(deal.id, byName.Lost.id, { outcomeReason: "Bad timing" });

    const reopened = await deals.reopen(deal.id, byName.Contacted.id);
    expect(reopened.stageId).toBe(byName.Contacted.id);
    expect(reopened.closedAt).toBeNull();
    expect(reopened.outcomeReason).toBeNull();
  });

  it("reopen into Won or Lost throws", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Cant reopen into closed", stageId: byName.New.id });

    await expect(deals.reopen(deal.id, byName.Won.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(deals.reopen(deal.id, byName.Lost.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("deals: moveToStage with an explicit `at`", () => {
  it("stamps deal_stage_events.at and stage_entered_at to the given date, not now", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Backdated move", stageId: byName.New.id });

    const at = "2026-09-01T12:00:00.000Z";
    const moved = await deals.moveToStage(deal.id, byName.Contacted.id, { at });

    expect(moved.stageEnteredAt).toBe(at);
    // Backdated on purpose, so it is not the most recent event by `at` -
    // find it by the stage it moved to rather than by array position.
    const events = await deals.listStageEvents(deal.id);
    const moveEvent = events.find((event) => event.toStageId === byName.Contacted.id);
    expect(moveEvent?.at).toBe(at);
    // updatedAt is bookkeeping, not the business date: it stays close to now.
    expect(new Date(moved.updatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("omitting `at` behaves exactly as before (now)", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Undated move", stageId: byName.New.id });

    const before = Date.now();
    const moved = await deals.moveToStage(deal.id, byName.Contacted.id);
    const after = Date.now();

    const stampedAt = new Date(moved.stageEnteredAt).getTime();
    expect(stampedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(stampedAt).toBeLessThanOrEqual(after + 1000);
  });

  it("a won move with an explicit `at` sets closed_at to that date", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Backdated win", stageId: byName.New.id });

    const at = "2026-09-19T12:00:00.000Z";
    const won = await deals.moveToStage(deal.id, byName.Won.id, { at });
    expect(won.closedAt).toBe(at);
  });

  it("a lost move with an explicit `at` sets closed_at to that date", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Backdated loss", stageId: byName.New.id });

    const at = "2026-09-10T12:00:00.000Z";
    const lost = await deals.moveToStage(deal.id, byName.Lost.id, {
      at,
      outcomeReason: "Too expensive",
    });
    expect(lost.closedAt).toBe(at);
  });

  it("writes a system timeline entry naming the stage and the date, in the same transaction", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Timeline check", stageId: byName.New.id });

    const at = "2026-09-19T12:00:00.000Z";
    await deals.moveToStage(deal.id, byName.Won.id, { at });

    const { rows } = await activities.list({ dealId: deal.id, kind: "system" });
    const moveEntry = rows.find((row) => row.body.startsWith("Moved to Won"));
    expect(moveEntry).toBeDefined();
    expect(moveEntry?.dealId).toBe(deal.id);
    expect(moveEntry?.isSystem).toBe(true);
    expect(moveEntry?.occurredAt).toBe(at);
    expect(moveEntry?.body).toContain("Moved to Won on");
  });

  it("does not write a timeline entry or event for a no-op move (already in that stage)", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Stays put", stageId: byName.New.id });

    await deals.moveToStage(deal.id, byName.New.id, { at: "2026-09-19T12:00:00.000Z" });

    const { rows } = await activities.list({ dealId: deal.id, kind: "system" });
    expect(rows.filter((row) => row.body.startsWith("Moved to")).length).toBe(0);
  });
});

describe("deals: moveTo / reposition", () => {
  it("rewrites positions 0..n-1 within one stage after a drop", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const d1 = await deals.create({ title: "D1", stageId: byName.New.id });
    const d2 = await deals.create({ title: "D2", stageId: byName.New.id });
    const d3 = await deals.create({ title: "D3", stageId: byName.New.id });

    // Drop d3 at index 0.
    await deals.moveTo(d3.id, byName.New.id, 0);

    const { rows } = await deals.list({ stageId: byName.New.id });
    const ordered = [...rows].sort((a, b) => a.position - b.position);
    expect(ordered.map((d) => d.id)).toEqual([d3.id, d1.id, d2.id]);
    expect(ordered.map((d) => d.position)).toEqual([0, 1, 2]);
  });

  it("moves the deal into the target stage at the right position and out of the source stage", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const d1 = await deals.create({ title: "D1", stageId: byName.New.id });
    const d2 = await deals.create({ title: "D2", stageId: byName.New.id });
    const d3 = await deals.create({ title: "D3", stageId: byName.New.id });

    await deals.moveTo(d2.id, byName.Contacted.id, 0);

    const sourceRows = (await deals.list({ stageId: byName.New.id })).rows;
    expect(sourceRows.map((d) => d.id).sort()).toEqual([d1.id, d3.id].sort());

    const targetRows = (await deals.list({ stageId: byName.Contacted.id })).rows;
    expect(targetRows.map((d) => d.id)).toEqual([d2.id]);
    expect(targetRows[0].position).toBe(0);
    expect(targetRows[0].stageId).toBe(byName.Contacted.id);
  });

  it("leaves the source stage contiguous after a cross-stage move", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const d1 = await deals.create({ title: "D1", stageId: byName.New.id });
    const d2 = await deals.create({ title: "D2", stageId: byName.New.id });
    const d3 = await deals.create({ title: "D3", stageId: byName.New.id });

    await deals.moveTo(d2.id, byName.Contacted.id, 0);

    const sourceRows = (await deals.list({ stageId: byName.New.id })).rows.sort(
      (a, b) => a.position - b.position,
    );
    expect(sourceRows.map((d) => d.id)).toEqual([d1.id, d3.id]);
    expect(sourceRows.map((d) => d.position)).toEqual([0, 1]);

    const targetRows = (await deals.list({ stageId: byName.Contacted.id })).rows;
    expect(targetRows.map((d) => d.id)).toEqual([d2.id]);
    expect(targetRows[0].position).toBe(0);
    expect(targetRows[0].stageId).toBe(byName.Contacted.id);
  });
});

describe("deals: findByExternalId", () => {
  it("finds a deal by its external id for lead-poll idempotency", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({
      title: "From the web",
      stageId: byName.New.id,
      externalId: "site.example:lead-42",
    });

    const found = await deals.findByExternalId("site.example:lead-42");
    expect(found?.id).toBe(deal.id);
    expect(await deals.findByExternalId("nothing:here")).toBeNull();
  });
});

describe("deals: goneQuiet", () => {
  it("shows a deal whose stage_entered_at is older than the stage's quiet_days", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Quiet deal", stageId: byName.New.id });

    // New has quietDays = 14. Back-date entry to 20 days before nowAt.
    await raw.execute(`UPDATE deals SET stage_entered_at = ? WHERE id = ?`, [
      "2024-01-01T00:00:00.000Z",
      deal.id,
    ]);
    const nowAt = "2024-01-21T00:00:00.000Z"; // 20 days later

    const quiet = await deals.goneQuiet(nowAt);
    expect(quiet.map((d) => d.id)).toContain(deal.id);
  });

  it("a later activity on the deal takes it off the list", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Revived deal", stageId: byName.New.id });

    await raw.execute(`UPDATE deals SET stage_entered_at = ? WHERE id = ?`, [
      "2024-01-01T00:00:00.000Z",
      deal.id,
    ]);
    await activities.create({
      kind: "note",
      body: "Talked to the customer.",
      dealId: deal.id,
      occurredAt: "2024-01-15T00:00:00.000Z",
    });

    const nowAt = "2024-01-21T00:00:00.000Z"; // only 6 days after the activity
    const quiet = await deals.goneQuiet(nowAt);
    expect(quiet.map((d) => d.id)).not.toContain(deal.id);
  });

  it("quiet_days = 0 disables the rule", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    await stages.update(byName.New.id, { quietDays: 0 });
    const deal = await deals.create({ title: "Never quiet", stageId: byName.New.id });

    await raw.execute(`UPDATE deals SET stage_entered_at = ? WHERE id = ?`, [
      "2020-01-01T00:00:00.000Z",
      deal.id,
    ]);
    const nowAt = "2024-01-01T00:00:00.000Z";

    const quiet = await deals.goneQuiet(nowAt);
    expect(quiet.map((d) => d.id)).not.toContain(deal.id);
  });
});

describe("deals: board", () => {
  it("returns one column per stage, in stage position order, empty ones included", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const ordered = await stages.list(pipeline.id);
    const byName = await seededStages();

    // One deal, in the third stage: every other column must still be there.
    await deals.create({ title: "Fence quote", stageId: byName.Quoted.id });

    const board = await deals.board(pipeline.id);

    expect(board.map((column) => column.stageId)).toEqual(ordered.map((s) => s.id));
    expect(board.find((c) => c.stageId === byName.Quoted.id)?.deals).toHaveLength(1);
    expect(board.find((c) => c.stageId === byName.New.id)?.deals).toEqual([]);
  });

  it("follows the stages when they are reordered, not the order deals arrived", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const byName = await seededStages();

    await deals.create({ title: "Older, later stage", stageId: byName.Scheduled.id });
    await deals.create({ title: "Newer, first stage", stageId: byName.New.id });

    const before = await deals.board(pipeline.id);
    expect(before[0].stageId).toBe(byName.New.id);

    // Move "Scheduled" to the front; the board follows.
    const current = await stages.list(pipeline.id);
    await stages.reorder([
      byName.Scheduled.id,
      ...current.filter((s) => s.id !== byName.Scheduled.id).map((s) => s.id),
    ]);

    const after = await deals.board(pipeline.id);
    expect(after[0].stageId).toBe(byName.Scheduled.id);
    expect(after[0].deals).toHaveLength(1);
    expect(after.map((c) => c.stageId)).toHaveLength(before.length);
  });
});
