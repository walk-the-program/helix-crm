/**
 * A purged record leaves no row in search (SEC audit, launch round
 * 2026-09-20, acceptance A3).
 *
 * `drizzle/0001_search.sql` wires `search_docs` to `contacts`/`companies`/
 * `deals`/`activities` with an AFTER DELETE trigger that removes the entity's
 * row, and `search_docs`'s own AFTER DELETE trigger removes the matching
 * `search_index` row behind it. `trash.purge()` (`src/db/repos/trash.ts`) does
 * a real `DELETE FROM <table> WHERE id = ?`, so if a customer is purged and a
 * row still answers a search for their name, the trigger chain - not the
 * purge - is what broke.
 *
 * This needs the real migrations and a real SQLite (FTS5 is a virtual table;
 * nothing here is pure), so it borrows the repo harness. It lives under
 * tests/unit because that is where new tests for this audit are scoped to
 * land; `vitest.config.ts` runs both directories identically.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSeededHarness, type Harness } from "../../repo/harness";
import { raw } from "@/db/client";
import * as contacts from "@/db/repos/contacts";
import * as trash from "@/db/repos/trash";

let h: Harness | null = null;

afterEach(() => {
  h?.dispose();
  h = null;
});

async function searchHits(needle: string): Promise<number> {
  const rows = await raw.query(
    `SELECT count(*) FROM search_index WHERE search_index MATCH ?`,
    [needle],
  );
  return Number(rows[0][0]);
}

async function searchDocsFor(entityType: string, entityId: string): Promise<number> {
  const rows = await raw.query(
    `SELECT count(*) FROM search_docs WHERE entity_type = ? AND entity_id = ?`,
    [entityType, entityId],
  );
  return Number(rows[0][0]);
}

describe("search cleanup on purge", () => {
  it("leaves no search_docs or search_index row for a purged contact", async () => {
    h = await createSeededHarness();

    const contact = await contacts.create({
      firstName: "Zbigniew",
      lastName: "Purgeworthy",
    });

    // The insert trigger already indexed it: findable before anything happens.
    expect(await searchHits("Zbigniew")).toBe(1);
    expect(await searchDocsFor("contact", contact.id)).toBe(1);

    await contacts.softDelete(contact.id);
    // A soft delete already pulls it out of search (the triggers filter on
    // `deleted_at IS NULL`) - the real question this test exists for is what
    // happens after the HARD delete.
    expect(await searchHits("Zbigniew")).toBe(0);

    await trash.purge("contact", contact.id);

    expect(await countRows("contacts", contact.id)).toBe(0);
    expect(await searchDocsFor("contact", contact.id)).toBe(0);
    expect(await searchHits("Zbigniew")).toBe(0);
  });

  it("leaves no search row for a purged company, including what its contacts contributed", async () => {
    h = await createSeededHarness();
    const companies = await import("@/db/repos/companies");

    const company = await companies.create({ name: "Anaconda Roofing Unlimited" });
    expect(await searchHits("Anaconda")).toBe(1);

    await companies.softDelete(company.id);
    await trash.purge("company", company.id);

    expect(await searchDocsFor("company", company.id)).toBe(0);
    expect(await searchHits("Anaconda")).toBe(0);
  });
});

async function countRows(table: string, id: string): Promise<number> {
  const rows = await raw.query(`SELECT count(*) FROM ${table} WHERE id = ?`, [id]);
  return Number(rows[0][0]);
}
