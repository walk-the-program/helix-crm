/**
 * Schedule: the owner's week, in one place.
 *
 * Today a trade owner keeps this in a paper diary or in Google Calendar and
 * re-types it, because Helix already holds a visit at nine, a job he said he
 * would start Thursday, a reminder that came round again and an invoice that
 * falls due Friday — and shows none of them together. This screen is that
 * one place: a week strip he can flip through and a day underneath it, built
 * entirely off `scheduleItems`, which reads the tables Helix already trusts
 * rather than a second copy of the same dates (decision PX-6).
 *
 * The week and the selected day live in component state, not in the URL —
 * only a single day has a route of its own (`ScheduleDayScreen`, for a link
 * that has to survive a reload). The default selection is today, when today
 * falls inside the week on screen, and the Monday otherwise; moving weeks
 * re-applies the same rule, and jumping to a specific date always lands
 * exactly there.
 */
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Plus } from "@/ui/icons";
import { Button, EmptyState, PageHeader } from "@/ui";
import { isTypingTarget } from "@/app/shortcuts";
import { useFormats } from "@/app/formats";
import { todayLocal } from "@/lib/dates";
import { countByDate, itemsOn } from "@/features/schedule/lib/types";
import {
  addDays,
  addWeeksToDate,
  startOfWeekMonday,
  weekRangeLabel,
} from "@/features/schedule/lib/week";
import { openVisitDialog } from "@/features/schedule/lib/visitDialog";
import { useSchedule } from "@/features/schedule/lib/hooks";
import { WeekStrip } from "@/features/schedule/components/WeekStrip";
import { DayAgenda } from "@/features/schedule/components/DayAgenda";

/** Today when it falls in the week that starts on `weekStart`, else the Monday. */
function defaultSelectedFor(weekStart: string, today: string): string {
  const weekEnd = addDays(weekStart, 6);
  return weekStart <= today && today <= weekEnd ? today : weekStart;
}

export function ScheduleScreen() {
  const formats = useFormats();
  const today = todayLocal();

  const [weekStart, setWeekStart] = useState<string>(() => startOfWeekMonday(today));
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    defaultSelectedFor(startOfWeekMonday(today), today),
  );

  const weekEnd = addDays(weekStart, 6);
  const { data: weekItems, isLoading } = useSchedule({ from: weekStart, to: weekEnd });
  const counts = countByDate(weekItems ?? []);
  const dayItems = itemsOn(weekItems ?? [], selectedDate);
  const weekIsEmpty = !isLoading && (weekItems ?? []).length === 0;

  function goToWeek(nextWeekStart: string) {
    setWeekStart(nextWeekStart);
    setSelectedDate(defaultSelectedFor(nextWeekStart, today));
  }

  function handlePrevWeek() {
    goToWeek(addWeeksToDate(weekStart, -1));
  }

  function handleNextWeek() {
    goToWeek(addWeeksToDate(weekStart, 1));
  }

  function handleThisWeek() {
    setWeekStart(startOfWeekMonday(today));
    setSelectedDate(today);
  }

  function handleJumpToDate(date: string) {
    setWeekStart(startOfWeekMonday(date));
    setSelectedDate(date);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Bound on this screen's own container, never as a global shortcut — the
    // shell owns those. A key a child already handled (the DatePicker's own
    // calendar grid calls preventDefault on its arrow keys) is left alone,
    // and so is anything typed into a field, a select or a contenteditable,
    // so paging the mini calendar never also flips the week.
    if (event.defaultPrevented) return;
    if (isTypingTarget(event.target)) return;
    if (event.key === "ArrowLeft") {
      handlePrevWeek();
    } else if (event.key === "ArrowRight") {
      handleNextWeek();
    }
  }

  return (
    <div
      className="flex flex-col gap-[var(--space-6)]"
      data-testid="schedule-screen"
      onKeyDown={handleKeyDown}
    >
      <PageHeader
        title="Schedule"
        subtitle={weekRangeLabel(weekStart, formats.locale)}
        actions={
          <Button
            type="button"
            variant="primary"
            iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
            onClick={() => openVisitDialog({ date: selectedDate })}
          >
            Schedule a visit
          </Button>
        }
      />

      <WeekStrip
        weekStart={weekStart}
        selectedDate={selectedDate}
        counts={counts}
        locale={formats.locale}
        onSelectDate={setSelectedDate}
        onPrevWeek={handlePrevWeek}
        onNextWeek={handleNextWeek}
        onThisWeek={handleThisWeek}
        onJumpToDate={handleJumpToDate}
      />

      {isLoading ? (
        <p role="status" className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Reading the database.
        </p>
      ) : weekIsEmpty ? (
        // The whole week has nothing on it: one message, one action. Showing
        // the day agenda underneath as well would repeat the same "nothing
        // here" sentence with a second "Schedule a visit" button next to it —
        // exactly the two-competing-actions bug DESIGN.md forbids.
        <EmptyState
          variant="quiet"
          title="Nothing in the diary this week."
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openVisitDialog({ date: selectedDate })}
            >
              Schedule a visit
            </Button>
          }
        />
      ) : (
        <DayAgenda date={selectedDate} items={dayItems} />
      )}
    </div>
  );
}
