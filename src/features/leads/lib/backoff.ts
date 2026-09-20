/**
 * The poller's timing rules, kept pure so they can be tested without a clock.
 *
 *   healthy            every 5 minutes
 *   network failure    1, 2, 4, 8 minutes, then 8 minutes forever
 *   3 failures in a row -> the banner appears (and stays until a poll succeeds)
 *   401 / 403          the timer stops entirely until the settings change
 *
 * docs/PLAN.md, "LEAD POLL" state machine and the LeadPollNetworkError row of
 * the error map.
 */

export const POLL_INTERVAL_MS = 5 * 60_000;

/** 1, 2, 4, 8 minutes. The last entry repeats for every later failure. */
export const BACKOFF_MINUTES = [1, 2, 4, 8] as const;

/** Consecutive network failures before the owner is told anything. */
export const FAILURES_BEFORE_BANNER = 3;

/**
 * How long to wait before the next attempt.
 *
 * @param consecutiveFailures 0 after a success, then 1, 2, 3, ... per failure.
 */
export function nextDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_INTERVAL_MS;
  const index = Math.min(consecutiveFailures, BACKOFF_MINUTES.length) - 1;
  return BACKOFF_MINUTES[index] * 60_000;
}

/** The banner is silent for the first two network failures (PLAN.md). */
export function shouldShowNetworkBanner(consecutiveFailures: number): boolean {
  return consecutiveFailures >= FAILURES_BEFORE_BANNER;
}

/**
 * Consecutive network failures before the banner offers Disconnect.
 *
 * Twelve failures is three at 1/2/4 minutes plus nine at the 8-minute ceiling:
 * about eighty minutes of Helix being open and getting nothing. A site that is
 * merely down comes back inside that; a site that was taken down when the
 * client stopped paying for it never does, and before LR-REV that owner was
 * told "Helix keeps trying on its own" forever with no hint that stopping was
 * an option (F-REV-5). Disconnecting is offered, never done for him: his leads
 * are already in Helix either way, and only he knows whether the site is
 * coming back.
 */
export const FAILURES_BEFORE_DISCONNECT_HINT = 12;

/** True once "the site is gone" is a likelier reading than "the site is down". */
export function shouldSuggestDisconnect(consecutiveFailures: number): boolean {
  return consecutiveFailures >= FAILURES_BEFORE_DISCONNECT_HINT;
}

/**
 * The error map splits on the HTTP status: 401 and 403 are "check the token"
 * and stop the timer; everything else is a network error and backs off.
 */
export function isAuthStatus(status: number | null): boolean {
  return status === 401 || status === 403;
}

/**
 * The HTTP status behind a failure, or null when the request never got one.
 *
 * Three shapes reach here. A `LeadsFetchError` carries the status outright.
 * The Rust pipe reports a non-2xx as the `HTTP_STATUS` code with the number in
 * the message. Anything else - DNS, timeout, the app being offline - has no
 * status at all, which is exactly the network branch of the error map.
 */
export function statusFromError(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const record = err as { status?: unknown; code?: unknown; message?: unknown };

  if (typeof record.status === "number" && Number.isFinite(record.status)) {
    return record.status;
  }
  if (record.code !== "HTTP_STATUS") return null;

  const match = /\b(\d{3})\b/.exec(String(record.message ?? ""));
  if (!match) return null;
  const status = Number(match[1]);
  return status >= 100 && status <= 599 ? status : null;
}
