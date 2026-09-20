/**
 * A prune must not delete the file a restore is reading (LR-OPS, F-OPS-6).
 *
 * Found by LR-OPS-W2 while proving the timer guards. `restoreFromBackup` calls
 * `pauseTimers()`, but that only stops a NEW scheduler tick from starting: a
 * tick that passed its own `timersPaused()` check a moment earlier runs to the
 * end, and the end is `pruneBackups()`. If the backup the owner picked is the
 * oldest one past the retention window - which is exactly the one somebody
 * reaches for after a bad week - it can be deleted while the restore is copying
 * from it.
 *
 * Rust's `backup_guard` already serialises `db_backup` against `db_close`, so
 * the database file itself was never at risk. Nothing coordinated the two
 * pieces of JS that touch the backups FOLDER. The flag in `backupsFs.ts` does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const removePath = vi.fn();
const copyFileTo = vi.fn();
const readDirEntries = vi.fn();
const close = vi.fn();
const open = vi.fn();
const backup = vi.fn();

vi.mock("@/db/client", () => ({
  raw: {
    backup: (...a: unknown[]) => backup(...a),
    close: (...a: unknown[]) => close(...a),
    open: (...a: unknown[]) => open(...a),
  },
}));
vi.mock("@/db/writeLock", () => ({ pauseTimers: () => () => {} }));
vi.mock("@/app/boot", () => ({ openWorkspace: vi.fn() }));
vi.mock("@/app/appSettings", () => ({
  readRegistry: async () => ({ workspaces: [{ id: "ws", path: "/w/helix.db" }] }),
  touchWorkspace: vi.fn(),
}));
vi.mock("@/db/repos/settings", () => ({ get: async () => null, set: vi.fn() }));
vi.mock("@/features/data/lib/workspace", () => ({
  workspacePaths: async () => ({
    workspaceId: "ws",
    dbPath: "/w/helix.db",
    dir: "/w",
    backupsDir: "/w/backups",
    attachmentsDir: "/w/attachments",
    documentsDir: "/w/documents",
  }),
}));
vi.mock("@/features/data/lib/fsBridge", async () => {
  const actual = await vi.importActual<typeof import("@/features/data/lib/fsBridge")>(
    "@/features/data/lib/fsBridge",
  );
  return {
    ...actual,
    readDirEntries: (...a: unknown[]) => readDirEntries(...a),
    fileSize: async () => 1024,
    copyFileTo: (...a: unknown[]) => copyFileTo(...a),
    removePath: (...a: unknown[]) => removePath(...a),
  };
});

import {
  pruneBackups,
  resetRestoreStateForTests,
  restoreFromBackup,
  type BackupFile,
} from "@/features/data/lib/backupsFs";

/** One backup from today and one from three months ago: retention drops the old one. */
const OLD = "2026-06-01T02-00-00Z-scheduled.db";
const NEW = "2026-09-20T02-00-00Z-scheduled.db";

const oldFile: BackupFile = {
  name: OLD,
  path: `/w/backups/${OLD}`,
  at: "2026-06-01T02:00:00Z",
  reason: "scheduled",
  bytes: 1024,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetRestoreStateForTests();
  readDirEntries.mockResolvedValue([
    { name: OLD, isFile: true },
    { name: NEW, isFile: true },
  ]);
  backup.mockResolvedValue("/w/backups/2026-09-20T12-00-00Z-pre-restore.db");
  close.mockResolvedValue(undefined);
  open.mockResolvedValue(undefined);
  copyFileTo.mockResolvedValue(undefined);
});

describe("pruneBackups during a restore", () => {
  it("normally deletes what retention has dropped", async () => {
    const result = await pruneBackups(new Date("2026-09-20T12:00:00Z"));
    expect(result.deleted).toBe(1);
    expect(removePath).toHaveBeenCalledWith(`/w/backups/${OLD}`);
  });

  /** The whole point: the file being restored is the one retention would drop. */
  it("deletes nothing while a restore is copying from the folder", async () => {
    // Hold the restore open at the close step, the way a real close waits for
    // an in-flight backup on the Rust side.
    let releaseClose: () => void = () => {};
    close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = () => resolve();
        }),
    );

    const restore = restoreFromBackup(oldFile);
    // Let restoreFromBackup reach the close.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const result = await pruneBackups(new Date("2026-09-20T12:00:00Z"));
    expect(result.deleted).toBe(0);
    expect(removePath).not.toHaveBeenCalled();

    releaseClose();
    await restore;
  });

  it("prunes again once the restore has finished", async () => {
    await restoreFromBackup(oldFile);
    removePath.mockClear();

    const result = await pruneBackups(new Date("2026-09-20T12:00:00Z"));
    expect(result.deleted).toBe(1);
  });

  /** A restore that throws must not leave pruning switched off for the session. */
  it("prunes again after a restore that failed", async () => {
    copyFileTo.mockRejectedValueOnce(new Error("the drive went away"));
    await expect(restoreFromBackup(oldFile)).rejects.toThrow("the drive went away");

    const result = await pruneBackups(new Date("2026-09-20T12:00:00Z"));
    expect(result.deleted).toBe(1);
  });
});
