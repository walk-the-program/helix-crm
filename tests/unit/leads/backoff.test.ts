import { describe, it, expect } from "vitest";
import {
  nextDelayMs,
  shouldShowNetworkBanner,
  isAuthStatus,
  statusFromError,
  POLL_INTERVAL_MS,
} from "@/features/leads/lib/backoff";

describe("backoff", () => {
  describe("nextDelayMs", () => {
    it("polls every 5 minutes when there have been no failures", () => {
      // docs/PLAN.md, "LEAD POLL" state machine: healthy cadence.
      expect(nextDelayMs(0)).toBe(POLL_INTERVAL_MS);
      expect(nextDelayMs(0)).toBe(5 * 60_000);
    });

    it("backs off 1, 2, 4, 8 minutes for the first four failures", () => {
      // docs/PLAN.md, "LEAD POLL": "retry with backoff 1,2,4,8 min".
      expect(nextDelayMs(1)).toBe(1 * 60_000);
      expect(nextDelayMs(2)).toBe(2 * 60_000);
      expect(nextDelayMs(3)).toBe(4 * 60_000);
      expect(nextDelayMs(4)).toBe(8 * 60_000);
    });

    it("holds at 8 minutes for every failure after the fourth, it does not keep growing", () => {
      expect(nextDelayMs(5)).toBe(8 * 60_000);
      expect(nextDelayMs(50)).toBe(8 * 60_000);
    });
  });

  describe("shouldShowNetworkBanner", () => {
    it("stays silent for the first two consecutive failures", () => {
      // docs/PLAN.md: "backoff... banner after 3 failures".
      expect(shouldShowNetworkBanner(0)).toBe(false);
      expect(shouldShowNetworkBanner(1)).toBe(false);
      expect(shouldShowNetworkBanner(2)).toBe(false);
    });

    it("shows the banner at 3 consecutive failures and beyond", () => {
      expect(shouldShowNetworkBanner(3)).toBe(true);
      expect(shouldShowNetworkBanner(4)).toBe(true);
      expect(shouldShowNetworkBanner(50)).toBe(true);
    });
  });

  describe("isAuthStatus", () => {
    it("treats 401 and 403 as auth failures", () => {
      expect(isAuthStatus(401)).toBe(true);
      expect(isAuthStatus(403)).toBe(true);
    });

    it("treats every other status, and null, as not an auth failure", () => {
      expect(isAuthStatus(200)).toBe(false);
      expect(isAuthStatus(404)).toBe(false);
      expect(isAuthStatus(429)).toBe(false);
      expect(isAuthStatus(500)).toBe(false);
      expect(isAuthStatus(null)).toBe(false);
    });
  });

  describe("statusFromError", () => {
    it("reads the status straight off a LeadsFetchError-shaped object", () => {
      expect(statusFromError({ status: 401 })).toBe(401);
    });

    it("pulls the status out of the message when the code is HTTP_STATUS", () => {
      // The Rust pipe reports a non-2xx this way (backoff.ts doc comment).
      expect(
        statusFromError({
          code: "HTTP_STATUS",
          message: "The website answered HTTP 401.",
        }),
      ).toBe(401);
    });

    it("returns null for a plain Error", () => {
      expect(statusFromError(new Error("boom"))).toBeNull();
    });

    it("does not mistake a number in a non-status error's message for a status", () => {
      // This is the whole point of statusFromError: a NET_ERROR carrying a
      // duration like "500ms" must not be read as HTTP 500.
      expect(
        statusFromError({ code: "NET_ERROR", message: "dns error 500ms" }),
      ).toBeNull();
    });

    it("returns null for a string, and for null or undefined", () => {
      expect(statusFromError("500")).toBeNull();
      expect(statusFromError(null)).toBeNull();
      expect(statusFromError(undefined)).toBeNull();
    });
  });
});
