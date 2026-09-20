/**
 * The deal value math, on its own.
 *
 * Every number the deal page, the board and the revenue report show comes out
 * of `totalsFor`, so the arithmetic is tested without a database: the yearly
 * normalisation, where the rounding lands, and the discount.
 */
import { describe, expect, it } from "vitest";
import {
  annualValueCents,
  monthlyCentsFor,
  MONTHS_PER_YEAR,
  oneTimeCentsFor,
  totalsFor,
  type ValueLine,
} from "../../../src/db/repos/dealItems";

function line(over: Partial<ValueLine> = {}): ValueLine {
  return {
    kind: "one_time",
    interval: null,
    qty: 1,
    suggestedUnitCents: 0,
    actualUnitCents: 0,
    ...over,
  };
}

describe("one line at a time", () => {
  it("charges a one-time line once and never monthly", () => {
    const l = line({ qty: 3, actualUnitCents: 50_000 });
    expect(oneTimeCentsFor(l, l.actualUnitCents)).toBe(150_000);
    expect(monthlyCentsFor(l, l.actualUnitCents)).toBe(0);
  });

  it("charges a monthly line monthly and never up front", () => {
    const l = line({ kind: "recurring", interval: "month", qty: 2, actualUnitCents: 15_000 });
    expect(monthlyCentsFor(l, l.actualUnitCents)).toBe(30_000);
    expect(oneTimeCentsFor(l, l.actualUnitCents)).toBe(0);
  });

  it("normalises a yearly line to a month", () => {
    const l = line({ kind: "recurring", interval: "year", actualUnitCents: 120_000 });
    expect(monthlyCentsFor(l, l.actualUnitCents)).toBe(10_000);
  });

  it("rounds a yearly line that does not divide by twelve", () => {
    // $100.00 a year is 833.33 cents a month; the stored number is whole cents.
    const l = line({ kind: "recurring", interval: "year", actualUnitCents: 10_000 });
    expect(monthlyCentsFor(l, l.actualUnitCents)).toBe(833);
  });

  it("rounds half up", () => {
    // 10_006 / 12 = 833.83..., and 78 / 12 = 6.5 exactly.
    expect(
      monthlyCentsFor(line({ kind: "recurring", interval: "year", actualUnitCents: 78 }), 78),
    ).toBe(7);
  });

  it("rounds per line rather than over the sum", () => {
    // Three $100/year plans are 833 each, so the deal says 2,499 a month and
    // not 2,500. The rows on the deal page have to add up to the total under
    // them, which is the number the owner checks.
    const yearly = line({ kind: "recurring", interval: "year", actualUnitCents: 10_000 });
    const totals = totalsFor([yearly, yearly, yearly]);
    expect(totals.recurringMonthlyCents).toBe(2_499);
  });
});

describe("a deal's totals", () => {
  it("is upfront plus twelve months of recurring", () => {
    expect(annualValueCents(150_000, 15_000)).toBe(150_000 + MONTHS_PER_YEAR * 15_000);
  });

  it("adds a one-time line and a monthly line into the breakdown", () => {
    const totals = totalsFor([
      line({ actualUnitCents: 150_000, suggestedUnitCents: 150_000 }),
      line({
        kind: "recurring",
        interval: "month",
        actualUnitCents: 15_000,
        suggestedUnitCents: 15_000,
      }),
    ]);
    expect(totals.oneTimeCents).toBe(150_000);
    expect(totals.recurringMonthlyCents).toBe(15_000);
    expect(totals.valueCents).toBe(330_000);
    expect(totals.suggestedTotalCents).toBe(330_000);
    expect(totals.discountCents).toBe(0);
  });

  it("shows the discount when the owner charges less than the catalog says", () => {
    // Suggested $2,100, actual $1,650: the deal page's own example.
    const totals = totalsFor([
      line({ suggestedUnitCents: 210_000, actualUnitCents: 165_000 }),
    ]);
    expect(totals.suggestedTotalCents).toBe(210_000);
    expect(totals.valueCents).toBe(165_000);
    expect(totals.discountCents).toBe(45_000);
  });

  it("shows a negative discount when he charges more", () => {
    const totals = totalsFor([
      line({ suggestedUnitCents: 100_000, actualUnitCents: 120_000 }),
    ]);
    expect(totals.discountCents).toBe(-20_000);
  });

  it("prices a discount on a monthly line across the whole year", () => {
    // $50 a month off is $600 a year off, because value is the annual figure.
    const totals = totalsFor([
      line({
        kind: "recurring",
        interval: "month",
        suggestedUnitCents: 20_000,
        actualUnitCents: 15_000,
      }),
    ]);
    expect(totals.recurringMonthlyCents).toBe(15_000);
    expect(totals.suggestedRecurringMonthlyCents).toBe(20_000);
    expect(totals.discountCents).toBe(60_000);
  });

  it("is all zeroes for a deal with no lines", () => {
    const totals = totalsFor([]);
    expect(totals.valueCents).toBe(0);
    expect(totals.suggestedTotalCents).toBe(0);
    expect(totals.discountCents).toBe(0);
  });

  it("keeps the total equal to the breakdown it shows", () => {
    // The invariant the whole design rests on: whatever the page prints as
    // "Upfront X + Y/mo" must be the stored value, with no third number.
    const totals = totalsFor([
      line({ qty: 2, actualUnitCents: 33_333, suggestedUnitCents: 33_333 }),
      line({
        kind: "recurring",
        interval: "year",
        actualUnitCents: 99_999,
        suggestedUnitCents: 99_999,
      }),
    ]);
    expect(totals.valueCents).toBe(
      totals.oneTimeCents + MONTHS_PER_YEAR * totals.recurringMonthlyCents,
    );
  });
});
