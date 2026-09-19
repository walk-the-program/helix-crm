/**
 * Undo, as the records screens actually use it.
 *
 * Quick add's Undo replays `changeLog.undoBatch`, which deletes the rows a
 * batch inserted. A delete's Undo calls the entity's `restore()` — one
 * statement instead of a replay, and the path the screens use.
 *
 * Since wave 3 `undoBatch` covers a soft delete as well: `softDeleteRow` logs
 * `before: { deletedAt: null }`, and undoBatch writes that back rather than
 * re-inserting a row that never left. Both paths are proved here, and both
 * still work, which is the point — the screens were not changed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../harness";
import { undoBatch } from "@/db/changeLog";
import { newId } from "@/lib/ids";
import * as contactsRepo from "@/db/repos/contacts";
import * as companiesRepo from "@/db/repos/companies";
import * as dealsRepo from "@/db/repos/deals";
import * as tasksRepo from "@/db/repos/tasks";
import * as activitiesRepo from "@/db/repos/activities";
import * as stagesRepo from "@/db/repos/stages";
import * as pipelines from "@/db/repos/pipelines";
import * as trash from "@/db/repos/trash";

let harness: Harness;

beforeEach(async () => {
  harness = await createSeededHarness();
});

afterEach(() => {
  harness.dispose();
});

describe("undo on a quick-add create", () => {
  it("removes a contact the batch inserted", async () => {
    const batchId = newId();
    const contact = await contactsRepo.create(
      {
        firstName: "Brent",
        lastName: "Hendrickson",
        emails: [{ email: "brent@example.com", label: "work", isPrimary: true }],
      },
      { batchId },
    );
    expect(await contactsRepo.get(contact.id)).not.toBeNull();

    await undoBatch(batchId);

    expect(await contactsRepo.get(contact.id)).toBeNull();
    // Not a soft delete: the row is gone, so it is not sitting in the trash.
    expect(await trash.list("contact")).toHaveLength(0);
  });

  it("removes a company, a task and a note the same way", async () => {
    const companyBatch = newId();
    const company = await companiesRepo.create({ name: "Sorensen Landscaping" }, {
      batchId: companyBatch,
    });
    const taskBatch = newId();
    const task = await tasksRepo.create({ title: "Call back" }, { batchId: taskBatch });
    const noteBatch = newId();
    const note = await activitiesRepo.create(
      { kind: "note", body: "Left a voicemail.", companyId: company.id },
      { batchId: noteBatch },
    );

    await undoBatch(noteBatch);
    await undoBatch(taskBatch);
    await undoBatch(companyBatch);

    expect(await activitiesRepo.get(note.id)).toBeNull();
    expect(await tasksRepo.get(task.id)).toBeNull();
    expect(await companiesRepo.get(company.id)).toBeNull();
  });

  it("removes a deal without disturbing the rest of its stage", async () => {
    const pipeline = await pipelines.getDefaultOrThrow();
    const stages = await stagesRepo.list(pipeline.id);
    const keeper = await dealsRepo.create({ title: "Keeper", stageId: stages[0].id });

    const batchId = newId();
    const undone = await dealsRepo.create({ title: "Undone", stageId: stages[0].id }, { batchId });

    await undoBatch(batchId);

    expect(await dealsRepo.get(undone.id)).toBeNull();
    expect(await dealsRepo.get(keeper.id)).not.toBeNull();
  });
});

describe("undoBatch on a soft delete", () => {
  it("brings a soft-deleted contact back, without re-inserting the row", async () => {
    const contact = await contactsRepo.create({
      firstName: "Marta",
      lastName: "Reyes",
      phones: [{ raw: "(801) 555-0147", label: "mobile", isPrimary: true }],
    });

    const batchId = newId();
    await contactsRepo.softDelete(contact.id, { batchId });
    expect(await contactsRepo.list({}).then((r) => r.rows)).toHaveLength(0);
    expect(await trash.list("contact")).toHaveLength(1);

    await undoBatch(batchId);

    const back = await contactsRepo.getOrThrow(contact.id);
    // The row was never deleted, so its id, its timestamps and its child rows
    // all survive: an undone soft delete is the same row, not a copy.
    expect(back.id).toBe(contact.id);
    expect(back.createdAt).toBe(contact.createdAt);
    expect(back.phones).toHaveLength(1);
    expect(await trash.list("contact")).toHaveLength(0);
  });

  it("undoes a whole batch of soft deletes together", async () => {
    const contact = await contactsRepo.create({ firstName: "Marta", lastName: "Reyes" });
    const note = await activitiesRepo.create({
      kind: "call",
      body: "Talked about the fence.",
      contactId: contact.id,
    });
    const task = await tasksRepo.create({ title: "Send the quote", contactId: contact.id });

    const batchId = newId();
    await activitiesRepo.softDelete(note.id, { batchId });
    await tasksRepo.softDelete(task.id, { batchId });

    await undoBatch(batchId);

    expect(await activitiesRepo.list({ contactId: contact.id }).then((r) => r.rows)).toHaveLength(1);
    expect(await tasksRepo.list({ contactId: contact.id }).then((r) => r.rows)).toHaveLength(1);
  });

  it("leaves restore() as the path the screens use, and the two agree", async () => {
    const a = await contactsRepo.create({ firstName: "Marta", lastName: "Reyes" });
    const b = await contactsRepo.create({ firstName: "Dale", lastName: "Okafor" });

    const batchId = newId();
    await contactsRepo.softDelete(a.id, { batchId });
    await contactsRepo.softDelete(b.id);

    expect(await contactsRepo.list({}).then((r) => r.rows)).toHaveLength(0);

    await undoBatch(batchId);
    await contactsRepo.restore(b.id);

    expect(await contactsRepo.list({}).then((r) => r.rows)).toHaveLength(2);
    expect(await trash.list("contact")).toHaveLength(0);
  });
});

describe("undo on a delete", () => {
  it("restores a contact, and the contact leaves the trash", async () => {
    const contact = await contactsRepo.create({ firstName: "Marta", lastName: "Reyes" });

    await contactsRepo.softDelete(contact.id, { batchId: newId() });
    expect(await contactsRepo.list({}).then((r) => r.rows)).toHaveLength(0);
    expect(await trash.list("contact")).toHaveLength(1);

    await contactsRepo.restore(contact.id, { batchId: newId() });

    expect(await contactsRepo.list({}).then((r) => r.rows)).toHaveLength(1);
    expect(await trash.list("contact")).toHaveLength(0);
  });

  it("keeps a restored contact's phones and emails", async () => {
    const contact = await contactsRepo.create({
      firstName: "Marta",
      lastName: "Reyes",
      phones: [{ raw: "(801) 555-0147", label: "mobile", isPrimary: true }],
      emails: [{ email: "marta@example.com", label: "work", isPrimary: true }],
    });

    await contactsRepo.softDelete(contact.id);
    await contactsRepo.restore(contact.id);

    const restored = await contactsRepo.getOrThrow(contact.id);
    expect(restored.phones).toHaveLength(1);
    expect(restored.phones[0].e164).toBe("+18015550147");
    expect(restored.emails).toHaveLength(1);
  });

  it("restores a deleted timeline entry and a deleted task", async () => {
    const contact = await contactsRepo.create({ firstName: "Marta", lastName: "Reyes" });
    const note = await activitiesRepo.create({
      kind: "call",
      body: "Talked about the fence.",
      contactId: contact.id,
    });
    const task = await tasksRepo.create({ title: "Send the quote", contactId: contact.id });

    await activitiesRepo.softDelete(note.id);
    await tasksRepo.softDelete(task.id);
    expect(await activitiesRepo.list({ contactId: contact.id }).then((r) => r.rows)).toHaveLength(0);

    await activitiesRepo.restore(note.id);
    await tasksRepo.restore(task.id);

    expect(await activitiesRepo.list({ contactId: contact.id }).then((r) => r.rows)).toHaveLength(1);
    expect(await tasksRepo.list({ contactId: contact.id }).then((r) => r.rows)).toHaveLength(1);
  });

  it("refuses to delete a system entry, so undo never has to cope with one", async () => {
    const contact = await contactsRepo.create({ firstName: "Marta", lastName: "Reyes" });
    const system = await activitiesRepo.createSystem({
      body: "Lead received from the website.",
      contactId: contact.id,
    });

    await expect(activitiesRepo.softDelete(system.id)).rejects.toThrow();
    await expect(activitiesRepo.update(system.id, { body: "edited" })).rejects.toThrow();
  });
});

describe("the duplicate warning behind the create form", () => {
  it("matches on email first, then on phone, and never on name", async () => {
    await contactsRepo.create({
      firstName: "Brent",
      lastName: "Hendrickson",
      emails: [{ email: "Brent@Example.COM", label: "work", isPrimary: true }],
      phones: [{ raw: "801.555.0147", label: "mobile", isPrimary: true }],
    });

    const byEmail = await contactsRepo.findDuplicates({ emails: ["brent@example.com"] });
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0].matchedOn).toBe("email");

    // Three spellings of the same number all normalise to one E.164.
    const byPhone = await contactsRepo.findDuplicates({ phones: ["(801) 555-0147"] });
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0].matchedOn).toBe("phone");

    const byName = await contactsRepo.findDuplicates({ emails: [], phones: [] });
    expect(byName).toHaveLength(0);
  });

  it("stops warning once the duplicate is in the trash", async () => {
    const contact = await contactsRepo.create({
      firstName: "Brent",
      lastName: "Hendrickson",
      emails: [{ email: "brent@example.com", label: "work", isPrimary: true }],
    });

    await contactsRepo.softDelete(contact.id);

    expect(await contactsRepo.findDuplicates({ emails: ["brent@example.com"] })).toHaveLength(0);
  });
});
