// @vitest-environment jsdom
/**
 * OverviewScreen (/reports): the four report groups, their links, and the
 * null / zero-divisor cases that must render "—" rather than 0, "NaN%" or
 * "null" (round 3, criterion 15).
 *
 * `useOverview` is mocked so this test drives `OverviewBundle` shapes
 * directly rather than standing up react-query and the database - the hook
 * itself already belongs to src/features/leads/lib/reportKeys.ts, which is
 * out of this task's ownership and unedited here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { OverviewBundle } from "@/db/repos/reports";
import { installRadixStubs } from "../ui/radixSetup";

installRadixStubs();

const mockUseOverview = vi.fn();
vi.mock("@/features/leads/lib/reportKeys", () => ({
  useOverview: (...args: unknown[]) => mockUseOverview(...args),
}));

// Imported after the mock so OverviewScreen's own import of reportKeys
// resolves to the mocked module.
const { renderOverview } = await import("./overview.fixtures");

afterEach(() => {
  cleanup();
  mockUseOverview.mockReset();
});

function bundle(overrides: Partial<OverviewBundle> = {}): OverviewBundle {
  return {
    deals: {
      newCount: 3,
      newValueCents: 30_000,
      wonCount: 0,
      lostCount: 0,
      closedCount: 0,
      wonRate: null,
      wonValueCents: 0,
      averageWonCents: null,
      medianDaysToWin: null,
    },
    people: {
      contacts: 0,
      companies: 4,
      contactsWithDeal: 0,
      companiesWithDeal: 2,
      newContacts: 0,
      newCompanies: 1,
    },
    money: {
      quotedCents: 150_000,
      openCents: 150_000,
      wonCents: 0,
      invoicedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
    },
    mrrCents: 12_000,
    arrCents: 144_000,
    openByStage: [
      {
        stageId: "s1",
        stageName: "New lead",
        stagePosition: 0,
        stageColor: "var(--stage-1)",
        openDeals: 2,
        openValueCents: 40_000,
      },
      {
        stageId: "s2",
        stageName: "Estimate sent",
        stagePosition: 1,
        stageColor: "var(--stage-3)",
        openDeals: 1,
        openValueCents: 20_000,
      },
    ],
    ...overrides,
  };
}

function loaded(data: OverviewBundle) {
  mockUseOverview.mockReturnValue({ isPending: false, isError: false, data });
}

describe("OverviewScreen", () => {
  it("renders all four groups, each linking to its own report tab", () => {
    loaded(bundle());
    renderOverview();

    // getByRole/getByText throw when nothing matches, so reaching the
    // assertion below is itself proof each of these exists exactly once.
    screen.getByRole("heading", { name: "Revenue" });
    screen.getByRole("heading", { name: "Deals" });
    screen.getByRole("heading", { name: "Contacts and companies" });
    screen.getByRole("heading", { name: "Open pipeline" });

    // Revenue's exact money words.
    for (const label of ["Quoted", "Won", "Invoiced", "Collected", "Outstanding"]) {
      screen.getByText(label);
    }

    const links = screen.getAllByRole("link", { name: "See the detail" });
    const hrefs = links.map((link) => link.getAttribute("href")).sort();
    // Revenue -> /reports/revenue, Deals and Open pipeline -> /reports/deals,
    // Contacts and companies -> /reports/people.
    expect(hrefs).toEqual(
      ["/reports/deals", "/reports/deals", "/reports/people", "/reports/revenue"].sort(),
    );
  });

  it("renders won rate, average won value and median days to win as em dashes when nothing has won", () => {
    loaded(
      bundle({
        deals: {
          newCount: 5,
          newValueCents: 50_000,
          wonCount: 0,
          lostCount: 2,
          closedCount: 2,
          wonRate: null,
          wonValueCents: 0,
          averageWonCents: null,
          medianDaysToWin: null,
        },
      }),
    );
    renderOverview();

    // Three distinct null figures, each an em dash - never 0, "NaN%" or "null".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText("null")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("renders a deal share of '—' when there are no contacts to divide by", () => {
    loaded(bundle({ people: { contacts: 0, companies: 3, contactsWithDeal: 0, companiesWithDeal: 1, newContacts: 0, newCompanies: 0 } }));
    renderOverview();

    // "Contacts with a deal" is 0/0 - guarded to "—", not "NaN%".
    const contactsLabel = screen.getByText("Contacts with a deal");
    expect(contactsLabel.parentElement?.textContent).toContain("—");
    expect(contactsLabel.parentElement?.textContent).not.toMatch(/NaN/);
  });

  it("spends zero primary buttons - the tab links are text links, not buttons", () => {
    loaded(bundle());
    renderOverview();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("passes each stage's own stageColor through as the bar fill, never a literal", () => {
    loaded(bundle());
    const { container } = renderOverview();

    const bars = container.querySelectorAll<HTMLElement>('[style*="background-color"]');
    const colors = Array.from(bars).map((el) => el.style.backgroundColor);
    expect(colors).toContain("var(--stage-1)");
    expect(colors).toContain("var(--stage-3)");
  });

  it("shows a spinner while pending and an EmptyState carrying the error message on failure", () => {
    mockUseOverview.mockReturnValue({ isPending: true, isError: false, data: undefined });
    const { unmount } = renderOverview();
    screen.getByText("Loading reports");
    unmount();

    mockUseOverview.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("disk is on fire"),
      data: undefined,
    });
    renderOverview();
    screen.getByText("disk is on fire");
  });

  it("shows a single worded empty state for a brand-new workspace instead of a wall of zeroes", () => {
    loaded(
      bundle({
        deals: {
          newCount: 0,
          newValueCents: 0,
          wonCount: 0,
          lostCount: 0,
          closedCount: 0,
          wonRate: null,
          wonValueCents: 0,
          averageWonCents: null,
          medianDaysToWin: null,
        },
        people: { contacts: 0, companies: 0, contactsWithDeal: 0, companiesWithDeal: 0, newContacts: 0, newCompanies: 0 },
        money: { quotedCents: 0, openCents: 0, wonCents: 0, invoicedCents: 0, collectedCents: 0, outstandingCents: 0 },
        mrrCents: 0,
        arrCents: 0,
        openByStage: [],
      }),
    );
    renderOverview();

    screen.getByText("Nothing here yet");
    expect(screen.queryByText("Quoted")).toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});
