import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * LR-SEC-W1 item 9 (and its correction, 2026-09-20): a non-auth poll failure
 * carries up to 200 characters of the site's own response body. The token in
 * it is redacted by leads.rs, but the rest is arbitrary third-party text - a
 * framework 500 can serialise the row it choked on, which can be a
 * customer's name or email.
 *
 *   lead_sync.last_error (SQLCipher-encrypted, surfaced in Settings ->
 *   Website - where an owner debugging their own site needs it) KEEPS the
 *   full detail.
 *
 *   helix.log (plaintext on disk, exactly what Diagnostics invites the
 *   owner to send to support) must NEVER carry it.
 *
 * Every collaborator `tick()` would otherwise reach for a real database or
 * the Tauri IPC bridge is mocked at the module boundary, so this stays a
 * pure unit test: no sqlite, no invoke.
 */

const { pollLogCalls, recordErrorCalls } = vi.hoisted(() => ({
  pollLogCalls: [] as { level: string; message: string }[],
  recordErrorCalls: [] as { syncKey: string; message: string }[],
}));

vi.mock("@/features/leads/lib/log", () => ({
  pollLog: {
    info: (message: string) => pollLogCalls.push({ level: "info", message }),
    warn: (message: string) => pollLogCalls.push({ level: "warn", message }),
    error: (message: string) => pollLogCalls.push({ level: "error", message }),
  },
}));

vi.mock("@/db/repos/leadSync", () => ({
  ensure: vi.fn(async (siteOrigin: string) => ({
    siteOrigin,
    cursor: null,
    lastPolledAt: null,
    lastError: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  })),
  saveCursor: vi.fn(async () => undefined),
  recordError: vi.fn(async (syncKey: string, message: string) => {
    recordErrorCalls.push({ syncKey, message });
  }),
  get: vi.fn(async () => null),
  clear: vi.fn(async () => undefined),
}));

vi.mock("@/features/leads/lib/siteConnection", () => ({
  readSiteConnection: vi.fn(async () => ({
    connected: true,
    siteOrigin: "https://example.com",
    hasToken: true,
  })),
  syncKeyFor: (origin: string) => origin,
  currentWorkspaceId: vi.fn(async () => "ws-1"),
}));

vi.mock("@/features/leads/lib/applyLeads", () => ({
  prepareApply: vi.fn(async () => ({
    stageId: "stage-1",
    sourceId: "source-1",
    currency: "USD",
    region: "US",
    nextPosition: 0,
  })),
  applyLeadPage: vi.fn(async () => ({
    created: 0,
    skipped: 0,
    contactsReused: 0,
    invalid: 0,
    dealIds: [],
  })),
}));

// Imported after the mocks above so poller.ts resolves them instead of the
// real, DB-backed and IPC-backed modules.
const poller = await import("@/features/leads/poller");

describe("recordFailure log redaction (LR-SEC-W1 item 9 correction)", () => {
  beforeEach(() => {
    poller.__resetPollerForTests();
    pollLogCalls.length = 0;
    recordErrorCalls.length = 0;
  });

  it("a non-auth failure's site-echoed detail reaches lead_sync.last_error but never the log", async () => {
    const hostileDetail =
      "HTTP 500 from the site: while saving customer name: Jane Doe, jane@example.com";
    poller.setLeadsFetch(async () => {
      throw { code: "HTTP_STATUS", message: hostileDetail };
    });

    await poller.tick("manual");

    // Present: this is exactly where an owner debugging their own broken
    // site needs the site's answer, and the database is encrypted at rest.
    expect(
      recordErrorCalls.some((call) => call.message.includes("jane@example.com")),
    ).toBe(true);
    expect(
      recordErrorCalls.some((call) => call.message.includes("Jane Doe")),
    ).toBe(true);

    // Absent, explicitly: a test that only checked the line above would
    // pass even if the log leaked the same text, so both halves are
    // asserted here.
    expect(pollLogCalls.length).toBeGreaterThan(0);
    for (const call of pollLogCalls) {
      expect(call.message).not.toContain("jane@example.com");
      expect(call.message).not.toContain("Jane Doe");
      expect(call.message).not.toContain(hostileDetail);
    }
  });

  it("still logs the status and the failure count for a non-auth failure", async () => {
    poller.setLeadsFetch(async () => {
      throw { code: "HTTP_STATUS", message: "HTTP 500 from the site: boom" };
    });

    await poller.tick("manual");

    const networkLine = pollLogCalls.find((call) =>
      call.message.includes("LeadPollNetworkError"),
    );
    expect(networkLine).toBeDefined();
    expect(networkLine?.message).toContain("1/3");
  });

  it("an auth failure's body never reaches the log either (existing item 9 behaviour)", async () => {
    poller.setLeadsFetch(async () => {
      throw {
        code: "HTTP_STATUS",
        message: "HTTP 401 from the site: invalid token: hx_live_should_not_leak",
      };
    });

    await poller.tick("manual");

    for (const call of pollLogCalls) {
      expect(call.message).not.toContain("hx_live_should_not_leak");
    }
  });
});
