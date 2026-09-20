import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import * as merge from "../../src/db/repos/merge";
import * as contacts from "../../src/db/repos/contacts";
import * as companies from "../../src/db/repos/companies";
import * as activities from "../../src/db/repos/activities";
import * as tasks from "../../src/db/repos/tasks";
import * as deals from "../../src/db/repos/deals";
import * as pipelines from "../../src/db/repos/pipelines";
import * as stages from "../../src/db/repos/stages";
import { newId } from "../../src/lib/ids";
import { MergeReversalRefusedError } from "../../src/db/errors";

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

describe("merge: contacts", () => {
  it("moves activities, tasks, deals, phones, emails, tag links, custom values and attachments to the survivor", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const survivor = await contacts.create({ firstName: "Survivor", lastName: "One" });
    const loser = await contacts.create({
      firstName: "Loser",
      lastName: "Two",
      phones: [{ raw: "+1 415 555 0100" }],
      emails: [{ email: "loser@example.com" }],
    });

    const activity = await activities.create({ kind: "note", body: "On loser", contactId: loser.id });
    const task = await tasks.create({ title: "Loser's task", contactId: loser.id });
    const deal = await deals.create({ title: "Loser's deal", stageId, contactId: loser.id });

    const tagId = newId();
    await raw.execute(`INSERT INTO tags (id, name) VALUES (?, ?)`, [tagId, "Tag"]);
    const tagLinkId = newId();
    await raw.execute(
      `INSERT INTO tag_links (id, tag_id, entity_type, entity_id) VALUES (?, ?, ?, ?)`,
      [tagLinkId, tagId, "contact", loser.id],
    );

    const fieldId = newId();
    await raw.execute(
      `INSERT INTO custom_fields (id, entity_type, name, kind) VALUES (?, ?, ?, ?)`,
      [fieldId, "contact", "Notes", "text"],
    );
    const customValueId = newId();
    await raw.execute(
      `INSERT INTO custom_values (id, field_id, entity_id, value_text) VALUES (?, ?, ?, ?)`,
      [customValueId, fieldId, loser.id, "Some value"],
    );

    const attachmentId = newId();
    await raw.execute(
      `INSERT INTO attachments (id, entity_type, entity_id, file_name, stored_name) VALUES (?, ?, ?, ?, ?)`,
      [attachmentId, "contact", loser.id, "file.pdf", "stored.pdf"],
    );

    const result = await merge.merge("contact", survivor.id, loser.id);
    // The call, plus the "Task added" system entry tasks.create has written
    // alongside the task since round 3 (criterion 26). Both belong to the
    // loser and both have to move.
    expect(result.movedCounts.activities).toBe(2);
    expect(result.movedCounts.tasks).toBe(1);
    expect(result.movedCounts.deals).toBe(1);
    expect(result.movedCounts.contact_phones).toBe(1);
    expect(result.movedCounts.contact_emails).toBe(1);
    expect(result.movedCounts.tag_links).toBe(1);
    expect(result.movedCounts.custom_values).toBe(1);
    expect(result.movedCounts.attachments).toBe(1);

    expect((await activities.getOrThrow(activity.id)).contactId).toBe(survivor.id);
    expect((await tasks.getOrThrow(task.id)).contactId).toBe(survivor.id);
    expect((await deals.getOrThrow(deal.id)).contactId).toBe(survivor.id);

    const survivorWithChildren = await contacts.getOrThrow(survivor.id);
    expect(survivorWithChildren.phones.map((p) => p.raw)).toContain("+1 415 555 0100");
    expect(survivorWithChildren.emails.map((e) => e.emailLower)).toContain(
      "loser@example.com",
    );

    const tagLinkRows = await raw.query(
      `SELECT entity_id AS entity_id FROM tag_links WHERE id = ?`,
      [tagLinkId],
    );
    expect(String(tagLinkRows[0][0])).toBe(survivor.id);

    const customValueRows = await raw.query(
      `SELECT entity_id AS entity_id FROM custom_values WHERE id = ?`,
      [customValueId],
    );
    expect(String(customValueRows[0][0])).toBe(survivor.id);

    const attachmentRows = await raw.query(
      `SELECT entity_id AS entity_id FROM attachments WHERE id = ?`,
      [attachmentId],
    );
    expect(String(attachmentRows[0][0])).toBe(survivor.id);

    // The loser is soft-deleted.
    const loserAfter = await contacts.get(loser.id);
    expect(loserAfter?.deletedAt).not.toBeNull();

    // A system activity was written.
    const systemActivities = await raw.query(
      `SELECT count(*) AS n FROM activities WHERE is_system = 1 AND contact_id = ?`,
      [survivor.id],
    );
    expect(Number(systemActivities[0][0])).toBeGreaterThan(0);

    // One merges row was recorded with a batch_id.
    const mergeRecord = await merge.get(result.mergeId);
    expect(mergeRecord?.batchId).toBe(result.batchId);
    expect(mergeRecord?.survivorId).toBe(survivor.id);
    expect(mergeRecord?.loserId).toBe(loser.id);
  });

  it("overwrites the survivor's chosen fields with the field picks", async () => {
    h = await createSeededHarness();
    const survivor = await contacts.create({ firstName: "Keep", lastName: "OldLast" });
    const loser = await contacts.create({ firstName: "Discard", lastName: "NewLast" });

    await merge.merge("contact", survivor.id, loser.id, { last_name: "NewLast" });

    const survivorAfter = await contacts.getOrThrow(survivor.id);
    expect(survivorAfter.lastName).toBe("NewLast");
    expect(survivorAfter.firstName).toBe("Keep");
  });

  it("reverse() restores the loser and keeps rows the survivor already owned", async () => {
    h = await createSeededHarness();
    const survivor = await contacts.create({ firstName: "Survivor", lastName: "Reverse" });
    const loser = await contacts.create({ firstName: "Loser", lastName: "Reverse" });

    const ownTask = await tasks.create({ title: "Already survivor's", contactId: survivor.id });
    const loserTask = await tasks.create({ title: "Loser's task", contactId: loser.id });

    const result = await merge.merge("contact", survivor.id, loser.id);
    expect((await tasks.getOrThrow(ownTask.id)).contactId).toBe(survivor.id);
    expect((await tasks.getOrThrow(loserTask.id)).contactId).toBe(survivor.id);

    await merge.reverse(result.mergeId);

    // The loser's task goes back to the loser...
    expect((await tasks.getOrThrow(loserTask.id)).contactId).toBe(loser.id);
    // ...but the survivor's own pre-existing task must stay with the survivor.
    expect((await tasks.getOrThrow(ownTask.id)).contactId).toBe(survivor.id);

    const loserAfter = await contacts.getOrThrow(loser.id);
    expect(loserAfter.deletedAt).toBeNull();
  });

  it("refuses reversal when the survivor has been merged again since", async () => {
    h = await createSeededHarness();
    const survivor = await contacts.create({ firstName: "Survivor", lastName: "A" });
    const loser1 = await contacts.create({ firstName: "Loser", lastName: "One" });
    const loser2 = await contacts.create({ firstName: "Loser", lastName: "Two" });

    const firstMerge = await merge.merge("contact", survivor.id, loser1.id);
    // Back-date the first merge (but not so far that the 30-day window is
    // also what trips the refusal) so the second merge is unambiguously
    // later, even if both happen within the same millisecond on a fast run.
    await raw.execute(`UPDATE merges SET at = ? WHERE id = ?`, [
      "2024-06-01T00:00:00.000Z",
      firstMerge.mergeId,
    ]);
    await merge.merge("contact", survivor.id, loser2.id);

    await expect(
      merge.reverse(firstMerge.mergeId, { now: "2024-06-20T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(MergeReversalRefusedError);
  });

  it("refuses reversal when the merge was already reversed", async () => {
    h = await createSeededHarness();
    const survivor = await contacts.create({ firstName: "Survivor", lastName: "B" });
    const loser = await contacts.create({ firstName: "Loser", lastName: "B" });

    const result = await merge.merge("contact", survivor.id, loser.id);
    await merge.reverse(result.mergeId);

    await expect(merge.reverse(result.mergeId)).rejects.toBeInstanceOf(
      MergeReversalRefusedError,
    );
  });

  it("refuses reversal when it is older than 30 days", async () => {
    h = await createSeededHarness();
    const survivor = await contacts.create({ firstName: "Survivor", lastName: "C" });
    const loser = await contacts.create({ firstName: "Loser", lastName: "C" });

    const result = await merge.merge("contact", survivor.id, loser.id);
    await raw.execute(`UPDATE merges SET at = ? WHERE id = ?`, [
      "2024-01-01T00:00:00.000Z",
      result.mergeId,
    ]);

    const now = "2024-02-15T00:00:00.000Z"; // 45 days later
    await expect(merge.reverse(result.mergeId, { now })).rejects.toBeInstanceOf(
      MergeReversalRefusedError,
    );
  });
});

describe("merge: companies", () => {
  it("moves contacts to the survivor and can be reversed", async () => {
    h = await createSeededHarness();
    const survivor = await companies.create({ name: "Survivor Co" });
    const loser = await companies.create({ name: "Loser Co" });
    const contact = await contacts.create({
      firstName: "Company",
      lastName: "Contact",
      companyId: loser.id,
    });

    const result = await merge.merge("company", survivor.id, loser.id);
    expect((await contacts.getOrThrow(contact.id)).companyId).toBe(survivor.id);

    const loserAfter = await companies.get(loser.id);
    expect(loserAfter?.deletedAt).not.toBeNull();

    await merge.reverse(result.mergeId);
    expect((await contacts.getOrThrow(contact.id)).companyId).toBe(loser.id);
    expect((await companies.getOrThrow(loser.id)).deletedAt).toBeNull();
  });
});
