/**
 * Per-stage follow-up rules, and the bulk stage move that has to fire them
 * exactly once per deal.
 *
 * The rule the owner writes reads "After 2 days here, remind me to book the
 * walkthrough", and it belongs to the stage rather than to any one job. Two
 * things can go wrong at this seam and neither is the runner's fault: a move
 * that is not really a move (re-picking the stage a deal already sits in, or
 * correcting a won date) must fire nothing, and a bulk move of twelve deals
 * must produce twelve reminders in ONE transaction under ONE batch id - not
 * twelve transactions, and not twelve reminders on one deal.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import * as deals from "../../src/db/repos/deals";
import * as stages from "../../src/db/repos/stages";
import * as pipelines from "../../src/db/repos/pipelines";
import * as tasks from "../../src/db/repos/tasks";
import { undoBatch } from "../../src/db/changeLog";
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

async function automationTasks() {
  const { rows } = await tasks.list({ source: "automation" });
  return rows;
}

describe("moveToStage: the stage's own follow-up rule", () => {
  it("writes one task when a deal enters a stage that has a rule", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    await stages.update(byName.Quoted.id, {
      followUpDays: 2,
      followUpTitle: "Chase {name} about the quote",
    });

    const deal = await deals.create({ title: "Retaining wall", stageId: byName.New.id });
    await deals.moveToStage(deal.id, byName.Quoted.id);

    const written = await automationTasks();
    expect(written).toHaveLength(1);
    expect(written[0].dealId).toBe(deal.id);
    expect(written[0].source).toBe("automation");
    expect(written[0].title).toContain("Chase ");
  });

  it("writes nothing for a stage with no rule", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const deal = await deals.create({ title: "Retaining wall", stageId: byName.New.id });
    await deals.moveToStage(deal.id, byName.Quoted.id);
    expect(await automationTasks()).toHaveLength(0);
  });

  it("does not fire when the deal is already in that stage", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    await stages.update(byName.Quoted.id, {
      followUpDays: 2,
      followUpTitle: "Chase {name}",
    });
    const deal = await deals.create({ title: "Retaining wall", stageId: byName.Quoted.id });
    await deals.moveToStage(deal.id, byName.Quoted.id);
    expect(await automationTasks()).toHaveLength(0);
  });

  it("leaves a timeline entry saying what Helix did and why", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    await stages.update(byName.Quoted.id, {
      followUpDays: 2,
      followUpTitle: "Chase {name} about the quote",
    });
    const deal = await deals.create({ title: "Retaining wall", stageId: byName.New.id });
    await deals.moveToStage(deal.id, byName.Quoted.id);

    const rows = await raw.query(
      `SELECT a.body AS a_body FROM activities a
       WHERE a.deal_id = ? AND a.body LIKE 'Helix added a follow-up%'`,
      [deal.id],
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0][0])).toContain("Quoted");
  });
});

describe("moveManyToStage", () => {
  it("moves every deal, fires the rule once each, under one batch id", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    await stages.update(byName.Quoted.id, {
      followUpDays: 3,
      followUpTitle: "Follow up with {name}",
    });

    const made = [];
    for (const title of ["Deck", "Patio", "Fence"]) {
      made.push(await deals.create({ title, stageId: byName.New.id }));
    }

    const result = await deals.moveManyToStage(
      made.map((d) => d.id),
      byName.Quoted.id,
    );
    expect(result.moved).toBe(3);
    expect(result.batchId).toBeTruthy();

    for (const d of made) {
      expect((await deals.getOrThrow(d.id)).stageId).toBe(byName.Quoted.id);
    }

    const written = await automationTasks();
    expect(written).toHaveLength(3);
    expect(new Set(written.map((t) => t.dealId)).size).toBe(3);

    // One undo entry for the whole move: every deal's change_log row shares
    // the batch id the call returned.
    const rows = await raw.query(
      `SELECT count(*) AS n FROM change_log WHERE batch_id = ? AND entity_type = 'deal'`,
      [result.batchId],
    );
    expect(Number(rows[0][0])).toBe(3);
  });

  it("is one transaction: a deal that cannot move takes the whole move back", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const lost = Object.values(byName).find((s) => s.isLost);
    expect(lost).toBeTruthy();

    const made = [];
    for (const title of ["Deck", "Patio"]) {
      made.push(await deals.create({ title, stageId: byName.New.id }));
    }

    // A lost stage needs a reason, and none is given: the first deal's move
    // is written and then rolled back with the second one's refusal.
    await expect(
      deals.moveManyToStage(
        made.map((d) => d.id),
        lost!.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    for (const d of made) {
      expect((await deals.getOrThrow(d.id)).stageId).toBe(byName.New.id);
    }
    const events = await raw.query(
      `SELECT count(*) AS n FROM deal_stage_events WHERE to_stage_id = ?`,
      [lost!.id],
    );
    expect(Number(events[0][0])).toBe(0);
  });

  it("counts a deal already in the target stage as moved but fires no rule for it", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    await stages.update(byName.Quoted.id, {
      followUpDays: 3,
      followUpTitle: "Follow up with {name}",
    });
    const already = await deals.create({ title: "Deck", stageId: byName.Quoted.id });
    const moving = await deals.create({ title: "Patio", stageId: byName.New.id });

    const result = await deals.moveManyToStage([already.id, moving.id], byName.Quoted.id);
    expect(result.moved).toBe(2);

    const written = await automationTasks();
    expect(written).toHaveLength(1);
    expect(written[0].dealId).toBe(moving.id);
  });

  it("undoes the whole move in one step", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const made = [];
    for (const title of ["Deck", "Patio", "Fence"]) {
      made.push(await deals.create({ title, stageId: byName.New.id }));
    }
    const result = await deals.moveManyToStage(
      made.map((d) => d.id),
      byName.Quoted.id,
    );
    await undoBatch(result.batchId);
    for (const d of made) {
      expect((await deals.getOrThrow(d.id)).stageId).toBe(byName.New.id);
    }
  });

  it("writes nothing for an empty list", async () => {
    h = await createSeededHarness();
    const byName = await seededStages();
    const result = await deals.moveManyToStage([], byName.Quoted.id);
    expect(result.moved).toBe(0);
    expect(await automationTasks()).toHaveLength(0);
  });
});
