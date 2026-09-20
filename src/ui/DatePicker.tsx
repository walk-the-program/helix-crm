import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/Popover";
import { IconButton } from "@/ui/IconButton";
import { CalendarBlank, CaretLeft, CaretRight, X } from "@/ui/icons";
import { cn } from "@/ui/cn";
import {
  disabledState,
  focusRing,
  focusRingInset,
  headingFont,
  quietTransition,
  sectionLabel,
} from "@/ui/styles";
import {
  addDaysToDateString,
  formatDateDisplay,
  parseDateOnly,
  toLocalDateString,
  todayLocal,
} from "@/lib/dates";

/* -------------------------------------------------------------------------- */
/* pure date helpers                                                          */
/*                                                                            */
/* Everything below works on "YYYY-MM-DD" strings and LOCAL Date objects      */
/* built with `new Date(y, m, d)`, never `.toISOString()` - a date-only value */
/* has no timezone, and formatting it through UTC is exactly how a picker     */
/* saves "the 18th" for a user who picked "the 19th" west of Greenwich.       */
/* -------------------------------------------------------------------------- */

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonthsToDate(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function isDateDisabled(dateString: string, min?: string, max?: string): boolean {
  // "YYYY-MM-DD" strings compare lexicographically in calendar order, so a
  // plain string compare is exact here and needs no Date parsing at all.
  if (min && dateString < min) return true;
  if (max && dateString > max) return true;
  return false;
}

/** Walks from `start` in `direction` (in whole days) until it lands on an
 *  enabled date, or gives up after ten years so a caller can never spin
 *  forever chasing a `min`/`max` pair that excludes everything. */
function findEnabledDate(start: string, direction: 1 | -1, min?: string, max?: string): string | null {
  let candidate = start;
  for (let i = 0; i < 3660; i += 1) {
    if (!isDateDisabled(candidate, min, max)) return candidate;
    candidate = addDaysToDateString(candidate, direction);
  }
  return null;
}

/** One arrow-key step: jump the requested distance, then keep walking in the
 *  same direction until an enabled day turns up, so `min`/`max` "skip" a
 *  disabled run instead of stranding focus on a disabled button. */
function stepFocusedDate(current: string, deltaDays: number, min?: string, max?: string): string {
  const target = addDaysToDateString(current, deltaDays);
  const direction: 1 | -1 = deltaDays >= 0 ? 1 : -1;
  return findEnabledDate(target, direction, min, max) ?? current;
}

/** `Intl.Locale#weekInfo` is how a browser actually knows a Saudi week starts
 *  Sunday and a French one starts Monday - but it is too new to be in
 *  TypeScript's own lib types and not guaranteed to exist at runtime (older
 *  Node, some jsdom builds), so it is read defensively and never asserted. */
function getWeekStartsOn(locale?: string): number {
  try {
    const resolvedLocale = locale ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
    const localeWithWeekInfo = new Intl.Locale(resolvedLocale) as Intl.Locale & {
      weekInfo?: { firstDay: number };
    };
    const firstDay = localeWithWeekInfo.weekInfo?.firstDay;
    if (typeof firstDay === "number") {
      // The spec's firstDay is 1 (Monday) .. 7 (Sunday); Date#getDay() wants
      // 0 (Sunday) .. 6 (Saturday) - `% 7` is the whole conversion.
      return firstDay % 7;
    }
  } catch {
    // Fall through to the default below.
  }
  return 1; // Monday - the guide's own "Mo Tu We Th Fr Sa Su" order.
}

function startOfWeek(dateString: string, weekStartsOn: number): string {
  const d = parseDateOnly(dateString);
  if (!d) return dateString;
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDaysToDateString(dateString, -diff);
}

function endOfWeek(dateString: string, weekStartsOn: number): string {
  return addDaysToDateString(startOfWeek(dateString, weekStartsOn), 6);
}

function monthHasEnabledDay(monthDate: Date, min?: string, max?: string): boolean {
  const first = toLocalDateString(startOfMonth(monthDate));
  const last = toLocalDateString(new Date(monthDate.getFullYear(), monthDate.getMonth(), daysInMonth(monthDate)));
  if (min && last < min) return false;
  if (max && first > max) return false;
  return true;
}

function firstEnabledDayInMonth(monthDate: Date, min?: string, max?: string): string {
  const total = daysInMonth(monthDate);
  for (let day = 1; day <= total; day += 1) {
    const ds = toLocalDateString(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
    if (!isDateDisabled(ds, min, max)) return ds;
  }
  return toLocalDateString(startOfMonth(monthDate));
}

function defaultFocusDate(value: string | null, min?: string, max?: string): string {
  if (value) return value;
  const today = todayLocal();
  if (!isDateDisabled(today, min, max)) return today;
  if (min && today < min) return min;
  if (max && today > max) return max;
  return today;
}

type DayCell = {
  dateString: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
};

/** Always 42 cells (six full weeks), so the grid never resizes itself as the
 *  owner pages between a four-week February and a six-week October - a
 *  popover that changes height every click is the kind of thing that reads
 *  as broken rather than responsive. */
function buildMonthGrid(
  monthDate: Date,
  weekStartsOn: number,
  value: string | null,
  min: string | undefined,
  max: string | undefined,
  today: string,
): DayCell[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const offset = (firstOfMonth.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(year, month, 1 - offset);

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dateString = toLocalDateString(d);
    cells.push({
      dateString,
      dayNumber: d.getDate(),
      inCurrentMonth: d.getMonth() === month,
      isToday: dateString === today,
      isSelected: value === dateString,
      isDisabled: isDateDisabled(dateString, min, max),
    });
  }
  return cells;
}

function getWeekdayLabels(weekStartsOn: number, locale?: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  // A fixed reference week (2023-01-01 is a Sunday) keeps the header stable
  // and independent of "today", a leap day, or a DST edge.
  const referenceSunday = new Date(2023, 0, 1);
  const labels: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const dayIndex = (weekStartsOn + i) % 7;
    const d = new Date(
      referenceSunday.getFullYear(),
      referenceSunday.getMonth(),
      referenceSunday.getDate() + dayIndex,
    );
    labels.push(formatter.format(d));
  }
  return labels;
}

function getMonthYearLabel(monthDate: Date, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(monthDate);
  } catch {
    return `${monthDate.getFullYear()}`;
  }
}

