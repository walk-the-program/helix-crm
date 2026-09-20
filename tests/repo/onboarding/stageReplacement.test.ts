/**
 * Applying a preset on a workspace that already has stages.
 *
 * Walker picked a trade after clicking around for ten minutes and ended up
 * with the six default stages and the trade's seven stacked on top of each
 * other. Round 3's rule: a stage that holds nothing is cleared out to make
 * room for the preset's; a stage that holds work is kept, moved below the new
 * ones, and named back to the caller so the screen can say so.
 *
 * "Holds nothing" is measured against both tables that point at a stage -
 * `deals.stage_id` and `deal_stage_events.to_stage_id` are both ON DELETE
 * RESTRICT, so a stage under a trashed deal is not empty and deleting it
 * would fail mid-transaction.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stagesRepo from "../../../src/db/repos/stages";
import * as dealsRepo from "../../../src/db/repos/deals";
import { DEFAULT_STAGES } from "../../../src/db/repos/seed";
import { PRESETS } from "../../../src/features/onboarding/presets";
import { applyPlan, planFromPreset } from "../../../src/features/onboarding/lib/applyPreset";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function stageNames(): Promise<string[]> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const list = await stagesRepo.list(pipeline.id);
  return list.map((stage) => stage.name);
}

describe("applying a preset over the seeded defaults", () => {
  it("leaves exactly the preset's stages, in order, when none of the defaults held a deal", async () => {
    h = await createSeededHarness();
    expect(await stageNames()).toEqual(DEFAULT_STAGES.map((stage) => stage.name));

    const preset = PRESETS.landscaping;
    const result = await applyPlan(planFromPreset(preset));

    expect(await stageNames()).toEqual(preset.stages.map((stage) => stage.name));
    expect(result.stagesCreated).toBe(preset.stages.length);
    expect(result.stagesRemoved).toBe(DEFAULT_STAGES.length);
    expect(result.stagesKept).toEqual([]);
  });

  it("positions the preset's stages 0..n-1 with no gaps", async () => {
    h = await createSeededHarness();
    const preset = PRESETS.landscaping;
    await applyPlan(planFromPreset(preset));

    const pipeline = await pipelines.getDefaultOrThrow();
    const list = await stagesRepo.list(pipeline.id);
    expect(list.map((stage) => stage.position)).toEqual(
      preset.stages.map((_stage, index) => index),
    );
  });

  it("keeps a default stage that holds a deal, moves it below the new ones, and names it", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const before = await stagesRepo.list(pipeline.id);
    const quoted = before.find((stage) => stage.name === "Quoted");
    expect(quoted).toBeDefined();
    await dealsRepo.create({ title: "Sprinklers", stageId: quoted!.id, valueCents: 25_000 });

    const preset = PRESETS.landscaping;
    const result = await applyPlan(planFromPreset(preset));

    expect(result.stagesKept).toEqual(["Quoted"]);
    // Every other default went; the preset's stages are first and "Quoted"
    // is last, still holding its deal.
    expect(await stageNames()).toEqual([...preset.stages.map((stage) => stage.name), "Quoted"]);
    expect(result.stagesRemoved).toBe(DEFAULT_STAGES.length - 1);

    const after = await stagesRepo.list(pipeline.id);
    expect(after.map((stage) => stage.position)).toEqual(after.map((_stage, index) => index));
    const stillThere = after.find((stage) => stage.name === "Quoted");
    expect(stillThere?.id).toBe(quoted!.id);
    expect(await stagesRepo.dealCount(stillThere!.id)).toBe(1);
  });

  it("keeps a stage whose only deal is in the trash, because the foreign key still points at it", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const before = await stagesRepo.list(pipeline.id);
    const contacted = before.find((stage) => stage.name === "Contacted")!;
    const deal = await dealsRepo.create({ title: "Gone", stageId: contacted.id });
    await dealsRepo.softDelete(deal.id);

    const result = await applyPlan(planFromPreset(PRESETS.landscaping));

    expect(result.stagesKept).toEqual(["Contacted"]);
    expect((await stageNames()).at(-1)).toBe("Contacted");
  });

  it("does not insert a second stage by the name of one it kept", async () => {
    h = await createSeededHarness();
    const pipeline = await pipelines.getDefaultOrThrow();
    const before = await stagesRepo.list(pipeline.id);
    const won = before.find((stage) => stage.name === "Won")!;
    await dealsRepo.create({ title: "Paid job", stageId: won.id });

    // The landscaping preset's own won stage is called "Paid", so this also
    // proves the kept stage is matched by name rather than by its flags.
    const preset = PRESETS.dental;
    const presetHasWon = preset.stages.some((stage) => stage.name === "Won");
    const result = await applyPlan(planFromPreset(preset));

    const names = await stageNames();
    expect(names.filter((name) => name === "Won")).toHaveLength(1);
    expect(result.stagesKept).toEqual(["Won"]);
    expect(result.stagesCreated).toBe(preset.stages.length - (presetHasWon ? 1 : 0));
  });

  it("still writes the preset's sources even though screen 2 no longer shows them", async () => {
    h = await createSeededHarness();
    const preset = PRESETS.landscaping;
    await applyPlan(planFromPreset(preset));

    const rows = await raw.query(`SELECT name FROM sources WHERE deleted_at IS NULL`);
    const names = rows.map((row) => String(row[0]));
    for (const source of preset.sources) {
      expect(names).toContain(source.name);
    }
  });
});
