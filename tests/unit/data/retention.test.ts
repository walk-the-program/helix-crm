/**
 * Pure policy tests for src/features/data/lib/retention.ts. Every "now" is a
 * fixed Date, never Date.now(), so these never flake with the clock.
 *
 * TZ is pinned to UTC so "one per local day" grouping is deterministic
 * regardless of the machine running the suite.
 */
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import {
  BACKUP_INTERVAL_MS,
  BACKUP_MIN_GAP_MS,
  formatBytes,
  msUntilNextBackup,
  parseBackupName,
  planRetention,
  shouldBackupOnBoot,
  totalBytes,
  type BackupFile,
} from "@/features/data/lib/retention";

const NOW = new Date("2026-09-18T12:00:00Z");

function file(at: string, reason = "scheduled", bytes = 1000, name?: string): BackupFile {
  const fname = name ?? `${at.replace(/:/g, "-")}-${reason}.db`;
  return { name: fname, path: `/workspaces/w1/backups/${fname}`, at, reason, bytes };
}

describe("parseBackupName", () => {
  it("parses a real backup name", () => {
    expect(parseBackupName("2026-09-18T19-05-03Z-manual.db")).toEqual({
      at: "2026-09-18T19:05:03Z",
      reason: "manual",
    });
  });

  it("tolerates a same-second collision suffix", () => {
    expect(parseBackupName("2026-09-18T19-05-03Z-manual-2.db")).toEqual({
      at: "2026-09-18T19:05:03Z",
      reason: "manual",
    });
  });

  it("parses a slugged multi-word reason", () => {
    expect(parseBackupName("2026-09-18T19-05-03Z-pre-restore.db")).toEqual({
      at: "2026-09-18T19:05:03Z",
      reason: "pre-restore",
    });
  });

  it("returns null for a non-backup file", () => {
    expect(parseBackupName("helix.db")).toBeNull();
    expect(parseBackupName("notes.txt")).toBeNull();
    expect(parseBackupName("2026-09-18T19-05-03Z-manual.db.tmp")).toBeNull();
  });
});

describe("planRetention", () => {
  it("keeps everything inside the last 24 hours", () => {
    const files = [
      file("2026-09-18T11:59:00Z"), // 1 minute ago
      file("2026-09-18T00:00:01Z"), // ~12 hours ago
      file("2026-09-17T12:00:01Z"), // just inside 24h
    ];
    const { keep, drop } = planRetention(files, NOW);
    expect(keep).toHaveLength(3);
    expect(drop).toHaveLength(0);
  });

  it("collapses older days to the newest of that day", () => {
    const olderMorning = file("2026-09-15T08:00:00Z");
    const olderEvening = file("2026-09-15T20:00:00Z");
    const anotherDay = file("2026-09-10T09:00:00Z");
    const { keep, drop } = planRetention([olderMorning, olderEvening, anotherDay], NOW);

    expect(keep).toContainEqual(olderEvening);
    expect(keep).toContainEqual(anotherDay);
    expect(keep).toHaveLength(2);
    expect(drop).toEqual([olderMorning]);
  });

  it("drops everything past 30 days", () => {
    const recent = file("2026-09-18T00:00:00Z");
    const tooOld = file("2026-08-10T00:00:00Z"); // ~39 days before NOW
    const { keep, drop } = planRetention([recent, tooOld], NOW);

    expect(keep).toEqual([recent]);
    expect(drop).toEqual([tooOld]);
  });

  it("keeps the newest file even when it is ancient", () => {
    const ancient = file("2025-01-01T00:00:00Z");
    const { keep, drop } = planRetention([ancient], NOW);

    expect(keep).toEqual([ancient]);
    expect(drop).toHaveLength(0);
  });

  it("is stable on an empty list", () => {
    expect(planRetention([], NOW)).toEqual({ keep: [], drop: [] });
  });
});

describe("shouldBackupOnBoot", () => {
  it("is true when there is no prior backup", () => {
    expect(shouldBackupOnBoot(null, NOW)).toBe(true);
  });

  it("is true when the last backup was 2 hours ago", () => {
    expect(shouldBackupOnBoot("2026-09-18T10:00:00Z", NOW)).toBe(true);
  });

  it("is false when the last backup was 10 minutes ago", () => {
    expect(shouldBackupOnBoot("2026-09-18T11:50:00Z", NOW)).toBe(false);
  });

  it("agrees with the exported 1-hour gap constant", () => {
    expect(BACKUP_MIN_GAP_MS).toBe(60 * 60 * 1000);
    const exactlyOneHourAgo = new Date(NOW.getTime() - BACKUP_MIN_GAP_MS).toISOString();
    expect(shouldBackupOnBoot(exactlyOneHourAgo, NOW)).toBe(true);
  });
});

describe("msUntilNextBackup", () => {
  it("is clamped at 0 once the interval has passed", () => {
    expect(msUntilNextBackup("2026-09-18T05:00:00Z", NOW)).toBe(0); // 7 hours ago
  });

  it("is correct mid-window", () => {
    // 3 hours ago, 6-hour interval -> 3 hours remain.
    expect(msUntilNextBackup("2026-09-18T09:00:00Z", NOW)).toBe(3 * 60 * 60 * 1000);
  });

  it("is 0 when there is no prior backup", () => {
    expect(msUntilNextBackup(null, NOW)).toBe(0);
  });

  it("agrees with the exported 6-hour interval constant", () => {
    expect(BACKUP_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe("totalBytes", () => {
  it("sums the bytes of every file", () => {
    const files = [file("2026-09-18T00:00:00Z", "a", 100), file("2026-09-17T00:00:00Z", "b", 250)];
    expect(totalBytes(files)).toBe(350);
  });

  it("is 0 for an empty list", () => {
    expect(totalBytes([])).toBe(0);
  });
});

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats plain bytes with no decimals", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats kilobytes with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatBytes(1468006)).toBe("1.4 MB");
  });
});
