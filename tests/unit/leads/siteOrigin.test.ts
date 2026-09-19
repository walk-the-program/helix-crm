import { describe, it, expect } from "vitest";
import { checkOrigin, syncKeyFor } from "@/features/leads/lib/siteConnection";

/** No jargon a non-technical business owner would trip over. */
const JARGON = /\bURL\b|protocol|parse|invalid/i;

describe("siteConnection", () => {
  describe("checkOrigin", () => {
    it("accepts a plain https address", () => {
      const result = checkOrigin("https://sorensenlandscaping.com");
      expect(result).toEqual({ ok: true, origin: "https://sorensenlandscaping.com" });
    });

    it("trims a trailing slash", () => {
      const result = checkOrigin("https://sorensenlandscaping.com/");
      expect(result).toEqual({ ok: true, origin: "https://sorensenlandscaping.com" });
    });

    it("accepts http on the loopback IP for local development", () => {
      const result = checkOrigin("http://127.0.0.1:4711");
      expect(result).toEqual({ ok: true, origin: "http://127.0.0.1:4711" });
    });

    it("accepts http on localhost for local development", () => {
      const result = checkOrigin("http://localhost:4711");
      expect(result).toEqual({ ok: true, origin: "http://localhost:4711" });
    });

    it("rejects an empty or whitespace-only address", () => {
      expect(checkOrigin("").ok).toBe(false);
      expect(checkOrigin("   ").ok).toBe(false);
    });

    it("rejects an address with no scheme", () => {
      expect(checkOrigin("sorensenlandscaping.com").ok).toBe(false);
    });

    it("rejects plain http off the loopback address", () => {
      expect(checkOrigin("http://sorensenlandscaping.com").ok).toBe(false);
    });

    it("rejects a non-http(s) scheme", () => {
      expect(checkOrigin("ftp://sorensenlandscaping.com").ok).toBe(false);
    });

    it("rejects a URL with a page path on it", () => {
      // Only the bare site address is wanted, e.g. no /contact.
      expect(checkOrigin("https://x.com/contact").ok).toBe(false);
    });

    it("gives a plain, actionable sentence for every rejection", () => {
      const rejections = [
        "",
        "   ",
        "sorensenlandscaping.com",
        "http://sorensenlandscaping.com",
        "ftp://sorensenlandscaping.com",
        "https://x.com/contact",
      ];
      for (const input of rejections) {
        const result = checkOrigin(input);
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.message.length).toBeGreaterThan(0);
        expect(result.message).not.toMatch(JARGON);
      }
    });
  });

  describe("syncKeyFor", () => {
    it("is the same key whether or not the origin has a trailing slash", () => {
      expect(syncKeyFor("https://X.com/")).toBe(syncKeyFor("https://X.com"));
    });

    it("lowercases the scheme and host", () => {
      expect(syncKeyFor("https://Sorensenlandscaping.COM")).toBe(
        "https://sorensenlandscaping.com",
      );
    });
  });
});
