/**
 * Trash flow: soft delete -> trash list/counts -> restore, and purge cascading
 * to tag_links and custom_values (docs/PLAN.md item 18).
 *
 * Every repo call is awaited in sequence - the write lock is not reentrant,
 * and Promise.all on writes would hang.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import * as contacts from "../../../src/db/repos/contacts";
import * as deals from "../../../src/db/repos/deals";
import * as tasks from "../../../src/db/repos/tasks";
import * as tags from "../../../src/db/repos/tags";
import * as customFields from "../../../src/db/repos/customFields";
import * as pipelines from "../../../src/db/repos/pipelines";
import * as stages from "../../../src/db/repos/stages";
import * as trash from "../../../src/db/repos/trash";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function firstStageId(): Promise<string> {
  const pipeline = await pipelines.getDefaultOrThrow();
  const stage = await stages.firstStage(pipeline.id);
  if (!stage) throw new Error("Seeded workspace has no first stage.");
  return stage.id;
}

describe("trash: contact soft delete, list, counts, restore", () => {
  it("moves a soft-deleted contact into trash.list and back out on restore", async () => {
    h = await createSeededHarness();

    const contact = await contacts.create({ firstName: "Brent", lastName: "Hendrickson" });

    await contacts.softDelete(contact.id);

    const afterDelete = await contacts.list();
    expect(afterDelete.rows.map((c) => c.id)).not.toContain(contact.id);

    const trashed = await trash.list("contact");
    expect(trashed).toHaveLength(1);
    expect(trashed[0].entityId).toBe(contact.id);
    expect(trashed[0].label).toBe("Brent Hendrickson");
    expect(trashed[0].deletedAt).toBeTruthy();

    const countsAfterDelete = await trash.counts();
    expect(countsAfterDelete.contact).toBe(1);

    await trash.restore("contact", contact.id);

    const countsAfterRestore = await trash.counts();
    expect(countsAfterRestore.contact).toBe(0);

    const restoredTrash = await trash.list("contact");
    expect(restoredTrash).toHaveLength(0);

    const backInList = await contacts.list();
    expect(backInList.rows.map((c) => c.id)).toContain(contact.id);
  });
});

describe("trash: purge cascades to tag_links and custom_values", () => {
  it("hard-deletes the contact row and its tag links and custom values", async () => {
    h = await createSeededHarness();

    const contact = await contacts.create({ firstName: "Katherine", lastName: "Johnson" });

    const tag = await tags.ensure("VIP");
    await tags.attach(tag.id, "contact", contact.id);

    const field = await customFields.create({
      entityType: "contact",
      name: "Referral source",
      kind: "text",
    });
    await customFields.setValue(field.id, contact.id, { text: "Word of mouth" });

    // Sanity: the tag and custom value are actually there before delete.
    const tagsBefore = await tags.listForEntity("contact", contact.id);
    expect(tagsBefore.map((t) => t.id)).toContain(tag.id);
    const valuesBefore = await customFields.listValues(contact.id);
    expect(valuesBefore.map((v) => v.fieldId)).toContain(field.id);

    await contacts.softDelete(contact.id);
    await trash.purge("contact", contact.id);

    const afterPurge = await contacts.get(contact.id);
    expect(afterPurge).toBeNull();

    const trashedAfterPurge = await trash.list("contact");
    expect(trashedAfterPurge).toHaveLength(0);

    const tagsAfter = await tags.listForEntity("contact", contact.id);
    expect(tagsAfter).toEqual([]);

    const valuesAfter = await customFields.listValues(contact.id);
    expect(valuesAfter).toEqual([]);
  });
});

describe("trash: deal and task round-trip", () => {
  it("round trips a deal through delete, trash and restore", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();

    const deal = await deals.create({ title: "Repave the driveway", stageId });

    await deals.softDelete(deal.id);
    const trashedDeals = await trash.list("deal");
    expect(trashedDeals.map((t) => t.entityId)).toContain(deal.id);

    await trash.restore("deal", deal.id);
    const dealAfterRestore = await deals.get(deal.id);
    expect(dealAfterRestore?.deletedAt).toBeNull();

    const trashedDealsAfter = await trash.list("deal");
    expect(trashedDealsAfter.map((t) => t.entityId)).not.toContain(deal.id);
  });

  it("round trips a task through delete, trash and restore", async () => {
    h = await createSeededHarness();

    const task = await tasks.create({ title: "Call the customer back" });

    await tasks.softDelete(task.id);
    const trashedTasks = await trash.list("task");
    expect(trashedTasks.map((t) => t.entityId)).toContain(task.id);

    await trash.restore("task", task.id);
    const taskAfterRestore = await tasks.get(task.id);
    expect(taskAfterRestore?.deletedAt).toBeNull();

    const trashedTasksAfter = await trash.list("task");
    expect(trashedTasksAfter.map((t) => t.entityId)).not.toContain(task.id);
  });
});

describe("trash: listAll across types, newest first", () => {
  it("returns items from more than one type ordered by deletedAt descending", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();

    const contact = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    await contacts.softDelete(contact.id);

    const deal = await deals.create({ title: "Fence install", stageId });
    await deals.softDelete(deal.id);

    const task = await tasks.create({ title: "Follow up next week" });
    await tasks.softDelete(task.id);

    const all = await trash.listAll();

    const entityIds = all.map((item) => item.entityId);
    expect(entityIds).toContain(contact.id);
    expect(entityIds).toContain(deal.id);
    expect(entityIds).toContain(task.id);

    // Newest deletion first: deletedAt is non-increasing across the list.
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].deletedAt.localeCompare(all[i].deletedAt)).toBeGreaterThanOrEqual(0);
    }

    // Three deletions inside one millisecond share a deleted_at, and the sort
    // is stable rather than tie-broken, so the exact order of a tie is not
    // asserted here. What matters is that no later deletion sorts before an
    // earlier one, which the loop above already proves.
    const task_ = all.find((item) => item.entityId === task.id);
    const contact_ = all.find((item) => item.entityId === contact.id);
    expect(task_?.deletedAt.localeCompare(contact_?.deletedAt ?? "")).toBeGreaterThanOrEqual(0);
  });
});
