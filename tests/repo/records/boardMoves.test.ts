/**
 * The repository behaviour the pipeline board leans on: a drag or a shift+arrow
 * turns into one `deals.moveTo`, and the board's pure arithmetic
 * (`lib/board.ts`) must agree with what the database ends up holding.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as dealsRepo from "@/db/repos/deals";
import * as stagesRepo from "@/db/repos/stages";
import * as pipelines from "@/db/repos/pipelines";
import { keyboardMove, moveCard, type BoardColumn } from "@/features/records/lib/board";

let harness: Harness;
let pipelineId: string;
let stages: { id: string; name: string; isLost: boolean }[];

/**
 * The board as the screen assembles it. `deals.board()` returns only the
 * stages that hold something, in map order, so the screen (and this helper)
 * drives the columns from the stage list instead. Noted in STATUS.
 */
async function boardColumns(): Promise<BoardColumn[]> {
  const grouped = await dealsRepo.board(pipelineId);
  return stages.map((stage) => ({
    stageId: stage.id,
    dealIds: (grouped.find((column) => column.stageId === stage.id)?.deals ?? []).map(
      (deal) => deal.id,
    ),
  }));
}

beforeEach(async () => {
  harness = await createSeededHarness();
  const pipeline = await pipelines.getDefaultOrThrow();
  pipelineId = pipeline.id;
  stages = (await stagesRepo.list(pipelineId)).map((stage) => ({
    id: stage.id,
    name: stage.name,
    isLost: stage.isLost,
  }));
});

afterEach(() => {
  harness.dispose();
});

describe("the board's moves against the repository", () => {
  it("drags a card to another stage and persists stage and position", async () => {
    const first = stages[0];
    const second = stages[1];
    const a = await dealsRepo.create({ title: "A", stageId: first.id });
    const b = await dealsRepo.create({ title: "B", stageId: first.id });
    await dealsRepo.create({ title: "C", stageId: second.id });

    const before = await boardColumns();
    const predicted = moveCard(before, a.id, second.id, 0);

    await dealsRepo.moveTo(a.id, second.id, 0);

    const after = await boardColumns();
    expect(after).toEqual(predicted);

    const moved = await dealsRepo.getOrThrow(a.id);
    expect(moved.stageId).toBe(second.id);
    expect(moved.position).toBe(0);

    // The stage it left keeps no hole.
    const remaining = await dealsRepo.getOrThrow(b.id);
    expect(remaining.position).toBe(0);
  });

  it("records a stage event for every cross-stage move and none for a reorder", async () => {
    const deal = await dealsRepo.create({ title: "A", stageId: stages[0].id });
    await dealsRepo.create({ title: "B", stageId: stages[0].id });

    await dealsRepo.moveTo(deal.id, stages[1].id, 0);
    await dealsRepo.moveTo(deal.id, stages[1].id, 0);

    // One event for the create, one for the cross-stage move, none for the
    // reorder that followed it.
    const events = await dealsRepo.listStageEvents(deal.id);
    expect(events).toHaveLength(2);
    expect(events[0].fromStageId).toBeNull();
    expect(events[0].toStageId).toBe(stages[0].id);
    expect(events[1].fromStageId).toBe(stages[0].id);
    expect(events[1].toStageId).toBe(stages[1].id);
  });

  it("reorders inside one stage exactly as the board predicted", async () => {
    const first = stages[0];
    const a = await dealsRepo.create({ title: "A", stageId: first.id });
    await dealsRepo.create({ title: "B", stageId: first.id });
    await dealsRepo.create({ title: "C", stageId: first.id });

    const before = await boardColumns();
    const predicted = moveCard(before, a.id, first.id, 2);

    await dealsRepo.moveTo(a.id, first.id, 2);

    expect(await boardColumns()).toEqual(predicted);
  });

  it("carries out a shift+arrow move end to end", async () => {
    const a = await dealsRepo.create({ title: "A", stageId: stages[0].id });
    await dealsRepo.create({ title: "B", stageId: stages[0].id });

    const columns = await boardColumns();
    const move = keyboardMove(columns, a.id, "right");
    expect(move).not.toBeNull();
    if (!move) return;

    await dealsRepo.moveTo(move.dealId, move.toStageId, move.toIndex);

    const moved = await dealsRepo.getOrThrow(a.id);
    expect(moved.stageId).toBe(stages[1].id);
  });

  it("refuses a move into a lost stage until there is a reason, then takes it", async () => {
    const lost = stages.find((stage) => stage.isLost);
    expect(lost).toBeDefined();
    if (!lost) return;

    const deal = await dealsRepo.create({ title: "A", stageId: stages[0].id });

    await expect(dealsRepo.moveTo(deal.id, lost.id, 0)).rejects.toThrow(/reason/i);
    expect((await dealsRepo.getOrThrow(deal.id)).stageId).toBe(stages[0].id);

    await dealsRepo.moveTo(deal.id, lost.id, 0, { outcomeReason: "Went with a cheaper bid." });
    const after = await dealsRepo.getOrThrow(deal.id);
    expect(after.stageId).toBe(lost.id);
    expect(after.outcomeReason).toBe("Went with a cheaper bid.");
    expect(after.closedAt).not.toBeNull();
  });

  it("moves every deal out of a stage the owner deletes", async () => {
    const doomed = await stagesRepo.create({ pipelineId, name: "Walkthrough" });
    const deal = await dealsRepo.create({ title: "A", stageId: doomed.id });

    await expect(stagesRepo.remove(doomed.id)).rejects.toThrow();

    await stagesRepo.remove(doomed.id, stages[0].id);

    expect(await dealsRepo.get(deal.id).then((d) => d?.stageId)).toBe(stages[0].id);
    expect((await stagesRepo.list(pipelineId)).some((s) => s.id === doomed.id)).toBe(false);
  });

  it("totals a column's value the way the header prints it", async () => {
    await dealsRepo.create({ title: "A", stageId: stages[0].id, valueCents: 150000 });
    await dealsRepo.create({ title: "B", stageId: stages[0].id, valueCents: 25050 });

    const summary = await stagesRepo.summary(pipelineId);
    const row = summary.find((entry) => entry.stageId === stages[0].id);
    expect(row?.dealCount).toBe(2);
    expect(row?.valueCents).toBe(175050);
  });
});
