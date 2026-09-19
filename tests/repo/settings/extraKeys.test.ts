/**
 * The settings keys this feature adds on top of the repository's registry,
 * against a real database through the real migrator.
 *
 * They go in through `settings.setRaw` and come back validated here, so the two
 * things worth proving are that a round trip works and that a corrupted row
 * falls back to the default instead of bricking the screen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createHarness, type Harness } from "../harness";
import * as settingsRepo from "../../../src/db/repos/settings";
import { defineExtraSetting } from "../../../src/features/settings/lib/extraKeys";
import {
  aiBaseUrl,
  aiKeyState,
  aiKeySuffix,
  DEFAULT_BASE_URL,
  readAiConfig,
} from "../../../src/features/ai/lib/aiSettings";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("the AI settings keys", () => {
  it("default before anything is written", async () => {
    h = await createHarness();
    expect(await aiKeySuffix.get()).toBeNull();
    expect(await aiKeyState.get()).toBe("unset");
    expect(await aiBaseUrl.get()).toBe(DEFAULT_BASE_URL);
  });

  it("round-trips through the settings table", async () => {
    h = await createHarness();
    await aiKeySuffix.set("1234");
    await aiKeyState.set("saved");
    await aiBaseUrl.set("http://127.0.0.1:4795");

    expect(await aiKeySuffix.get()).toBe("1234");
    expect(await aiKeyState.get()).toBe("saved");
    expect(await aiBaseUrl.get()).toBe("http://127.0.0.1:4795");
  });

  it("stores one row per key, alongside the registry's own keys", async () => {
    h = await createHarness();
    await aiKeyState.set("rejected");
    await settingsRepo.set("aiEnabled", true);

    expect(await settingsRepo.getRaw("aiKeyState")).toBe("rejected");
    expect(await settingsRepo.get("aiEnabled")).toBe(true);
  });

  it("falls back to the default when the stored value is nonsense", async () => {
    h = await createHarness();
    await settingsRepo.setRaw("aiKeyState", { not: "a state" });
    await settingsRepo.setRaw("aiBaseUrl", 42);

    expect(await aiKeyState.get()).toBe("unset");
    expect(await aiBaseUrl.get()).toBe(DEFAULT_BASE_URL);
  });

  it("writes a change_log entry, like every other repository write", async () => {
    h = await createHarness();
    await aiKeySuffix.set("9876");
    const rows = await h.driver.query(
      `SELECT cl.entity_id AS cl_entity_id, cl.op AS cl_op FROM change_log cl
       WHERE cl.entity_type = 'setting' AND cl.entity_id = 'aiKeySuffix'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe("create");
  });

  it("readAiConfig assembles the whole picture, defaults included", async () => {
    h = await createHarness();
    const before = await readAiConfig();
    expect(before.enabled).toBe(false);
    expect(before.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(before.keyState).toBe("unset");
    // The repository's stored default predates the Claude 5 ids, so the config
    // reader is what guarantees a model the provider can actually call.
    expect(before.model).toBe("claude-sonnet-5");

    await settingsRepo.set("aiEnabled", true);
    await settingsRepo.set("aiModel", "claude-opus-5");
    await aiKeySuffix.set("4321");
    await aiKeyState.set("saved");

    const after = await readAiConfig();
    expect(after).toMatchObject({
      enabled: true,
      model: "claude-opus-5",
      keyState: "saved",
      keySuffix: "4321",
    });
  });

  it("an unknown model in the row is replaced by the default, not sent", async () => {
    h = await createHarness();
    await settingsRepo.set("aiModel", "claude-2-retired");
    expect((await readAiConfig()).model).toBe("claude-sonnet-5");
  });

  it("defineExtraSetting works for any key a feature needs next", async () => {
    h = await createHarness();
    const flag = defineExtraSetting("someLaterFlag", z.boolean(), false);
    expect(await flag.get()).toBe(false);
    await flag.set(true);
    expect(await flag.get()).toBe(true);
  });
});