function getDayAccessibleLabel(dateString: string, locale?: string): string {
  const d = parseDateOnly(dateString);
  if (!d) return dateString;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return dateString;
  }
}

/**
 * A calendar popover that replaces the native `<input type="date">`, which
 * renders its own browser chrome (a different affordance per OS, no way to
 * theme it, no way to keep it inside our radius-0/token-only visual
 * language) - it looks like a web page dropped into the product, which is
 * exactly the complaint that started this component.
 *
 * The trigger is styled byte-for-byte off `Select`'s: same height, hairline,
 * surface and focus ring, so a date field sits in a form next to a `Select`
 * or an `Input` without announcing itself as a different kind of control.
 *
 * State model: the single source of truth inside the popover is
 * `focusedDate`, one "YYYY-MM-DD" string. The visible month is *derived* from
 * it (`startOfMonth(focusedDate)`), not tracked separately - so paging a
 * month, pressing an arrow key that crosses a month boundary, and opening on
 * a value from three years ago all just fall out of "what month is
 * `focusedDate` in", instead of needing to keep a second piece of state in
 * sync with the first. Selecting a day calls `onChange` and closes; moving
 * focus around inside the grid never does.
 *
 * Keyboard model is a roving tabindex, the same pattern `useRovingRowNav`
 * gives list rows: exactly one day (`focusedDate`) is a tab stop, every other
 * cell is `tabIndex={-1}`, and arrow keys move a real DOM focus rather than a
 * simulated one, which is what makes screen-reader "read current cell"
 * behaviour correct for free. A day outside `min`/`max` is a disabled
 * `<button>`, and every step (arrow, Home/End, PageUp/PageDown) walks past
 * a run of disabled days instead of parking focus on one.
 *
 * Escape-to-close and return-focus-to-trigger are not implemented here at
 * all - Radix's `Popover.Content` already does both (the same primitive
 * `Dialog` builds on), so re-adding them would just be a second, competing
 * implementation of a behaviour the library already owns.
 *
 * The clear "x" is a sibling of the trigger `<button>`, absolutely
 * positioned over its trailing edge, not a nested `<button>` inside it -
 * a button cannot contain another button without breaking HTML's content
 * model, and the overlap alone (not event propagation) is what keeps a
 * click on the clear affordance from also opening the popover; the
 * `stopPropagation` is a second line of defence, not the mechanism.
 *
 * Colour: day numbers are plain ink (`--color-text` / faded to
 * `--color-text-faint` for a leading/trailing day from an adjacent month).
 * The selected day gets the one saturated block the product has -
 * `--color-accent` / `--color-accent-text`, the same treatment the selected
 * sidebar row and the primary button use - and today is a hairline
 * `--color-border-strong` box, not a colour. Nothing in this file is a hex
 * literal or a Tailwind palette class; the only non-ink colours anywhere are
 * the focus ring (`--color-focus`, via the shared `focusRing`/`focusRingInset`
 * fragments) and that one selected-day block.
 */
