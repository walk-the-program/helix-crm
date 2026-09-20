/**
 * A visit's .ics shape: `buildIcs` and its folding/escaping are already
 * covered by ics.test.ts, so what is new here is what `calendarSubjectFor`
 * (schedule/lib/calendar.ts) hands it for a timed visit - a duration turned
 * into a DTEND, a place turned into an escaped LOCATION, and a customer's
 * name and phone turned into a DESCRIPTION.
 *
 * `calendarSubjectFor` is pure - a visit's place already lives on the
 * `ScheduleItem` as `place`, so there is no address lookup to mock, unlike
 * `AddToCalendarButton`'s own `resolveLocation`.
 */
import { describe, expect, it } from "vitest";
import { buildIcs, icsUid, type IcsEvent } from "@/lib/ics";
import { calendarSubjectFor } from "@/features/schedule/lib/calendar";
import type { ScheduleItem } from "@/features/schedule/lib/types";

function unfold(text: string): string {
  return text.replace(/\r\n /g, "");
}

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function visitItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: "visit:t1",
    kind: "visit",
    sourceId: "t1",
    date: "2026-09-23",
    at: "2026-09-23T13:00:00.000Z",
    durationMinutes: 60,
    title: "Site visit",
    who: { label: "Priya Raman", href: "/contacts/c1" },
    place: "12 Main St",
    href: "/tasks",
    contactId: "c1",
    companyId: null,
    dealId: null,
    phone: "555-123-4567",
    ...overrides,
  };
}

/** What `AddToCalendarButton.saveAndOpenIcs` builds from a `CalendarSubject`,
 *  minus the address lookup a visit never needs (its place already resolved
 *  onto the item). */
function toIcsEvent(item: ScheduleItem): IcsEvent {
  const subject = calendarSubjectFor(item);
  return {
    uid: icsUid(subject.kind, subject.id),
    summary: subject.summary,
    dateOnly: subject.dateOnly ?? null,
    startAt: subject.startAt ?? null,
    endAt: subject.endAt ?? null,
    description: subject.description ?? null,
    location: subject.location ?? null,
  };
}

describe("a visit's DTEND", () => {
  it("is DTSTART plus a 30 minute duration", () => {
    const out = buildIcs(toIcsEvent(visitItem({ durationMinutes: 30 })));
    expect(out).toContain("DTSTART:20260923T130000Z");
    expect(out).toContain("DTEND:20260923T133000Z");
  });

  it("is DTSTART plus a 90 minute duration", () => {
    const out = buildIcs(toIcsEvent(visitItem({ durationMinutes: 90 })));
    expect(out).toContain("DTSTART:20260923T130000Z");
    expect(out).toContain("DTEND:20260923T143000Z");
  });

  it("is DTSTART plus a 120 minute duration", () => {
    const out = buildIcs(toIcsEvent(visitItem({ durationMinutes: 120 })));
    expect(out).toContain("DTSTART:20260923T130000Z");
    expect(out).toContain("DTEND:20260923T150000Z");
  });

  it("crosses midnight into the next day", () => {
    const out = buildIcs(
      toIcsEvent(visitItem({ at: "2026-09-23T23:45:00.000Z", durationMinutes: 30 })),
    );
    expect(out).toContain("DTSTART:20260923T234500Z");
    expect(out).toContain("DTEND:20260924T001500Z");
  });

  it("crosses a month end into the next month", () => {
    const out = buildIcs(
      toIcsEvent(visitItem({ at: "2026-01-31T23:30:00.000Z", durationMinutes: 60 })),
    );
    expect(out).toContain("DTSTART:20260131T233000Z");
    expect(out).toContain("DTEND:20260201T003000Z");
  });

  it("falls back to the builder's default hour when there is no duration", () => {
    const out = buildIcs(toIcsEvent(visitItem({ durationMinutes: null })));
    expect(out).toContain("DTSTART:20260923T130000Z");
    expect(out).toContain("DTEND:20260923T140000Z");
  });
});

describe("LOCATION", () => {
  it("carries the place, escaped for a comma and a semicolon", () => {
    const out = buildIcs(
      toIcsEvent(visitItem({ place: "123 Main St, Suite 5; Springfield" })),
    );
    expect(unfold(out)).toContain("LOCATION:123 Main St\\, Suite 5\\; Springfield");
  });

  it("is omitted when the visit has no place", () => {
    const out = buildIcs(toIcsEvent(visitItem({ place: null })));
    expect(out).not.toContain("LOCATION");
  });
});

describe("DESCRIPTION", () => {
  it("carries the customer's name, their phone, and the Helix line, with newlines escaped", () => {
    const out = buildIcs(toIcsEvent(visitItem()));
    expect(unfold(out)).toContain(
      "DESCRIPTION:Priya Raman\\n555-123-4567\\nHelix /contacts/c1\\nAdded from Helix CRM.",
    );
  });

  it("still ends with the Helix line when there is no customer on the visit", () => {
    const out = buildIcs(
      toIcsEvent(visitItem({ who: null, phone: null, contactId: null })),
    );
    expect(unfold(out)).toContain("DESCRIPTION:Added from Helix CRM.");
  });
});

describe("UID", () => {
  it("is stable for the same task id across two exports", () => {
    const first = buildIcs(toIcsEvent(visitItem()));
    const second = buildIcs(toIcsEvent(visitItem({ title: "Renamed", place: "Somewhere else" })));
    const uidOf = (text: string) => /UID:(\S+)/.exec(text)?.[1];
    expect(uidOf(first)).toBe(uidOf(second));
    expect(uidOf(first)).toBe("task-t1@helix-crm");
  });
});

describe("timestamps", () => {
  it("DTSTART, DTEND and DTSTAMP all end in Z", () => {
    const out = buildIcs(toIcsEvent(visitItem()));
    for (const name of ["DTSTART", "DTEND", "DTSTAMP"]) {
      const match = new RegExp(`${name}:(\\S+)`).exec(out);
      expect(match?.[1]).toMatch(/Z$/);
    }
  });
});

describe("folding", () => {
  it("folds a long SUMMARY at 75 octets with a single leading space on continuation lines", () => {
    const longTitle =
      "Estimate for the retaining wall replacement and the drainage work behind the garage";
    const out = buildIcs(toIcsEvent(visitItem({ title: longTitle })));

    const lines = out.split("\r\n");
    for (const line of lines) {
      expect(utf8ByteLength(line)).toBeLessThanOrEqual(75);
    }

    // Only SUMMARY's own continuation lines: a later field's folded text can
    // legitimately start with a real space of its own (DESCRIPTION does,
    // here - "Helix\nCRM." folds right before its space), which is a second,
    // content space rather than a second fold space and is not what this
    // assertion is about.
    const summaryStart = lines.findIndex((line) => line.startsWith("SUMMARY:"));
    const summaryContinuations: string[] = [];
    for (let i = summaryStart + 1; i < lines.length && lines[i].startsWith(" "); i += 1) {
      summaryContinuations.push(lines[i]);
    }
    expect(summaryContinuations.length).toBeGreaterThan(0);
    for (const line of summaryContinuations) {
      expect(line.startsWith("  ")).toBe(false);
    }

    expect(unfold(out)).toContain(`SUMMARY:${longTitle}`);
  });
});

describe("line endings", () => {
  it("uses CRLF throughout and never a bare LF", () => {
    const out = buildIcs(toIcsEvent(visitItem()));
    expect(/[^\r]\n/.test(out)).toBe(false);
  });
});
