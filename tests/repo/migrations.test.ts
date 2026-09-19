import { describe, expect, it, afterEach } from "vitest";
import { createHarness, type Harness } from "./harness";
import { raw } from "../../src/db/client";
import { appliedVersions, hasFts5, migrate } from "../../src/db/migrator";
import { diskMigrationSource } from "./harness";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("migrations", () => {
  it("applies every journal entry once", async () => {
    h = await createHarness();
    expect(await appliedVersions()).toEqual(["0000_init", "0001_search"]);
    const again = await migrate({ source: diskMigrationSource, backup: false });
    expect(again.applied).toEqual([]);
  });

  it("creates the FTS5 tables and triggers", async () => {
    h = await createHarness();
    expect(await hasFts5()).toBe(true);
    const tables = await raw.query(
      "SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name",
    );
    const names = tables.map((r) => String(r[0]));
    expect(names).toContain("search_docs");
    expect(names).toContain("search_index");
    expect(names).toContain("search_contacts_ai");
    expect(names).toContain("search_contact_phones_au");
  });

  it("leaves no foreign key violations", async () => {
    h = await createHarness();
    const rows = await raw.query("PRAGMA foreign_key_check");
    expect(rows).toEqual([]);
  });
});
