/**
 * F-LB-20: the Deals report's Conversion card wrote its Rate column through
 * `formatPercent()` ("45.2%"), the only column in Reports that broke the
 * plain-number rule the rest of reportKeys.ts follows. `rateForCsv` is the
 * fix, exported from DealsReportScreen.tsx for exactly this test.
 *
 * This test lives under tests/unit/invoices per this task's file ownership,
 * even though DealsReportScreen.tsx belongs to the leads feature.
 */
import { describe, it, expect } from "vitest";
import { rateForCsv } from "@/features/leads/screens/DealsReportScreen";

describe("rateForCsv", () => {
  it("emits the raw decimal rate, not a formatted percent string", () => {
    expect(rateForCsv(0.452)).toBe(0.452);
    expect(rateForCsv(1)).toBe(1);
    expect(rateForCsv(0)).toBe(0);
  });

  it("emits an empty cell (never a string like '—') for a pair with nothing to report", () => {
    expect(rateForCsv(null)).toBe("");
  });
});
