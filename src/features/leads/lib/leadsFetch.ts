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
import { hasUsableId } from "@/features/leads/lib/leadMapping";

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

/**
 * A page that does not match the site contract (docs/CONTRACTS.md, "Site
 * endpoint contract"). Extends `Error` so it flows through the poller's
 * existing `catch (err)` in `tick()` exactly like a `LeadsFetchError` does:
 * `lead_sync.last_error` gets a real message and the banner logic sees a
 * failure, instead of the page silently being treated as a successful,
 * empty-ish poll (CPO audit, F-LB-1).
 */
export class LeadShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadShapeError";
  }
}

/**
 * Checked the instant a page comes back from `fetchLeads`, before the cursor
 * moves or a single row is written. Before this, nothing verified that
 * `leads` was even an array: a stub or a broken site answering
 * `{ leads: "not-an-array" }` had that string iterated character by
 * character - a JS string is itself iterable - and every character quietly
 * became a "lead" with no `.id`, reported to the owner as a successful poll
 * (CPO audit, F-LB-1).
 *
 * `leads` must be an array, and every entry an object carrying a usable
 * (non-blank, string) `id` - the same rule `leadMapping.hasUsableId` applies
 * later, kept in step here as the very first gate. The whole page is rejected
 * on either violation: a page this malformed cannot be trusted lead by lead,
 * and letting some of it through would still advance the cursor past
 * whatever the site actually meant to send.
 */
export function assertValidLeadPage(page: LeadPage): void {
  const leads: unknown = (page as { leads?: unknown } | null | undefined)?.leads;
  if (!Array.isArray(leads)) {
    throw new LeadShapeError(
      "Your website sent a lead list Helix could not read. Nothing was saved; check the site's lead feed and try again.",
    );
  }
  const withoutId = leads.filter(
    (lead) =>
      typeof lead !== "object" ||
      lead === null ||
      !hasUsableId((lead as { id?: unknown }).id),
  ).length;
  if (withoutId > 0) {
    throw new LeadShapeError(
      `Your website sent ${withoutId} lead${withoutId === 1 ? "" : "s"} with no id. Nothing was saved; check the site's lead feed and try again.`,
    );
  }
}

/**
 * True when a page's `nextCursor` is exactly the cursor it was just asked
 * with. A site that answers this way is never going to reach the end
 * paging forward: continuing would spin the poller's tick forever, hammering
 * the site and blocking every later poll behind it (LR-SEC-W1 item 4, the
 * hostile-200 "nextCursor never changes" case). A null `nextCursor` means
 * "caught up" and is never a stall.
 */
export function isStalledCursor(
  requestedCursor: string | null,
  nextCursor: string | null,
): boolean {
  return nextCursor !== null && nextCursor === requestedCursor;
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
