// @vitest-environment jsdom
/**
 * Today's outstanding line: the sentence the owner reads about money he is
 * still owed, once payments exist (LR-PX-A addition 9, relayed to LR-PX-B).
 *
 * The wording itself is proven pure in tests/unit/invoices/format.test.ts.
 * What only a render can prove is the part Today owns: that the line picks
 * the right sentence for the summary it is given, prints the balances
 * version rather than the old totals version, and says nothing at all on a
 * day with nothing outstanding - which is the state most days are in, and
 * the one where a standing "Nothing outstanding." would train him to stop
 * reading the line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OutstandingSummary } from "@/features/invoices/lib/format";

const useOutstandingSummary = vi.fn();

vi.mock("@/features/invoices/lib/hooks", () => ({
  useOutstandingSummary: () => useOutstandingSummary(),
}));

import { OutstandingLine } from "@/features/today/sections/OutstandingLine";

function summary(overrides: Partial<OutstandingSummary> = {}): OutstandingSummary {
  return {
    sentCount: 0,
    outstandingCents: 0,
    overdueCount: 0,
    worstOverdueDays: 0,
    draftCount: 0,
    partialCount: 0,
    ...overrides,
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  useOutstandingSummary.mockReset();
});

describe("Today's outstanding line", () => {
  it("says nothing when nothing is outstanding", () => {
    useOutstandingSummary.mockReturnValue({ data: summary() });
    render(wrap(<OutstandingLine />));
    expect(screen.queryByTestId("today-outstanding")).toBeNull();
  });

  it("says nothing while the summary is still loading", () => {
    useOutstandingSummary.mockReturnValue({ data: undefined });
    render(wrap(<OutstandingLine />));
    expect(screen.queryByTestId("today-outstanding")).toBeNull();
  });

  it("prints the balance, the part-paid count and the worst overdue", () => {
    useOutstandingSummary.mockReturnValue({
      data: summary({
        sentCount: 3,
        outstandingCents: 215000,
        overdueCount: 1,
        worstOverdueDays: 12,
        partialCount: 1,
      }),
    });
    render(wrap(<OutstandingLine />));
    expect(screen.getByTestId("today-outstanding").textContent).toContain(
      "3 unpaid, $2,150.00 outstanding, 1 part paid, 1 overdue by 12 days.",
    );
  });

  it("prints the plural part-paid clause and drops the overdue one", () => {
    useOutstandingSummary.mockReturnValue({
      data: summary({ sentCount: 5, outstandingCents: 300000, partialCount: 2 }),
    });
    render(wrap(<OutstandingLine />));
    expect(screen.getByTestId("today-outstanding").textContent).toContain(
      "5 unpaid, $3,000.00 outstanding, 2 part paid.",
    );
  });

  it("drops both clauses when nothing is part paid or overdue", () => {
    useOutstandingSummary.mockReturnValue({
      data: summary({ sentCount: 2, outstandingCents: 40000 }),
    });
    render(wrap(<OutstandingLine />));
    expect(screen.getByTestId("today-outstanding").textContent).toContain(
      "2 unpaid, $400.00 outstanding.",
    );
  });

  it("offers the way through to receivables", () => {
    useOutstandingSummary.mockReturnValue({
      data: summary({ sentCount: 2, outstandingCents: 40000 }),
    });
    render(wrap(<OutstandingLine />));
    expect(screen.getByRole("link", { name: "Open receivables" })).toHaveProperty(
      "href",
      expect.stringContaining("/reports/receivables") as unknown as string,
    );
  });
});
