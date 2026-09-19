/**
 * Everything Settings > AI stores, and the single question the three AI
 * buttons ask: "can I run right now, and if not, what do I tell him?"
 *
 * What is stored where:
 *   keychain (Rust)   the API key itself. Never anywhere else.
 *   settings table    aiEnabled, aiModel   (already in the repository registry)
 *                     aiKeySuffix          the last four characters, so the
 *                                          screen can say "saved, ends in 1234"
 *                                          without ever reading the key back
 *                     aiKeyState           unset | saved | rejected
 *                     aiBaseUrl            https://api.anthropic.com, pointed
 *                                          at a local fake by the e2e suite
 *
 * The suffix is the only part of a key that is ever persisted outside the
 * keychain, and it is not enough to authenticate with.
 */
import { z } from "zod";
import * as settingsRepo from "@/db/repos/settings";
import { defineExtraSetting } from "@/features/settings/lib/extraKeys";
import { DEFAULT_MODEL, isKnownModel } from "@/features/ai/lib/models";
import { getSecret, KeychainError } from "@/features/ai/lib/secrets";

export const DEFAULT_BASE_URL = "https://api.anthropic.com";

export const keyStateSchema = z.enum(["unset", "saved", "rejected"]);
export type KeyState = z.infer<typeof keyStateSchema>;

/* Keys the repository registry does not define yet (see STATUS.md). */
export const aiKeySuffix = defineExtraSetting(
  "aiKeySuffix",
  z.string().nullable(),
  null as string | null,
);
export const aiKeyState = defineExtraSetting(
  "aiKeyState",
  keyStateSchema,
  "unset" as KeyState,
);
export const aiBaseUrl = defineExtraSetting(
  "aiBaseUrl",
  z.string(),
  DEFAULT_BASE_URL,
);

/**
 * The last four characters of a key, for "saved, ends in 1234".
 *
 * A key shorter than four characters is not a real key; we still never show
 * more than four, and we never show the prefix, which is the part that
 * identifies the account.
 */
export function maskedSuffix(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(-4);
}

/** "saved, ends in 1234" - the only thing the screen ever says about a key. */
export function describeStoredKey(
  state: KeyState,
  suffix: string | null,
): string {
  if (state === "unset" || !suffix) return "No key saved.";
  if (state === "rejected") {
    return `Saved, ends in ${suffix}. Anthropic rejected it the last time it was used.`;
  }
  return `Saved, ends in ${suffix}.`;
}

export type AiConfig = {
  enabled: boolean;
  model: string;
  baseUrl: string;
  keyState: KeyState;
  keySuffix: string | null;
};

export async function readAiConfig(): Promise<AiConfig> {
  const [enabled, model, baseUrl, keyState, keySuffix] = await Promise.all([
    settingsRepo.get("aiEnabled"),
    settingsRepo.get("aiModel"),
    aiBaseUrl.get(),
    aiKeyState.get(),
    aiKeySuffix.get(),
  ]);
  return {
    enabled,
    model: isKnownModel(model) ? model : DEFAULT_MODEL,
    baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
    keyState,
    keySuffix,
  };
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await settingsRepo.set("aiEnabled", enabled);
}

export async function setModel(model: string): Promise<void> {
  await settingsRepo.set("aiModel", model);
}

export async function recordSavedKey(key: string): Promise<void> {
  await aiKeySuffix.set(maskedSuffix(key));
  await aiKeyState.set("saved");
}

export async function recordRejectedKey(): Promise<void> {
  await aiKeyState.set("rejected");
}

export async function recordAcceptedKey(): Promise<void> {
  await aiKeyState.set("saved");
}

export async function forgetKey(): Promise<void> {
  await aiKeySuffix.set(null);
  await aiKeyState.set("unset");
}

/* -------------------------------------------------------------------------- */
/* the gate every AI button asks                                              */
/* -------------------------------------------------------------------------- */

export type AiReadiness =
  | { ready: true; config: AiConfig }
  | { ready: false; reason: string; config: AiConfig };

/**
 * PLAN.md E1: "When AI is off or the key is missing or rejected, the buttons
 * stay visible but disabled, with a one-line reason and a link to settings."
 * This is that one line, in one place, so all three actions say the same thing.
 */
export async function aiReadiness(workspaceId: string): Promise<AiReadiness> {
  const config = await readAiConfig();

  if (!config.enabled) {
    return { ready: false, reason: "AI is off. Turn it on in Settings.", config };
  }
  if (config.keyState === "rejected") {
    return {
      ready: false,
      reason: "Anthropic rejected your key. Save a new one in Settings.",
      config,
    };
  }

  let key: string | null = null;
  try {
    key = await getSecret(workspaceId, "anthropic");
  } catch (err) {
    if (err instanceof KeychainError) {
      return { ready: false, reason: err.message, config };
    }
    throw err;
  }

  if (!key) {
    return {
      ready: false,
      reason: "No Anthropic key is saved. Add one in Settings.",
      config,
    };
  }
  return { ready: true, config };
}
