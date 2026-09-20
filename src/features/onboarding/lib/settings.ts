/**
 * The workspace settings onboarding owns.
 *
 * All nine now live in the typed registry in `src/db/repos/settings.ts`,
 * promoted there in the final integration pass the same way the AI feature's
 * keys were. This file keeps the `KEYS` map because it is the vocabulary the
 * feature's own code reads in, and because a dotted key is easier to get wrong
 * spelled out at every call site than named once here. The reads and writes
 * still go through the repository's key-agnostic `getRaw`/`setRaw`, which is
 * why the promotion needed no change on this side.
 *
 *   onboarding.completedAt  string | null   the flow ran to the end
 *   onboarding.skippedAt    string | null   "Skip for now" was taken
 *   business.name           string          also the workspace name in helix.json
 *   business.trade          string          a TradeId
 *   business.tradeOther     string          what the owner typed under "Something else"
 *   owner.name              string          the person, for mail and text drafts
 *   owner.email             string
 *   owner.phone             string
 *   sample.loadedAt         string | null   the sample set is in the workspace
 *
 * `settingStatement` used to live here too, for the same reason it still
 * exists: the apply and the sample load are each ONE transaction, and
 * `settings.setRaw` takes the write lock, which is not reentrant. It is now
 * `settings.settingStatement` and is re-exported below, so the callers in this
 * feature did not have to move.
 */
import * as settings from "@/db/repos/settings";
import { readRegistry, updateRegistry } from "@/app/appSettings";
import { nowIso } from "@/lib/dates";

export const KEYS = {
  completedAt: "onboarding.completedAt",
  skippedAt: "onboarding.skippedAt",
  businessName: "business.name",
  trade: "business.trade",
  tradeOther: "business.tradeOther",
  ownerName: "owner.name",
  ownerEmail: "owner.email",
  ownerPhone: "owner.phone",
  sampleLoadedAt: "sample.loadedAt",
} as const;

/** A stored value read back as a string, or null when it was never set. */
async function readString(key: string): Promise<string | null> {
  const value = await settings.getRaw(key);
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

/**
 * The repository's upsert as a statement, for a caller inside a transaction.
 * Promoted to `src/db/repos/settings.ts`; re-exported here so this feature's
 * call sites read the same as they always did.
 */
export const settingStatement = settings.settingStatement;

export type OnboardingState = {
  completedAt: string | null;
  skippedAt: string | null;
};

export async function readOnboardingState(): Promise<OnboardingState> {
  const [completedAt, skippedAt] = await Promise.all([
    readString(KEYS.completedAt),
    readString(KEYS.skippedAt),
  ]);
  return { completedAt, skippedAt };
}

export type BusinessProfile = {
  businessName: string;
  trade: string | null;
  tradeOther: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
};

export async function readBusinessProfile(): Promise<BusinessProfile> {
  const [businessName, trade, tradeOther, ownerName, ownerEmail, ownerPhone] =
    await Promise.all([
      readString(KEYS.businessName),
      readString(KEYS.trade),
      readString(KEYS.tradeOther),
      readString(KEYS.ownerName),
      readString(KEYS.ownerEmail),
      readString(KEYS.ownerPhone),
    ]);
  return {
    businessName: businessName ?? "",
    trade,
    tradeOther: tradeOther ?? "",
    ownerName: ownerName ?? "",
    ownerEmail: ownerEmail ?? "",
    ownerPhone: ownerPhone ?? "",
  };
}

/**
 * The name of the business lives in three places, and all three are needed.
 *
 * `business.name` is what onboarding and the mail drafts read. `workspaceName`
 * is the settings row the rest of the product already used. The entry in
 * helix.json is the only one readable while the file is closed, which is what
 * the workspace picker and the window title need. Keeping them in step is one
 * line of work here and a confusing bug anywhere else.
 */
export async function renameWorkspace(name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  const registry = await readRegistry();
  const target =
    registry.workspaces.find((w) => w.id === registry.lastOpened) ??
    registry.workspaces.find((w) => !w.archived) ??
    null;
  if (!target) return;
  await updateRegistry((current) => ({
    ...current,
    workspaces: current.workspaces.map((w) =>
      w.id === target.id ? { ...w, name: trimmed } : w,
    ),
  }));
}

/** What screen 1 puts in the business name box before the owner types. */
export async function readDefaultBusinessName(): Promise<string> {
  const stored = await readString(KEYS.businessName);
  if (stored) return stored;
  const registry = await readRegistry();
  const target =
    registry.workspaces.find((w) => w.id === registry.lastOpened) ??
    registry.workspaces.find((w) => !w.archived) ??
    null;
  if (target && target.name !== "My business") return target.name;
  const fromSettings = await settings.get("workspaceName");
  return fromSettings === "My business" ? "" : fromSettings;
}

/** Screen 1's save. Outside any transaction, so the repository does the work. */
export async function writeBusinessProfile(profile: BusinessProfile): Promise<void> {
  await settings.setRaw(KEYS.businessName, profile.businessName);
  await settings.set("workspaceName", profile.businessName);
  await renameWorkspace(profile.businessName);
  await settings.setRaw(KEYS.trade, profile.trade ?? "other");
  await settings.setRaw(KEYS.tradeOther, profile.tradeOther);
  await settings.setRaw(KEYS.ownerName, profile.ownerName);
  await settings.setRaw(KEYS.ownerEmail, profile.ownerEmail);
  await settings.setRaw(KEYS.ownerPhone, profile.ownerPhone);
}

export async function markSkipped(): Promise<void> {
  await settings.setRaw(KEYS.skippedAt, nowIso());
}

/** Idempotent: the first of screen 2's apply and screen 3's choice wins. */
export async function markCompleted(): Promise<void> {
  const already = await readString(KEYS.completedAt);
  if (already) return;
  await settings.setRaw(KEYS.completedAt, nowIso());
}

export async function readSampleLoadedAt(): Promise<string | null> {
  return readString(KEYS.sampleLoadedAt);
}
