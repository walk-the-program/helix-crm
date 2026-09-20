/**
 * Everything the owner reads when the website connection is unhappy, in one
 * place.
 *
 * Before this file there was one split - auth or not-auth - and everything on
 * the not-auth side was reported as "Helix cannot reach your website". That is
 * true of a closed laptop and false of every other case the site can produce:
 * a site deployed without the lead endpoint answers 404, a site mid-deploy
 * answers 502, a site that cannot read the page marker Helix sent answers 400,
 * and a site that answers perfectly well with a malformed body answers 200. In
 * all four the owner was told his internet was down and Walker got a support
 * call about the wrong thing (LR-REV, F-REV-1/2/3).
 *
 * The six kinds and who fixes each:
 *
 *   auth      401/403   the owner, by pasting the new token
 *   endpoint  404       ClearPath, by switching the lead feed on
 *   cursor    400       Helix, by starting again from the first lead
 *   site      other     ClearPath, or nobody - the site is having a bad day
 *   network   no status the owner's connection, or nobody - keep trying
 *   config    keychain  the owner, by saving the token again
 *
 * The strings here are the contract `docs/OPERATIONS.md` procedure 3 and the
 * "Commercial lifecycle" section quote, so a change here is a change there.
 * Voice: docs/DESIGN.md §11 - say what happened and what to do, no jargon, no
 * apology, and never a code the owner cannot act on in the headline.
 */
import { isAuthStatus } from "@/features/leads/lib/backoff";
import type { PollErrorKind } from "@/features/leads/lib/types";

/** The kinds this module classifies. `write` is not one of them. */
export type PollFailureKind = Extract<
  PollErrorKind,
  "auth" | "endpoint" | "cursor" | "site" | "network" | "config"
>;

/**
 * Which kind of failure an HTTP status is.
 *
 * `siteAnswered` is true when the failure came out of a readable answer from
 * the site rather than out of the transport - a malformed 200 body is a site
 * problem even though it carries no status at all.
 */
export function classifyPollFailure(
  status: number | null,
  options: { siteAnswered?: boolean; code?: string | null } = {},
): PollFailureKind {
  // The keychain turned Helix down between the connection check and the
  // request. Telling the owner his website is unreachable would send him to
  // the wrong place entirely (LR-REV, F-REV-6).
  if (options.code === "SECRET_ERROR") return "config";
  if (isAuthStatus(status)) return "auth";
  if (status === 404) return "endpoint";
  if (status === 400) return "cursor";
  if (status !== null) return "site";
  return options.siteAnswered ? "site" : "network";
}

/* -------------------------------------------------------------------------- */
/* what gets written to lead_sync.last_error                                  */
/* -------------------------------------------------------------------------- */

/**
 * The prefixes are a small, stable vocabulary because they are parsed back by
 * `describeStoredPollError` and read raw by Diagnostics (where the audience is
 * Walker, not the owner).
 */
export const STORED_PREFIX: Record<PollFailureKind, string> = {
  auth: "LeadPollAuthError",
  endpoint: "LeadPollEndpointError",
  cursor: "LeadPollCursorError",
  site: "LeadPollSiteError",
  network: "LeadPollNetworkError",
  config: "LeadPollConfigError",
};

/**
 * Turn a stored `lead_sync.last_error` back into a sentence for the owner.
 *
 * Settings > Website used to print the stored string verbatim, so an owner
 * whose token had been rotated read "LeadPollAuthError: HTTP 401" in red on
 * his own screen (LR-REV, F-REV-4). The stored form stays as it is - support
 * and Diagnostics want it - and this is what the screen shows instead.
 */
export function describeStoredPollError(raw: string): string {
  const { prefix, detail } = splitStored(raw);
  const status = statusIn(detail);
  switch (prefix) {
    case STORED_PREFIX.auth:
      return "Your website turned the token down.";
    case STORED_PREFIX.endpoint:
      return "Your website has no lead connection on it yet.";
    case STORED_PREFIX.cursor:
      return "Your website could not read where Helix left off. Helix started again from your first lead.";
    case STORED_PREFIX.site:
      return status === null
        ? "Your website answered, but not with something Helix could use."
        : `Your website answered with an error (${status}).`;
    case STORED_PREFIX.network:
      return "Helix could not reach your website.";
    case STORED_PREFIX.config:
      return "Helix could not read your website token from this computer.";
    default:
      // Forward compatible: an unrecognised row is shown as it was stored
      // rather than swallowed.
      return raw;
  }
}

