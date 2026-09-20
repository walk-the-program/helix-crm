/**
 * `sourcePerformance` (LR-PX-C, PART 1): leads, wins, won value, win rate and
 * median days to win, per lead source, over `v_report_deal_sources` joined to
 * `deals` for `closed_at`.
 *
 * Deals and their `closed_at` are inserted directly with SQL rather than
 * through the deals repository, the same reason tests/repo/leads/reportViews
 * and reportsDeals do it: the repository always stamps "now", and this report
 * is entirely about which instant a row carries.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import * as sources from "../../../src/db/repos/sources";
import { newId } from "../../../src/lib/ids";
import { sourcePerformance } from "../../../src/db/repos/sourceReport";
import type { Period } from "../../../src/lib/periods";

let h: Harness | null = null;
let stageIds: Record<string, string> = {};
let sourceIds: Record<string, string> = {};

const MARCH: Period = {
  id: "month",
  label: "This month",
  from: "2026-03-01T00:00:00.000Z",
  to: "2026-04-01T00:00:00.000Z",
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

async function insertDeal(seed: {
  title: string;
  stage: string;
  valueCents?: number;
  createdAt: string;
  closedAt?: string | null;
  source?: string | null;
}): Promise<void> {
  const id = newId();
  await raw.execute(
    `INSERT INTO deals
       (id, title, value_cents, currency, stage_id, stage_entered_at, position,
        contact_id, company_id, source_id, external_id, expected_on, closed_at,
        outcome_reason, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'USD', ?, ?, 0, NULL, NULL, ?, NULL, NULL, ?, NULL, ?, ?, NULL)`,
    [
      id,
      seed.title,
      seed.valueCents ?? 0,
      stageIds[seed.stage],
      seed.createdAt,
      seed.source ? sourceIds[seed.source] : null,
      seed.closedAt ?? null,
      seed.createdAt,
      seed.createdAt,
    ],
  );
}

describe("sourcePerformance", () => {
  it("is an empty list on a workspace with no deals in the period", async () => {
    expect(await sourcePerformance(MARCH)).toEqual([]);
  });

  it("buckets a deal with no source into Unknown", async () => {
    await insertDeal({
      title: "No source",
      stage: "New",
      valueCents: 1_000_00,
      createdAt: "2026-03-05T10:00:00.000Z",
      source: null,
    });

    const rows = await sourcePerformance(MARCH);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe("");
    expect(rows[0].sourceName).toBe("Unknown");
    expect(rows[0].leads).toBe(1);
    expect(rows[0].won).toBe(0);
    expect(rows[0].winRate).toBe(0);
    expect(rows[0].medianDaysToWin).toBeNull();
  });

  it("counts leads, wins and won value per source, with a ratio win rate", async () => {
    // Website: two leads, one won at 10 days, one lost.
    await insertDeal({
      title: "Website won",
      stage: "Won",
      valueCents: 500_00,
      createdAt: "2026-03-01T09:00:00.000Z",
      closedAt: "2026-03-11T09:00:00.000Z",
      source: "Website",
    });
    await insertDeal({
      title: "Website lost",
      stage: "Lost",
      valueCents: 200_00,
      createdAt: "2026-03-02T09:00:00.000Z",
      closedAt: "2026-03-12T09:00:00.000Z",
      source: "Website",
    });
    // Referral: one lead, still open.
    await insertDeal({
      title: "Referral open",
      stage: "Quoted",
      valueCents: 800_00,
      createdAt: "2026-03-03T09:00:00.000Z",
      source: "Referral",
    });

    const rows = await sourcePerformance(MARCH);
    const bySource = new Map(rows.map((r) => [r.sourceName, r]));

    const website = bySource.get("Website");
    expect(website).toBeDefined();
    expect(website?.leads).toBe(2);
    expect(website?.won).toBe(1);
    expect(website?.wonValueCents).toBe(500_00);
    expect(website?.winRate).toBeCloseTo(0.5, 10);
    expect(website?.medianDaysToWin).toBe(10);

    const referral = bySource.get("Referral");
    expect(referral).toBeDefined();
    expect(referral?.leads).toBe(1);
    expect(referral?.won).toBe(0);
    expect(referral?.winRate).toBe(0);
    expect(referral?.medianDaysToWin).toBeNull();
  });

  it("sorts by won value descending, then source name ascending", async () => {
    await insertDeal({
      title: "Manual small win",
      stage: "Won",
      valueCents: 100_00,
      createdAt: "2026-03-01T09:00:00.000Z",
      closedAt: "2026-03-05T09:00:00.000Z",
      source: "Manual",
    });
    await insertDeal({
      title: "Website big win",
      stage: "Won",
      valueCents: 900_00,
      createdAt: "2026-03-01T09:00:00.000Z",
      closedAt: "2026-03-05T09:00:00.000Z",
      source: "Website",
    });
    // Same won value as Import below, to prove the name tiebreak.
    await insertDeal({
      title: "Referral tie",
      stage: "Won",
      valueCents: 300_00,
      createdAt: "2026-03-01T09:00:00.000Z",
      closedAt: "2026-03-05T09:00:00.000Z",
      source: "Referral",
    });
    await insertDeal({
      title: "Import tie",
      stage: "Won",
      valueCents: 300_00,
      createdAt: "2026-03-01T09:00:00.000Z",
      closedAt: "2026-03-05T09:00:00.000Z",
      source: "Import",
    });

    const rows = await sourcePerformance(MARCH);
    expect(rows.map((r) => r.sourceName)).toEqual(["Website", "Import", "Referral", "Manual"]);
  });

  it("takes the mean of the middle two for an even number of won deals, and the middle one for an odd number", async () => {
    // Odd: 5, 15, 25 days -> median 15.
    await insertDeal({
      title: "odd-1",
      stage: "Won",
      createdAt: "2026-03-01T00:00:00.000Z",
      closedAt: "2026-03-06T00:00:00.000Z",
      source: "Website",
    });
    await insertDeal({
      title: "odd-2",
      stage: "Won",
      createdAt: "2026-03-01T00:00:00.000Z",
      closedAt: "2026-03-16T00:00:00.000Z",
      source: "Website",
    });
    await insertDeal({
      title: "odd-3",
      stage: "Won",
      createdAt: "2026-03-01T00:00:00.000Z",
      closedAt: "2026-03-26T00:00:00.000Z",
      source: "Website",
    });

    let rows = await sourcePerformance(MARCH);
    expect(rows.find((r) => r.sourceName === "Website")?.medianDaysToWin).toBe(15);

    // Add a fourth: 5, 15, 25, 35 -> median (15 + 25) / 2 = 20.
    await insertDeal({
      title: "even-4",
      stage: "Won",
      createdAt: "2026-03-01T00:00:00.000Z",
      closedAt: "2026-04-05T00:00:00.000Z",
      source: "Website",
    });

    rows = await sourcePerformance(MARCH);
    expect(rows.find((r) => r.sourceName === "Website")?.medianDaysToWin).toBe(20);
  });

  it("only counts a won deal's days when it has a closed_at", async () => {
    await insertDeal({
      title: "won without closed_at",
      stage: "Won",
      valueCents: 400_00,
      createdAt: "2026-03-01T00:00:00.000Z",
      closedAt: null,
      source: "Website",
    });

    const rows = await sourcePerformance(MARCH);
    const website = rows.find((r) => r.sourceName === "Website");
    expect(website?.won).toBe(1);
    expect(website?.wonValueCents).toBe(400_00);
    expect(website?.medianDaysToWin).toBeNull();
  });
});
