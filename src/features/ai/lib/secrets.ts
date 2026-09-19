/**
 * The keychain, through the Rust commands in docs/CONTRACTS.md.
 *
 *   secret_set(workspaceId, kind, value)   keyring service "helix",
 *   secret_get(workspaceId, kind)          user "<workspaceId>:<kind>"
 *   secret_delete(workspaceId, kind)
 *
 * A key never reaches SQLite, helix.json, a log line or a React state value
 * that outlives the save. `setSecret` is the only place the plaintext key is
 * held, and only for the length of the call.
 *
 * KeychainError (PLAN.md's rescue map) is what a caller sees when the store is
 * unavailable: "Can't save the key securely on this machine." No plaintext
 * fallback, ever - AI and site polling simply stay off.
 */
export type SecretKind = "anthropic" | "site";

export class KeychainError extends Error {
  readonly code = "SECRET_ERROR";
  /** The underlying message, for Diagnostics. Never the secret itself. */
  readonly detail: string;
  constructor(detail: string) {
    super("Can't save the key securely on this machine.");
    this.name = "KeychainError";
    this.detail = detail;
  }
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new KeychainError("There is no keychain outside the desktop app.");
  }
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

function asDetail(err: unknown): string {
  if (err instanceof KeychainError) return err.detail;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return err instanceof Error ? err.message : String(err);
}

export async function setSecret(
  workspaceId: string,
  kind: SecretKind,
  value: string,
): Promise<void> {
  try {
    await invoke<void>("secret_set", { workspaceId, kind, value });
  } catch (err) {
    throw new KeychainError(asDetail(err));
  }
}

/** null when nothing is stored. Throws KeychainError when the store is broken. */
export async function getSecret(
  workspaceId: string,
  kind: SecretKind,
): Promise<string | null> {
  try {
    const result = await invoke<{ value: string | null }>("secret_get", {
      workspaceId,
      kind,
    });
    return result?.value ?? null;
  } catch (err) {
    throw new KeychainError(asDetail(err));
  }
}

/** Deleting something that is not there succeeds, per the Rust contract. */
export async function deleteSecret(
  workspaceId: string,
  kind: SecretKind,
): Promise<void> {
  try {
    await invoke<void>("secret_delete", { workspaceId, kind });
  } catch (err) {
    throw new KeychainError(asDetail(err));
  }
}

/** True when the keychain answers at all, for the Diagnostics row. */
export async function keychainAvailable(workspaceId: string): Promise<boolean> {
  try {
    await getSecret(workspaceId, "anthropic");
    return true;
  } catch {
    return false;
  }
}