/**
 * The technical line under that sentence: what support needs, in the smaller,
 * muted type, so the owner reads plain words first and Walker can still ask
 * "what does the grey line say".
 *
 * For auth, endpoint and cursor this is only the status. The Rust client
 * withholds a 401/403 body on purpose (a rejection body commonly echoes the
 * credential it just rejected - `sec.md` F-SEC-6) and a 404 body is the site's
 * own 404 page; neither is stored, so neither can be shown. For site and
 * network failures the stored detail is the site's own redacted answer, which
 * is exactly what an owner debugging his own website needs.
 */
export function storedPollErrorDetail(raw: string): string | null {
  const { prefix, detail } = splitStored(raw);
  const trimmed = detail.trim();
  if (
    prefix === STORED_PREFIX.auth ||
    prefix === STORED_PREFIX.endpoint ||
    prefix === STORED_PREFIX.cursor
  ) {
    const status = statusIn(trimmed);
    return status === null ? null : `HTTP ${status}`;
  }
  if (prefix === STORED_PREFIX.site || prefix === STORED_PREFIX.network) {
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function splitStored(raw: string): { prefix: string; detail: string } {
  const colon = raw.indexOf(":");
  if (colon < 0) return { prefix: raw, detail: "" };
  return { prefix: raw.slice(0, colon), detail: raw.slice(colon + 1) };
}

function statusIn(text: string): number | null {
  const match = /\b(\d{3})\b/.exec(text);
  if (!match) return null;
  const status = Number(match[1]);
  return status >= 100 && status <= 599 ? status : null;
}

/* -------------------------------------------------------------------------- */
/* what the owner reads                                                       */
/* -------------------------------------------------------------------------- */

export type BannerCopy = { headline: string; detail: string };

/**
 * Settings > Website, the full banner. This is the screen that carries the
 * fix, so this is where the whole explanation lives.
 *
 * @param suggestDisconnect true once a site has been unreachable long enough
 *   that "it is gone" is a likelier explanation than "it is down".
 */
export function pollBannerCopy(
  kind: PollFailureKind,
  options: {
    status?: number | null;
    consecutiveFailures?: number;
    suggestDisconnect?: boolean;
    detail?: string | null;
  } = {},
): BannerCopy {
  const tries = options.consecutiveFailures ?? 0;
  switch (kind) {
    case "auth":
      return {
        headline: "Your website turned the connection down. Check the token.",
        detail:
          "New leads are not coming in until the token is right. Paste a fresh one below and save.",
      };
    case "endpoint":
      return {
        headline: "Your website is not set up to send leads yet.",
        detail:
          "Helix reached the site, but there is no lead connection on it. Ask ClearPath to switch it on. Nothing is wrong with this computer.",
      };
    case "cursor":
      return {
        headline: "Your website could not read where Helix left off.",
        detail:
          "Helix is starting again from your first lead. Nothing will be duplicated, and nothing you have edited will be overwritten.",
      };
    case "site":
      return {
        headline:
          typeof options.status === "number"
            ? `Your website answered with an error (${options.status}).`
            : "Your website answered, but not with something Helix could use.",
        detail:
          options.detail?.trim() ||
          "New leads are not coming in. Helix keeps trying on its own. If it stays this way, tell ClearPath.",
      };
    case "config":
      return {
        headline: "Helix could not read your website token from this computer.",
        detail:
          "Your keychain turned Helix down. Paste the token below and save it again, and allow the keychain prompt when it appears.",
      };
    case "network":
    default:
      return {
        headline: "Helix cannot reach your website.",
        detail: options.suggestDisconnect
          ? `Nothing has come through for ${tries} tries. Helix keeps trying on its own. If the site is gone for good, you can disconnect it below. Every lead already in Helix stays.`
          : `Nothing has come through for ${tries} tries. Helix keeps trying on its own.`,
      };
  }
}

/**
 * Today, the quiet one-line half. One sentence, no colour, no icon - the
 * owner's work is what Today is for and this is a footnote about the plumbing
 * (`PollNotice`'s own header comment).
 */
export function pollNoticeCopy(kind: PollFailureKind): string {
  switch (kind) {
    case "auth":
      return "New leads are not coming in: your website turned the connection down.";
    case "endpoint":
      return "New leads are not coming in: your website is not set up to send them yet.";
    case "cursor":
      return "Helix is reading your leads again from the beginning: your website could not read where it left off.";
    case "site":
      return "New leads are not coming in: your website answered with an error.";
    case "config":
      return "New leads are not coming in: Helix could not read your website token.";
    case "network":
    default:
      return "New leads are not coming in: Helix cannot reach your website.";
  }
}
