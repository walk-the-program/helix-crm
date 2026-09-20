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
import * as leadSync from "@/db/repos/leadSync";
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

/**
 * The literal placeholder that ships in every ClearPath template's
 * `.env.example`. A client who copies the wrong line out of that file pastes
 * this, gets a 401, and reads "check that you copied all of it" - which is
 * true and useless. Naming it is worth four lines (LR-REV, F-REV-8).
 */
const TOKEN_PLACEHOLDERS = [
  "replace-with-a-long-random-string",
  "a-long-random-string",
];

export type TokenCheck =
  | { ok: true; token: string }
  | { ok: false; message: string };

/**
 * Clean up what was actually pasted before it goes near the keychain.
 *
 * The token is generated with `openssl rand -base64 32`, so it never contains
 * whitespace - but it is handed over in an email or a message, and what lands
 * in the box is routinely the whole environment line (`CRM_API_TOKEN=abc...`),
 * the value in quotes, or a value a mail client wrapped across two lines. All
 * three used to be saved verbatim and then rejected by the site as a wrong
 * token, sending the owner and Walker looking for the wrong problem.
 */
export function cleanToken(input: string): string {
  let value = input.trim();
  value = value.replace(/^CRM_API_TOKEN\s*=\s*/i, "");
  value = value.trim();
  // Strip one matching pair of surrounding quotes, not every quote: a quote
  // is not a base64 character, but stripping them blindly would corrupt a
  // token Walker chose to generate some other way.
  const first = value[0];
  if ((first === '"' || first === "'") && value.endsWith(first) && value.length > 1) {
    value = value.slice(1, -1);
  }
  // A wrapped paste. Base64 has no whitespace, so anything left is the mail
  // client's, not the token's.
  return value.replace(/\s+/g, "");
}

/** Clean it, then refuse the two values that can only be mistakes. */
export function checkToken(input: string): TokenCheck {
  const token = cleanToken(input);
  if (token.length === 0) {
    return { ok: false, message: "Paste the token from your website." };
  }
  if (TOKEN_PLACEHOLDERS.includes(token.toLowerCase())) {
    return {
      ok: false,
      message:
        "That is the example token from the website's settings file, not a real one. Ask ClearPath for the token itself.",
    };
  }
  return { ok: true, token };
}

/** Store the token in the OS keychain. The value never touches SQLite. */
export async function setSiteToken(value: string): Promise<void> {
  const workspaceId = await currentWorkspaceId();
  if (!workspaceId) throw new Error("No workspace is open.");
  const checked = checkToken(value);
  if (!checked.ok) throw new Error(checked.message);
  await secretStore.set(workspaceId, checked.token);
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

/**
 * Save the address, and decide what the change means for the leads already on
 * file.
 *
 * A lead's idempotency key is `<normalised origin>:<lead id>`
 * (`leadMapping.externalIdFor`), and `lead_sync` is keyed on the origin too.
 * So changing the address is, to everything downstream, a different website:
 * the cursor starts at null and every historical lead comes back with an
 * external id Helix has never seen, which turns the owner's entire pipeline
 * into a second copy of itself. That is the wrong answer for the change a
 * ClearPath client actually makes - staging to live, or apex to www - and the
 * right one for a genuinely different site (LR-REV, F-REV-11).
 *
 * Helix cannot tell those apart, so the screen asks and passes the answer
 * here. `carryCursorFrom` means "same website, new address": the old site's
 * cursor moves to the new key, so the site resumes where it stopped and no
 * lead is ever read a second time. Omitting it reads the new site from the
 * beginning, which is what a genuinely new site needs.
 */
export async function saveSiteOrigin(
  origin: string,
  options: { carryCursorFrom?: string | null } = {},
): Promise<string> {
  const checked = checkOrigin(origin);
  if (!checked.ok) throw new Error(checked.message);
  const from = options.carryCursorFrom?.trim();
  if (from && normaliseOrigin(from) !== normaliseOrigin(checked.origin)) {
    await carryCursor(normaliseOrigin(from), normaliseOrigin(checked.origin));
  }
  await settings.set("siteOrigin", checked.origin);
  return checked.origin;
}

/**
 * Move the old address's place-in-the-list to the new one, and only when the
 * new one has none of its own - re-pointing at an address Helix already knows
 * must not rewind it.
 */
async function carryCursor(fromKey: string, toKey: string): Promise<void> {
  const previous = await leadSync.get(fromKey);
  if (!previous?.cursor) return;
  const existing = await leadSync.get(toKey);
  if (existing?.cursor) return;
  await leadSync.ensure(toKey);
  await leadSync.saveCursor(toKey, previous.cursor);
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
