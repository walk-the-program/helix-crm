/**
 * Backup retention policy and scheduling maths (docs/PLAN.md item 17).
 *
 * PURE: no imports from @/db, no Tauri, no side effects, no wall-clock reads.
 * Every function takes `now` (or a `Date`) explicitly so it is exercised
 * deterministically in tests/unit/data/retention.test.ts.
 *
 * File name format (docs/CONTRACTS.md "Clarifications made during the
 * build"): `<ISO date>T<HH-MM-SS>Z-<reason>.db`, i.e. dashes in the time part
 * because Windows rejects `:`, with the reason already slugged by the Rust
 * side. A same-second collision gets a trailing `-<n>` (e.g. `-2`) before the
 * extension; retention treats that file exactly like the reason it collided
 * with, so parseBackupName strips a trailing numeric segment rather than
 * reporting it as part of the reason.
 */

export type BackupFile = {
  name: string;
  path: string;
  at: string;
  reason: string;
  bytes: number;
};

const BACKUP_NAME_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-(.+)\.db$/;

/**
 * "2026-09-18T19-05-03Z-manual.db" -> { at: "2026-09-18T19:05:03Z", reason: "manual" }.
 * Tolerates a "-2" (or "-<n>") same-second collision suffix on the reason,
 * and any slugged, possibly multi-word reason. Returns null for anything that
 * is not a backup file name (a live database file, an unrelated file, or an
 * in-progress `.db.tmp` write).
 */
export function parseBackupName(name: string): { at: string; reason: string } | null {
  const match = BACKUP_NAME_RE.exec(name);
  if (!match) return null;

  const [, date, hh, mm, ss, rawReason] = match;
  // Strip a trailing "-<digits>" collision suffix (e.g. "manual-2" -> "manual"),
  // but never strip the whole thing away if the reason was only digits.
  const withoutCollision = rawReason.replace(/-\d+$/, "");
  const reason = withoutCollision.length > 0 ? withoutCollision : rawReason;
  if (reason.length === 0) return null;

  return { at: `${date}T${hh}:${mm}:${ss}Z`, reason };
}

/** Every backup from the last 24 hours is always kept. */
const KEEP_ALL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Backups older than this collapse to nothing (except the newest overall). */
const RETENTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Local calendar day key ("2026-09-18") for grouping the day-collapse window. */
function localDayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * PLAN item 17: keep every backup from the last 24 hours, then one per day
 * (the newest of each local day) for 30 days, and drop the rest. The single
 * newest backup is always kept, even if it is older than 30 days (e.g. a
 * workspace that has been closed for a month).
 */
export function planRetention(
  files: BackupFile[],
  now: Date,
): { keep: BackupFile[]; drop: BackupFile[] } {
  if (files.length === 0) return { keep: [], drop: [] };

  const nowMs = now.getTime();
  const cutoff24 = nowMs - KEEP_ALL_WINDOW_MS;
  const cutoff30 = nowMs - RETENTION_WINDOW_MS;

  const timed = files
    .map((file) => ({ file, t: Date.parse(file.at) }))
    .filter((x) => !Number.isNaN(x.t));

  // Unparseable names should never disappear silently: keep them all.
  const unparseable = files.filter((file) => Number.isNaN(Date.parse(file.at)));

  if (timed.length === 0) {
    return { keep: [...unparseable], drop: [] };
  }

  let newest = timed[0];
  for (const x of timed) if (x.t > newest.t) newest = x;

  const keep = new Set<BackupFile>();
  const dayBest = new Map<string, { file: BackupFile; t: number }>();

  for (const x of timed) {
    if (x.t >= cutoff24) {
      keep.add(x.file);
      continue;
    }
    if (x.t >= cutoff30) {
      const key = localDayKey(x.t);
      const current = dayBest.get(key);
      if (!current || x.t > current.t) dayBest.set(key, x);
    }
    // else: past the 30-day window; dropped unless it turns out to be `newest`.
  }

  for (const best of dayBest.values()) keep.add(best.file);
  keep.add(newest.file);
  for (const file of unparseable) keep.add(file);

  const byTimeDesc = (a: BackupFile, b: BackupFile) => Date.parse(b.at) - Date.parse(a.at);
  const keepList = files.filter((f) => keep.has(f)).sort(byTimeDesc);
  const dropList = files.filter((f) => !keep.has(f)).sort(byTimeDesc);

  return { keep: keepList, drop: dropList };
}

/** Never back up more than once inside this window (used to skip the boot backup). */
export const BACKUP_MIN_GAP_MS = 60 * 60 * 1000; // 1 hour

/** The steady-state interval between automatic backups while the app is open. */
export const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** On boot, after first paint: back up unless one ran in the last hour. */
export function shouldBackupOnBoot(lastBackupAt: string | null, now: Date): boolean {
  if (!lastBackupAt) return true;
  const last = Date.parse(lastBackupAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= BACKUP_MIN_GAP_MS;
}

/** Milliseconds until the next scheduled backup, given the last one. Never negative. */
export function msUntilNextBackup(lastBackupAt: string | null, now: Date): number {
  if (!lastBackupAt) return 0;
  const last = Date.parse(lastBackupAt);
  if (Number.isNaN(last)) return 0;
  return Math.max(0, last + BACKUP_INTERVAL_MS - now.getTime());
}

export function totalBytes(files: BackupFile[]): number {
  return files.reduce((sum, f) => sum + f.bytes, 0);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** "1.4 MB" - tabular-friendly (fixed decimals per unit) for a right-aligned column. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${BYTE_UNITS[unitIndex]}`;
}
