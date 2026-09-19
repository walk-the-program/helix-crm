/**
 * The three AI settings keys promoted from `defineExtraSetting` into the
 * repository's own registry (docs/STATUS.md, "2026-09-18 — Settings and AI
 * agent", "Contract changes needed" item 1): `aiKeySuffix`, `aiKeyState` and
 * `aiBaseUrl`. They now go through the typed `get`/`set`/`getAll`, the same
 * path as `aiEnabled` and `aiModel`, instead of the unvalidated `getRaw`/
 * `setRaw` escape hatch. `src/features/ai/lib/aiSettings.ts`'s own
 * `defineExtraSetting` wrappers keep working unchanged, since `getRaw`/
 * `setRaw` are key-agnostic - see `tests/repo/settings/extraKeys.test.ts` for
 * that side.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import * as settingsRepo from "../../../src/db/repos/settings";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("the promoted AI settings keys", () => {
  it("default before anything is written", async () => {
    h = await createHarness();
    expect(await settingsRepo.get("aiKeySuffix")).toBeNull();
    expect(await settingsRepo.get("aiKeyState")).toBe("unset");
    expect(await settingsRepo.get("aiBaseUrl")).toBe("https://api.anthropic.com");
  });

  it("round-trips through set/get", async () => {
    h = await createHarness();
    await settingsRepo.set("aiKeySuffix", "1234");
    await settingsRepo.set("aiKeyState", "saved");
    await settingsRepo.set("aiBaseUrl", "http://127.0.0.1:4795");

    expect(await settingsRepo.get("aiKeySuffix")).toBe("1234");
    expect(await settingsRepo.get("aiKeyState")).toBe("saved");
    expect(await settingsRepo.get("aiBaseUrl")).toBe("http://127.0.0.1:4795");
  });

  it("falls back to the default when the stored row is corrupted", async () => {
    h = await createHarness();
    // setRaw bypasses validation entirely, same as a hand-edited row would.
    await settingsRepo.setRaw("aiKeySuffix", 42);
    await settingsRepo.setRaw("aiKeyState", { not: "a state" });
    await settingsRepo.setRaw("aiBaseUrl", null);

    expect(await settingsRepo.get("aiKeySuffix")).toBeNull();
    expect(await settingsRepo.get("aiKeyState")).toBe("unset");
    expect(await settingsRepo.get("aiBaseUrl")).toBe("https://api.anthropic.com");
  });

  it("set() rejects a value outside the aiKeyState enum", async () => {
    h = await createHarness();
    await expect(
      settingsRepo.set(
        "aiKeyState",
        // @ts-expect-error - deliberately invalid, exercising runtime validation
        "expired",
      ),
    ).rejects.toThrow();
  });

  it("getAll() includes all three, alongside the existing keys", async () => {
    h = await createHarness();
    await settingsRepo.set("aiKeySuffix", "9876");
    await settingsRepo.set("aiKeyState", "rejected");
    await settingsRepo.set("aiBaseUrl", "https://example.test");

    const all = await settingsRepo.getAll();
    expect(all.aiKeySuffix).toBe("9876");
    expect(all.aiKeyState).toBe("rejected");
    expect(all.aiBaseUrl).toBe("https://example.test");
    // Still there alongside the pre-existing keys this feature didn't touch.
    expect(all.aiEnabled).toBe(false);
    expect(all.aiModel).toBe("claude-sonnet-5");
  });
});
