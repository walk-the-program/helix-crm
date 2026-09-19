/**
 * The gone-quiet rule (docs/PLAN.md item 11) as arithmetic, with no database.
 *
 * `deals.goneQuiet()` runs the same comparison in SQL. These tests pin the
 * boundaries the SQL cannot be asked about cheaply: the exact day a deal
 * crosses its limit, a stage with the rule switched off, a deal that has never
 * had an activity, and a laptop whose clock is wrong.
 */
import { describe, expect, it } from "vitest";
import {
  compareQuiet,
  daysSince,
  describeQuiet,
  isGoneQuiet,
  lastTouch,
  quietVerdict,
  snoozeActivityBody,
} from "../../../src/features/today/lib/goneQuiet";

const NOW = "2026-09-18T12:00:00.000Z";

/** N whole days before NOW, to the millisecond. */
function daysAgo(days: number, extraMs = 0): string {
  return new Date(
    Date.parse(NOW) - days * 24 * 60 * 60 * 1000 + extraMs,
  ).toISOString();
}

describe("lastTouch", () => {
  it("takes the later of stage entry and the newest activity", () => {
    expect(lastTouch(daysAgo(30), daysAgo(3))).toBe(daysAgo(3));
    expect(lastTouch(daysAgo(3), daysAgo(30))).toBe(daysAgo(3));
  });

  it("falls back to stage entry when the deal has no activity", () => {
    expect(lastTouch(daysAgo(30), null)).toBe(daysAgo(30));
    expect(lastTouch(daysAgo(30))).toBe(daysAgo(30));
  });

  it("ignores a timestamp that will not parse rather than trusting it", () => {
    expect(lastTouch("not a date", daysAgo(5))).toBe(daysAgo(5));
    expect(lastTouch(daysAgo(5), "not a date")).toBe(daysAgo(5));
    expect(lastTouch("not a date", "also not a date")).toBeNull();
  });
});

describe("daysSince", () => {
  it("counts whole days and floors the remainder", () => {
    expect(daysSince(daysAgo(14), NOW)).toBe(14);
    // 13 days and 23 hours is not yet 14 days.
    expect(daysSince(daysAgo(14, 60 * 60 * 1000), NOW)).toBe(13);
  });

  it("never returns a negative number for a future timestamp", () => {
    expect(daysSince(daysAgo(-5), NOW)).toBe(0);
  });

  it("returns 0 for dates it cannot read", () => {
    expect(daysSince(null, NOW)).toBe(0);
    expect(daysSince("rubbish", NOW)).toBe(0);
    expect(daysSince(daysAgo(5), "rubbish")).toBe(0);
  });
});

