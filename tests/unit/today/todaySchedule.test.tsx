// @vitest-environment jsdom
/**
 * Today's schedule section: the day's timed work, and the silence that is
 * the right answer on most days.
 *
 * The feed itself is proven against fixtures in tests/unit/schedule/feed.test.ts.
 * What only a render can prove is the rule this section exists for: an
 * all-day row belongs to Due now, not to an agenda that answers "at what
 * time", and a day with nothing timed on it must draw no heading, no panel
 * and no empty state at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ScheduleItem } from "@/features/schedule/lib/types";
import { todayLocal } from "@/lib/dates";

const scheduleItems = vi.fn();

vi.mock("@/features/schedule/lib/feed", () => ({
  scheduleItems: (...args: unknown[]) => scheduleItems(...args),
}));

import { TodaySchedule } from "@/features/today/sections/TodaySchedule";

const TODAY = todayLocal();

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: "visit:t1",
    kind: "visit",
    sourceId: "t1",
    date: TODAY,
    at: `${TODAY}T14:00:00.000Z`,
    durationMinutes: 60,
    title: "Site visit",
    who: { label: "Priya Raman", href: "/contacts/c1" },
    place: "12 Mill Lane",
    note: null,
    href: "/contacts/c1",
    contactId: "c1",
    companyId: null,
    dealId: null,
    phone: "555-0100",
    ...overrides,
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  scheduleItems.mockReset();
});

describe("Today's schedule", () => {
  it("draws nothing at all on a day with nothing timed on it", async () => {
    scheduleItems.mockResolvedValue([
      item({ id: "task:t2", kind: "task", at: null, durationMinutes: null, title: "Order sod" }),
    ]);
    const { container } = render(wrap(<TodaySchedule />));
    await waitFor(() => expect(scheduleItems).toHaveBeenCalled());
    expect(screen.queryByText("Today's schedule")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("draws nothing when the whole day is empty", async () => {
    scheduleItems.mockResolvedValue([]);
    const { container } = render(wrap(<TodaySchedule />));
    await waitFor(() => expect(scheduleItems).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("lists the day's timed work with the customer and the place", async () => {
    scheduleItems.mockResolvedValue([
      item(),
      item({
        id: "visit:t3",
        sourceId: "t3",
        at: `${TODAY}T09:30:00.000Z`,
        title: "Estimate",
        who: { label: "Mountain Shadows", href: "/companies/co1" },
        place: null,
      }),
    ]);
    render(wrap(<TodaySchedule />));

    expect(await screen.findByText("Today's schedule")).toBeTruthy();
    expect(screen.getByText("Site visit")).toBeTruthy();
    expect(screen.getByText("Estimate")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Priya Raman" })).toBeTruthy();
    expect(screen.getByText(/12 Mill Lane/)).toBeTruthy();
  });

  it("asks the feed for today alone, not for a range", async () => {
    scheduleItems.mockResolvedValue([]);
    render(wrap(<TodaySchedule />));
    await waitFor(() => expect(scheduleItems).toHaveBeenCalledWith({ from: TODAY, to: TODAY }));
  });
});
