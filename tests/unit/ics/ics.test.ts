import { describe, it, expect } from "vitest";
import { buildIcs, buildIcsCalendar, icsFileName, icsUid, foldLine, escapeText, type IcsEvent } from "@/lib/ics";

function unfold(text: string): string {
  return text.replace(/\r\n /g, "");
}

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

describe("ics", () => {
  describe("calendar skeleton", () => {
    it("emits BEGIN/VERSION/PRODID/CALSCALE/METHOD before the first VEVENT, in order", () => {
      const out = buildIcs({ uid: "u1", summary: "Send estimate", dateOnly: "2026-09-19" });
      const lines = out.split("\r\n");
      expect(lines[0]).toBe("BEGIN:VCALENDAR");
      expect(lines[1]).toBe("VERSION:2.0");
      expect(lines[2]).toBe("PRODID:-//Helix CRM//Helix//EN");
      expect(lines[3]).toBe("CALSCALE:GREGORIAN");
      expect(lines[4]).toBe("METHOD:PUBLISH");
      expect(lines[5]).toBe("BEGIN:VEVENT");
    });

    it("ends with END:VCALENDAR followed by CRLF and nothing after", () => {
      const out = buildIcs({ uid: "u1", summary: "Send estimate", dateOnly: "2026-09-19" });
      expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
      expect(out.endsWith("END:VCALENDAR\r\n\r\n")).toBe(false);
    });

    it("wraps a single VEVENT with END:VEVENT before END:VCALENDAR", () => {
      const out = buildIcs({ uid: "u1", summary: "Send estimate", dateOnly: "2026-09-19" });
      expect(out).toContain("BEGIN:VEVENT");
      expect(out).toContain("END:VEVENT");
      expect(out.indexOf("END:VEVENT")).toBeLessThan(out.indexOf("END:VCALENDAR"));
    });
  });

  describe("line endings", () => {
    it("uses CRLF between every line and never a bare LF", () => {
      const out = buildIcsCalendar([
        { uid: "u1", summary: "Send estimate", dateOnly: "2026-09-19" },
        { uid: "u2", summary: "Follow up call", startAt: "2026-09-19T14:30:00.000Z", description: "Line one\nLine two" },
      ]);
      expect(/[^\r]\n/.test(out)).toBe(false);
    });
  });

  describe("all-day events", () => {
    it("emits DTSTART/DTEND with VALUE=DATE, DTEND one day after DTSTART", () => {
      const out = buildIcs({ uid: "u1", summary: "Job walkthrough", dateOnly: "2026-09-19" });
      expect(out).toContain("DTSTART;VALUE=DATE:20260919");
      expect(out).toContain("DTEND;VALUE=DATE:20260920");
    });

    it("rolls over a month-end boundary", () => {
      const out = buildIcs({ uid: "u1", summary: "Month end", dateOnly: "2026-02-28" });
      expect(out).toContain("DTSTART;VALUE=DATE:20260228");
      expect(out).toContain("DTEND;VALUE=DATE:20260301");
    });

    it("rolls over a leap-year February correctly", () => {
      const out = buildIcs({ uid: "u1", summary: "Leap day", dateOnly: "2028-02-28" });
      expect(out).toContain("DTSTART;VALUE=DATE:20280228");
      expect(out).toContain("DTEND;VALUE=DATE:20280229");
    });

    it("rolls over a year-end boundary", () => {
      const out = buildIcs({ uid: "u1", summary: "Year end", dateOnly: "2026-12-31" });
      expect(out).toContain("DTSTART;VALUE=DATE:20261231");
      expect(out).toContain("DTEND;VALUE=DATE:20270101");
    });

    it("never emits a DTEND equal to DTSTART for a one-day event", () => {
      const out = buildIcs({ uid: "u1", summary: "One day", dateOnly: "2026-09-19" });
      const start = /DTSTART;VALUE=DATE:(\d{8})/.exec(out)?.[1];
      const end = /DTEND;VALUE=DATE:(\d{8})/.exec(out)?.[1];
      expect(start).toBeDefined();
      expect(end).not.toBe(start);
    });
  });

  describe("timed events", () => {
    it("emits UTC DTSTART with trailing Z and no separators", () => {
      const out = buildIcs({ uid: "u1", summary: "Call", startAt: "2026-09-19T14:30:00.000Z" });
      expect(out).toContain("DTSTART:20260919T143000Z");
    });

    it("defaults DTEND to one hour after startAt when endAt is absent", () => {
      const out = buildIcs({ uid: "u1", summary: "Call", startAt: "2026-09-19T14:30:00.000Z" });
      expect(out).toContain("DTEND:20260919T153000Z");
    });

    it("uses the given endAt when it is after startAt", () => {
      const out = buildIcs({
        uid: "u1",
        summary: "Call",
        startAt: "2026-09-19T14:30:00.000Z",
        endAt: "2026-09-19T16:00:00.000Z",
      });
      expect(out).toContain("DTEND:20260919T160000Z");
    });

    it("corrects an endAt equal to startAt to startAt plus one hour", () => {
      const out = buildIcs({
        uid: "u1",
        summary: "Call",
        startAt: "2026-09-19T14:30:00.000Z",
        endAt: "2026-09-19T14:30:00.000Z",
      });
      expect(out).toContain("DTEND:20260919T153000Z");
    });

    it("corrects an endAt before startAt rather than emitting it backwards", () => {
      const out = buildIcs({
        uid: "u1",
        summary: "Call",
        startAt: "2026-09-19T14:30:00.000Z",
        endAt: "2026-09-19T10:00:00.000Z",
      });
      expect(out).toContain("DTEND:20260919T153000Z");
    });

    it("startAt wins over dateOnly when both are given", () => {
      const out = buildIcs({
        uid: "u1",
        summary: "Call",
        dateOnly: "2026-01-01",
        startAt: "2026-09-19T14:30:00.000Z",
      });
      expect(out).toContain("DTSTART:20260919T143000Z");
      expect(out).not.toContain("VALUE=DATE");
    });
  });

  describe("DTSTAMP", () => {
    it("uses the stamp override in UTC instant form", () => {
      const out = buildIcs({ uid: "u1", summary: "Call", dateOnly: "2026-09-19", stamp: "2026-01-02T03:04:05.000Z" });
      expect(out).toContain("DTSTAMP:20260102T030405Z");
    });
  });

  describe("optional fields", () => {
    it("includes DESCRIPTION and LOCATION when supplied", () => {
      const out = buildIcs({
        uid: "u1",
        summary: "Job walkthrough",
        dateOnly: "2026-09-19",
        description: "See helix-crm record",
        location: "12 Main St",
      });
      expect(out).toContain("DESCRIPTION:See helix-crm record");
      expect(out).toContain("LOCATION:12 Main St");
    });

    it("omits DESCRIPTION and LOCATION entirely when not supplied", () => {
      const out = buildIcs({ uid: "u1", summary: "Job walkthrough", dateOnly: "2026-09-19" });
      expect(out).not.toContain("DESCRIPTION");
      expect(out).not.toContain("LOCATION");
    });

    it("omits DESCRIPTION when it is an empty string", () => {
      const out = buildIcs({ uid: "u1", summary: "Job walkthrough", dateOnly: "2026-09-19", description: "" });
      expect(out).not.toContain("DESCRIPTION");
    });
  });

  describe("required fields", () => {
    it("every VEVENT carries UID, DTSTAMP, DTSTART, DTEND, SUMMARY", () => {
      const out = buildIcs({ uid: "task-42", summary: "Send revised estimate", dateOnly: "2026-09-19" });
      expect(out).toContain("UID:task-42");
      expect(out).toContain("DTSTAMP:");
      expect(out).toContain("DTSTART");
      expect(out).toContain("DTEND");
      expect(out).toContain("SUMMARY:Send revised estimate");
    });
  });

  describe("escapeText", () => {
    it("escapes a backslash", () => {
      expect(escapeText("C:\\path")).toBe("C:\\\\path");
    });

    it("escapes a semicolon", () => {
      expect(escapeText("a;b")).toBe("a\\;b");
    });

    it("escapes a comma", () => {
      expect(escapeText("a,b")).toBe("a\\,b");
    });

    it("escapes a newline as the two characters backslash-n", () => {
      expect(escapeText("a\nb")).toBe("a\\nb");
    });

    it("drops a literal carriage return", () => {
      expect(escapeText("a\rb")).toBe("ab");
    });

    it("does not escape a colon", () => {
      expect(escapeText("10:30am")).toBe("10:30am");
    });

    it("escapes backslash before semicolon, comma and newline (order matters)", () => {
      expect(escapeText("\\;")).toBe("\\\\\\;");
    });
  });

  describe("folding", () => {
    it("every physical line is at most 75 octets", () => {
      const out = buildIcs({
        uid: "u1",
        summary: "This is a very long summary that should definitely need folding across more than one physical line in the output",
        dateOnly: "2026-09-19",
      });
      for (const line of out.split("\r\n")) {
        expect(utf8ByteLength(line)).toBeLessThanOrEqual(75);
      }
    });

    it("continuation lines start with exactly one space", () => {
      const folded = foldLine(
        "SUMMARY:This is a very long summary that should definitely need folding across more than one physical line",
      );
      const lines = folded.split("\r\n");
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines.slice(1)) {
        expect(line.startsWith(" ")).toBe(true);
        expect(line.startsWith("  ")).toBe(false);
      }
    });

    it("unfolding the output restores the original long value", () => {
      const longSummary =
        "Follow up with the client about the revised estimate and confirm the schedule for next week's install";
      const out = buildIcs({ uid: "u1", summary: longSummary, dateOnly: "2026-09-19" });
      const restored = unfold(out);
      expect(restored).toContain(`SUMMARY:${longSummary}`);
    });

    it("does not split a multi-byte character across a fold boundary", () => {
      // Each of these characters is 3 bytes in UTF-8.
      const longMultiByte = "\u00e9\u00e8\u00ea".repeat(40);
      const folded = foldLine(`SUMMARY:${longMultiByte}`);
      for (const line of folded.split("\r\n")) {
        expect(utf8ByteLength(line)).toBeLessThanOrEqual(75);
      }
      expect(unfold(folded)).toBe(`SUMMARY:${longMultiByte}`);
    });

    it("does not fold in the middle of a backslash-n escape pair", () => {
      // Chosen so the escaped "\n" pair's backslash would land exactly on
      // the 75th octet of the first physical line, right where a naive
      // fold would split the pair across the CRLF boundary.
      const value = "a".repeat(62) + "\n" + "b".repeat(10);
      const escaped = escapeText(value);
      const folded = foldLine(`DESCRIPTION:${escaped}`);
      expect(folded).not.toMatch(/\\\r\n n/);
      expect(unfold(folded)).toBe(`DESCRIPTION:${escaped}`);
    });
  });

  describe("missing or invalid dates", () => {
    it("falls back to an all-day event on today's local date when dateOnly is missing", () => {
      const out = buildIcs({ uid: "u1", summary: "No date given" });
      const todayBasic = new Date().toLocaleDateString("en-CA").replace(/-/g, "");
      expect(out).toContain(`DTSTART;VALUE=DATE:${todayBasic}`);
    });

    it("falls back to an all-day event on today's local date when dateOnly is malformed", () => {
      const out = buildIcs({ uid: "u1", summary: "Bad date", dateOnly: "not-a-date" });
      const todayBasic = new Date().toLocaleDateString("en-CA").replace(/-/g, "");
      expect(out).toContain(`DTSTART;VALUE=DATE:${todayBasic}`);
    });

    it("falls back to an all-day event when startAt is unparseable and dateOnly is absent", () => {
      const out = buildIcs({ uid: "u1", summary: "Bad instant", startAt: "not-an-instant" });
      expect(out).toContain("VALUE=DATE");
    });
  });

  describe("buildIcsCalendar", () => {
    it("emits two VEVENTs inside one VCALENDAR for two events", () => {
      const out = buildIcsCalendar([
        { uid: "task-1", summary: "First", dateOnly: "2026-09-19" },
        { uid: "task-2", summary: "Second", dateOnly: "2026-09-20" },
      ]);
      expect(out.match(/BEGIN:VEVENT/g)?.length).toBe(2);
      expect(out.match(/END:VEVENT/g)?.length).toBe(2);
      expect(out.match(/BEGIN:VCALENDAR/g)?.length).toBe(1);
      expect(out.match(/END:VCALENDAR/g)?.length).toBe(1);
      expect(out).toContain("UID:task-1");
      expect(out).toContain("UID:task-2");
    });
  });

  describe("icsFileName", () => {
    it("lower-cases and collapses spaces and punctuation into single dashes", () => {
      expect(icsFileName("Send Revised Estimate!!")).toBe("send-revised-estimate.ics");
    });

    it("has no leading or trailing dash", () => {
      expect(icsFileName("  --Hello World--  ")).toBe("hello-world.ics");
    });

    it("truncates to a sane length and still ends with .ics", () => {
      const long = "a".repeat(100);
      const name = icsFileName(long);
      expect(name.endsWith(".ics")).toBe(true);
      expect(name.length).toBeLessThanOrEqual(44);
    });

    it("falls back to event.ics when the summary has no usable characters", () => {
      expect(icsFileName("!!!???")).toBe("event.ics");
      expect(icsFileName("")).toBe("event.ics");
    });
  });

  describe("icsUid", () => {
    it("builds kind-id@helix-crm", () => {
      expect(icsUid("task", "abc123")).toBe("task-abc123@helix-crm");
    });

    it("replaces characters outside [A-Za-z0-9-] in the id with a dash", () => {
      expect(icsUid("task", "abc 123!def")).toBe("task-abc-123-def@helix-crm");
    });

    it("never contains a space or line break", () => {
      const uid = icsUid("task", "abc 123\ndef");
      expect(uid).not.toMatch(/\s/);
    });
  });

  describe("type surface", () => {
    it("accepts an IcsEvent with only the required fields", () => {
      const event: IcsEvent = { uid: "u1", summary: "Minimal" };
      expect(() => buildIcs(event)).not.toThrow();
    });
  });
});
