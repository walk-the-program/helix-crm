import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  formatPhone,
  isValidPhone,
  phoneDigits,
  DEFAULT_REGION,
} from "@/lib/phone";

describe("phone", () => {
  describe("normalizePhone", () => {
    it("collapses the three documented US formats to the same E.164", () => {
      const a = normalizePhone("801.555.0100");
      const b = normalizePhone("(801) 555-0100");
      const c = normalizePhone("+1 801 555 0100");

      expect(a.e164).toBe("+18015550100");
      expect(b.e164).toBe("+18015550100");
      expect(c.e164).toBe("+18015550100");
    });

    it("keeps the trimmed input as raw", () => {
      const result = normalizePhone("  801.555.0100  ");
      expect(result.raw).toBe("801.555.0100");
    });

    it("returns empty raw and null e164 for empty/whitespace input", () => {
      expect(normalizePhone("")).toEqual({ raw: "", e164: null });
      expect(normalizePhone("   ")).toEqual({ raw: "", e164: null });
    });

    it("never rejects unparseable numbers: raw is kept, e164 is null", () => {
      const result = normalizePhone("not a phone number");
      expect(result.raw).toBe("not a phone number");
      expect(result.e164).toBeNull();
    });

    it("keeps too-short numbers raw with null e164", () => {
      const result = normalizePhone("555-0100");
      expect(result.raw).toBe("555-0100");
      expect(result.e164).toBeNull();
    });

    it("defaults to the DEFAULT_REGION (US)", () => {
      expect(DEFAULT_REGION).toBe("US");
      const result = normalizePhone("801.555.0100");
      expect(result.e164).toBe("+18015550100");
    });

    it("honors a non-US region override", () => {
      const result = normalizePhone("020 7946 0958", "GB");
      expect(result.e164).toBe("+442079460958");
    });

    it("parses an already-international number regardless of region", () => {
      const result = normalizePhone("+442079460958", "US");
      expect(result.e164).toBe("+442079460958");
    });
  });

  describe("formatPhone", () => {
    it("formats nationally when the number belongs to the given region", () => {
      expect(formatPhone("+18015550100", "US")).toBe("(801) 555-0100");
    });

    it("formats internationally when the number parses but belongs elsewhere", () => {
      const result = formatPhone("+442079460958", "US");
      expect(result).toBe("+44 20 7946 0958");
    });

    it("returns the raw string verbatim when it does not parse", () => {
      expect(formatPhone("not a phone number")).toBe("not a phone number");
    });

    it("returns empty string for null/undefined, never 'undefined'", () => {
      expect(formatPhone(null)).toBe("");
      expect(formatPhone(undefined)).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(formatPhone("   ")).toBe("");
    });
  });

  describe("isValidPhone", () => {
    it("is true for a valid US number", () => {
      expect(isValidPhone("801.555.0100")).toBe(true);
    });

    it("is false for an invalid/unparseable number", () => {
      expect(isValidPhone("555-0100")).toBe(false);
      expect(isValidPhone("not a phone")).toBe(false);
    });

    it("is false for empty input", () => {
      expect(isValidPhone("")).toBe(false);
    });

    it("honors a non-US region", () => {
      expect(isValidPhone("020 7946 0958", "GB")).toBe(true);
      expect(isValidPhone("020 7946 0958", "US")).toBe(false);
    });
  });

  describe("phoneDigits", () => {
    it("strips everything but digits from a formatted number", () => {
      expect(phoneDigits("(801) 555-0100")).toBe("8015550100");
    });

    it("keeps a leading +", () => {
      expect(phoneDigits("+1 801 555 0100")).toBe("+18015550100");
    });

    it("returns empty string for empty input", () => {
      expect(phoneDigits("")).toBe("");
    });

    it("does not keep a + that is not leading", () => {
      expect(phoneDigits("801+555+0100")).toBe("8015550100");
    });
  });
});