describe("quietVerdict", () => {
  const stage = { quietDays: 14 };

  it("fires on the day the limit is reached, not the day after", () => {
    const at14 = quietVerdict({ stageEnteredAt: daysAgo(14), ...stage }, NOW);
    expect(at14.quiet).toBe(true);
    expect(at14.daysQuiet).toBe(14);
    expect(at14.reason).toBe("quiet");

    const at13 = quietVerdict({ stageEnteredAt: daysAgo(13), ...stage }, NOW);
    expect(at13.quiet).toBe(false);
    expect(at13.reason).toBe("recent");
  });

  it("counts from the newest activity, not from stage entry, once one exists", () => {
    const verdict = quietVerdict(
      { stageEnteredAt: daysAgo(60), lastActivityAt: daysAgo(2), ...stage },
      NOW,
    );
    expect(verdict.quiet).toBe(false);
    expect(verdict.daysQuiet).toBe(2);
  });

  it("uses stage entry when the deal has never had an activity", () => {
    const verdict = quietVerdict(
      { stageEnteredAt: daysAgo(21), lastActivityAt: null, ...stage },
      NOW,
    );
    expect(verdict.quiet).toBe(true);
    expect(verdict.daysQuiet).toBe(21);
    expect(verdict.limitDays).toBe(14);
  });

  it("is switched off for a stage with quiet_days 0", () => {
    const verdict = quietVerdict(
      { stageEnteredAt: daysAgo(400), quietDays: 0 },
      NOW,
    );
    expect(verdict.quiet).toBe(false);
    expect(verdict.reason).toBe("disabled");
  });

  it("never fires on a won or a lost deal, whatever the dates say", () => {
    expect(
      quietVerdict({ stageEnteredAt: daysAgo(400), quietDays: 14, stageIsWon: true }, NOW),
    ).toMatchObject({ quiet: false, reason: "closed" });
    expect(
      quietVerdict({ stageEnteredAt: daysAgo(400), quietDays: 14, stageIsLost: true }, NOW),
    ).toMatchObject({ quiet: false, reason: "closed" });
  });

  it("does not fire on dates it cannot read", () => {
    const verdict = quietVerdict(
      { stageEnteredAt: "rubbish", lastActivityAt: "also rubbish", quietDays: 14 },
      NOW,
    );
    expect(verdict.quiet).toBe(false);
    expect(verdict.reason).toBe("unknown-dates");
  });

  it("does not fire on a deal whose timestamps are in the future", () => {
    // A laptop with a clock set forward writes stage_entered_at ahead of now.
    const verdict = quietVerdict(
      { stageEnteredAt: daysAgo(-30), quietDays: 14 },
      NOW,
    );
    expect(verdict.quiet).toBe(false);
    expect(verdict.daysQuiet).toBe(0);
  });

  it("treats a nonsense quiet_days as the rule being off", () => {
    expect(
      quietVerdict(
        { stageEnteredAt: daysAgo(400), quietDays: Number.NaN },
        NOW,
      ),
    ).toMatchObject({ quiet: false, reason: "disabled" });
    expect(
      quietVerdict({ stageEnteredAt: daysAgo(400), quietDays: -7 }, NOW),
    ).toMatchObject({ quiet: false, reason: "disabled" });
  });

  it("truncates a fractional quiet_days rather than comparing against a fraction", () => {
    const verdict = quietVerdict(
      { stageEnteredAt: daysAgo(14), quietDays: 14.9 },
      NOW,
    );
    expect(verdict.limitDays).toBe(14);
    expect(verdict.quiet).toBe(true);
  });
});

describe("isGoneQuiet", () => {
  it("is the boolean of quietVerdict", () => {
    expect(isGoneQuiet({ stageEnteredAt: daysAgo(30), quietDays: 14 }, NOW)).toBe(true);
    expect(isGoneQuiet({ stageEnteredAt: daysAgo(1), quietDays: 14 }, NOW)).toBe(false);
  });
});

describe("describeQuiet", () => {
  it("spells the numbers out and gets the singular right", () => {
    expect(
      describeQuiet(quietVerdict({ stageEnteredAt: daysAgo(21), quietDays: 14 }, NOW)),
    ).toBe("No activity for 21 days · Limit 14 days");
    expect(
      describeQuiet(quietVerdict({ stageEnteredAt: daysAgo(1), quietDays: 1 }, NOW)),
    ).toBe("No activity for 1 day · Limit 1 days");
  });

  it("says so when there is no readable date at all", () => {
    expect(
      describeQuiet(quietVerdict({ stageEnteredAt: "rubbish", quietDays: 14 }, NOW)),
    ).toBe("No activity yet · Limit 14 days");
  });
});

describe("compareQuiet", () => {
  it("puts the longest-quiet deal first, then the largest value, then the title", () => {
    const rows = [
      { daysQuiet: 15, valueCents: 500, title: "B" },
      { daysQuiet: 30, valueCents: 100, title: "A" },
      { daysQuiet: 15, valueCents: 900, title: "C" },
      { daysQuiet: 15, valueCents: 500, title: "A" },
    ];
    expect([...rows].sort(compareQuiet).map((r) => `${r.daysQuiet}-${r.title}`)).toEqual([
      "30-A",
      "15-C",
      "15-A",
      "15-B",
    ]);
  });
});

describe("snoozeActivityBody", () => {
  it("says how long the snooze actually lasts, which is the stage's limit", () => {
    expect(snoozeActivityBody(14)).toContain("14 days");
    expect(snoozeActivityBody(1)).toContain("1 day");
    expect(snoozeActivityBody(1)).not.toContain("1 days");
  });
});