export function DatePicker(props: {
  value: string | null;
  onChange: (v: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  clearable?: boolean;
  id?: string;
  className?: string;
  /** Wired automatically by `Field`, but harmless to pass directly too. */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  /** Overrides the browser's own locale for week-start and month/weekday
   *  formatting - mainly for tests, which cannot assume a fixed locale. */
  locale?: string;
  /** Mount with the calendar already open. For the component gallery; not a
   *  controlled `open`. */
  defaultOpen?: boolean;
}): ReactElement {
  const {
    value,
    onChange,
    min,
    max,
    placeholder,
    disabled,
    clearable,
    id,
    className,
    locale,
    defaultOpen,
  } = props;
  const ariaLabel = props["aria-label"];
  const ariaDescribedBy = props["aria-describedby"];
  const ariaInvalid = props["aria-invalid"];

  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [focusedDate, setFocusedDate] = useState<string>(() => defaultFocusDate(value, min, max));
  const contentRef = useRef<HTMLDivElement>(null);

  const today = todayLocal();
  const weekStartsOn = useMemo(() => getWeekStartsOn(locale), [locale]);
  const viewMonthDate = useMemo(
    () => startOfMonth(parseDateOnly(focusedDate) ?? new Date()),
    [focusedDate],
  );
  const monthYearLabel = useMemo(() => getMonthYearLabel(viewMonthDate, locale), [viewMonthDate, locale]);
  const weekdayLabels = useMemo(() => getWeekdayLabels(weekStartsOn, locale), [weekStartsOn, locale]);
  const cells = useMemo(
    () => buildMonthGrid(viewMonthDate, weekStartsOn, value, min, max, today),
    [viewMonthDate, weekStartsOn, value, min, max, today],
  );

  const prevDisabled = !monthHasEnabledDay(addMonthsToDate(viewMonthDate, -1), min, max);
  const nextDisabled = !monthHasEnabledDay(addMonthsToDate(viewMonthDate, 1), min, max);

  function focusDay(dateString: string): void {
    const el = contentRef.current?.querySelector<HTMLButtonElement>(`[data-date="${dateString}"]`);
    el?.focus();
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (next) {
      setFocusedDate(defaultFocusDate(value, min, max));
    }
  }

  function selectDate(dateString: string): void {
    onChange(dateString);
    setOpen(false);
  }

  /** Clamps the current focused day-of-month into `targetMonthDate`, nudging
   *  onto the nearest enabled day if the clamp lands on a disabled one.
   *  Returns the resolved date so a caller can also move DOM focus to it. */
  function moveFocusedToMonth(targetMonthDate: Date): string {
    const currentDay = parseDateOnly(focusedDate)?.getDate() ?? 1;
    const clampedDay = Math.min(currentDay, daysInMonth(targetMonthDate));
    const candidate = toLocalDateString(
      new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), clampedDay),
    );
    const resolved = isDateDisabled(candidate, min, max)
      ? firstEnabledDayInMonth(targetMonthDate, min, max)
      : candidate;
    setFocusedDate(resolved);
    return resolved;
  }

  /** Prev/Next month buttons: only move `focusedDate` - actual DOM focus
   *  stays on the button that was clicked, so paging through several months
   *  by mouse or by repeated Enter/Space does not get interrupted by focus
   *  jumping into the grid after the first click. */
  function movePageMonth(delta: 1 | -1): void {
    const targetMonthDate = addMonthsToDate(viewMonthDate, delta);
    if (!monthHasEnabledDay(targetMonthDate, min, max)) return;
    moveFocusedToMonth(targetMonthDate);
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLButtonElement>, cellDate: string): void {
    switch (event.key) {
      case "ArrowRight": {
        event.preventDefault();
        const next = stepFocusedDate(cellDate, 1, min, max);
        setFocusedDate(next);
        focusDay(next);
        return;
      }
      case "ArrowLeft": {
        event.preventDefault();
        const next = stepFocusedDate(cellDate, -1, min, max);
        setFocusedDate(next);
        focusDay(next);
        return;
      }
      case "ArrowDown": {
        event.preventDefault();
        const next = stepFocusedDate(cellDate, 7, min, max);
        setFocusedDate(next);
        focusDay(next);
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        const next = stepFocusedDate(cellDate, -7, min, max);
        setFocusedDate(next);
        focusDay(next);
        return;
      }
      case "Home": {
        event.preventDefault();
        const target = startOfWeek(cellDate, weekStartsOn);
        const next = findEnabledDate(target, 1, min, max) ?? cellDate;
        setFocusedDate(next);
        focusDay(next);
        return;
      }
      case "End": {
        event.preventDefault();
        const target = endOfWeek(cellDate, weekStartsOn);
        const next = findEnabledDate(target, -1, min, max) ?? cellDate;
        setFocusedDate(next);
        focusDay(next);
        return;
      }
      case "PageUp": {
        event.preventDefault();
        const targetMonthDate = addMonthsToDate(viewMonthDate, -1);
        if (!monthHasEnabledDay(targetMonthDate, min, max)) return;
        focusDay(moveFocusedToMonth(targetMonthDate));
        return;
      }
      case "PageDown": {
        event.preventDefault();
        const targetMonthDate = addMonthsToDate(viewMonthDate, 1);
        if (!monthHasEnabledDay(targetMonthDate, min, max)) return;
        focusDay(moveFocusedToMonth(targetMonthDate));
        return;
      }
      default:
        return;
    }
  }

  const displayText = value ? formatDateDisplay(value, locale) : (placeholder ?? "Pick a date");
  const showClear = Boolean(clearable && value && !disabled);

  return (
    <div className="relative w-full">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            data-testid="date-picker"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid || undefined}
            className={cn(
              "flex w-full h-[var(--control-h)] items-center gap-[var(--space-2)]",
              "border border-[var(--color-border-strong)]",
              "bg-[var(--color-surface)] text-[var(--color-text)]",
              "px-[var(--space-3)] text-[length:var(--text-base)]",
              "enabled:hover:bg-[var(--color-hover)]",
              quietTransition,
              disabledState,
              focusRing,
              className,
            )}
          >
            <span className={cn("flex-1 truncate text-left", !value && "text-[var(--color-text-faint)]")}>
              {displayText}
            </span>
            <CalendarBlank
              size={16}
              weight="bold"
              aria-hidden="true"
              className="flex-none text-[var(--color-text-muted)]"
            />
          </button>
        </PopoverTrigger>

        {showClear && (
          <IconButton
            label="Clear date"
            icon={<X size={16} weight="bold" aria-hidden="true" />}
            variant="ghost"
            size="sm"
            className="absolute right-[var(--space-8)] top-1/2 -translate-y-1/2"
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
          />
        )}

        <PopoverContent
          ref={contentRef}
          align="start"
          collisionPadding={8}
          aria-label="Choose a date"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            focusDay(defaultFocusDate(value, min, max));
          }}
          className={cn(
            "w-[288px]",
            "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto",
          )}
        >
          <div className="flex items-center justify-between gap-[var(--space-2)]">
            <IconButton
              label="Previous month"
              icon={<CaretLeft size={14} weight="bold" aria-hidden="true" />}
              variant="ghost"
              size="sm"
              disabled={prevDisabled}
              onClick={() => movePageMonth(-1)}
            />
            <span className={cn(headingFont, "text-[length:var(--text-sm)] font-semibold")}>
              {monthYearLabel}
            </span>
            <IconButton
              label="Next month"
              icon={<CaretRight size={14} weight="bold" aria-hidden="true" />}
              variant="ghost"
              size="sm"
              disabled={nextDisabled}
              onClick={() => movePageMonth(1)}
            />
          </div>

          <div className="mt-[var(--space-3)] grid grid-cols-7 gap-[var(--space-1)]">
            {weekdayLabels.map((label, index) => (
              <div
                key={`${label}-${index}`}
                className={cn(sectionLabel, "flex h-[var(--control-h-sm)] items-center justify-center")}
              >
                {label}
              </div>
            ))}
          </div>

          <div
            data-testid="date-picker-grid"
            role="group"
            aria-label={monthYearLabel}
            className="mt-[var(--space-1)] grid grid-cols-7 gap-[var(--space-1)]"
          >
            {cells.map((cell) => (
              <button
                key={cell.dateString}
                type="button"
                data-testid="date-picker-day"
                data-date={cell.dateString}
                data-today={cell.isToday ? "true" : undefined}
                aria-selected={cell.isSelected ? "true" : undefined}
                tabIndex={cell.dateString === focusedDate ? 0 : -1}
                disabled={cell.isDisabled}
                aria-label={getDayAccessibleLabel(cell.dateString, locale)}
                onClick={() => selectDate(cell.dateString)}
                onFocus={() => setFocusedDate(cell.dateString)}
                onKeyDown={(event) => handleGridKeyDown(event, cell.dateString)}
                className={cn(
                  "flex h-[var(--control-h-sm)] items-center justify-center",
                  "text-[length:var(--text-sm)]",
                  quietTransition,
                  disabledState,
                  focusRingInset,
                  cell.isSelected
                    ? "bg-[var(--color-accent)] text-[var(--color-accent-text)]"
                    : cn(
                        "enabled:hover:bg-[var(--color-hover)]",
                        cell.inCurrentMonth ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]",
                      ),
                  cell.isToday && !cell.isSelected && "border border-[var(--color-border-strong)]",
                )}
              >
                {cell.dayNumber}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
