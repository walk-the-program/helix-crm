/**
 * Purging a customer takes the notes about them with it (F-SEC-10).
 *
 * `activities`, `tasks` and `recurring_rules` all reference a contact with
 * `ON DELETE set null` (drizzle/0000_init.sql). So before this fix, emptying
 * the trash deleted the contact row and left every note about them behind with
 * `contact_id` nulled out - and because `search_activities_ad` only fires on a
 * real DELETE, the note kept its `search_docs` row too. The owner was told the
 * customer was gone for good, and typing that customer's name still found
 * "Called Jane about the leak, she's at 42 Elm St".
 *
 * The other half of the rule matters just as much and is tested here as
 * deliberately: a note filed against a contact AND a deal is a note about the
 * deal as well. The deal is still there, so the note stays and loses only the
 * link. Deleting it would be a different bug in the opposite direction.
 *
 * Real migrations and real SQLite, because the whole mechanism is foreign keys
 * and triggers; it borrows the repo harness the way searchIndexPurge does.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../../repo/harness";
import { raw } from "@/db/client";
import * as contacts from "@/db/repos/contacts";
import * as activities from "@/db/repos/activities";
import * as trash from "@/db/repos/trash";

let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
});

async function countWhere(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await raw.query(sql, params);
  return Number(rows[0][0]);
}

async function searchHits(needle: string): Promise<number> {
  return countWhere(
    `SELECT count(*) FROM search_index WHERE search_index MATCH ?`,
    [needle],
  );
}

describe("purging a record sweeps up what was only about that record", () => {
  it("deletes a note whose only subject was the purged contact, search row and all", async () => {
    h = await createSeededHarness();

    const contact = await contacts.create({
      firstName: "Wilhelmina",
      lastName: "Quatrefoil",
    });
    await activities.create({
      kind: "note",
      body: "Called Wilhelmina about the leak, she is at 42 Elm Street",
      contactId: contact.id,
      companyId: null,
      dealId: null,
    });

    // The note is findable by the customer's name while they exist.
    expect(await searchHits("Wilhelmina")).toBeGreaterThan(0);

    await contacts.softDelete(contact.id);
    await trash.purge("contact", contact.id);

    expect(
      await countWhere(`SELECT count(*) FROM activities WHERE body LIKE '%Elm Street%'`),
    ).toBe(0);
    expect(await searchHits("Wilhelmina")).toBe(0);
    expect(await searchHits("Quatrefoil")).toBe(0);
  });

  it("keeps a note that also belongs to a deal, and only drops the contact link", async () => {
    h = await createSeededHarness();

    const contact = await contacts.create({ firstName: "Ada", lastName: "Lovelace" });
    const stageRows = await raw.query(`SELECT id FROM stages ORDER BY position LIMIT 1`);
    const stageId = String(stageRows[0][0]);
    await raw.execute(
      `INSERT INTO deals (id, title, stage_id, stage_entered_at, contact_id, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))`,
      ["deal-keep-1", "Gutter clean", stageId, contact.id],
    );
    const deal = { id: "deal-keep-1" };
    await activities.create({
      kind: "note",
      body: "Quoted the gutter clean at 300",
      contactId: contact.id,
      companyId: null,
      dealId: deal.id,
    });

    await contacts.softDelete(contact.id);
    await trash.purge("contact", contact.id);

    // The deal is still real, so its note is too - it just has no contact now.
    const kept = await raw.query(
      `SELECT contact_id, deal_id FROM activities WHERE body = ?`,
      ["Quoted the gutter clean at 300"],
    );
    expect(kept.length).toBe(1);
    expect(kept[0][0]).toBeNull();
    expect(kept[0][1]).toBe(deal.id);
  });

  it("takes a task that was only about the purged contact", async () => {
    h = await createSeededHarness();

    const contact = await contacts.create({ firstName: "Bartholomew", lastName: "Finch" });
    await raw.execute(
      `INSERT INTO tasks (id, title, contact_id, company_id, deal_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, datetime('now'), datetime('now'))`,
      ["task-orphan-1", "Ring Bartholomew back", contact.id],
    );

    await contacts.softDelete(contact.id);
    await trash.purge("contact", contact.id);

    expect(
      await countWhere(`SELECT count(*) FROM tasks WHERE id = ?`, ["task-orphan-1"]),
    ).toBe(0);
  });
});
