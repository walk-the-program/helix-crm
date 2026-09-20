/**
 * The shapes the website lead poller works with.
 *
 * `Lead` and `LeadPage` mirror the Rust `leads_fetch` command exactly
 * (docs/CONTRACTS.md, "Site endpoint contract"). The command is injected as a
 * function rather than imported, so the integration test can point the poller
 * at `tools/fake-site` over plain `fetch` and the e2e harness can point it at
 * its own stub.
 */

export type Lead = {
  id: string;
  createdAt: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  service: string | null;
  message: string | null;
  pageUrl: string | null;
};

export type LeadPage = {
  leads: Lead[];
  /** Null means "caught up". Never sent back as `after` - see LeadsFetch. */
  nextCursor: string | null;
};

/**
 * The one dependency the poller takes on the outside world.
 *
 * A null cursor means "from the beginning". The Rust command omits the `after`
 * query parameter entirely in that case (docs/CONTRACTS.md, "Clarifications
 * made during the build"), so callers pass null and never an empty string.
 */
export type LeadsFetch = (
  cursor: string | null,
  limit: number,
) => Promise<LeadPage>;

/**
 * Why a poll stopped. The names come from docs/PLAN.md's error map, widened by
 * LR-REV: "network" used to absorb every failure that was not a 401, so a site
 * with no lead endpoint (404), a site mid-deploy (502), a site that could not
 * read Helix's page marker (400) and a site sending a malformed body all told
 * the owner his computer could not reach the internet. Each of those has a
 * different person who can fix it, so each gets its own kind.
 *
 *   auth      401/403             the owner, by pasting the new token
 *   endpoint  404                 ClearPath, by switching the lead feed on
 *   cursor    400                 Helix, by starting again from the first lead
 *   site      other status / body ClearPath, or nobody
 *   network   no answer at all    the connection, or nobody
 *   config    keychain refused    the owner, by saving the token again
 */
export type PollErrorKind =
  | "auth"
  | "endpoint"
  | "cursor"
  | "site"
  | "network"
  | "config"
  | "write";

export type PollError = {
  kind: PollErrorKind;
  /** What the owner reads. Plain words, says what to do. */
  message: string;
  /** The HTTP status behind it, when there was one. Null for transport failures. */
  status?: number | null;
  /**
   * The site's own sentence, when it produced one worth repeating under the
   * headline. Only a malformed-page failure sets this; everything else lets
   * `pollBannerCopy` write the second line.
   */
  detail?: string | null;
};

export type PollPhase = "idle" | "fetching" | "applying" | "stopped";

export type PollStatus = {
  phase: PollPhase;
  /** False until the site origin and token are both in place. */
  configured: boolean;
  siteOrigin: string | null;
  lastPolledAt: string | null;
  lastError: PollError | null;
  /** Consecutive network failures; the banner appears at 3. */
  consecutiveFailures: number;
  /** Leads turned into deals by the most recent successful poll. */
  lastCreated: number;
  /** Leads the most recent poll had already seen. */
  lastSkipped: number;
  /** When the next tick is due, or null while the timer is stopped. */
  nextPollAt: string | null;
  /** True while a banner should be on screen. */
  bannerVisible: boolean;
};

export const IDLE_STATUS: PollStatus = {
  phase: "idle",
  configured: false,
  siteOrigin: null,
  lastPolledAt: null,
  lastError: null,
  consecutiveFailures: 0,
  lastCreated: 0,
  lastSkipped: 0,
  nextPollAt: null,
  bannerVisible: false,
};
