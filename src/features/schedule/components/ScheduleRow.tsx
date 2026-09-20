/**
 * One line in a day: what it is, its title, who it is for, where and when,
 * a way to open the record it came from, and a way to hand it to the
 * calendar the owner actually carries in his pocket.
 *
 * A row never re-derives any of this. The kind, the time, the duration all
 * come from `lib/labels.ts`, which already knows the owner's own vocabulary
 * and the workspace's clock; this file only lays the words out.
 */
import { Link } from "wouter";
import type { ReactNode } from "react";
import { Badge } from "@/ui";
import type { Vocabulary } from "@/app/vocabulary";
import { AddToCalendarButton } from "@/features/records/components/AddToCalendarButton";
import { calendarSubjectFor } from "@/features/schedule/lib/calendar";
import { durationLabel, kindLabel, timeLabel } from "@/features/schedule/lib/labels";
import type { ScheduleItem } from "@/features/schedule/lib/types";

const linkClass =
  "text-[var(--color-text-muted)] no-underline underline-offset-2 hover:text-[var(--color-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]";

export function ScheduleRow(props: { item: ScheduleItem; vocabulary: Vocabulary; locale?: string }) {
  const { item, vocabulary, locale } = props;

  const time = timeLabel(item, locale);
  const duration = item.durationMinutes ? durationLabel(item.durationMinutes) : "";

  const meta: ReactNode[] = [];
  if (time) {
    meta.push(
      <span key="time" className="tabular whitespace-nowrap">
        {time}
        {duration ? ` · ${duration}` : ""}
      </span>,
    );
  }
  if (item.who) {
    meta.push(
      <Link key="who" href={item.who.href} className={`truncate ${linkClass}`}>
        {item.who.label}
      </Link>,
    );
  }
  if (item.place) {
    meta.push(
      <span key="place" className="truncate">
        {item.place}
      </span>,
    );
  }

  return (
    <li
      data-testid="schedule-row"
      className={[
        "flex items-center gap-[var(--space-3)]",
        "border-b border-[var(--color-border)] last:border-b-0",
        "px-[var(--space-4)] py-[var(--space-3)] hover:bg-[var(--color-hover)]",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <Badge tone="neutral">{kindLabel(item.kind, vocabulary)}</Badge>
          <Link
            href={item.href}
            title={item.title}
            className="truncate text-[length:var(--text-base)] font-medium leading-[var(--leading-tight)] text-[var(--color-text)] no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
          >
            {item.title}
          </Link>
        </div>

        {meta.length > 0 ? (
          <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {meta.map((node, index) => (
              <span key={index} className="flex min-w-0 items-center gap-[var(--space-1)]">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-[var(--color-text-faint)]">
                    ·
                  </span>
                ) : null}
                {node}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-none items-center gap-[var(--space-1)]">
        <AddToCalendarButton subject={calendarSubjectFor(item)} size="sm" />
      </div>
    </li>
  );
}
