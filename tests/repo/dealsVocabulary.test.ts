/**
 * The workspace's own word reaches the messages a REPOSITORY writes, not just
 * the ones a screen renders.
 *
 * An owner who set the vocabulary to Jobs never sees the word "deal" anywhere
 * in Helix — except, until this, in a validation message thrown out of
 * `deals.moveToStage`, which is exactly the moment he is being told he did
 * something wrong. Being corrected in someone else's vocabulary is the worst
 * place for the product to drop its own voice.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import * as deals from "../../src/db/repos/deals";
import * as stages from "../../src/db/repos/stages";
import * as pipelines from "../../src/db/repos/pipelines";
import * as settings from "../../src/db/repos/settings";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function lostStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const all = await stages.list(pipeline.id);
  const lost = all.find((stage) => stage.isLost);
  if (!lost) throw new Error("the seeded pipeline has no lost stage");
  return lost.id;
}

async function newDeal(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const [first] = await stages.list(pipeline.id);
  const deal = await deals.create({ title: "Sprinkler repair", stageId: first.id });
  return deal.id;
}

describe("repository messages follow the workspace vocabulary", () => {
  it("says 'deal' in a deals workspace", async () => {
    h = await createSeededHarness();
    const id = await newDeal();
    await expect(deals.moveToStage(id, await lostStageId())).rejects.toThrow(
      "Losing a deal needs a reason.",
    );
  });

  it("says 'job' in a jobs workspace", async () => {
    h = await createSeededHarness();
    await settings.set("vocabulary", "jobs");
    const id = await newDeal();
    await expect(deals.moveToStage(id, await lostStageId())).rejects.toThrow(
      "Losing a job needs a reason.",
    );
  });

  it("says 'quote' in a quotes workspace", async () => {
    h = await createSeededHarness();
    await settings.set("vocabulary", "quotes");
    const id = await newDeal();
    await expect(deals.moveToStage(id, await lostStageId())).rejects.toThrow(
      "Losing a quote needs a reason.",
    );
  });

  it("still accepts the move once a reason is given", async () => {
    h = await createSeededHarness();
    await settings.set("vocabulary", "jobs");
    const id = await newDeal();
    const moved = await deals.moveToStage(id, await lostStageId(), {
      outcomeReason: "Went with a cheaper bid.",
    });
    expect(moved.stageIsLost).toBe(true);
    expect(moved.outcomeReason).toBe("Went with a cheaper bid.");
  });
});
