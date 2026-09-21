/**
 * LA-W2 / J5 — moving a visit across a DST boundary, at the repository
 * layer with the real write path (`composeVisit` + `tasksRepo`), against
 * real SQLite.
 *
 * `process.env.TZ` is pinned the same way `tests/unit/schedule/week.test.ts`
 * pins it, to "America/New_York" — 2026's US clocks spring forward on
 * 2026-03-08 (2:00 a.m. -> 3:00 a.m., EST UTC-5 -> EDT UTC-4) and fall back
 * on 2026-11-01. This file moves ONE visit by weeks across the March
 * boundary and independently recomputes, by hand, what the stored UTC
 * instant and the wall-clock label the owner sees ought to be on each side —
 * never by re-deriving the app's own formula, which would just prove the
 * code agrees with itself.
 */
process.env.TZ = "America/New_York";

import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "@/db/client";
import * as contacts from "@/db/repos/contacts";
import * as tasksRepo from "@/db/repos/tasks";
import { composeVisit, taskEndAt } from "@/features/schedule/lib/visit";
import { calendarSubjectFor } from "@/features/schedule/lib/calendar";
import { buildIcs } from "@/lib/ics";
import { scheduleItems } from "@/features/schedule/lib/feed";
import type { ScheduleItem } from "@/features/schedule/lib/types";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

/** Wall-clock time in America/New_York for a UTC ISO instant, independent of the app's own label code. */
function nyTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function nyOffsetHours(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(iso));
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-]\d+)/.exec(tz);
  return match ? Number(match[1]) : NaN;
}

describe("LA-W2 J5: a visit moved by weeks across the March 2026 DST boundary", () => {
  it("stores the correct UTC instant on each side, keeps the same local wall time, and the .ics reflects it", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Rosalind", lastName: "Whitaker" });

    // Before the boundary: 2026-03-01 is EST (UTC-5). 09:00 local -> 14:00Z.
    const before = composeVisit({
      title: "Site visit",
      date: "2026-03-01",
      time: "09:00",
      durationMinutes: 90,
      place: "12 Mill Lane, Bristol",
      note: "Gate code 4821",
      contactId: contact.id,
      companyId: null,
      dealId: null,
    });
    expect(nyOffsetHours(before.dueAt!)).toBe(-5);
    expect(before.dueAt).toBe("2026-03-01T14:00:00.000Z");
    expect(nyTime(before.dueAt!)).toBe("9:00 AM");

    const created = await tasksRepo.create({ ...before, source: "user" });

    // Move it three weeks later, past the 2026-03-08 spring-forward, keeping
    // the SAME local time (09:00) and the same duration/place — exactly what
    // "edit the time and confirm it updates" means when the owner does not
    // change the clock reading at all, only the date.
    const after = composeVisit({
      title: "Site visit",
      date: "2026-03-22",
      time: "09:00",
      durationMinutes: 90,
      place: "12 Mill Lane, Bristol",
      note: "Gate code 4821",
      contactId: contact.id,
      companyId: null,
      dealId: null,
    });
    // 2026-03-22 is EDT (UTC-4): the same local 09:00 is now 13:00Z, ONE HOUR
    // earlier in UTC than the pre-boundary instant — the DST shift, not a bug.
    expect(nyOffsetHours(after.dueAt!)).toBe(-4);
    expect(after.dueAt).toBe("2026-03-22T13:00:00.000Z");
    expect(nyTime(after.dueAt!)).toBe("9:00 AM");

    const updated = await tasksRepo.update(created.id, after);
    expect(updated.dueAt).toBe("2026-03-22T13:00:00.000Z");
    expect(updated.dueOn).toBe("2026-03-22");

    // The row in the database agrees — this is what Schedule, Tasks and
    // Today all read.
    const row = await raw.query(`SELECT due_at, due_on FROM tasks WHERE id = ?`, [created.id]);
    expect(String(row[0][0])).toBe("2026-03-22T13:00:00.000Z");
    expect(String(row[0][1])).toBe("2026-03-22");

    // The schedule feed places it on the post-boundary week, not the
    // pre-boundary one, and the displayed time is still 9:00, not 8:00 or 10:00.
    const postWeek = await scheduleItems({ from: "2026-03-22", to: "2026-03-28" });
    const visitRow = postWeek.find((item: ScheduleItem) => item.sourceId === created.id);
    expect(visitRow).toBeDefined();
    expect(visitRow!.at).toBe("2026-03-22T13:00:00.000Z");

    const preWeek = await scheduleItems({ from: "2026-03-01", to: "2026-03-07" });
    expect(preWeek.find((item: ScheduleItem) => item.sourceId === created.id)).toBeUndefined();

    // The .ics the owner's calendar actually receives, for BOTH sides of the
    // move, carries the right UTC instant — this is the file bytes, not a
    // label the app renders for itself.
    const icsBefore = buildIcs({
      uid: `task-${created.id}@helix-crm`,
      summary: "Site visit",
      startAt: before.dueAt,
      endAt: taskEndAt({ dueAt: before.dueAt, durationMinutes: 90 }),
      location: before.place,
    });
    expect(icsBefore).toContain("DTSTART:20260301T140000Z");
    expect(icsBefore).toContain("DTEND:20260301T153000Z"); // +90 minutes

    const icsAfter = buildIcs({
      uid: `task-${created.id}@helix-crm`,
      summary: "Site visit",
      startAt: after.dueAt,
      endAt: taskEndAt({ dueAt: after.dueAt, durationMinutes: 90 }),
      location: after.place,
    });
    expect(icsAfter).toContain("DTSTART:20260322T130000Z");
    expect(icsAfter).toContain("DTEND:20260322T143000Z");

    // calendarSubjectFor (the ScheduleItem -> CalendarSubject seam
    // AddToCalendarButton uses) agrees with the raw task-level computation.
    if (visitRow) {
      const subject = calendarSubjectFor(visitRow);
      expect(subject.startAt).toBe("2026-03-22T13:00:00.000Z");
      expect(subject.endAt).toBe("2026-03-22T14:30:00.000Z");
    }
  });
});
