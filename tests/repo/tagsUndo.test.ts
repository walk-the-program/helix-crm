import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import { undoBatch } from "../../src/db/changeLog";
import * as tags from "../../src/db/repos/tags";
import * as contacts from "../../src/db/repos/contacts";
import { newId } from "../../src/lib/ids";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function makeTag(name: string): Promise<string> {
  const id = newId();
  await raw.execute(`INSERT INTO tags (id, name) VALUES (?, ?)`, [id, name]);
  return id;
}

async function linkCount(contactId: string, tagId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT count(*) FROM tag_links WHERE entity_type = 'contact' AND entity_id = ? AND tag_id = ?`,
    [contactId, tagId],
  );
  return Number(rows[0][0]);
}

// A tag link is hard-deleted. Undo therefore has to re-insert the row, which
// only works when the change_log entry carries the whole row with its id.
// Before this test existed both unlink paths logged an id-less `before`, so
// undoBatch issued an UPDATE that matched nothing and reported success.
describe("undoing a tag removal restores the link", () => {
  it("setForEntity: removing one tag is undone by re-inserting its link", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Tagged", lastName: "Person" });
    const keep = await makeTag("Keep");
    const drop = await makeTag("Drop");
    await tags.setForEntity("contact", contact.id, [keep, drop]);
    expect(await linkCount(contact.id, drop)).toBe(1);

    const batchId = newId();
    await tags.setForEntity("contact", contact.id, [keep], { batchId });
    expect(await linkCount(contact.id, drop)).toBe(0);

    await undoBatch(batchId);
    expect(await linkCount(contact.id, drop)).toBe(1);
    expect(await linkCount(contact.id, keep)).toBe(1);
  });

  it("detach: untagging is undone by re-inserting the link", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Tagged", lastName: "Person" });
    const tag = await makeTag("Seasonal");
    await tags.setForEntity("contact", contact.id, [tag]);

    const batchId = newId();
    await tags.detach(tag, "contact", contact.id, { batchId });
    expect(await linkCount(contact.id, tag)).toBe(0);

    await undoBatch(batchId);
    expect(await linkCount(contact.id, tag)).toBe(1);
  });
});
