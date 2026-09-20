import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import { undoBatch } from "../../src/db/changeLog";
import * as bulk from "../../src/db/repos/bulk";
import * as contacts from "../../src/db/repos/contacts";
import * as companies from "../../src/db/repos/companies";
import * as deals from "../../src/db/repos/deals";
import * as sources from "../../src/db/repos/sources";
import * as pipelines from "../../src/db/repos/pipelines";
import * as stages from "../../src/db/repos/stages";
import { newId } from "../../src/lib/ids";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const [stage] = await stages.list(pipeline.id);
  return stage.id;
}

async function makeTag(name: string): Promise<string> {
  const id = newId();
  await raw.execute(`INSERT INTO tags (id, name) VALUES (?, ?)`, [id, name]);
  return id;
}

async function tagLinkCount(tagId: string, contactId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT count(*) FROM tag_links WHERE tag_id = ? AND entity_type = 'contact' AND entity_id = ? AND deleted_at IS NULL`,
    [tagId, contactId],
  );
  return Number(rows[0][0]);
}

describe("bulk: addTagToContacts / removeTagFromContacts", () => {
  it("adds a tag to every contact in one batch", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const b = await contacts.create({ firstName: "B", lastName: "Two" });
    const tagId = await makeTag("Repeat");

    const result = await bulk.addTagToContacts([a.id, b.id], tagId);

    expect(result.count).toBe(2);
    expect(await tagLinkCount(tagId, a.id)).toBe(1);
    expect(await tagLinkCount(tagId, b.id)).toBe(1);

    const logRows = await raw.query(`SELECT batch_id FROM change_log WHERE batch_id = ?`, [
      result.batchId,
    ]);
    expect(logRows.length).toBe(2);
  });

  it("is idempotent: adding a tag a contact already has does not duplicate the link", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const tagId = await makeTag("Repeat");

    await bulk.addTagToContacts([a.id], tagId);
    await bulk.addTagToContacts([a.id], tagId);

    expect(await tagLinkCount(tagId, a.id)).toBe(1);
  });

  it("removing a tag a contact does not have is a no-op, not an error", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const tagId = await makeTag("Repeat");

    await expect(bulk.removeTagFromContacts([a.id], tagId)).resolves.toEqual({
      batchId: expect.any(String),
      count: 1,
    });
  });

  it("undoBatch reverses the whole add in one step", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const b = await contacts.create({ firstName: "B", lastName: "Two" });
    const tagId = await makeTag("Repeat");

    const { batchId } = await bulk.addTagToContacts([a.id, b.id], tagId);
    await undoBatch(batchId);

    expect(await tagLinkCount(tagId, a.id)).toBe(0);
    expect(await tagLinkCount(tagId, b.id)).toBe(0);
  });

  it("rolls back the WHOLE transaction when one contact id does not exist", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const tagId = await makeTag("Repeat");
    const missingId = newId();

    await expect(bulk.addTagToContacts([a.id, missingId], tagId)).rejects.toThrow();

    // The valid id's link must not have been left behind by the failed batch.
    expect(await tagLinkCount(tagId, a.id)).toBe(0);
  });
});

describe("bulk: setContactsCompany", () => {
  it("sets the company on every contact in one batch and undoes as one step", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Acme" });
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const b = await contacts.create({ firstName: "B", lastName: "Two" });

    const { batchId, count } = await bulk.setContactsCompany([a.id, b.id], company.id);
    expect(count).toBe(2);
    expect((await contacts.get(a.id))?.companyId).toBe(company.id);
    expect((await contacts.get(b.id))?.companyId).toBe(company.id);

    await undoBatch(batchId);
    expect((await contacts.get(a.id))?.companyId).toBeNull();
    expect((await contacts.get(b.id))?.companyId).toBeNull();
  });

  it("rolls back the whole transaction and leaves the database untouched on a bad id", async () => {
    h = await createSeededHarness();
    const company = await companies.create({ name: "Acme" });
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const missingId = newId();

    await expect(
      bulk.setContactsCompany([a.id, missingId], company.id),
    ).rejects.toThrow();

    expect((await contacts.get(a.id))?.companyId).toBeNull();
  });
});

describe("bulk: trashContacts", () => {
  it("soft-deletes every contact in one batch", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const b = await contacts.create({ firstName: "B", lastName: "Two" });

    const { batchId, count } = await bulk.trashContacts([a.id, b.id]);
    expect(count).toBe(2);
    expect((await contacts.get(a.id))?.deletedAt).not.toBeNull();
    expect((await contacts.get(b.id))?.deletedAt).not.toBeNull();

    await undoBatch(batchId);
    expect((await contacts.get(a.id))?.deletedAt).toBeNull();
    expect((await contacts.get(b.id))?.deletedAt).toBeNull();
  });

  it("a mid-list failure rolls back every contact already trashed in the same call", async () => {
    h = await createSeededHarness();
    const a = await contacts.create({ firstName: "A", lastName: "One" });
    const b = await contacts.create({ firstName: "B", lastName: "Two" });
    const missingId = newId();

    await expect(bulk.trashContacts([a.id, b.id, missingId])).rejects.toThrow();

    expect((await contacts.get(a.id))?.deletedAt).toBeNull();
    expect((await contacts.get(b.id))?.deletedAt).toBeNull();
  });
});

describe("bulk: setDealsSource", () => {
  it("sets the source on every deal in one batch and undoes as one step", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const source = await sources.create({ name: "Referral" });
    const d1 = await deals.create({ title: "Deal one", stageId });
    const d2 = await deals.create({ title: "Deal two", stageId });

    const { batchId, count } = await bulk.setDealsSource([d1.id, d2.id], source.id);
    expect(count).toBe(2);
    expect((await deals.get(d1.id))?.sourceId).toBe(source.id);
    expect((await deals.get(d2.id))?.sourceId).toBe(source.id);

    await undoBatch(batchId);
    expect((await deals.get(d1.id))?.sourceId).toBeNull();
    expect((await deals.get(d2.id))?.sourceId).toBeNull();
  });

  it("rolls back the whole transaction on a bad deal id", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const source = await sources.create({ name: "Referral" });
    const d1 = await deals.create({ title: "Deal one", stageId });
    const missingId = newId();

    await expect(bulk.setDealsSource([d1.id, missingId], source.id)).rejects.toThrow();
    expect((await deals.get(d1.id))?.sourceId).toBeNull();
  });
});

describe("bulk: trashDeals", () => {
  it("soft-deletes every deal in one batch and undoes as one step", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const d1 = await deals.create({ title: "Deal one", stageId });
    const d2 = await deals.create({ title: "Deal two", stageId });

    const { batchId, count } = await bulk.trashDeals([d1.id, d2.id]);
    expect(count).toBe(2);
    expect((await deals.get(d1.id))?.deletedAt).not.toBeNull();
    expect((await deals.get(d2.id))?.deletedAt).not.toBeNull();

    await undoBatch(batchId);
    expect((await deals.get(d1.id))?.deletedAt).toBeNull();
    expect((await deals.get(d2.id))?.deletedAt).toBeNull();
  });

  it("a mid-list failure rolls back every deal already trashed in the same call", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const d1 = await deals.create({ title: "Deal one", stageId });
    const d2 = await deals.create({ title: "Deal two", stageId });
    const missingId = newId();

    await expect(bulk.trashDeals([d1.id, d2.id, missingId])).rejects.toThrow();

    expect((await deals.get(d1.id))?.deletedAt).toBeNull();
    expect((await deals.get(d2.id))?.deletedAt).toBeNull();
  });
});

describe("bulk: empty input", () => {
  it("every operation is a no-op returning count 0 for an empty id list", async () => {
    h = await createSeededHarness();
    expect(await bulk.trashContacts([])).toEqual({ batchId: expect.any(String), count: 0 });
    expect(await bulk.trashDeals([])).toEqual({ batchId: expect.any(String), count: 0 });
  });
});
