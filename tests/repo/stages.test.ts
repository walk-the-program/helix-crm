import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import * as stages from "../../src/db/repos/stages";
import * as pipelines from "../../src/db/repos/pipelines";
import * as deals from "../../src/db/repos/deals";
import { StageInUseError } from "../../src/db/errors";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function makePipelineWithStages(): Promise<{
  pipelineId: string;
  a: string;
  b: string;
  c: string;
}> {
  const pipeline = await pipelines.create({ name: "Test pipeline" });
  const a = await stages.create({ pipelineId: pipeline.id, name: "A" });
  const b = await stages.create({ pipelineId: pipeline.id, name: "B" });
  const c = await stages.create({ pipelineId: pipeline.id, name: "C" });
  return { pipelineId: pipeline.id, a: a.id, b: b.id, c: c.id };
}

describe("stages: list and create", () => {
  it("lists in position order and create appends", async () => {
    h = await createHarness();
    const { pipelineId, a, b, c } = await makePipelineWithStages();

    const list1 = await stages.list(pipelineId);
    expect(list1.map((s) => s.id)).toEqual([a, b, c]);
    expect(list1.map((s) => s.position)).toEqual([0, 1, 2]);

    const d = await stages.create({ pipelineId, name: "D" });
    expect(d.position).toBe(3);

    const list2 = await stages.list(pipelineId);
    expect(list2.map((s) => s.id)).toEqual([a, b, c, d.id]);
  });
});

describe("stages: reorder", () => {
  it("rewrites positions to 0..n-1 in the given order", async () => {
    h = await createHarness();
    const { pipelineId, a, b, c } = await makePipelineWithStages();

    await stages.reorder([c, a, b]);

    const list = await stages.list(pipelineId);
    expect(list.map((s) => s.id)).toEqual([c, a, b]);
    expect(list.map((s) => s.position)).toEqual([0, 1, 2]);
  });
});

describe("stages: summary", () => {
  it("counts deals and sums value per stage", async () => {
    h = await createHarness();
    const { pipelineId, a, b } = await makePipelineWithStages();

    await deals.create({ title: "D1", stageId: a, valueCents: 1000 });
    await deals.create({ title: "D2", stageId: a, valueCents: 2500 });
    await deals.create({ title: "D3", stageId: b, valueCents: 500 });

    const summary = await stages.summary(pipelineId);
    const forA = summary.find((s) => s.stageId === a);
    const forB = summary.find((s) => s.stageId === b);
    expect(forA?.dealCount).toBe(2);
    expect(forA?.valueCents).toBe(3500);
    expect(forB?.dealCount).toBe(1);
    expect(forB?.valueCents).toBe(500);
  });
});

describe("stages: remove (StageInUseError)", () => {
  it("throws and changes nothing when deals exist and no target is given", async () => {
    h = await createHarness();
    const { a } = await makePipelineWithStages();
    const deal = await deals.create({ title: "In use", stageId: a });

    await expect(stages.remove(a)).rejects.toBeInstanceOf(StageInUseError);

    const stillThere = await stages.getOrThrow(a);
    expect(stillThere.deletedAt).toBeNull();
    const dealStillThere = await deals.getOrThrow(deal.id);
    expect(dealStillThere.stageId).toBe(a);
  });

  it("moves every deal, writes a deal_stage_event per move, then soft-deletes the stage", async () => {
    h = await createHarness();
    const { a, b } = await makePipelineWithStages();
    const d1 = await deals.create({ title: "D1", stageId: a });
    const d2 = await deals.create({ title: "D2", stageId: a });

    await stages.remove(a, b);

    const moved1 = await deals.getOrThrow(d1.id);
    const moved2 = await deals.getOrThrow(d2.id);
    expect(moved1.stageId).toBe(b);
    expect(moved2.stageId).toBe(b);

    const events1 = await deals.listStageEvents(d1.id);
    expect(events1[events1.length - 1].toStageId).toBe(b);
    expect(events1[events1.length - 1].fromStageId).toBe(a);

    const events2 = await deals.listStageEvents(d2.id);
    expect(events2[events2.length - 1].toStageId).toBe(b);

    const removedStage = await stages.get(a);
    expect(removedStage?.deletedAt).not.toBeNull();
  });

  it("deletes cleanly when there are no deals in the stage", async () => {
    h = await createHarness();
    const { a } = await makePipelineWithStages();
    await stages.remove(a);
    const removed = await stages.get(a);
    expect(removed?.deletedAt).not.toBeNull();
  });

  it("appends a change_log row on stage soft-delete", async () => {
    h = await createHarness();
    const { a } = await makePipelineWithStages();
    await stages.remove(a);
    const rows = await raw.query(
      `SELECT cl.op AS cl_op FROM change_log cl WHERE cl.entity_type = 'stage' AND cl.entity_id = ?`,
      [a],
    );
    expect(rows.map((r) => String(r[0]))).toContain("delete");
  });
});
