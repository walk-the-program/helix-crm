/**
 * The site connection: the origin (workspace settings, in SQLite) and the
 * token (the OS keychain, through `secret_set` / `secret_get` /
 * `secret_delete`, never in SQLite and never in helix.json).
 *
 * The origin rule here is the same one `src-tauri/src/leads.rs::validate_origin`
 * enforces, restated in the UI so the owner gets the message before the
 * round trip rather than after it: HTTPS anywhere, plain HTTP only on
 * loopback, which is how `tools/fake-site` is reached in development.
 */
import * as settings from "@/db/repos/settings";
import { readRegistry } from "@/app/appSettings";
import { normaliseOrigin } from "@/features/leads/lib/leadMapping";

export const SITE_SECRET_KIND = "site";

export type OriginCheck =
  | { ok: true; origin: string }
  | { ok: false; message: string };

/** Mirrors validate_origin in Rust. Trailing slashes are trimmed. */
export function checkOrigin(input: string): OriginCheck {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return { ok: false, message: "Enter your website address." };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      message: `"${trimmed}" is not a web address. It should look like https://yourbusiness.com.`,
    };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return {
      ok: false,
      message: "Use just the address of the site, with no page after it.",
    };
  }
  if (url.protocol === "https:") {
    return url.hostname.length > 0
      ? { ok: true, origin: trimmed }
      : { ok: false, message: "That address has no website name in it." };
  }
  if (url.protocol === "http:") {
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return { ok: true, origin: trimmed };
    }
    return {
      ok: false,
      message:
        "The address has to start with https://. Plain http:// only works for a test site on this computer.",
    };
  }
  return { ok: false, message: "The address has to start with https://." };
}

/** The workspace whose keychain entry and database are open right now. */
export async function currentWorkspaceId(): Promise<string | null> {
  const registry = await readRegistry();
  return registry.lastOpened ?? registry.workspaces[0]?.id ?? null;
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * The keychain, behind an interface.
 *
 * In the app and under the Playwright harness this is the three `secret_*`
 * commands. The Node integration test has no Tauri runtime at all, so it
 * installs an in-memory store instead - the same seam `setLeadsFetch` gives
 * the poller for the HTTP half.
 */
export type SecretStore = {
  set(workspaceId: string, value: string): Promise<void>;
  get(workspaceId: string): Promise<string | null>;
  delete(workspaceId: string): Promise<void>;
};

export const tauriSecretStore: SecretStore = {
  async set(workspaceId, value) {
    const core = await import("@tauri-apps/api/core");
    await (core.invoke as InvokeFn)<void>("secret_set", {
      workspaceId,
      kind: SITE_SECRET_KIND,
      value,
    });
  },
  async get(workspaceId) {
    const core = await import("@tauri-apps/api/core");
    const result = await (core.invoke as InvokeFn)<{ value: string | null }>(
      "secret_get",
      { workspaceId, kind: SITE_SECRET_KIND },
    );
    return result?.value ?? null;
  },
  async delete(workspaceId) {
    const core = await import("@tauri-apps/api/core");
    await (core.invoke as InvokeFn)<void>("secret_delete", {
      workspaceId,
      kind: SITE_SECRET_KIND,
    });
  },
};

let secretStore: SecretStore = tauriSecretStore;

export function setSecretStore(store: SecretStore): void {
  secretStore = store;
}

/** Store the token in the OS keychain. The value never touches SQLite. */
export async function setSiteToken(value: string): Promise<void> {
  const workspaceId = await currentWorkspaceId();
  if (!workspaceId) throw new Error("No workspace is open.");
  await secretStore.set(workspaceId, value);
}

/** True when a token is stored. The value itself is never shown in the UI. */
export async function hasSiteToken(): Promise<boolean> {
  const workspaceId = await currentWorkspaceId();
  if (!workspaceId) return false;
  try {
    const value = await secretStore.get(workspaceId);
    return typeof value === "string" && value.length > 0;
  } catch {
    // KeychainError: the machine cannot store secrets. Treated as "no token",
    // which keeps polling off rather than failing on every tick.
    return false;
  }
}

export async function deleteSiteToken(): Promise<void> {
  const workspaceId = await currentWorkspaceId();
  if (!workspaceId) return;
  await secretStore.delete(workspaceId);
}

export type SiteConnection = {
  siteOrigin: string | null;
  hasToken: boolean;
  /** Both halves present: the poller only runs when this is true. */
  connected: boolean;
};

export async function readSiteConnection(): Promise<SiteConnection> {
  const stored = await settings.get("siteOrigin");
  const siteOrigin = stored && stored.trim().length > 0 ? stored.trim() : null;
  const hasToken = siteOrigin ? await hasSiteToken() : false;
  return { siteOrigin, hasToken, connected: Boolean(siteOrigin && hasToken) };
}

export async function saveSiteOrigin(origin: string): Promise<string> {
  const checked = checkOrigin(origin);
  if (!checked.ok) throw new Error(checked.message);
  await settings.set("siteOrigin", checked.origin);
  return checked.origin;
}

/**
 * Disconnect: forget the address, delete the key from the keychain, keep every
 * deal and contact the site ever sent. The `lead_sync` row is kept too, so
 * reconnecting the same site does not re-import history the owner may have
 * since deleted.
 */
export async function disconnectSite(): Promise<void> {
  await deleteSiteToken();
  await settings.set("siteOrigin", null);
}

/** The key `lead_sync` rows are stored under. */
export function syncKeyFor(origin: string): string {
  return normaliseOrigin(origin);
}
