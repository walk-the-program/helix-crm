/**
 * The `leads_fetch` command, wrapped so the poller can be handed a different
 * implementation.
 *
 *   production        invoke("leads_fetch") -> Rust -> the owner's site
 *   integration test  a plain fetch() against tools/fake-site on 4711
 *   e2e               the Playwright harness's Tauri invoke stub
 *
 * The cursor is opaque and is passed straight back; when it is null the `after`
 * parameter is omitted entirely, which the site treats as "from the beginning"
 * (docs/CONTRACTS.md, "Clarifications made during the build").
 */
import type { LeadPage, LeadsFetch } from "@/features/leads/lib/types";

/** Anything the poller can classify. `status` is null for transport failures. */
export class LeadsFetchError extends Error {
  readonly status: number | null;
  readonly code: string;
  constructor(message: string, status: number | null, code = "NET_ERROR") {
    super(message);
    this.name = "LeadsFetchError";
    this.status = status;
    this.code = code;
  }
}

/** The contract caps `limit` at 200 and the Rust side clamps to 1..=200. */
export const MAX_PAGE = 200;

export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return MAX_PAGE;
  return Math.min(MAX_PAGE, Math.max(1, Math.trunc(limit)));
}

/** The real thing: the Rust command, which holds the token and the origin. */
export const invokeLeadsFetch: LeadsFetch = async (cursor, limit) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LeadPage>("leads_fetch", {
    cursor,
    limit: clampLimit(limit),
  });
};

/**
 * A `LeadsFetch` over plain HTTP, for the integration test against
 * `tools/fake-site`. Never used in the app: in production the token must not
 * enter the webview, which is the whole reason `leads_fetch` lives in Rust.
 */
export function httpLeadsFetch(
  origin: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): LeadsFetch {
  const base = origin.replace(/\/+$/, "");
  return async (cursor, limit) => {
    const params = new URLSearchParams({ limit: String(clampLimit(limit)) });
    // Null cursor: no `after` at all, not `after=`.
    if (cursor !== null) params.set("after", cursor);

    let response: Response;
    try {
      response = await fetchImpl(`${base}/api/crm/leads?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new LeadsFetchError(
        err instanceof Error ? err.message : String(err),
        null,
      );
    }
    if (!response.ok) {
      throw new LeadsFetchError(
        `The website answered HTTP ${response.status}.`,
        response.status,
        "HTTP_STATUS",
      );
    }
    return (await response.json()) as LeadPage;
  };
}
