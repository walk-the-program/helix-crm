/**
 * F-LB-11 (which empty state is true) - the pure logic that decides which
 * copy the Unpaid tab shows, extracted from InvoicesScreen.tsx so it is
 * testable without rendering anything.
 */
import { describe, it, expect } from "vitest";
import {
  hasAnyDocuments,
  NO_INVOICES_YET_TITLE,
  noInvoicesYetDescription,
  NOTHING_OUTSTANDING_DESCRIPTION,
  NOTHING_OUTSTANDING_TITLE,
  unpaidEmptyCopy,
} from "@/features/invoices/lib/format";

describe("hasAnyDocuments", () => {
  it("is false only once the count has loaded and is genuinely zero", () => {
    expect(hasAnyDocuments(0)).toBe(false);
  });

  it("is true once any document - draft, quote or void included - has been counted", () => {
    expect(hasAnyDocuments(1)).toBe(true);
    expect(hasAnyDocuments(42)).toBe(true);
  });

  it("assumes true while the count has not loaded yet, so it never flashes the wrong state", () => {
    expect(hasAnyDocuments(undefined)).toBe(true);
  });
});

describe("unpaidEmptyCopy", () => {
  it("a workspace that has never raised a document gets the first-invoice state (F-LB-11a)", () => {
    expect(unpaidEmptyCopy(false, "deal")).toEqual({
      title: NO_INVOICES_YET_TITLE,
      description: noInvoicesYetDescription("deal"),
    });
  });

  it("a workspace with invoices but none unpaid gets the honest 'all paid' sentence (F-LB-11b)", () => {
    expect(unpaidEmptyCopy(true, "deal")).toEqual({
      title: NOTHING_OUTSTANDING_TITLE,
      description: NOTHING_OUTSTANDING_DESCRIPTION,
    });
  });

  it("names the workspace's own word for the concept (F-LB-D22) rather than always saying 'job'", () => {
    expect(unpaidEmptyCopy(false, "job").description).toContain("from a job");
    expect(unpaidEmptyCopy(false, "quote").description).toContain("from a quote");
    expect(unpaidEmptyCopy(false, "deal").description).toContain("from a deal");
  });
});
