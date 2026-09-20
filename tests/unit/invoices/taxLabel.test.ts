import { describe, it, expect } from "vitest";
import {
  hasMixedTaxability,
  summarizeTaxLines,
  taxRowLabel,
  type TaxLine,
} from "@/features/invoices/lib/taxLabel";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

describe("taxLabel", () => {
  describe("summarizeTaxLines", () => {
    it("tallies the taxable lines' count and amount separately from the rest", () => {
      const lines: TaxLine[] = [
        { taxable: false, amountCents: 24500 },
        { taxable: true, amountCents: 17400 },
        { taxable: false, amountCents: 51000 },
      ];
      expect(summarizeTaxLines(lines)).toEqual({
        taxableCount: 1,
        lineCount: 3,
        taxableCents: 17400,
      });
    });
  });

  describe("hasMixedTaxability", () => {
    it("is false when every line is taxable", () => {
      expect(hasMixedTaxability({ taxableCount: 3, lineCount: 3, taxableCents: 100 })).toBe(false);
    });

    it("is false when no line is taxable", () => {
      expect(hasMixedTaxability({ taxableCount: 0, lineCount: 3, taxableCents: 0 })).toBe(false);
    });

    it("is true when some lines are taxable and some are not", () => {
      expect(hasMixedTaxability({ taxableCount: 1, lineCount: 3, taxableCents: 100 })).toBe(true);
    });
  });

  describe("taxRowLabel", () => {
    it("all lines taxable: keeps the flat percentage", () => {
      const summary = summarizeTaxLines([
        { taxable: true, amountCents: 50000 },
        { taxable: true, amountCents: 50000 },
      ]);
      const result = taxRowLabel(summary, 8250, "8.25%", dollars);
      expect(result).toEqual({ show: true, label: "Tax (8.25%)" });
    });

    it("some lines taxable: names the taxed amount so the number is not misread as a bug", () => {
      // The reported case: $1,028.00 subtotal, only $174.00 of it taxable,
      // 8.25% of $174.00 is $14.36 - which looks wrong next to the subtotal
      // unless the row says what it is 8.25% of.
      const summary = summarizeTaxLines([
        { taxable: false, amountCents: 24500 },
        { taxable: true, amountCents: 17400 },
        { taxable: false, amountCents: 51000 },
        { taxable: false, amountCents: 9900 },
      ]);
      const result = taxRowLabel(summary, 1436, "8.25%", dollars);
      expect(result).toEqual({ show: true, label: "Tax (8.25% on $174.00)" });
    });

    it("no lines taxable: omits the row rather than showing a $0.00 tax line", () => {
      const summary = summarizeTaxLines([
        { taxable: false, amountCents: 24500 },
        { taxable: false, amountCents: 51000 },
      ]);
      const result = taxRowLabel(summary, 0, "8.25%", dollars);
      expect(result).toEqual({ show: false });
    });

    it("taxable lines but a zero rate: still omits the row, never $0.00", () => {
      const summary = summarizeTaxLines([{ taxable: true, amountCents: 10000 }]);
      const result = taxRowLabel(summary, 0, "0%", dollars);
      expect(result).toEqual({ show: false });
    });
  });
});
