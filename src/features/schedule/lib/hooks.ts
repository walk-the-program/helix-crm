/**
 * Reading the week: one TanStack query, shaped to whatever range is on screen.
 *
 * The Schedule screens never touch a repository directly. `scheduleItems`
 * (./feed.ts) is the one function that knows how to turn tasks, deals,
 * recurring rules, documents and invoice schedules into one sorted list, and
 * every screen below reads it through the same `qk.schedule(from, to)` key so
 * that a visit created from the dialog invalidates every open Schedule view
 * at once, rather than leaving the week strip's counts stale next to a
 * freshly updated day agenda.
 *
 * No writes live here. A visit is created by the dialog behind
 * `openVisitDialog` (./visitDialog.ts); this file only ever reads.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { qk } from "@/app/queryClient";
import { scheduleItems } from "@/features/schedule/lib/feed";
import { itemsOn, type ScheduleItem, type ScheduleRange } from "@/features/schedule/lib/types";

/** Everything scheduled inside one inclusive range of local calendar days. */
export function useSchedule(range: ScheduleRange) {
  return useQuery<ScheduleItem[]>({
    queryKey: qk.schedule(range.from, range.to),
    queryFn: () => scheduleItems(range),
  });
}

/**
 * One day, already narrowed to it and sorted the way `compareScheduleItems`
 * orders a day: timed items first, earliest to latest, then the all-day ones.
 * Built on `useSchedule` with a one-day range, so a day screen shares the same
 * cache entry and invalidation as a week view that happens to include it.
 */
export function useScheduleDay(date: string) {
  const query = useSchedule({ from: date, to: date });
  const items = useMemo(() => itemsOn(query.data ?? [], date), [query.data, date]);
  return { ...query, items };
}
