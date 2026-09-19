import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import * as trash from "../../src/db/repos/trash";
import * as contacts from "../../src/db/repos/contacts";
import * as deals from "../../src/db/repos/deals";
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

describe("trash: list per type", () => {
  it("shows soft-deleted rows with a label", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Trashed", lastName: "Person" });
    await contacts.softDelete(contact.id);

    const items = await trash.list("contact");
    const found = items.find((i) => i.entityId === contact.id);
    expect(found).toBeDefined();
    expect(found?.label).toBe("Trashed Person");
  });

  it("excludes live rows", async () => {
    h = await createSeededHarness();
    await contacts.create({ firstName: "Alive", lastName: "Person" });
    const items = await trash.list("contact");
    expect(items).toEqual([]);
  });
});

describe("trash: restore", () => {
  it("brings a row back", async () => {
    h = await createSeededHarness();
    const contact = await contacts.create({ firstName: "Comeback", lastName: "Kid" });
    await contacts.softDelete(contact.id);

    await trash.restore("contact", contact.id);

    const found = await contacts.get(contact.id);
    expect(found?.deletedAt).toBeNull();
  });
});

describe("trash: purge order and FK cascades", () => {
  it("cascades contact_phones and contact_emails, nulls out deals.contact_id, and deletes tag_links/custom_values/attachments", async () => {
    h = await createSeededHarness();
    const stageId = await firstStageId();
    const contact = await contacts.create({
      firstName: "Cascade",
      lastName: "Test",
      phones: [{ raw: "+1 415 555 0100" }],
      emails: [{ email: "cascade@example.com" }],
    });
    const deal = await deals.create({
      title: "Linked deal",
      stageId,
      contactId: contact.id,
    });

    const tagId = newId();
    await raw.execute(`INSERT INTO tags (id, name) VALUES (?, ?)`, [tagId, "VIP"]);
    const tagLinkId = newId();
    await raw.execute(
      `INSERT INTO tag_links (id, tag_id, entity_type, entity_id) VALUES (?, ?, ?, ?)`,
      [tagLinkId, tagId, "contact", contact.id],
    );

    const fieldId = newId();
    await raw.execute(
      `INSERT INTO custom_fields (id, entity_type, name, kind) VALUES (?, ?, ?, ?)`,
      [fieldId, "contact", "Favorite color", "text"],
    );
    const customValueId = newId();
    await raw.execute(
      `INSERT INTO custom_values (id, field_id, entity_id, value_text) VALUES (?, ?, ?, ?)`,
      [customValueId, fieldId, contact.id, "Blue"],
    );

    const attachmentId = newId();
    await raw.execute(
      `INSERT INTO attachments (id, entity_type, entity_id, file_name, stored_name) VALUES (?, ?, ?, ?, ?)`,
      [attachmentId, "contact", contact.id, "notes.pdf", "stored-notes.pdf"],
    );

    await contacts.softDelete(contact.id);
    await trash.purge("contact", contact.id);

    // The contact row itself is gone.
    expect(await contacts.get(contact.id)).toBeNull();

    // contact_phones and contact_emails cascade-deleted via ON DELETE CASCADE.
    const phones = await raw.query(
      `SELECT count(*) AS n FROM contact_phones WHERE contact_id = ?`,
      [contact.id],
    );
    expect(Number(phones[0][0])).toBe(0);
    const emails = await raw.query(
      `SELECT count(*) AS n FROM contact_emails WHERE contact_id = ?`,
      [contact.id],
    );
    expect(Number(emails[0][0])).toBe(0);

    // deals.contact_id is nulled out via ON DELETE SET NULL.
    const stillDeal = await deals.getOrThrow(deal.id);
    expect(stillDeal.contactId).toBeNull();

    // tag_links, custom_values and attachments are explicitly deleted.
    const tagLinks = await raw.query(`SELECT count(*) AS n FROM tag_links WHERE id = ?`, [
      tagLinkId,
    ]);
    expect(Number(tagLinks[0][0])).toBe(0);
    const customValues = await raw.query(
      `SELECT count(*) AS n FROM custom_values WHERE id = ?`,
      [customValueId],
    );
    expect(Number(customValues[0][0])).toBe(0);
    const attachments = await raw.query(
      `SELECT count(*) AS n FROM attachments WHERE id = ?`,
      [attachmentId],
    );
    expect(Number(attachments[0][0])).toBe(0);

    // change_log rows are kept.
    const changeLogRows = await raw.query(
      `SELECT count(*) AS n FROM change_log WHERE entity_type = 'contact' AND entity_id = ?`,
      [contact.id],
    );
    expect(Number(changeLogRows[0][0])).toBeGreaterThan(0);
  });
});

describe("trash: expired", () => {
  it("only returns rows soft-deleted longer ago than the window", async () => {
    h = await createSeededHarness();
    const oldContact = await contacts.create({ firstName: "Old", lastName: "Trash" });
    const recentContact = await contacts.create({ firstName: "Recent", lastName: "Trash" });

    await contacts.softDelete(oldContact.id);
    await contacts.softDelete(recentContact.id);

    // Back-date the old contact's deletion to 40 days before "today".
    await raw.execute(`UPDATE contacts SET deleted_at = ? WHERE id = ?`, [
      "2024-01-01T00:00:00.000Z",
      oldContact.id,
    ]);
    // Recent one deleted 5 days before "today".
    await raw.execute(`UPDATE contacts SET deleted_at = ? WHERE id = ?`, [
      "2024-02-05T00:00:00.000Z",
      recentContact.id,
    ]);

    const today = "2024-02-10"; // 40 days after old, 5 days after recent
    const expired = await trash.expired(30, today);
    const ids = expired.map((e) => e.entityId);
    expect(ids).toContain(oldContact.id);
    expect(ids).not.toContain(recentContact.id);
  });

  it("respects a custom retention window", async () => {
    h = await createSeededHarness();
    const tenDaysAgo = await contacts.create({ firstName: "TenDaysAgo", lastName: "Test" });
    const threeDaysAgo = await contacts.create({ firstName: "ThreeDaysAgo", lastName: "Test" });
    await contacts.softDelete(tenDaysAgo.id);
    await contacts.softDelete(threeDaysAgo.id);
    await raw.execute(`UPDATE contacts SET deleted_at = ? WHERE id = ?`, [
      "2024-02-01T00:00:00.000Z",
      tenDaysAgo.id,
    ]);
    await raw.execute(`UPDATE contacts SET deleted_at = ? WHERE id = ?`, [
      "2024-02-08T00:00:00.000Z",
      threeDaysAgo.id,
    ]);

    const today = "2024-02-11";
    const expiredAtFiveDays = await trash.expired(5, today);
    const ids = expiredAtFiveDays.map((e) => e.entityId);
    expect(ids).toContain(tenDaysAgo.id);
    expect(ids).not.toContain(threeDaysAgo.id);
  });
});
