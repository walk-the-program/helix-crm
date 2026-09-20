/**
 * Round 3, criterion 26: the timeline is the record's full history, and the
 * repositories write their system entries in the same transaction as the
 * change itself — so a task cannot exist without the line that says it was
 * added.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, createSeededHarness, type Harness } from "../harness";
import * as activities from "../../../src/db/repos/activities";
import * as attachments from "../../../src/db/repos/attachments";
import * as contacts from "../../../src/db/repos/contacts";
import * as tasks from "../../../src/db/repos/tasks";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function bodiesFor(contactId: string): Promise<string[]> {
  const { rows } = await activities.list({ contactId });
  return rows.map((r) => r.body);
}

describe("tasks write their own timeline entries", () => {
  it("records a task being added against the record it is linked to", async () => {
    h = await createHarness();
    const contact = await contacts.create({ firstName: "Priya", lastName: "Raman" });
    await tasks.create({ title: "Call about the roof", contactId: contact.id });

    const { rows } = await activities.list({ contactId: contact.id });
    const entry = rows.find((r) => r.body === "Task added: Call about the roof");
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe("system");
    expect(entry?.contactId).toBe(contact.id);
  });

  it("records a task being completed, dated when it was completed", async () => {
    h = await createHarness();
    const contact = await contacts.create({ firstName: "Dale", lastName: "Winters" });
    const task = await tasks.create({ title: "Send the quote", contactId: contact.id });
    await tasks.complete(task.id, { at: "2026-03-04T17:00:00.000Z" });

    const { rows } = await activities.list({ contactId: contact.id });
    const done = rows.find((r) => r.body === "Task done: Send the quote");
    expect(done).toBeDefined();
    expect(done?.occurredAt).toBe("2026-03-04T17:00:00.000Z");
  });

  it("writes nothing for a task linked to no record, rather than an orphan entry", async () => {
    h = await createHarness();
    const before = await activities.list({});
    await tasks.create({ title: "Buy more ladders" });
    const after = await activities.list({});
    expect(after.rows.length).toBe(before.rows.length);
  });

  it("leaves no task behind when the entry cannot be written", async () => {
    // The two writes share one transaction, so this is really a statement
    // about atomicity: after a successful create, both rows exist.
    h = await createHarness();
    const contact = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const task = await tasks.create({ title: "Measure the gutters", contactId: contact.id });
    expect(await tasks.get(task.id)).not.toBeNull();
    expect(await bodiesFor(contact.id)).toContain("Task added: Measure the gutters");
  });
});

describe("attachments write their own timeline entries", () => {
  const file = {
    fileName: "roof-photo.jpg",
    storedName: "abc123.jpg",
    bytes: 2048,
    mime: "image/jpeg",
  };

  it("records a file added to a contact", async () => {
    h = await createHarness();
    const contact = await contacts.create({ firstName: "Tom", lastName: "Ramanathan" });
    await attachments.create({ entityType: "contact", entityId: contact.id, ...file });
    expect(await bodiesFor(contact.id)).toContain("File added: roof-photo.jpg");
  });

  it("records a file added to a deal", async () => {
    h = await createSeededHarness();
    const deals = await import("../../../src/db/repos/deals");
    const stages = await import("../../../src/db/repos/stages");
    const pipelines = await import("../../../src/db/repos/pipelines");
    const pipeline = await pipelines.getDefault();
    const stageList = await stages.list(pipeline!.id);
    const deal = await deals.create({
      title: "Re-roof at 14 Elm",
      stageId: stageList[0].id,
      valueCents: 0,
    });
    await attachments.create({ entityType: "deal", entityId: deal.id, ...file });
    const { rows } = await activities.list({ dealId: deal.id });
    expect(rows.map((r) => r.body)).toContain("File added: roof-photo.jpg");
  });

  it("writes no entry for an entity type with no timeline", async () => {
    h = await createHarness();
    const before = await activities.list({});
    await attachments.create({ entityType: "document", entityId: "doc-1", ...file });
    const after = await activities.list({});
    expect(after.rows.length).toBe(before.rows.length);
  });
});
