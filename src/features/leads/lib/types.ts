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

/** Why a poll stopped. The names come from docs/PLAN.md's error map. */
export type PollErrorKind = "auth" | "network" | "config" | "write";

export type PollError = {
  kind: PollErrorKind;
  /** What the owner reads. Plain words, says what to do. */
  message: string;
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
