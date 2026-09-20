/**
 * LR-REV. Every owner-facing string about a failed poll comes from one module
 * now, so this is where the commercial lifecycle's messages are pinned:
 * a rotated token, a site with no lead endpoint, a site that cannot read
 * Helix's page marker, a site having a bad day, a site that is simply gone,
 * and a keychain that turned Helix down. Before this split all six read
 * "Helix cannot reach your website", which was true of exactly one of them.
 */
import { describe, expect, it } from "vitest";
import {
  STORED_PREFIX,
  classifyPollFailure,
  describeStoredPollError,
  pollBannerCopy,
  pollNoticeCopy,
  storedPollErrorDetail,
} from "../../../src/features/leads/lib/pollMessages";

describe("classifyPollFailure", () => {
  it("sends each status to the person who can actually fix it", () => {
    expect(classifyPollFailure(401)).toBe("auth");
    expect(classifyPollFailure(403)).toBe("auth");
    expect(classifyPollFailure(404)).toBe("endpoint");
    expect(classifyPollFailure(400)).toBe("cursor");
    expect(classifyPollFailure(429)).toBe("site");
    expect(classifyPollFailure(500)).toBe("site");
    expect(classifyPollFailure(502)).toBe("site");
    expect(classifyPollFailure(null)).toBe("network");
  });

  it("a malformed answer is the site's problem, not the connection's", () => {
    // A 200 with a body Helix cannot read carries no status at all, and used
    // to be reported as an unreachable website.
    expect(classifyPollFailure(null, { siteAnswered: true })).toBe("site");
  });

  it("a keychain refusal is not a website problem", () => {
    expect(classifyPollFailure(null, { code: "SECRET_ERROR" })).toBe("config");
    // Even if a status somehow came with it, the keychain is the real cause.
    expect(classifyPollFailure(401, { code: "SECRET_ERROR" })).toBe("config");
  });
});

describe("describeStoredPollError", () => {
  it("never shows the owner an exception class name", () => {
    const stored = [
      `${STORED_PREFIX.auth}: HTTP 401`,
      `${STORED_PREFIX.endpoint}: HTTP 404`,
      `${STORED_PREFIX.cursor}: HTTP 400`,
      `${STORED_PREFIX.site}: HTTP 500 from the site: boom`,
      `${STORED_PREFIX.network}: Could not reach the site: dns error`,
      `${STORED_PREFIX.config}: the keychain refused`,
    ];
    for (const raw of stored) {
      const sentence = describeStoredPollError(raw);
      expect(sentence).not.toMatch(/LeadPoll\w*Error/);
      expect(sentence.endsWith(".")).toBe(true);
    }
  });

  it("says what happened, per kind", () => {
    expect(describeStoredPollError(`${STORED_PREFIX.auth}: HTTP 401`)).toBe(
      "Your website turned the token down.",
    );
    expect(describeStoredPollError(`${STORED_PREFIX.endpoint}: HTTP 404`)).toBe(
      "Your website has no lead connection on it yet.",
    );
    expect(
      describeStoredPollError(`${STORED_PREFIX.site}: HTTP 503 from the site: nope`),
    ).toContain("(503)");
    expect(describeStoredPollError(`${STORED_PREFIX.network}: offline`)).toBe(
      "Helix could not reach your website.",
    );
  });

  it("passes an unrecognised row through rather than swallowing it", () => {
    expect(describeStoredPollError("something from a future version")).toBe(
      "something from a future version",
    );
  });
});

describe("storedPollErrorDetail", () => {
  it("keeps the status where support needs it, without the body", () => {
    // Walker's phone question is "what does the grey line say"; F-SEC-6 is why
    // a 401's body is never stored, so there is nothing but the status to give.
    expect(storedPollErrorDetail(`${STORED_PREFIX.auth}: HTTP 401`)).toBe("HTTP 401");
    expect(storedPollErrorDetail(`${STORED_PREFIX.endpoint}: HTTP 404`)).toBe("HTTP 404");
  });

  it("keeps the site's own redacted answer for a site or network failure", () => {
    expect(
      storedPollErrorDetail(`${STORED_PREFIX.site}: HTTP 500 from the site: boom`),
    ).toBe("HTTP 500 from the site: boom");
    expect(storedPollErrorDetail(`${STORED_PREFIX.network}: dns error`)).toBe("dns error");
  });

  it("has nothing to add to an unrecognised row", () => {
    expect(storedPollErrorDetail("plain text")).toBeNull();
  });
});

describe("pollBannerCopy", () => {
  it("names the right fixer in each headline", () => {
    expect(pollBannerCopy("auth").headline).toMatch(/token/i);
    expect(pollBannerCopy("endpoint").detail).toMatch(/ClearPath/);
    expect(pollBannerCopy("endpoint").detail).toMatch(/nothing is wrong with this computer/i);
    expect(pollBannerCopy("cursor").detail).toMatch(/nothing will be duplicated/i);
    expect(pollBannerCopy("site", { status: 502 }).headline).toContain("(502)");
    expect(pollBannerCopy("config").detail).toMatch(/keychain/i);
  });

  it("offers Disconnect only once a site looks gone rather than down", () => {
    const down = pollBannerCopy("network", {
      consecutiveFailures: 4,
      suggestDisconnect: false,
    });
    expect(down.detail).toContain("4 tries");
    expect(down.detail).not.toMatch(/disconnect/i);

    const gone = pollBannerCopy("network", {
      consecutiveFailures: 12,
      suggestDisconnect: true,
    });
    expect(gone.detail).toMatch(/disconnect/i);
    // And it must promise the thing that is actually true: the leads stay.
    expect(gone.detail).toMatch(/already in Helix stays/i);
  });

  it("repeats the site's own sentence rather than writing over it", () => {
    const shape = "Your website sent 3 leads with no id.";
    expect(pollBannerCopy("site", { status: null, detail: shape }).detail).toBe(shape);
  });
});

describe("pollNoticeCopy", () => {
  it("is one sentence per kind, and never blames the connection wrongly", () => {
    expect(pollNoticeCopy("auth")).toContain("turned the connection down");
    expect(pollNoticeCopy("endpoint")).toContain("not set up to send them yet");
    expect(pollNoticeCopy("site")).toContain("answered with an error");
    expect(pollNoticeCopy("network")).toContain("cannot reach your website");
    expect(pollNoticeCopy("config")).toContain("could not read your website token");
    for (const kind of ["auth", "endpoint", "site", "config"] as const) {
      expect(pollNoticeCopy(kind)).not.toContain("cannot reach your website");
    }
  });
});
