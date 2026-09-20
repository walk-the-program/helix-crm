import { describe, it, expect } from "vitest";
import {
  assertValidLeadPage,
  clampLimit,
  isStalledCursor,
  LeadShapeError,
  LeadsFetchError,
  httpLeadsFetch,
  MAX_PAGE,
} from "@/features/leads/lib/leadsFetch";
import type { Lead, LeadPage } from "@/features/leads/lib/types";

const EMPTY_PAGE: LeadPage = { leads: [], nextCursor: null };

/** Records the URL and init it was called with, and returns a fixed Response. */
function recordingFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function throwingFetch(error: unknown) {
  const fetchImpl = (async () => {
    throw error;
  }) as typeof fetch;
  return fetchImpl;
}

describe("leadsFetch", () => {
  describe("clampLimit", () => {
    it("raises a zero or negative limit to 1", () => {
      expect(clampLimit(0)).toBe(1);
      expect(clampLimit(-5)).toBe(1);
    });

    it("caps a limit above 200 to 200", () => {
      expect(clampLimit(500)).toBe(MAX_PAGE);
      expect(clampLimit(500)).toBe(200);
    });

    it("leaves an in-range limit unchanged", () => {
      expect(clampLimit(50)).toBe(50);
    });

    it("falls back to 200 for NaN and Infinity", () => {
      expect(clampLimit(NaN)).toBe(200);
      expect(clampLimit(Infinity)).toBe(200);
    });

    it("truncates a fractional limit toward zero", () => {
      expect(clampLimit(7.9)).toBe(7);
    });
  });

  describe("httpLeadsFetch", () => {
    it("omits the `after` parameter entirely for a null cursor", async () => {
      // docs/CONTRACTS.md, "Clarifications made during the build": a null
      // cursor must produce no `after` at all, not `after=`.
      const { fetchImpl, calls } = recordingFetch(200, EMPTY_PAGE);
      const fetchLeads = httpLeadsFetch("https://x.com", "tok", fetchImpl);
      await fetchLeads(null, 50);
      expect(calls[0].url).not.toContain("after");
    });

    it("passes a non-null cursor through verbatim, URL-encoded, as `after`", async () => {
      const { fetchImpl, calls } = recordingFetch(200, EMPTY_PAGE);
      const fetchLeads = httpLeadsFetch("https://x.com", "tok", fetchImpl);
      const cursor = "abc/def+ghi";
      await fetchLeads(cursor, 50);
      const url = new URL(calls[0].url);
      expect(url.searchParams.get("after")).toBe(cursor);
    });

    it("clamps the limit into the query string", async () => {
      const { fetchImpl, calls } = recordingFetch(200, EMPTY_PAGE);
      const fetchLeads = httpLeadsFetch("https://x.com", "tok", fetchImpl);
      await fetchLeads(null, 500);
      const url = new URL(calls[0].url);
      expect(url.searchParams.get("limit")).toBe("200");
    });

    it("sends the token as an Authorization Bearer header", async () => {
      const { fetchImpl, calls } = recordingFetch(200, EMPTY_PAGE);
      const fetchLeads = httpLeadsFetch("https://x.com", "secret-token", fetchImpl);
      await fetchLeads(null, 50);
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer secret-token");
    });

    it("does not double a slash when the origin has a trailing one", async () => {
      const { fetchImpl, calls } = recordingFetch(200, EMPTY_PAGE);
      const fetchLeads = httpLeadsFetch("https://x.com/", "tok", fetchImpl);
      await fetchLeads(null, 50);
      expect(calls[0].url).toContain("https://x.com/api/crm/leads?");
      expect(calls[0].url).not.toContain("//api");
    });

    it("rejects with a LeadsFetchError carrying status 401 and code HTTP_STATUS on a 401", async () => {
      const { fetchImpl } = recordingFetch(401, { error: "unauthorized" });
      const fetchLeads = httpLeadsFetch("https://x.com", "tok", fetchImpl);
      await expect(fetchLeads(null, 50)).rejects.toMatchObject({
        status: 401,
        code: "HTTP_STATUS",
      });
      await expect(fetchLeads(null, 50)).rejects.toBeInstanceOf(LeadsFetchError);
    });

    it("rejects with status 500 on a server error", async () => {
      const { fetchImpl } = recordingFetch(500, { error: "boom" });
      const fetchLeads = httpLeadsFetch("https://x.com", "tok", fetchImpl);
      await expect(fetchLeads(null, 50)).rejects.toMatchObject({ status: 500 });
    });

    it("rejects with a LeadsFetchError whose status is null when fetch itself throws (offline)", async () => {
      // That null status is what routes the poller into the backoff branch
      // instead of the auth-stop branch (backoff.ts / docs/PLAN.md).
      const fetchImpl = throwingFetch(new TypeError("network error"));
      const fetchLeads = httpLeadsFetch("https://x.com", "tok", fetchImpl);
      await expect(fetchLeads(null, 50)).rejects.toBeInstanceOf(LeadsFetchError);
      await expect(fetchLeads(null, 50)).rejects.toMatchObject({ status: null });
    });

    it("returns the parsed body unchanged, including nextCursor, on a 200", async () => {
      const page: LeadPage = {
        leads: [
          {
            id: "lead-1",
            createdAt: "2026-03-01T00:00:00.000Z",
            name: "Bob",
            email: "bob@example.com",
            phone: null,
            service: "Lawn care",
            message: "Call me",
            pageUrl: null,
          },
        ],
        nextCursor: "opaque-cursor",
      };
      const { fetchImpl } = recordingFetch(200, page);
      const fetchLeads = httpLeadsFetch("https://x.com", "tok", fetchImpl);
      const result = await fetchLeads(null, 50);
      expect(result).toEqual(page);
      expect(result.nextCursor).toBe("opaque-cursor");
    });
  });

  describe("assertValidLeadPage (F-LB-1)", () => {
    function lead(overrides: Partial<Lead> = {}): Lead {
      return {
        id: "lead-1",
        createdAt: "2026-03-01T00:00:00.000Z",
        name: "Bob",
        email: "bob@example.com",
        phone: null,
        service: null,
        message: null,
        pageUrl: null,
        ...overrides,
      };
    }

    it("accepts a normal page unchanged", () => {
      const page: LeadPage = { leads: [lead(), lead({ id: "lead-2" })], nextCursor: "abc" };
      expect(() => assertValidLeadPage(page)).not.toThrow();
    });

    it("accepts an empty page", () => {
      expect(() => assertValidLeadPage({ leads: [], nextCursor: null })).not.toThrow();
    });

    it("rejects a page whose `leads` is not an array, the string-iterated-as-leads bug", () => {
      const page = { leads: "not-an-array", nextCursor: null } as unknown as LeadPage;
      expect(() => assertValidLeadPage(page)).toThrow(LeadShapeError);
    });

    it("rejects a page whose `leads` is missing entirely", () => {
      const page = {} as unknown as LeadPage;
      expect(() => assertValidLeadPage(page)).toThrow(LeadShapeError);
    });

    it("rejects a page containing a lead with no `id` at all", () => {
      const page = {
        leads: [{ name: "No Id" } as unknown as Lead],
        nextCursor: null,
      };
      expect(() => assertValidLeadPage(page)).toThrow(LeadShapeError);
    });

    it("rejects a page containing a lead whose `id` is a blank string", () => {
      const page: LeadPage = { leads: [lead({ id: "  " })], nextCursor: null };
      expect(() => assertValidLeadPage(page)).toThrow(LeadShapeError);
    });

    it("rejects a page where only one of several leads lacks an id - the whole page, not just that lead", () => {
      const page = {
        leads: [lead({ id: "lead-1" }), { name: "No Id" } as unknown as Lead],
        nextCursor: null,
      };
      expect(() => assertValidLeadPage(page)).toThrow(LeadShapeError);
    });

    it("says how many leads had no id", () => {
      const page = {
        leads: [{} as unknown as Lead, {} as unknown as Lead, lead()],
        nextCursor: null,
      };
      expect(() => assertValidLeadPage(page)).toThrow(/2 leads with no id/);
    });
  });

  describe("isStalledCursor (LR-SEC-W1 item 4)", () => {
    it("is stalled when nextCursor echoes the cursor it was just asked with", () => {
      expect(isStalledCursor("abc", "abc")).toBe(true);
    });

    it("is not stalled when nextCursor moves forward", () => {
      expect(isStalledCursor("abc", "def")).toBe(false);
    });

    it("is not stalled when nextCursor is null - that means caught up", () => {
      expect(isStalledCursor("abc", null)).toBe(false);
    });

    it("is not stalled on the very first page, where the requested cursor is null", () => {
      // A null request answered with a null nextCursor means "there was
      // nothing at all", not a stall - both sides being null must not match
      // the stall rule the same way two equal strings would.
      expect(isStalledCursor(null, null)).toBe(false);
    });

    it("is not stalled when a null cursor is answered with a real one", () => {
      expect(isStalledCursor(null, "abc")).toBe(false);
    });
  });
});
