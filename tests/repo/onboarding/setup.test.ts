/**
 * Onboarding against a real database.
 *
 * Three things are worth proving here and cannot be proved anywhere else: that
 * applying a preset on a fresh workspace leaves exactly the pipeline the trade
 * described, that the sample set loads and every row of it carries the tag, and
 * that removing it leaves the workspace as empty as it started — no rows, no
 * tag, no setting, and nothing orphaned.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as settings from "../../../src/db/repos/settings";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import * as sources from "../../../src/db/repos/sources";
import * as customFields from "../../../src/db/repos/customFields";
import * as tags from "../../../src/db/repos/tags";
import * as contacts from "../../../src/db/repos/contacts";
import * as companies from "../../../src/db/repos/companies";
import * as deals from "../../../src/db/repos/deals";
import * as activities from "../../../src/db/repos/activities";
import * as tasks from "../../../src/db/repos/tasks";
import { DEFAULT_STAGES } from "../../../src/db/repos/seed";
import { PRESETS } from "../../../src/features/onboarding/presets";
import { SAMPLES } from "../../../src/features/onboarding/sample";
import {
  applyPlan,
  planFromPreset,
} from "../../../src/features/onboarding/lib/applyPreset";
import {
  loadSampleData,
  removeSampleData,
} from "../../../src/features/onboarding/lib/sampleData";
import {
  markSkipped,
  readOnboardingState,
  readSampleLoadedAt,
} from "../../../src/features/onboarding/lib/settings";
import { shouldShowOnboarding } from "../../../src/features/onboarding/gate";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function countRows(table: string): Promise<number> {
  const rows = await raw.query(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0][0]);
}

describe("the onboarding gate", () => {
  it("fires on a fresh workspace and never again once it is answered", async () => {
    h = await createSeededHarness();
    expect(await shouldShowOnboarding()).toBe(true);

    await markSkipped();
    expect(await shouldShowOnboarding()).toBe(false);
  });

  it("does not fire on a workspace that already has records", async () => {
    h = await createSeededHarness();
    await contacts.create({ firstName: "Marla", lastName: "Quintero" });
    expect(await shouldShowOnboarding()).toBe(false);
  });

  it("does not fire once a preset has been applied", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));
    expect(await shouldShowOnboarding()).toBe(false);
  });
});

describe("applying a preset", () => {
  it("replaces the default pipeline with the trade's own, in order", async () => {
    h = await createSeededHarness();
    const preset = PRESETS.landscaping;

    const result = await applyPlan(planFromPreset(preset));
    expect(result.replaced).toBe(true);
    expect(result.stagesCreated).toBe(preset.stages.length);

    const pipeline = await pipelines.getDefaultOrThrow();
    const rows = await stages.list(pipeline.id);

    expect(rows.map((s) => s.name)).toEqual(preset.stages.map((s) => s.name));
    expect(rows.map((s) => s.position)).toEqual(preset.stages.map((_, i) => i));
    expect(rows.map((s) => s.quietDays)).toEqual(preset.stages.map((s) => s.quietDays));
    expect(rows.filter((s) => s.isWon)).toHaveLength(1);
    expect(rows.filter((s) => s.isLost)).toHaveLength(1);
    expect(rows.find((s) => s.isWon)!.color).toBe("var(--stage-5)");
    expect(rows.find((s) => s.isLost)!.color).toBe("var(--stage-6)");

    // The six the first-boot seed put there are gone, not soft-deleted beside it.
    for (const seeded of DEFAULT_STAGES) {
      if (preset.stages.some((s) => s.name === seeded.name)) continue;
      expect(rows.some((s) => s.name === seeded.name)).toBe(false);
    }
    expect(await countRows("stages")).toBe(preset.stages.length);
  });

  it("replaces the sources and writes the trade's fields, vocabulary and completedAt", async () => {
    h = await createSeededHarness();
    const preset = PRESETS.landscaping;
    await applyPlan(planFromPreset(preset));

    const sourceRows = (await sources.list()).rows;
    expect(sourceRows.map((s) => s.name).sort()).toEqual(
      preset.sources.map((s) => s.name).sort(),
    );

    const fieldRows = await customFields.list();
    expect(fieldRows).toHaveLength(preset.fields.length);
    for (const field of preset.fields) {
      const found = fieldRows.find(
        (f) => f.name === field.name && f.entityType === field.entityType,
      );
      expect(found, `no field called ${field.name}`).toBeTruthy();
      expect(found!.kind).toBe(field.kind);
      if (field.kind === "choice") {
        expect(JSON.parse(found!.optionsJson!)).toEqual(field.options);
      } else {
        expect(found!.optionsJson).toBeNull();
      }
    }

    expect(await settings.get("vocabulary")).toBe(preset.vocabulary);
    const state = await readOnboardingState();
    expect(state.completedAt).toBeTruthy();
    expect(state.skippedAt).toBeNull();
  });

  it("is additive, never destructive, on a workspace that is already in use", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));
    await loadSampleData("landscaping");

    const before = (await deals.list({}, { limit: 200 })).total;
    expect(before).toBeGreaterThan(0);

    const result = await applyPlan(planFromPreset(PRESETS.dental));
    expect(result.replaced).toBe(false);

    const pipeline = await pipelines.getDefaultOrThrow();
    const names = (await stages.list(pipeline.id)).map((s) => s.name);
    // The landscaping stages the deals are sitting in are all still there.
    for (const stage of PRESETS.landscaping.stages) {
      expect(names).toContain(stage.name);
    }
    expect((await deals.list({}, { limit: 200 })).total).toBe(before);
    expect(await settings.get("vocabulary")).toBe(PRESETS.dental.vocabulary);
  });

  it("refuses a plan with no won stage and changes nothing", async () => {
    h = await createSeededHarness();
    const plan = planFromPreset(PRESETS.landscaping);
    const broken = { ...plan, stages: plan.stages.map((s) => ({ ...s, isWon: false })) };

    await expect(applyPlan(broken)).rejects.toThrow(/won/i);

    const pipeline = await pipelines.getDefaultOrThrow();
    const names = (await stages.list(pipeline.id)).map((s) => s.name);
    expect(names).toEqual(DEFAULT_STAGES.map((s) => s.name));
    expect((await readOnboardingState()).completedAt).toBeNull();
  });
});

describe("the sample data set", () => {
  it("loads a whole week, tagged, in the preset's own stages", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));

    const counts = await loadSampleData("landscaping");
    const set = SAMPLES.landscaping;
    expect(counts).toEqual({
      // R9: the set now carries priced lines and two invoices, raised through
      // the repositories after the transactional phase.
      dealItems: set.deals.reduce((n, d) => n + (d.items?.length ?? 0), 0),
      documents: (set.documents ?? []).length,
      companies: set.companies.length,
      contacts: set.contacts.length,
      deals: set.deals.length,
      activities: set.activities.length,
      tasks: set.tasks.length,
    });

    expect((await contacts.list({}, { limit: 100 })).total).toBe(set.contacts.length);
    expect((await companies.list({}, { limit: 100 })).total).toBe(set.companies.length);
    expect((await deals.list({}, { limit: 100 })).total).toBe(set.deals.length);
    /*
     * The set's own activities are the ones it authored; the documents raised
     * in phase two add their own system timeline entries on top ("Invoice
     * INV-0001 sent, $1,450.00"), which is the behaviour the example exists to
     * demonstrate. So the two are counted separately rather than summed into a
     * number nobody can check.
     */
    expect((await activities.list({ includeSystem: false }, { limit: 200 })).total).toBe(
      set.activities.length,
    );
    const withSystem = (await activities.list({ includeSystem: true }, { limit: 200 })).total;
    expect(withSystem).toBeGreaterThan(set.activities.length);
    expect((await tasks.list({}, { limit: 100 })).total).toBe(set.tasks.length);
    expect(await readSampleLoadedAt()).toBeTruthy();

    // Every row carries the tag, including the tasks and activities nothing else
    // in the product tags today.
    const tag = await tags.findByName("Sample");
    expect(tag).toBeTruthy();
    const links = await raw.query(
      `SELECT tl.entity_type AS t, count(*) AS n FROM tag_links tl
       WHERE tl.tag_id = ? GROUP BY tl.entity_type`,
      [tag!.id],
    );
    const byType = Object.fromEntries(links.map((r) => [String(r[0]), Number(r[1])]));
    expect(byType).toEqual({
      company: set.companies.length,
      contact: set.contacts.length,
      deal: set.deals.length,
      activity: set.activities.length,
      task: set.tasks.length,
    });

    // The deals landed in real stages, spread over the board, with money on them.
    const board = await deals.list({}, { limit: 100 });
    expect(new Set(board.rows.map((d) => d.stageName)).size).toBeGreaterThanOrEqual(4);
    expect(board.rows.every((d) => d.valueCents > 0)).toBe(true);

    // Phones and emails came through the normal child-row path.
    expect(await countRows("contact_phones")).toBe(
      set.contacts.filter((c) => c.phone).length,
    );
    expect(await countRows("contact_emails")).toBe(
      set.contacts.filter((c) => c.email).length,
    );
    // And the preset's own custom fields have values on them.
    expect(await countRows("custom_values")).toBeGreaterThan(0);
  });

  /*
   * The arithmetic, end to end, for every trade (R9).
   *
   * `tests/unit/onboarding/sample.test.ts` holds the DATA to its claims — that
   * a priced deal's lines add up to the value it states. This holds the LOADER
   * to the same claim, which is a different thing: the lines go in through
   * `dealItems`, and `recompute` is what actually writes `value_cents`. If the
   * two ever disagree, the board and the pipeline totals move under a change
   * that was only supposed to add detail, and nothing above this line would
   * notice.
   */
  it.each(Object.keys(SAMPLES) as (keyof typeof SAMPLES)[])(
    "%s: a priced deal's value_cents is exactly what the set says",
    async (trade) => {
      h = await createSeededHarness();
      await applyPlan(planFromPreset(PRESETS[trade]));
      await loadSampleData(trade);

      const set = SAMPLES[trade];
      const priced = set.deals.filter((d) => (d.items?.length ?? 0) > 0);
      // Every set has money now; a set that quietly lost it should fail here.
      expect(priced.length, `${trade} has no priced deals`).toBeGreaterThan(0);

      /*
       * Matched by title, and a title is not unique — two gym members can both
       * have an "Unlimited monthly membership" — so this asserts that the
       * values the set states are all present among the rows with that title,
       * rather than that there is exactly one row.
       */
      for (const title of new Set(priced.map((d) => d.title))) {
        const rows = await raw.query(
          `SELECT value_cents FROM deals WHERE title = ? AND deleted_at IS NULL`,
          [title],
        );
        const actual = rows.map((r) => Number(r[0]));
        for (const deal of priced.filter((d) => d.title === title)) {
          const want = Math.round(deal.value * 100);
          expect(
            actual,
            `${trade}: "${title}" recomputed to something other than the ${want} the set states (got ${actual.join(", ")})`,
          ).toContain(want);
        }
      }

      // And every document the set declares was actually raised, with a real
      // number out of the sequence rather than a hand-rolled insert.
      const declared = (set.documents ?? []).length;
      const raised = await raw.query(`SELECT number FROM documents`, []);
      expect(raised.length, `${trade}: documents raised`).toBe(declared);
      for (const row of raised) {
        expect(String(row[0]), `${trade}: a document with no number`).toMatch(/\w+-\d{4}-\d+/);
      }
    },
  );

  it("comes out again leaving no rows, no tag and no setting", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));
    await loadSampleData("landscaping");

    // R9: the example now raises real invoices, so prove they were there
    // before proving they are gone — an assertion against a table that was
    // already empty proves nothing.
    expect(await countRows("deal_items")).toBeGreaterThan(0);
    expect(await countRows("documents")).toBe(2);
    expect(await countRows("document_items")).toBeGreaterThan(0);

    const result = await removeSampleData();
    expect(result.removed).toBeGreaterThan(0);

    for (const table of [
      "contacts",
      "companies",
      "deals",
      "deal_stage_events",
      "activities",
      "tasks",
      "contact_phones",
      "contact_emails",
      "custom_values",
      // The money the example brought with it. `documents.deal_id` is ON
      // DELETE SET NULL, so an invoice raised against a sample deal would
      // otherwise survive its deal and float free of any record.
      "deal_items",
      "documents",
      "document_items",
      "invoice_schedules",
      "tag_links",
      "tags",
    ]) {
      expect(await countRows(table), `${table} still has rows`).toBe(0);
    }
    expect(await tags.findByName("Sample")).toBeNull();
    expect(await readSampleLoadedAt()).toBeNull();

    // The pipeline the owner set up is untouched: only the example went.
    const pipeline = await pipelines.getDefaultOrThrow();
    expect((await stages.list(pipeline.id)).length).toBe(
      PRESETS.landscaping.stages.length,
    );
    expect((await customFields.list()).length).toBe(PRESETS.landscaping.fields.length);
  });

  it("does nothing, twice, when there is no sample data", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));
    expect(await removeSampleData()).toEqual({ removed: 0 });

    await loadSampleData("landscaping");
    await removeSampleData();
    expect(await removeSampleData()).toEqual({ removed: 0 });
  });

  it("leaves what the owner added himself alone", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));
    await loadSampleData("landscaping");

    const mine = await contacts.create({ firstName: "Walker", lastName: "Tracy" });
    await removeSampleData();

    expect((await contacts.list({}, { limit: 100 })).total).toBe(1);
    expect((await contacts.get(mine.id))?.firstName).toBe("Walker");
  });
});
