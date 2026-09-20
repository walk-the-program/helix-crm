/**
 * One day, full width — the page a link can point at when a week view is one
 * click too many: a task reminder, a search result, a bookmark that has to
 * still work after a reload. It shows the same agenda the week view shows for
 * whichever day is selected, just with the whole window to itself, a way back
 * to the week, and the pair of arrows a diary page has always had.
 *
 * An unparseable or missing `:date` — a stale link, a hand-edited URL — is not
 * an error worth alarming anyone over. It quietly falls back to today.
 */
import type { KeyboardEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, CaretLeft, CaretRight } from "@/ui/icons";
import { IconButton, PageHeader } from "@/ui";
import { isTypingTarget } from "@/app/shortcuts";
import { useFormats } from "@/app/formats";
import { parseDateOnly, todayLocal } from "@/lib/dates";
import { addDays, dayLabel } from "@/features/schedule/lib/week";
import { useScheduleDay } from "@/features/schedule/lib/hooks";
import { DayAgenda } from "@/features/schedule/components/DayAgenda";

const backLinkClass =
  "inline-flex w-fit items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-faint)] no-underline hover:text-[var(--color-text)] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]";

/** A missing or unparseable date param falls back to today rather than erroring. */
function resolveDate(raw: string | undefined): string {
  if (raw && parseDateOnly(raw)) return raw;
  return todayLocal();
}

export function ScheduleDayScreen() {
  const { date: rawDate } = useParams<{ date: string }>();
  const [, navigate] = useLocation();
  const formats = useFormats();
  const date = resolveDate(rawDate);
  const { items, isLoading } = useScheduleDay(date);

  function goToDay(next: string) {
    navigate(`/schedule/day/${next}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Same guard as the week view: bound on this screen's own container, not
    // a global shortcut, and it defers to anything a child already handled or
    // to typing in a field.
    if (event.defaultPrevented) return;
    if (isTypingTarget(event.target)) return;
    if (event.key === "ArrowLeft") {
      goToDay(addDays(date, -1));
    } else if (event.key === "ArrowRight") {
      goToDay(addDays(date, 1));
    }
  }

  return (
    <div
      className="flex flex-col gap-[var(--space-6)]"
      data-testid="schedule-day-screen"
      onKeyDown={handleKeyDown}
    >
      <PageHeader
        breadcrumb={
          <Link href="/schedule" className={backLinkClass}>
            <ArrowLeft size={14} weight="bold" aria-hidden="true" /> Schedule
          </Link>
        }
        title={dayLabel(date, formats.locale)}
        actions={
          <div className="flex items-center gap-[var(--space-1)]">
            <IconButton
              label="Previous day"
              icon={<CaretLeft size={16} weight="bold" aria-hidden="true" />}
              onClick={() => goToDay(addDays(date, -1))}
            />
            <IconButton
              label="Next day"
              icon={<CaretRight size={16} weight="bold" aria-hidden="true" />}
              onClick={() => goToDay(addDays(date, 1))}
            />
          </div>
        }
      />

      <DayAgenda date={date} items={items} isLoading={isLoading} />
    </div>
  );
}
