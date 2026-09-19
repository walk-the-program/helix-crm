import { describe, it, expect } from "vitest";
import {
  formatMoney,
  formatMoneyCompact,
  parseMoneyToCents,
  centsToDecimalString,
  sumCents,
} from "@/lib/money";

describe("money", () => {
  describe("formatMoney", () => {
    it("formats positive cents as USD by default", () => {
      expect(formatMoney(123456, undefined, "en-US")).toBe("$1,234.56");
    });

    it("formats zero", () => {
      expect(formatMoney(0, undefined, "en-US")).toBe("$0.00");
    });

    it("formats negative cents", () => {
      expect(formatMoney(-500, undefined, "en-US")).toBe("-$5.00");
    });

    it("honors an explicit currency", () => {
      const result = formatMoney(100000, "EUR", "en-US");
      expect(result).toContain("1,000.00");
    });
  });

  describe("formatMoneyCompact", () => {
    it("degrades to the full format under 1000 currency units", () => {
      expect(formatMoneyCompact(50000, undefined, "en-US")).toBe(
        formatMoney(50000, undefined, "en-US"),
      );
    });

    it("compacts large amounts, e.g. ~$12.5k", () => {
      const result = formatMoneyCompact(1250000, undefined, "en-US");
      expect(result.toLowerCase()).toContain("k");
    });

    it("formats zero the same as formatMoney", () => {
      expect(formatMoneyCompact(0, undefined, "en-US")).toBe(formatMoney(0, undefined, "en-US"));
    });
  });

  describe("parseMoneyToCents", () => {
    it("parses a comma-thousands, dot-decimal string", () => {
      expect(parseMoneyToCents("1,234.56")).toBe(123456);
    });

    it("parses a dollar-prefixed string", () => {
      expect(parseMoneyToCents("$1,234.56")).toBe(123456);
    });

    it("parses a bare integer string", () => {
      expect(parseMoneyToCents("1234")).toBe(123400);
    });

    it("parses a comma-decimal string when there is no dot", () => {
      expect(parseMoneyToCents("1 234,56")).toBe(123456);
    });

    it("parses a bare negative number", () => {
      expect(parseMoneyToCents("-50")).toBe(-5000);
    });

    it("parses zero", () => {
      expect(parseMoneyToCents("0")).toBe(0);
      expect(parseMoneyToCents("0.00")).toBe(0);
    });

    it("rounds to the nearest cent", () => {
      expect(parseMoneyToCents("1.005")).toBe(101);
      expect(parseMoneyToCents("1.004")).toBe(100);
    });

    it("returns null for gibberish input", () => {
      expect(parseMoneyToCents("not money")).toBeNull();
      expect(parseMoneyToCents("$$$")).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(parseMoneyToCents("")).toBeNull();
      expect(parseMoneyToCents("   ")).toBeNull();
    });
  });

  describe("centsToDecimalString", () => {
    it("formats a whole dollar amount", () => {
      expect(centsToDecimalString(123400)).toBe("1234.00");
    });

    it("formats an amount with cents", () => {
      expect(centsToDecimalString(123450)).toBe("1234.50");
    });

    it("formats zero", () => {
      expect(centsToDecimalString(0)).toBe("0.00");
    });

    it("formats negative cents with a leading minus", () => {
      expect(centsToDecimalString(-500)).toBe("-5.00");
    });

    it("pads single-digit cents", () => {
      expect(centsToDecimalString(105)).toBe("1.05");
    });
  });

  describe("sumCents", () => {
    it("sums an array of cent values", () => {
      expect(sumCents([100, 200, 300])).toBe(600);
    });

    it("treats null and undefined entries as zero", () => {
      expect(sumCents([100, null, undefined, 50])).toBe(150);
    });

    it("returns 0 for an empty array", () => {
      expect(sumCents([])).toBe(0);
    });

    it("handles negative values", () => {
      expect(sumCents([100, -50, null])).toBe(50);
    });
  });
});
