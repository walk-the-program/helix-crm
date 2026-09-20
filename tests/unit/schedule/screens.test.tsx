// @vitest-environment jsdom
/**
 * The Schedule screens: the week view, the day view, and the two rules the
 * whole feature stands on — one action on an empty day or week, and every
 * word on a row following the workspace's own vocabulary rather than a
 * hard-coded "Deal".
 *
 * `@/features/schedule/lib/feed` is mocked so every test renders off a fixed
 * fixture list rather than a database; `week.ts`, `labels.ts`, `types.ts` and
 * `calendar.ts` are the real modules, the same contract the screens are built
 * against, so the ordering and the labels under test are exactly what
 * production draws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/ui";
import { installRadixStubs } from "../ui/radixSetup";
import { todayLocal } from "@/lib/dates";
import {
  addWeeksToDate,
  dayLabel,
  startOfWeekMonday,
  weekDays,
  weekRangeLabel,
} from "@/features/schedule/lib/week";
import type { ScheduleItem } from "@/features/schedule/lib/types";
import type { Vocabulary } from "@/lib/vocabulary";

installRadixStubs();

/* -------------------------------------------------------------------------- */
/* mocks                                                                      */
/* -------------------------------------------------------------------------- */

const scheduleState = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/features/schedule/lib/feed", () => ({
  scheduleItems: () => Promise.resolve(scheduleState.items),
}));

const DEALS_VOCABULARY: Vocabulary = {
  key: "deals",
  one: "Deal",
  many: "Deals",
  newOne: "New deal",
  lower: "deal",
  lowerMany: "deals",
};
const JOBS_VOCABULARY: Vocabulary = {
  key: "jobs",
  one: "Job",
  many: "Jobs",
  newOne: "New job",
  lower: "job",
  lowerMany: "jobs",
};

// `vi.hoisted` factories run before the module's own top-level statements, so
// this cannot reference `DEALS_VOCABULARY` below — the literal is repeated
// once, here, for that reason alone.
const vocabState = vi.hoisted(() => ({
  current: {
    key: "deals",
    one: "Deal",
    many: "Deals",
    newOne: "New deal",
    lower: "deal",
    lowerMany: "deals",
  },
}));
vi.mock("@/app/vocabulary", () => ({
  useVocabulary: () => vocabState.current,
}));

const openVisitDialogMock = vi.fn();
vi.mock("@/features/schedule/lib/visitDialog", () => ({
  openVisitDialog: (prefill: unknown) => openVisitDialogMock(prefill),
  OPEN_VISIT_EVENT: "helix:open-visit",
}));

import { ScheduleScreen } from "@/features/schedule/screens/ScheduleScreen";
import { ScheduleDayScreen } from "@/features/schedule/screens/ScheduleDayScreen";
import { DayAgenda } from "@/features/schedule/components/DayAgenda";

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const today = todayLocal();
const weekStart = startOfWeekMonday(today);
const days = weekDays(weekStart);
const sparseDay = days.find((d) => d !== today) ?? days[0];

/** An ISO instant at `hour`:`minute` LOCAL time on `dateOnly`, round-tripping
 *  through the same locale `timeLabel` reads back with. */
function isoAt(dateOnly: string, hour: number, minute = 0): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).toISOString();
}

const VISIT: ScheduleItem = {
  id: "visit:t1",
  kind: "visit",
  sourceId: "t1",
  date: today,
  at: isoAt(today, 9, 0),
  durationMinutes: 60,
  title: "Site visit",
  who: { label: "Jane Doe", href: "/contacts/c1" },
  place: "123 Main St",
  href: "/tasks",
  contactId: "c1",
  companyId: null,
  dealId: null,
  phone: "555-0100",
  note: null,
};

const DEAL_EXPECTED: ScheduleItem = {
  id: "deal-expected:d1",
  kind: "deal-expected",
  sourceId: "d1",
  date: today,
  at: null,
  durationMinutes: null,
  title: "Kitchen remodel",
  who: { label: "Bob Smith", href: "/contacts/c2" },
  place: null,
  href: "/deals/d1",
  contactId: "c2",
  companyId: null,
  dealId: "d1",
  phone: null,
  note: null,
};

/* -------------------------------------------------------------------------- */
/* render helpers                                                             */
/* -------------------------------------------------------------------------- */

function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Router>{ui}</Router>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function renderDayScreenAt(path: string) {
  const { hook } = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Router hook={hook}>
          <Route path="/schedule/day/:date" component={ScheduleDayScreen} />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  scheduleState.items = [];
  vocabState.current = DEALS_VOCABULARY;
});

/* -------------------------------------------------------------------------- */
/* the week strip                                                             */
/* -------------------------------------------------------------------------- */

