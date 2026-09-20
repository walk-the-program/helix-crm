/**
 * The week strip: seven real buttons, Monday to Sunday, and the three ways to
 * move between weeks.
 *
 * Every day is a `<button>` rather than a styled `<td>` or `<div>` — a mouse
 * click and a screen reader both need the same thing here, one control with
 * one accessible name ("Monday 21 September, 2 scheduled"), not a bare number
 * that only makes sense once you have already read the column header above
 * it. Today gets a hairline box, never a colour: the week's one confident
 * colour block already belongs to the header's "Schedule a visit" button, and
 * a second one on the strip would be the second-primary bug DESIGN.md calls
 * out by name. The selected day wears the kit's quiet selected tint instead —
 * the same one a picked table row wears, never the sidebar's primary block.
 */
import { useMemo } from "react";
import { Button, DatePicker, IconButton } from "@/ui";
import { CaretLeft, CaretRight } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { todayLocal } from "@/lib/dates";
import {
  dayLabel,
  dayNumberLabel,
  isSameDay,
  shortDayLabel,
  weekDays,
} from "@/features/schedule/lib/week";

export function WeekStrip(props: {
  /** The Monday of the week on screen. */
  weekStart: string;
  selectedDate: string;
  /** How many items each day holds, keyed by "YYYY-MM-DD" (`countByDate`). */
  counts: Map<string, number>;
  locale?: string;
  onSelectDate: (date: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onJumpToDate: (date: string) => void;
}) {
  const {
    weekStart,
    selectedDate,
    counts,
    locale,
    onSelectDate,
    onPrevWeek,
    onNextWeek,
    onThisWeek,
    onJumpToDate,
  } = props;

  const today = todayLocal();
  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  return (
    <div className="flex flex-col gap-[var(--space-3)]" data-testid="week-strip">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-1)]">
          <IconButton
            label="Previous week"
            icon={<CaretLeft size={16} weight="bold" aria-hidden="true" />}
            onClick={onPrevWeek}
          />
          <IconButton
            label="Next week"
            icon={<CaretRight size={16} weight="bold" aria-hidden="true" />}
            onClick={onNextWeek}
          />
          <Button type="button" variant="secondary" size="sm" onClick={onThisWeek}>
            This week
          </Button>
        </div>

        <div className="w-[180px]">
          <DatePicker
            value={selectedDate}
            onChange={(next) => {
              if (next) onJumpToDate(next);
            }}
            clearable={false}
            aria-label="Jump to a date"
            locale={locale}
          />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-[var(--space-2)]">
        {days.map((date) => {
          const isToday = isSameDay(date, today);
          const isSelected = isSameDay(date, selectedDate);
          const count = counts.get(date) ?? 0;
          const accessibleLabel =
            count > 0 ? `${dayLabel(date, locale)}, ${count} scheduled` : dayLabel(date, locale);

          return (
            <button
              key={date}
              type="button"
              data-testid="week-strip-day"
              onClick={() => onSelectDate(date)}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              aria-label={accessibleLabel}
              className={cn(
                "flex flex-col items-center gap-[var(--space-1)]",
                "border py-[var(--space-2)]",
                "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-1",
                isSelected
                  ? "border-[var(--color-border-strong)] bg-[var(--color-selected)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-hover)]",
                isToday && !isSelected ? "border-[var(--color-border-strong)]" : "",
              )}
            >
              <span className="text-[length:var(--text-caption)] font-semibold uppercase leading-[var(--leading-caption)] tracking-[var(--tracking-label)] text-[var(--color-text-faint)]">
                {shortDayLabel(date, locale)}
              </span>
              <span className="tabular text-[length:var(--text-lg)] font-medium text-[var(--color-text)]">
                {dayNumberLabel(date, locale)}
              </span>
              {count > 0 ? (
                <span className="tabular text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
