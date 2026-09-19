import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import { DEFAULT_SOURCES, DEFAULT_STAGES, seedWorkspace } from "../../src/db/repos/seed";
import * as pipelines from "../../src/db/repos/pipelines";
import * as stages from "../../src/db/repos/stages";
import * as sources from "../../src/db/repos/sources";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("seed: first boot", () => {
  it("creates one pipeline with the six named stages in order", async () => {
    h = await createHarness();
    const result = await seedWorkspace();
    expect(result.pipelineCreated).toBe(true);
    expect(result.stagesCreated).toBe(DEFAULT_STAGES.length);

    const allPipelines = await pipelines.list();
    expect(allPipelines).toHaveLength(1);

    const stageRows = await stages.list(allPipelines[0].id);
    expect(stageRows.map((s) => s.name)).toEqual(DEFAULT_STAGES.map((s) => s.name));

    const won = stageRows.find((s) => s.name === "Won");
    const lost = stageRows.find((s) => s.name === "Lost");
    expect(won?.isWon).toBe(true);
    expect(won?.isLost).toBe(false);
    expect(lost?.isLost).toBe(true);
    expect(lost?.isWon).toBe(false);

    for (const stage of stageRows) {
      if (stage.name === "Won" || stage.name === "Lost") continue;
      expect(stage.isWon).toBe(false);
      expect(stage.isLost).toBe(false);
    }
  });

  it("creates the four default sources", async () => {
    h = await createHarness();
    const result = await seedWorkspace();
    expect(result.sourcesCreated).toBe(DEFAULT_SOURCES.length);

    const { rows } = await sources.list();
    const names = rows.map((s) => s.name).sort();
    expect(names).toEqual([...DEFAULT_SOURCES.map((s) => s.name)].sort());
  });

  it("running it twice creates nothing extra", async () => {
    h = await createHarness();
    await seedWorkspace();
    const second = await seedWorkspace();

    expect(second.pipelineCreated).toBe(false);
    expect(second.stagesCreated).toBe(0);
    expect(second.sourcesCreated).toBe(0);

    const allPipelines = await pipelines.list();
    expect(allPipelines).toHaveLength(1);
    const { rows } = await sources.list();
    expect(rows).toHaveLength(DEFAULT_SOURCES.length);
  });

  it("sources.ensure('Website') returns the seeded row rather than a duplicate", async () => {
    h = await createHarness();
    await seedWorkspace();

    const seededWebsite = (await sources.list()).rows.find((s) => s.name === "Website");
    expect(seededWebsite).toBeDefined();

    const ensured = await sources.ensure("Website");
    expect(ensured.id).toBe(seededWebsite?.id);

    const { rows } = await sources.list();
    expect(rows.filter((s) => s.name === "Website")).toHaveLength(1);
  });
});
