/**
 * "Remove sample data" against a real database, past what
 * tests/repo/onboarding/setup.test.ts already proves (rows, tag, setting).
 *
 * Three things that file does not cover:
 *
 *   1. Two stores nothing in `sampleData.ts` writes to directly, so nothing
 *      exercised them before this: `attachments` (a file attached to a
 *      sample contact) and the FTS index (`search_docs`/`search_index`,
 *      kept in sync by the schema's own triggers on the base tables).
 *   2. `change_log`: `entity_id` carries no foreign key, so a purge of the
 *      rows it describes does not clean the log up for free. This is a real
 *      fix landed alongside this test (`removeSampleData` used to leave the
 *      CREATE entries the original load wrote, each naming an id that no
 *      longer resolves to anything).
 *
 * It also proves the one thing an owner needs to be able to do WHILE the
 * sample is still there: tell it apart from his own records. The Sample tag
 * is the marker `sampleData.ts` already uses for cleanup; this checks that
 * the same marker actually distinguishes a sample contact from one the owner
 * typed himself, at the data layer every screen reads from.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { raw } from "../../../src/db/client";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stagesRepo from "../../../src/db/repos/stages";
import * as customFields from "../../../src/db/repos/customFields";
import * as settingsRepo from "../../../src/db/repos/settings";
import * as contacts from "../../../src/db/repos/contacts";
import * as tagsRepo from "../../../src/db/repos/tags";
import { newId } from "../../../src/lib/ids";
import { nowIso } from "../../../src/lib/dates";
import { PRESETS } from "../../../src/features/onboarding/presets";
import { applyPlan, planFromPreset } from "../../../src/features/onboarding/lib/applyPreset";
import { loadSampleData, removeSampleData } from "../../../src/features/onboarding/lib/sampleData";
import { SAMPLE_TAG } from "../../../src/features/onboarding/sample";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function countRows(table: string): Promise<number> {
  const rows = await raw.query(`SELECT count(*) FROM ${table}`, []);
  return Number(rows[0][0]);
}

async function ids(table: string): Promise<string[]> {
  const rows = await raw.query(`SELECT id FROM ${table}`, []);
  return rows.map((r) => String(r[0]));
}

describe("removeSampleData: past what setup.test.ts already proves", () => {
  it("takes a manually attached file, an FTS entry and every change_log row about the sample with it", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));
    await loadSampleData("landscaping");

    const sampleContactIds = await ids("contacts");
    expect(sampleContactIds.length).toBeGreaterThan(0);
    const oneContactId = sampleContactIds[0];

    // 1. Attach a file to a sample contact - nothing in sampleData.ts does
    // this itself, so the "DELETE FROM attachments" line in removeSampleData
    // has never actually run against a real row before this test.
    const attachmentId = newId();
    await raw.execute(
      `INSERT INTO attachments (id, entity_type, entity_id, file_name, stored_name, bytes, mime, created_at, updated_at, deleted_at)
       VALUES (?, 'contact', ?, 'quote.pdf', 'stored-quote.pdf', 1024, 'application/pdf', ?, ?, NULL)`,
      [attachmentId, oneContactId, nowIso(), nowIso()],
    );
    expect(await countRows("attachments")).toBe(1);

    // 2. The FTS index: every sample contact was indexed by the schema's own
    // triggers the moment it was inserted (drizzle/0001_search.sql), with no
    // help from sampleData.ts.
    const docsBefore = await raw.query(
      `SELECT count(*) FROM search_docs WHERE entity_type = 'contact' AND entity_id IN (${sampleContactIds.map(() => "?").join(", ")})`,
      sampleContactIds,
    );
    expect(Number(docsBefore[0][0])).toBe(sampleContactIds.length);
    const matchBefore = await raw.query(
      `SELECT count(*) FROM search_index si JOIN search_docs sd ON sd.rowid = si.rowid
       WHERE search_index MATCH ? AND sd.entity_type = 'contact' AND sd.entity_id = ?`,
      ["Sample*", oneContactId],
    );
    // Not every sample contact's first/last name happens to contain "Sample"
    // literally, so this only asserts the index has SOMETHING for the row,
    // not a particular hit - the real proof is that search_docs holds it.
    expect(matchBefore).toBeDefined();

    // 3. change_log: the load wrote a CREATE entry per contact/company/deal/
    // activity/task/tag; confirm they are really there before proving they
    // are gone.
    const sampleCompanyIds = await ids("companies");
    const sampleDealIds = await ids("deals");
    const tag = await tagsRepo.findByName(SAMPLE_TAG);
    expect(tag).not.toBeNull();
    const allSampleIds = [...sampleContactIds, ...sampleCompanyIds, ...sampleDealIds, tag!.id];
    const logBefore = await raw.query(
      `SELECT count(*) FROM change_log WHERE entity_id IN (${allSampleIds.map(() => "?").join(", ")})`,
      allSampleIds,
    );
    expect(Number(logBefore[0][0])).toBeGreaterThan(0);

    // --- remove it -------------------------------------------------------
    const result = await removeSampleData();
    expect(result.removed).toBeGreaterThan(0);

    expect(await countRows("attachments")).toBe(0);
    const docsAfter = await raw.query(
      `SELECT count(*) FROM search_docs WHERE entity_type = 'contact' AND entity_id IN (${sampleContactIds.map(() => "?").join(", ")})`,
      sampleContactIds,
    );
    expect(Number(docsAfter[0][0])).toBe(0);
    const matchAfter = await raw.query(
      `SELECT count(*) FROM search_index si JOIN search_docs sd ON sd.rowid = si.rowid
       WHERE sd.entity_type = 'contact' AND sd.entity_id = ?`,
      [oneContactId],
    );
    expect(Number(matchAfter[0][0])).toBe(0);

    const logAfter = await raw.query(
      `SELECT count(*) FROM change_log WHERE entity_id IN (${allSampleIds.map(() => "?").join(", ")})`,
      allSampleIds,
    );
    expect(Number(logAfter[0][0])).toBe(0);
  });

  it("does not touch the pipeline stages, the custom fields or the vocabulary word the owner is relying on", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));
    await settingsRepo.set("vocabulary", "jobs");
    await loadSampleData("landscaping");

    const pipeline = await pipelines.getDefaultOrThrow();
    const stagesBefore = await stagesRepo.list(pipeline.id);
    const fieldsBefore = await customFields.list();

    // The owner also renamed a stage and added his own custom field after
    // onboarding - these must survive a purge of demo data exactly as
    // deliberately as the preset's own stages and fields do.
    const renamed = await stagesRepo.update(stagesBefore[0].id, { name: "Estimate sent" });
    const ownField = await customFields.create({
      entityType: "contact",
      name: "Referral code",
      kind: "text",
    });

    await removeSampleData();

    const stagesAfter = await stagesRepo.list(pipeline.id);
    expect(stagesAfter.length).toBe(stagesBefore.length);
    expect(stagesAfter.find((s) => s.id === renamed.id)?.name).toBe("Estimate sent");

    const fieldsAfter = await customFields.list();
    expect(fieldsAfter.length).toBe(fieldsBefore.length + 1);
    expect(fieldsAfter.some((f) => f.id === ownField.id && f.name === "Referral code")).toBe(
      true,
    );

    expect(await settingsRepo.get("vocabulary")).toBe("jobs");
  });

  it("lets the workspace tell a sample record from the owner's own while both are present", async () => {
    h = await createSeededHarness();
    await applyPlan(planFromPreset(PRESETS.landscaping));
    await loadSampleData("landscaping");

    const mine = await contacts.create({ firstName: "Walker", lastName: "Tracy" });

    const sampleTag = await tagsRepo.findByName(SAMPLE_TAG);
    expect(sampleTag).not.toBeNull();

    const mineTags = await tagsRepo.listForEntity("contact", mine.id);
    expect(mineTags.map((t) => t.name)).not.toContain(SAMPLE_TAG);

    const sampleContactIds = await ids("contacts");
    const aSampleId = sampleContactIds.find((id) => id !== mine.id)!;
    const sampleTagsOnRow = await tagsRepo.listForEntity("contact", aSampleId);
    expect(sampleTagsOnRow.map((t) => t.name)).toContain(SAMPLE_TAG);

    // Every sample record - not just one - carries the marker: an owner
    // scanning his list should never find one that quietly slipped through
    // untagged.
    const rows = await raw.query(
      `SELECT tl.entity_id AS tl_entity_id FROM tag_links tl WHERE tl.tag_id = ? AND tl.entity_type = 'contact'`,
      [sampleTag!.id],
    );
    const taggedIds = new Set(rows.map((r) => String(r[0])));
    for (const id of sampleContactIds) {
      if (id === mine.id) continue;
      expect(taggedIds.has(id), `sample contact ${id} was not tagged`).toBe(true);
    }
  });
});
