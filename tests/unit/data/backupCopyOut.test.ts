/**
 * The second copy of the backups (LR-OPS, F-OPS-2).
 *
 * The rule this file exists to hold: a backup that was written successfully is
 * a backup that succeeded, whatever the copy to the owner's drive did. An
 * unplugged external disk or a signed-out sync folder must not turn a good
 * backup into a red banner that says Helix could not save one - it must say the
 * copy failed, which is a different sentence and a different fix.
 *
 * The copying itself is Rust (`src-tauri/src/backups.rs`, 5 tests): what is
 * copied, what is removed to match the 30 days retention keeps, and that the
 * owner's own files in that folder are never touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const getSetting = vi.fn();
const setSetting = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/db/repos/settings", () => ({
  get: (...a: unknown[]) => getSetting(...a),
  set: (...a: unknown[]) => setSetting(...a),
}));
vi.mock("@/app/boot", () => ({ openWorkspace: vi.fn() }));
vi.mock("@/db/client", () => ({ raw: { backup: vi.fn(), close: vi.fn(), open: vi.fn() } }));
vi.mock("@/db/writeLock", () => ({ pauseTimers: () => () => {} }));
vi.mock("@/app/appSettings", () => ({ readRegistry: vi.fn(), touchWorkspace: vi.fn() }));

import {
  copyOutIfConfigured,
  lastMirrorState,
  resetMirrorStateForTests,
} from "@/features/data/lib/backupsFs";

beforeEach(() => {
  vi.clearAllMocks();
  resetMirrorStateForTests();
});

describe("copyOutIfConfigured", () => {
  it("does nothing, and asks Rust nothing, when no folder has been chosen", async () => {
    getSetting.mockResolvedValue(null);
    expect(await copyOutIfConfigured()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(lastMirrorState().error).toBeNull();
  });

  it("copies to the chosen folder and records what happened", async () => {
    getSetting.mockResolvedValue("/Volumes/Backup");
    invoke.mockResolvedValue({
      path: "/Volumes/Backup/Helix backups/018f",
      copied: 2,
      removed: 1,
      failed: [],
    });

    const result = await copyOutIfConfigured();

    expect(invoke).toHaveBeenCalledWith("backup_mirror", { destDir: "/Volumes/Backup" });
    expect(result?.copied).toBe(2);
    expect(lastMirrorState().error).toBeNull();
    expect(lastMirrorState().result?.removed).toBe(1);
  });

  /** The whole point: an unplugged drive is reported, not thrown. */
  it("records a failure instead of throwing, and names the folder", async () => {
    getSetting.mockResolvedValue("/Volumes/Backup");
    invoke.mockRejectedValue({
      code: "IO_ERROR",
      message: "Helix cannot reach /Volumes/Backup.",
    });

    await expect(copyOutIfConfigured()).resolves.toBeNull();

    const state = lastMirrorState();
    expect(state.error).toContain("/Volumes/Backup");
    expect(state.error).not.toContain("object Object");
  });

  it("reports a partial copy rather than calling it a success", async () => {
    getSetting.mockResolvedValue("/Volumes/Backup");
    invoke.mockResolvedValue({
      path: "/Volumes/Backup/Helix backups/018f",
      copied: 1,
      removed: 0,
      failed: ["2026-09-20T06-00-00Z-scheduled.db: No space left on device"],
    });

    await copyOutIfConfigured();

    expect(lastMirrorState().error).toContain("1 file(s) could not be copied");
  });

  /** A settings read that fails is "no folder chosen", not a crash on every backup. */
  it("treats an unreadable setting as no folder", async () => {
    getSetting.mockRejectedValue(new Error("no database is open"));
    expect(await copyOutIfConfigured()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

/**
 * Found by the test above: `reasonOf` used `String(err)`, and Tauri rejects
 * with a plain object, so every real backup failure told the owner
 * "Helix could not save a backup: [object Object]" (F-OPS-3).
 */
describe("runBackup's failure message", () => {
  it("quotes what Rust said rather than [object Object]", async () => {
    const { raw } = await import("@/db/client");
    vi.mocked(raw.backup).mockRejectedValue({
      code: "BACKUP_FAILED",
      message: "No space left on the disk.",
    });
    const { runBackup } = await import("@/features/data/lib/backupsFs");

    await expect(runBackup("manual")).rejects.toThrow("No space left on the disk.");
  });
});
