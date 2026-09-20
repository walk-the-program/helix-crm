/**
 * Schedule word-choice: the kind label reads the vocabulary rather than
 * assuming Deals, and the time/duration labels never throw on a bad instant.
 *
 * TZ is pinned to UTC so a fixed ISO instant reads as a fixed clock time
 * regardless of the machine running the suite.
 */
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { durationLabel, kindLabel, timeLabel } from "@/features/schedule/lib/labels";
import type { ScheduleItem } from "@/features/schedule/lib/types";
import { DEFAULT_VOCABULARY, vocabularyFor } from "@/lib/vocabulary";

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: "task:1",
    kind: "task",
    sourceId: "1",
    date: "2026-09-21",
    at: null,
    durationMinutes: null,
    title: "Mow the lawn",
    who: null,
    place: null,
    href: "/tasks",
    contactId: null,
    companyId: null,
    dealId: null,
    phone: null,
    ...overrides,
  };
}

describe("kindLabel", () => {
  it("names the five fixed kinds", () => {
    expect(kindLabel("visit", DEFAULT_VOCABULARY)).toBe("Visit");
    expect(kindLabel("task", DEFAULT_VOCABULARY)).toBe("Task");
    expect(kindLabel("recurring-due", DEFAULT_VOCABULARY)).toBe("Reminder due");
    expect(kindLabel("invoice-due", DEFAULT_VOCABULARY)).toBe("Invoice due");
    expect(kindLabel("invoice-issue", DEFAULT_VOCABULARY)).toBe("Invoice to issue");
  });

  it("never hard-codes Deal or Job: deal-expected follows the vocabulary", () => {
    expect(kindLabel("deal-expected", vocabularyFor("deals"))).toBe("Deal expected");
    expect(kindLabel("deal-expected", vocabularyFor("jobs"))).toBe("Job expected");
    expect(kindLabel("deal-expected", vocabularyFor("quotes"))).toBe("Quote expected");
  });
});

describe("timeLabel", () => {
  it("is empty for an all-day item", () => {
    expect(timeLabel(item({ at: null }))).toBe("");
  });

  it("is the start time alone with no duration", () => {
    expect(timeLabel(item({ at: "2026-09-21T09:00:00.000Z" }))).toBe("09:00");
  });

  it("is a start-end range once a duration is known", () => {
    expect(
      timeLabel(item({ at: "2026-09-21T09:00:00.000Z", durationMinutes: 90 })),
    ).toBe("09:00 – 10:30");
  });

  it("carries a duration across an hour boundary", () => {
    expect(
      timeLabel(item({ at: "2026-09-21T23:30:00.000Z", durationMinutes: 60 })),
    ).toBe("23:30 – 00:30");
  });

  it("does not throw on an unparseable instant", () => {
    expect(timeLabel(item({ at: "not-a-time" }))).toBe("");
  });
});

describe("durationLabel", () => {
  it("is empty when there is no duration", () => {
    expect(durationLabel(null)).toBe("");
  });

  it("is empty for a zero or negative duration", () => {
    expect(durationLabel(0)).toBe("");
    expect(durationLabel(-15)).toBe("");
  });

  it("reads minutes alone under an hour", () => {
    expect(durationLabel(30)).toBe("30 min");
  });

  it("reads whole hours with no remainder", () => {
    expect(durationLabel(60)).toBe("1 hr");
    expect(durationLabel(120)).toBe("2 hr");
  });

  it("reads hours and minutes together", () => {
    expect(durationLabel(90)).toBe("1 hr 30 min");
  });
});
