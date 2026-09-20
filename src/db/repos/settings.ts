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
import { logWrite, parseOrThrow, type Statement } from "@/db/repos/_base";

const SETTINGS = {
  vocabulary: { schema: z.enum(["deals", "jobs", "quotes"]), default: "deals" },
  currency: { schema: z.string(), default: "USD" },
  locale: { schema: z.string(), default: "en-US" },
  defaultRegion: { schema: z.string(), default: "US" },
  workspaceName: { schema: z.string(), default: "My business" },
  siteOrigin: { schema: z.string().nullable(), default: null },
  aiEnabled: { schema: z.boolean(), default: false },
  aiModel: { schema: z.string(), default: "claude-sonnet-5" },
  // Promoted from src/features/ai/lib/aiSettings.ts's defineExtraSetting escape
  // hatch (docs/STATUS.md, "2026-09-18 — Settings and AI agent", contract
  // change 1). The AI feature still reads/writes them through its own
  // aiKeySuffix/aiKeyState/aiBaseUrl wrappers, which call this repo's
  // getRaw/setRaw - those paths are key-agnostic, so promoting the key here
  // needs no change on the feature side.
  aiKeySuffix: { schema: z.string().nullable(), default: null },
  aiKeyState: { schema: z.enum(["unset", "saved", "rejected"]), default: "unset" },
  aiBaseUrl: { schema: z.string(), default: "https://api.anthropic.com" },
  backupsEnabled: { schema: z.boolean(), default: true },
  // A second folder to copy this workspace's backups into, chosen by the owner
  // through a native folder picker: an external drive, or a folder their
  // Dropbox, iCloud Drive or OneDrive already syncs (LR-OPS, F-OPS-2). Null
  // until they pick one. Backups next to the live database survive a mistake;
  // only a copy somewhere else survives the disk. The copy is the same
  // SQLCipher-encrypted file, and `src-tauri/src/backups.rs` is the only thing
  // that writes it.
  backupCopyDir: { schema: z.string().nullable(), default: null },
  lastDuplicateScanAt: { schema: z.string().nullable(), default: null },
  lastBackupAt: { schema: z.string().nullable(), default: null },
  connectCardDismissed: { schema: z.boolean(), default: false },
  // Promoted from src/features/onboarding/lib/settings.ts (docs/STATUS.md,
  // "2026-09-19 — Onboarding agent", "Two things for other owners" item 1),
  // the same way the AI keys above were. The onboarding feature still reads and
  // writes them through its own readString/writeBusinessProfile wrappers, which
  // call the key-agnostic getRaw/setRaw, so registering them here needs no
  // change on the feature side - it only means `get`, `getAll` and the
  // diagnostics screen now know the key exists and what shape it is.
  //
  // The dots in the names are part of the stored key. They are quoted here
  // because that is what the settings table holds, and renaming them would
  // orphan every row already written.
  "onboarding.completedAt": { schema: z.string().nullable(), default: null },
  "onboarding.skippedAt": { schema: z.string().nullable(), default: null },
  "business.name": { schema: z.string(), default: "" },
  "business.trade": { schema: z.string().nullable(), default: null },
  "business.tradeOther": { schema: z.string(), default: "" },
  "owner.name": { schema: z.string(), default: "" },
  "owner.email": { schema: z.string(), default: "" },
  "owner.phone": { schema: z.string(), default: "" },
  "sample.loadedAt": { schema: z.string().nullable(), default: null },
  // The templates feature's "has this workspace ever been given the four
  // starter templates" flag. It is a settings key rather than a row count so
  // that Trash can purge a deleted starter without the seed putting it back.
  "templates.seededAt": { schema: z.string().nullable(), default: null },
  // What goes on a quote or an invoice, and how they are numbered (D20). The
  // catalog agent registers them here so the invoices agent finds them typed
  // rather than reaching for getRaw/setRaw; the dots are part of the stored key,
  // the same way the business.* keys above are.
  //
  // A tax rate in basis points (1% = 100) keeps an 8.25% rate an integer, so no
  // float ever touches money. The default is 0: most of the trades this is for
  // do not charge tax on labour, and a wrong number on an invoice is worse than
  // no number.
  "business.address": { schema: z.string(), default: "" },
  "business.taxId": { schema: z.string(), default: "" },
  "business.paymentInstructions": { schema: z.string(), default: "" },
  "invoices.prefix": { schema: z.string(), default: "INV" },
  "quotes.prefix": { schema: z.string(), default: "QUO" },
  "invoices.taxRateBp": { schema: z.number().int().min(0).max(100_000), default: 0 },
  "invoices.dueDays": { schema: z.number().int().min(0).max(365), default: 14 },
  // The Contacts list's own display preferences. Not saved-view state — a
  // saved view is a named, explicitly-saved filter set, and these two persist
  // automatically as soon as the owner touches them, workspace-wide.
  "contacts.showAs": { schema: z.enum(["name", "company"]), default: "name" },
  "contacts.hideUnnamed": { schema: z.boolean(), default: false },
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

/**
 * The upsert above as a statement, for a caller that is already inside a
 * transaction.
 *
 * `set`/`setRaw` take the write lock, and the write lock is not reentrant: a
 * repository write from inside a transaction that already holds it would wait
 * for itself. Onboarding's "Use this setup" and the sample-data load are each
 * ONE transaction that has to write a settings row, so the row is built as a
 * statement and folded into the same batch as everything else.
 *
 * Promoted from src/features/onboarding/lib/settings.ts, which is where it was
 * first written. It is deliberately the same SQL as `upsert` - if one changes,
 * both change.
 *
 * It does NOT log a change_log entry, because a caller inside a batch builds
 * its own with `changeLogStatement` and knows the batch id. `setRaw` logs;
 * this does not.
 */
export function settingStatement(key: string, value: unknown): Statement {
  return {
    sql: `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    params: [key, JSON.stringify(value), nowIso()],
  };
}
