/**
 * The five report views in drizzle/0002_report_views.sql, each asserted on a
 * hand-built history.
 *
 * Deals and their stage events are inserted directly rather than through the
 * repositories, because these reports are about *when* things happened and the
 * repositories always stamp "now". Everything else - the pipeline, the stages,
 * the sources - comes from the real seed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import * as sources from "../../../src/db/repos/sources";
import { newId } from "../../../src/lib/ids";
import {
  daysInStage,
  leadsBySource,
  pipelineByStage,
  stageConversion,
  wonLost,
} from "../../../src/db/repos/reports";
import { customPeriod, type Period } from "../../../src/lib/periods";

let h: Harness | null = null;
let stageIds: Record<string, string> = {};
let sourceIds: Record<string, string> = {};

/** A range wide enough to hold everything these tests write. */
const ALL_TIME: Period = {
  id: "custom",
  label: "all",
  from: "2000-01-01T00:00:00.000Z",
  to: "2099-01-01T00:00:00.000Z",
};

beforeEach(async () => {
  h = await createSeededHarness();
  const pipeline = await pipelines.getDefaultOrThrow();
  stageIds = {};
  for (const stage of await stages.list(pipeline.id)) stageIds[stage.name] = stage.id;
  sourceIds = {};
  for (const source of (await sources.list()).rows) sourceIds[source.name] = source.id;
});

afterEach(() => {
  h?.dispose();
  h = null;
});

type DealSeed = {
  title: string;
  stage: string;
  valueCents?: number;
  createdAt: string;
  closedAt?: string | null;
  source?: string | null;
  deletedAt?: string | null;
  /** [stage name, ISO instant] in the order the deal moved through them. */
  history: [string, string][];
};

