/**
 * The sidebar's width and collapsed state in helix.json (round 3, criterion 7)
 * and the live-registry bus the footer reads (criterion 8).
 *
 * Outside Tauri, `appSettings` keeps helix.json in memory, which is the same
 * seam the e2e build runs on — so this exercises the real read/write path,
 * not a mock of it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_REGISTRY,
  readRegistry,
  registrySchema,
  resetRegistryCache,
  setSidebar,
  sidebarSchema,
  subscribeToRegistry,
  updateRegistry,
  writeRegistry,
} from "@/app/appSettings";

beforeEach(async () => {
  resetRegistryCache();
  await writeRegistry({ ...EMPTY_REGISTRY, sidebar: { width: 240, collapsed: false } });
});

describe("sidebarSchema", () => {
  it("clamps a hand-edited width instead of trusting it", () => {
    // A 4px sidebar has no handle to grab, so a bad file must not be able to
    // produce one. Zod's `.catch` turns an out-of-range number into the
    // default rather than throwing the whole registry away.
    expect(sidebarSchema.parse({ width: 12, collapsed: false }).width).toBe(240);
    expect(sidebarSchema.parse({ width: 9000, collapsed: false }).width).toBe(240);
    expect(sidebarSchema.parse({ width: 300, collapsed: true })).toEqual({
      width: 300,
      collapsed: true,
    });
  });

  it("fills itself in for a helix.json written by an older build", () => {
    const old = {
      workspaces: [],
      lastOpened: null,
      theme: "dark",
      density: "compact",
    };
    const parsed = registrySchema.parse(old);
    expect(parsed.sidebar).toEqual({ width: 240, collapsed: false });
    // And nothing else about the old file is lost.
    expect(parsed.theme).toBe("dark");
    expect(parsed.density).toBe("compact");
  });

  it("survives a garbled sidebar block rather than resetting the whole file", () => {
    const parsed = registrySchema.parse({
      workspaces: [],
      lastOpened: null,
      theme: "light",
      density: "comfortable",
      sidebar: "not an object",
    });
    expect(parsed.sidebar).toEqual({ width: 240, collapsed: false });
    expect(parsed.theme).toBe("light");
  });
});

describe("setSidebar", () => {
  it("writes the width and reads it back from the file, not from memory", async () => {
    await setSidebar({ width: 312 });
    resetRegistryCache();
    expect((await readRegistry()).sidebar.width).toBe(312);
  });

  it("patches one key without disturbing the other", async () => {
    await setSidebar({ width: 300 });
    await setSidebar({ collapsed: true });
    const registry = await readRegistry();
    expect(registry.sidebar).toEqual({ width: 300, collapsed: true });
  });

  it("keeps the chosen width while collapsed, so expanding restores it", async () => {
    await setSidebar({ width: 340 });
    await setSidebar({ collapsed: true });
    await setSidebar({ collapsed: false });
    expect((await readRegistry()).sidebar.width).toBe(340);
  });

  it("refuses to persist a width outside the bounds", async () => {
    await setSidebar({ width: 1000 });
    expect((await readRegistry()).sidebar.width).toBe(240);
  });
});

describe("subscribeToRegistry", () => {
  it("tells a listener about every write, with the new registry", async () => {
    const seen = vi.fn();
    const unsubscribe = subscribeToRegistry(seen);

    await updateRegistry((current) => ({
      ...current,
      workspaces: [
        {
          id: "w1",
          name: "Okafor Roofing",
          path: "/tmp/w1.db",
          lastPolledAt: null,
          lastBackupAt: null,
          archived: false,
        },
      ],
    }));

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].workspaces[0].name).toBe("Okafor Roofing");

    // This is criterion 8 in miniature: a rename is just another write, and
    // the footer hears about it without anyone threading a setter down.
    await updateRegistry((current) => ({
      ...current,
      workspaces: current.workspaces.map((w) => ({ ...w, name: "Okafor Roofing Ltd" })),
    }));
    expect(seen.mock.calls[1][0].workspaces[0].name).toBe("Okafor Roofing Ltd");

    unsubscribe();
    await setSidebar({ width: 260 });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("a listener that throws does not break the write that told it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsubscribe = subscribeToRegistry(() => {
      throw new Error("listener blew up");
    });
    const quiet = vi.fn();
    const unsubscribeQuiet = subscribeToRegistry(quiet);

    await expect(setSidebar({ width: 280 })).resolves.toBeTruthy();
    expect((await readRegistry()).sidebar.width).toBe(280);
    // The other listener still heard it.
    expect(quiet).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribeQuiet();
    error.mockRestore();
  });
});