describe("ScheduleScreen: the week strip", () => {
  it("renders seven days, Monday first, with today marked", () => {
    renderWithProviders(<ScheduleScreen />);

    const dayButtons = screen.getAllByTestId("week-strip-day");
    expect(dayButtons).toHaveLength(7);
    expect(dayButtons[0].getAttribute("aria-label")).toMatch(/^Monday/);
    expect(dayButtons[6].getAttribute("aria-label")).toMatch(/^Sunday/);

    const todayButtons = dayButtons.filter((btn) => btn.getAttribute("aria-current") === "date");
    expect(todayButtons).toHaveLength(1);
    expect(todayButtons[0].getAttribute("aria-label")).toBe(dayLabel(today, "en-US"));
  });

  it("moves the week with the arrows and the heading follows", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScheduleScreen />);

    expect(screen.getByText(weekRangeLabel(weekStart, "en-US"))).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(
      screen.getByText(weekRangeLabel(addWeeksToDate(weekStart, 1), "en-US")),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(
      screen.getByText(weekRangeLabel(addWeeksToDate(weekStart, -1), "en-US")),
    ).toBeTruthy();
  });

  it("This week returns to the week today is in", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScheduleScreen />);

    await user.click(screen.getByRole("button", { name: "Next week" }));
    await user.click(screen.getByRole("button", { name: "This week" }));

    expect(screen.getByText(weekRangeLabel(weekStart, "en-US"))).toBeTruthy();
    const todayButtons = screen
      .getAllByTestId("week-strip-day")
      .filter((btn) => btn.getAttribute("aria-pressed") === "true");
    expect(todayButtons).toHaveLength(1);
    expect(todayButtons[0].getAttribute("aria-label")).toBe(dayLabel(today, "en-US"));
  });
});

/* -------------------------------------------------------------------------- */
/* the day agenda                                                             */
/* -------------------------------------------------------------------------- */

describe("ScheduleScreen: the day agenda", () => {
  it("lists a day's items in time order with the kind, the customer and the place", async () => {
    scheduleState.items = [VISIT, DEAL_EXPECTED];
    renderWithProviders(<ScheduleScreen />);

    const rows = await screen.findAllByTestId("schedule-row");
    expect(rows).toHaveLength(2);

    // The timed visit sorts before the all-day deal (compareScheduleItems).
    expect(within(rows[0]).getByText("Visit")).toBeTruthy();
    expect(within(rows[0]).getByText("Jane Doe")).toBeTruthy();
    expect(within(rows[0]).getByText("123 Main St")).toBeTruthy();

    expect(within(rows[1]).getByText("Deal expected")).toBeTruthy();
    expect(within(rows[1]).getByText("Bob Smith")).toBeTruthy();
  });

  it("shows exactly one action on a day with nothing scheduled", async () => {
    const user = userEvent.setup();
    scheduleState.items = [VISIT];
    renderWithProviders(<ScheduleScreen />);

    // Let the week's items load first, so the day agenda is rendering off
    // real data rather than the "Reading the database." loading state.
    await screen.findAllByTestId("schedule-row");

    const sparseButton = screen
      .getAllByTestId("week-strip-day")
      .find((btn) => btn.getAttribute("aria-label") === dayLabel(sparseDay, "en-US"));
    expect(sparseButton).toBeTruthy();
    await user.click(sparseButton as HTMLElement);

    expect(await screen.findByText("Nothing on the books")).toBeTruthy();
    // Two buttons share the name on the page as a whole — the header's own
    // primary action and the empty day's one action — but the day agenda
    // itself offers exactly one, which is the rule this test is checking.
    const scheduleButtons = screen.getAllByRole("button", { name: "Schedule a visit" });
    expect(scheduleButtons).toHaveLength(2);

    await user.click(scheduleButtons[1]);
    expect(openVisitDialogMock).toHaveBeenCalledWith({ date: sparseDay });
  });

  it("shows one message and one action when the whole week is empty", async () => {
    scheduleState.items = [];
    renderWithProviders(<ScheduleScreen />);

    expect(await screen.findByText("Nothing in the diary this week.")).toBeTruthy();
    // Only the header's primary action and the banner's one action exist —
    // the day agenda itself does not also render underneath it.
    expect(screen.getAllByRole("button", { name: "Schedule a visit" })).toHaveLength(2);
    expect(screen.queryByText("Nothing on the books")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

describe("DayAgenda: vocabulary", () => {
  it("says Deal expected under the Deals vocabulary and Job expected under Jobs", () => {
    vocabState.current = DEALS_VOCABULARY;
    const { unmount } = renderWithProviders(<DayAgenda date={today} items={[DEAL_EXPECTED]} />);
    expect(screen.getByText("Deal expected")).toBeTruthy();
    unmount();

    vocabState.current = JOBS_VOCABULARY;
    renderWithProviders(<DayAgenda date={today} items={[DEAL_EXPECTED]} />);
    expect(screen.getByText("Job expected")).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* the day screen                                                             */
/* -------------------------------------------------------------------------- */

describe("ScheduleDayScreen", () => {
  it("falls back to today, quietly, on an unparseable date", () => {
    renderDayScreenAt("/schedule/day/not-a-date");
    expect(screen.getByRole("heading", { name: dayLabel(today, "en-US") })).toBeTruthy();
  });

  it("has a back link to the week", () => {
    renderDayScreenAt(`/schedule/day/${today}`);
    expect(screen.getByRole("link", { name: /Schedule/ })).toBeTruthy();
  });
});