async function seedDeal(seed: DealSeed): Promise<string> {
  const id = newId();
  const statements: { sql: string; params: unknown[] }[] = [
    {
      sql: `INSERT INTO deals
              (id, title, value_cents, currency, stage_id, stage_entered_at, position,
               contact_id, company_id, source_id, external_id, expected_on, closed_at,
               outcome_reason, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, 'USD', ?, ?, 0, NULL, NULL, ?, NULL, NULL, ?, NULL, ?, ?, ?)`,
      params: [
        id,
        seed.title,
        seed.valueCents ?? 0,
        stageIds[seed.stage],
        seed.history[seed.history.length - 1][1],
        seed.source ? sourceIds[seed.source] : null,
        seed.closedAt ?? null,
        seed.createdAt,
        seed.createdAt,
        seed.deletedAt ?? null,
      ],
    },
  ];
  let previous: string | null = null;
  for (const [stageName, at] of seed.history) {
    statements.push({
      sql: `INSERT INTO deal_stage_events
              (id, deal_id, from_stage_id, to_stage_id, at, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      params: [newId(), id, previous, stageIds[stageName], at, at, at],
    });
    previous = stageIds[stageName];
  }
  await raw.batch(statements);
  return id;
}

/* -------------------------------------------------------------------------- */

describe("v_report_pipeline_stage", () => {
  it("sums open deals per stage and keeps the empty stages", async () => {
    await seedDeal({
      title: "Sprinklers",
      stage: "New",
      valueCents: 150_000,
      createdAt: "2026-03-01T10:00:00.000Z",
      history: [["New", "2026-03-01T10:00:00.000Z"]],
    });
    await seedDeal({
      title: "Patio",
      stage: "New",
      valueCents: 350_000,
      createdAt: "2026-03-02T10:00:00.000Z",
      history: [["New", "2026-03-02T10:00:00.000Z"]],
    });
    await seedDeal({
      title: "Tree removal",
      stage: "Quoted",
      valueCents: 90_000,
      createdAt: "2026-03-03T10:00:00.000Z",
      history: [
        ["New", "2026-03-03T10:00:00.000Z"],
        ["Quoted", "2026-03-05T10:00:00.000Z"],
      ],
    });

    const rows = await pipelineByStage();
    const byStage = Object.fromEntries(rows.map((r) => [r.stageName, r]));

    // Only the four open stages: Won and Lost are excluded by their flags.
    expect(rows.map((r) => r.stageName)).toEqual([
      "New",
      "Contacted",
      "Quoted",
      "Scheduled",
    ]);
    expect(byStage.New.openDeals).toBe(2);
    expect(byStage.New.openValueCents).toBe(500_000);
    expect(byStage.Quoted.openDeals).toBe(1);
    expect(byStage.Quoted.openValueCents).toBe(90_000);
    // An empty stage still gets a row, with zeros rather than nothing.
    expect(byStage.Contacted.openDeals).toBe(0);
    expect(byStage.Contacted.openValueCents).toBe(0);
    expect(byStage.New.stageColor).toBe("var(--stage-1)");
  });

  it("leaves out closed and soft-deleted deals", async () => {
    await seedDeal({
      title: "Closed but still in New",
      stage: "New",
      valueCents: 100_000,
      createdAt: "2026-03-01T10:00:00.000Z",
      closedAt: "2026-03-09T10:00:00.000Z",
      history: [["New", "2026-03-01T10:00:00.000Z"]],
    });
    await seedDeal({
      title: "Deleted",
      stage: "New",
      valueCents: 999_000,
      createdAt: "2026-03-01T10:00:00.000Z",
      deletedAt: "2026-03-04T10:00:00.000Z",
      history: [["New", "2026-03-01T10:00:00.000Z"]],
    });

    const rows = await pipelineByStage();
    expect(rows.find((r) => r.stageName === "New")?.openDeals).toBe(0);
    expect(rows.find((r) => r.stageName === "New")?.openValueCents).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("v_report_closed_deals", () => {
  beforeEach(async () => {
    await seedDeal({
      title: "Won in January",
      stage: "Won",
      valueCents: 120_000,
      createdAt: "2026-01-02T10:00:00.000Z",
      closedAt: "2026-01-20T10:00:00.000Z",
      history: [
        ["New", "2026-01-02T10:00:00.000Z"],
        ["Won", "2026-01-20T10:00:00.000Z"],
      ],
    });
    await seedDeal({
      title: "Won in February",
      stage: "Won",
      valueCents: 80_000,
      createdAt: "2026-02-01T10:00:00.000Z",
      closedAt: "2026-02-11T10:00:00.000Z",
      history: [
        ["New", "2026-02-01T10:00:00.000Z"],
        ["Won", "2026-02-11T10:00:00.000Z"],
      ],
    });
    await seedDeal({
      title: "Lost in February",
      stage: "Lost",
      valueCents: 45_000,
      createdAt: "2026-02-02T10:00:00.000Z",
      closedAt: "2026-02-19T10:00:00.000Z",
      history: [
        ["New", "2026-02-02T10:00:00.000Z"],
        ["Lost", "2026-02-19T10:00:00.000Z"],
      ],
    });
    await seedDeal({
      title: "Won in Q3",
      stage: "Won",
      valueCents: 500_000,
      createdAt: "2026-07-01T10:00:00.000Z",
      closedAt: "2026-08-04T10:00:00.000Z",
      history: [
        ["New", "2026-07-01T10:00:00.000Z"],
        ["Won", "2026-08-04T10:00:00.000Z"],
      ],
    });
    // Still open: never appears in this view, whatever the period.
    await seedDeal({
      title: "Still quoting",
      stage: "Quoted",
      valueCents: 1_000_000,
      createdAt: "2026-02-03T10:00:00.000Z",
      history: [["Quoted", "2026-02-03T10:00:00.000Z"]],
    });
  });

  it("buckets by month", async () => {
    const rows = await wonLost(ALL_TIME, "month");
    expect(rows.map((r) => r.bucket)).toEqual(["2026-01", "2026-02", "2026-08"]);

    const february = rows[1];
    expect(february.wonCount).toBe(1);
    expect(february.wonValueCents).toBe(80_000);
    expect(february.lostCount).toBe(1);
    expect(february.lostValueCents).toBe(45_000);
  });

  it("buckets by quarter and by year", async () => {
    const quarters = await wonLost(ALL_TIME, "quarter");
    expect(quarters.map((r) => r.bucket)).toEqual(["2026-Q1", "2026-Q3"]);
    expect(quarters[0].wonCount).toBe(2);
    expect(quarters[0].wonValueCents).toBe(200_000);
    expect(quarters[0].lostCount).toBe(1);

    const years = await wonLost(ALL_TIME, "year");
    expect(years).toHaveLength(1);
    expect(years[0].bucket).toBe("2026");
    expect(years[0].wonCount).toBe(3);
    expect(years[0].wonValueCents).toBe(700_000);
    expect(years[0].lostValueCents).toBe(45_000);
  });

  it("honours the period bounds", async () => {
    const february = customPeriod("2026-02-01", "2026-02-28");
    expect(february).not.toBeNull();
    const rows = await wonLost(february!, "month");
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket).toBe("2026-02");
    expect(rows[0].wonCount).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("v_report_deal_sources", () => {
  it("counts deals per source and buckets the sourceless as Unknown", async () => {
    await seedDeal({
      title: "From the website",
      stage: "New",
      valueCents: 100_000,
      source: "Website",
      createdAt: "2026-03-01T10:00:00.000Z",
      history: [["New", "2026-03-01T10:00:00.000Z"]],
    });
    await seedDeal({
      title: "Also from the website",
      stage: "Won",
      valueCents: 200_000,
      source: "Website",
      createdAt: "2026-03-02T10:00:00.000Z",
      closedAt: "2026-03-20T10:00:00.000Z",
      history: [
        ["New", "2026-03-02T10:00:00.000Z"],
        ["Won", "2026-03-20T10:00:00.000Z"],
      ],
    });
    await seedDeal({
      title: "Word of mouth",
      stage: "New",
      valueCents: 50_000,
      source: "Referral",
      createdAt: "2026-03-03T10:00:00.000Z",
      history: [["New", "2026-03-03T10:00:00.000Z"]],
    });
    await seedDeal({
      title: "No source at all",
      stage: "New",
      valueCents: 25_000,
      source: null,
      createdAt: "2026-03-04T10:00:00.000Z",
      history: [["New", "2026-03-04T10:00:00.000Z"]],
    });
    // Outside the period below.
    await seedDeal({
      title: "Last year",
      stage: "New",
      source: "Website",
      createdAt: "2025-03-04T10:00:00.000Z",
      history: [["New", "2025-03-04T10:00:00.000Z"]],
    });

    const march = customPeriod("2026-03-01", "2026-03-31")!;
    const rows = await leadsBySource(march);
    const byName = Object.fromEntries(rows.map((r) => [r.sourceName, r]));

    expect(rows[0].sourceName).toBe("Website"); // ordered by count
    expect(byName.Website.dealCount).toBe(2);
    expect(byName.Website.valueCents).toBe(300_000);
    expect(byName.Website.wonCount).toBe(1);
    expect(byName.Website.openCount).toBe(1);
    expect(byName.Referral.dealCount).toBe(1);
    expect(byName.Unknown.dealCount).toBe(1);
    expect(byName.Unknown.valueCents).toBe(25_000);
  });
});

/* -------------------------------------------------------------------------- */

describe("v_report_stage_transitions", () => {
  it("is the share of deals that entered a stage and later entered the next one", async () => {
    // Three deals reach New; two go on to Contacted; one of those reaches Quoted.
    await seedDeal({
      title: "Goes all the way",
      stage: "Quoted",
      createdAt: "2026-03-01T09:00:00.000Z",
      history: [
        ["New", "2026-03-01T09:00:00.000Z"],
        ["Contacted", "2026-03-02T09:00:00.000Z"],
        ["Quoted", "2026-03-04T09:00:00.000Z"],
      ],
    });
    await seedDeal({
      title: "Stops at Contacted",
      stage: "Contacted",
      createdAt: "2026-03-01T10:00:00.000Z",
      history: [
        ["New", "2026-03-01T10:00:00.000Z"],
        ["Contacted", "2026-03-03T10:00:00.000Z"],
      ],
    });
    await seedDeal({
      title: "Never leaves New",
      stage: "New",
      createdAt: "2026-03-01T11:00:00.000Z",
      history: [["New", "2026-03-01T11:00:00.000Z"]],
    });

    const rows = await stageConversion(ALL_TIME);
    const byFrom = Object.fromEntries(rows.map((r) => [r.fromStageName, r]));

    // Consecutive by position: New->Contacted, Contacted->Quoted,
    // Quoted->Scheduled, Scheduled->Won, Won->Lost.
    expect(byFrom.New.toStageName).toBe("Contacted");
    expect(byFrom.New.entered).toBe(3);
    expect(byFrom.New.advanced).toBe(2);
    expect(byFrom.New.rate).toBeCloseTo(2 / 3, 6);

    expect(byFrom.Contacted.toStageName).toBe("Quoted");
    expect(byFrom.Contacted.entered).toBe(2);
    expect(byFrom.Contacted.advanced).toBe(1);
    expect(byFrom.Contacted.rate).toBeCloseTo(0.5, 6);

    // Nothing reached Quoted's successor, so Quoted is 1 entered, 0 advanced.
    expect(byFrom.Quoted.entered).toBe(1);
    expect(byFrom.Quoted.advanced).toBe(0);
    expect(byFrom.Quoted.rate).toBe(0);

    // A closed stage is never the "from" side: "Won -> Lost" is not a funnel
    // step, and a deal that has been won has nowhere left to convert to.
    expect(byFrom.Won).toBeUndefined();
    expect(byFrom.Lost).toBeUndefined();
  });

  it("still measures the step into a won stage, which is the one that matters", async () => {
    await seedDeal({
      title: "Scheduled and then won",
      stage: "Won",
      createdAt: "2026-03-01T09:00:00.000Z",
      closedAt: "2026-03-09T09:00:00.000Z",
      history: [
        ["Scheduled", "2026-03-05T09:00:00.000Z"],
        ["Won", "2026-03-09T09:00:00.000Z"],
      ],
    });
    await seedDeal({
      title: "Scheduled and still waiting",
      stage: "Scheduled",
      createdAt: "2026-03-01T09:00:00.000Z",
      history: [["Scheduled", "2026-03-06T09:00:00.000Z"]],
    });

    const rows = await stageConversion(ALL_TIME);
    const scheduled = rows.find((r) => r.fromStageName === "Scheduled");
    expect(scheduled).toBeDefined();
    expect(scheduled!.toStageName).toBe("Won");
    expect(scheduled!.entered).toBe(2);
    expect(scheduled!.advanced).toBe(1);
    expect(scheduled!.rate).toBeCloseTo(0.5, 6);
  });

  it("counts a deal that bounced back and then advanced again", async () => {
    await seedDeal({
      title: "Bouncer",
      stage: "Contacted",
      createdAt: "2026-03-01T09:00:00.000Z",
      history: [
        ["New", "2026-03-01T09:00:00.000Z"],
        ["Contacted", "2026-03-02T09:00:00.000Z"],
        ["New", "2026-03-03T09:00:00.000Z"],
        ["Contacted", "2026-03-04T09:00:00.000Z"],
      ],
    });
    const rows = await stageConversion(ALL_TIME);
    const newRow = rows.find((r) => r.fromStageName === "New")!;
    expect(newRow.entered).toBe(1);
    expect(newRow.advanced).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("v_report_stage_dwell", () => {
  it("averages finished visits and reports the current dwell separately", async () => {
    // Two finished visits to New: 2 days and 4 days -> average 3.
    await seedDeal({
      title: "Two days in New",
      stage: "Contacted",
      createdAt: "2026-03-01T00:00:00.000Z",
      history: [
        ["New", "2026-03-01T00:00:00.000Z"],
        ["Contacted", "2026-03-03T00:00:00.000Z"],
      ],
    });
    await seedDeal({
      title: "Four days in New",
      stage: "Contacted",
      createdAt: "2026-03-01T00:00:00.000Z",
      history: [
        ["New", "2026-03-01T00:00:00.000Z"],
        ["Contacted", "2026-03-05T00:00:00.000Z"],
      ],
    });
    // Sitting in New since ten days ago: counts as current dwell, not average.
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await seedDeal({
      title: "Still waiting",
      stage: "New",
      createdAt: tenDaysAgo,
      history: [["New", tenDaysAgo]],
    });

    const rows = await daysInStage(ALL_TIME);
    const byStage = Object.fromEntries(rows.map((r) => [r.stageName, r]));

    expect(byStage.New.completedCount).toBe(2);
    expect(byStage.New.averageDays).toBeCloseTo(3, 5);
    expect(byStage.New.openCount).toBe(1);
    expect(byStage.New.currentAverageDays).toBeGreaterThan(9.9);
    expect(byStage.New.currentAverageDays).toBeLessThan(10.1);

    // The two deals now sitting in Contacted are open dwell, no history yet.
    expect(byStage.Contacted.completedCount).toBe(0);
    expect(byStage.Contacted.averageDays).toBeNull();
    expect(byStage.Contacted.openCount).toBe(2);

    // Every live stage gets a row, including the ones nothing has touched.
    expect(rows.map((r) => r.stageName)).toEqual([
      "New",
      "Contacted",
      "Quoted",
      "Scheduled",
      "Won",
      "Lost",
    ]);
  });

  it("does not count a closed deal's last stage as open dwell", async () => {
    await seedDeal({
      title: "Won and done",
      stage: "Won",
      createdAt: "2026-03-01T00:00:00.000Z",
      closedAt: "2026-03-06T00:00:00.000Z",
      history: [
        ["New", "2026-03-01T00:00:00.000Z"],
        ["Won", "2026-03-06T00:00:00.000Z"],
      ],
    });
    const rows = await daysInStage(ALL_TIME);
    const won = rows.find((r) => r.stageName === "Won")!;
    expect(won.openCount).toBe(0);
    expect(won.currentAverageDays).toBeNull();

    const newStage = rows.find((r) => r.stageName === "New")!;
    expect(newStage.completedCount).toBe(1);
    expect(newStage.averageDays).toBeCloseTo(5, 5);
  });
});
