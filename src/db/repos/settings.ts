/**
 * Typed workspace settings over the `settings(key, value_json)` table.
 *
 * The registry below is the single source of truth for every known key's
 * shape and default. `get` never throws on missing or corrupted stored data -
 * it falls back to the default - because a bad settings row must never brick
 * the app. `getRaw`/`setRaw` exist for keys a feature agent adds outside the
 * registry; they skip validation entirely.
 */
import { z } from "zod";
import { raw } from "@/db/client";
import { withWrite } from "@/db/writeLock";
import { nowIso } from "@/lib/dates";
import { logWrite, parseOrThrow } from "@/db/repos/_base";

const SETTINGS = {
  vocabulary: { schema: z.enum(["deals", "jobs", "quotes"]), default: "deals" },
  currency: { schema: z.string(), default: "USD" },
  locale: { schema: z.string(), default: "en-US" },
  defaultRegion: { schema: z.string(), default: "US" },
  workspaceName: { schema: z.string(), default: "My business" },
  siteOrigin: { schema: z.string().nullable(), default: null },
  aiEnabled: { schema: z.boolean(), default: false },
  aiModel: { schema: z.string(), default: "claude-sonnet-4-5" },
  backupsEnabled: { schema: z.boolean(), default: true },
  lastDuplicateScanAt: { schema: z.string().nullable(), default: null },
  lastBackupAt: { schema: z.string().nullable(), default: null },
  connectCardDismissed: { schema: z.boolean(), default: false },
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export const VOCABULARY_KEY: SettingKey = "vocabulary";

function defaultFor<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS[key].default as SettingValue<K>;
}

async function readRawRow(key: string): Promise<unknown> {
  const rows = await raw.query(
    `SELECT s.value_json AS s_value_json FROM settings s WHERE s.key = ?`,
    [key],
  );
  if (rows.length === 0) return undefined;
  const json = rows[0][0];
  if (typeof json !== "string") return undefined;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

/** The default when the row is absent or the stored JSON fails validation. */
export async function get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const value = await readRawRow(key);
  if (value === undefined) return defaultFor(key);
  const result = SETTINGS[key].schema.safeParse(value);
  return result.success ? (result.data as SettingValue<K>) : defaultFor(key);
}

/** Every known setting, each resolved the same way as `get`. */
export async function getAll(): Promise<{ [K in SettingKey]: SettingValue<K> }> {
  const keys = Object.keys(SETTINGS) as SettingKey[];
  const entries = await Promise.all(keys.map(async (key) => [key, await get(key)] as const));
  return Object.fromEntries(entries) as { [K in SettingKey]: SettingValue<K> };
}

/** Raw stored value for a key outside the registry (or inside it, unvalidated). */
export async function getRaw(key: string): Promise<unknown> {
  return readRawRow(key);
}

async function upsert(
  key: string,
  value: unknown,
  options: { batchId?: string },
): Promise<void> {
  await withWrite(async () => {
    const before = await readRawRow(key);
    const at = nowIso();
    const json = JSON.stringify(value);
    await raw.execute(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [key, json, at],
    );
    await logWrite(
      "setting",
      key,
      before === undefined ? "create" : "update",
      before ?? null,
      value,
      options.batchId,
    );
  }, "Saving a setting");
}

/** Validates against the registry, upserts, and logs one change_log entry. */
export async function set<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  options: { batchId?: string } = {},
): Promise<void> {
  const parsed: unknown = parseOrThrow(SETTINGS[key].schema, value);
  await upsert(key, parsed, options);
}

/** For keys outside the registry: no validation, same upsert-and-log path. */
export async function setRaw(
  key: string,
  value: unknown,
  options: { batchId?: string } = {},
): Promise<void> {
  await upsert(key, value, options);
}
