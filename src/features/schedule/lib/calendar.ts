/**
 * One scheduled item, as something the owner's own calendar can swallow.
 *
 * Helix does not own the calendar and does not sync with one (DESIGN.md, and
 * the product promise that Helix never talks to anybody's server). The whole
 * integration is a .ics file the owner saves where he likes: his calendar
 * imports it, and the UID makes a second export of the same visit replace the
 * first rather than duplicate it.
 *
 * Pure: it maps a `ScheduleItem` onto the `CalendarSubject` that
 * `AddToCalendarButton` already knows how to save, so the file text itself is
 * still built by `src/lib/ics.ts` and written by the one impure module that
 * touches the save dialog.
 */
import type { CalendarSubject } from "@/features/records/components/AddToCalendarButton";
import type { ScheduleItem } from "@/features/schedule/lib/types";
import { parseIso, toIso } from "@/lib/dates";

/** The UID prefix per kind, so two kinds of row can share an id and not clash. */
const UID_KIND: Record<ScheduleItem["kind"], string> = {
  visit: "task",
  task: "task",
  "deal-expected": "deal",
  "recurring-due": "reminder",
  "invoice-due": "invoice",
  "invoice-issue": "invoice-issue",
};

/** The instant a timed item ends: its start plus its duration. */
export function endOfItem(item: ScheduleItem): string | null {
  if (!item.at || !item.durationMinutes) return null;
  const start = parseIso(item.at);
  if (!start) return null;
  return toIso(new Date(start.getTime() + item.durationMinutes * 60 * 1000));
}

/**
 * What the calendar entry says below its title.
 *
 * Three weeks later, on a phone, in a van, the useful facts are who it is,
 * what number to ring when nobody answers the door, and where the rest of the
 * story lives. The last line names Helix so an entry nobody recognises can be
 * traced back rather than deleted.
 */
export function visitDescription(item: ScheduleItem): string {
  const lines: string[] = [];
  if (item.who) lines.push(item.who.label);
  if (item.phone) lines.push(item.phone);
  if (item.who) lines.push(`Helix ${item.who.href}`);
  lines.push("Added from Helix CRM.");
  return lines.join("\n");
}

/** A scheduled row, ready for `saveAndOpenIcs`. */
export function calendarSubjectFor(item: ScheduleItem): CalendarSubject {
  return {
    kind: UID_KIND[item.kind],
    id: item.sourceId,
    summary: item.title,
    dateOnly: item.at ? null : item.date,
    startAt: item.at,
    endAt: endOfItem(item),
    description: visitDescription(item),
    location: item.place,
    contactId: item.contactId,
    companyId: item.companyId,
  };
}
