/**
 * The statement builders the import folds into its batches. These are pure,
 * and they are the part that decides whether 500 rows arrive as 500 round
 * trips or as a handful of multi-row inserts.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_BOUND_PARAMS,
  coalesceInserts,
  planBatch,
  companyCreateStatement,
  contactPhoneStatement,
  contactUpdateStatement,
  customFieldCreateStatement,
  tagCreateStatement,
  tagLinkStatement,
} from "../../../src/features/data/lib/importWrite";

describe("coalesceInserts", () => {
  it("folds inserts into the same table into one statement", () => {
    const folded = coalesceInserts([
      { sql: "INSERT INTO contacts (id, first_name) VALUES (?, ?)", params: ["a", "Ann"] },
      { sql: "INSERT INTO contacts (id, first_name) VALUES (?, ?)", params: ["b", "Bob"] },
      { sql: "INSERT INTO contacts (id, first_name) VALUES (?, ?)", params: ["c", "Cal"] },
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0].sql).toBe(
      "INSERT INTO contacts (id, first_name) VALUES (?, ?), (?, ?), (?, ?)",
    );
    expect(folded[0].params).toEqual(["a", "Ann", "b", "Bob", "c", "Cal"]);
  });

  it("starts a new statement when the table or the columns change", () => {
    const folded = coalesceInserts([
      { sql: "INSERT INTO contacts (id) VALUES (?)", params: ["a"] },
      { sql: "INSERT INTO contact_emails (id) VALUES (?)", params: ["e"] },
      { sql: "INSERT INTO contacts (id) VALUES (?)", params: ["b"] },
      { sql: "INSERT INTO contacts (id, notes) VALUES (?, ?)", params: ["c", "hi"] },
    ]);
    expect(folded.map((s) => s.sql)).toEqual([
      "INSERT INTO contacts (id) VALUES (?)",
      "INSERT INTO contact_emails (id) VALUES (?)",
      "INSERT INTO contacts (id) VALUES (?)",
      "INSERT INTO contacts (id, notes) VALUES (?, ?)",
    ]);
  });

  it("leaves anything that is not a plain insert alone, in order", () => {
    const folded = coalesceInserts([
      { sql: "INSERT INTO contacts (id) VALUES (?)", params: ["a"] },
      { sql: "UPDATE contacts SET notes = ? WHERE id = ?", params: ["x", "a"] },
      { sql: "INSERT INTO contacts (id) VALUES (?)", params: ["b"] },
    ]);
    expect(folded).toHaveLength(3);
    expect(folded[1].sql.startsWith("UPDATE")).toBe(true);
  });

  it("splits before SQLite's bound-parameter ceiling", () => {
    const rows = 20_000;
    const statements = Array.from({ length: rows }, (_, i) => ({
      sql: "INSERT INTO contacts (id, first_name) VALUES (?, ?)",
      params: [`id-${i}`, `name-${i}`],
    }));
    const folded = coalesceInserts(statements);
    expect(folded.length).toBeGreaterThan(1);
    for (const statement of folded) {
      expect(statement.params.length).toBeLessThanOrEqual(MAX_BOUND_PARAMS);
    }
    const total = folded.reduce((sum, s) => sum + s.params.length, 0);
    expect(total).toBe(rows * 2);
  });

  it("is a no-op on an empty list", () => {
    expect(coalesceInserts([])).toEqual([]);
  });
});

describe("planBatch", () => {
  /** What one imported row looks like: never two inserts into one table in a row. */
  function rowStatements(i: number) {
    return [
      { sql: "INSERT INTO companies (id, name) VALUES (?, ?)", params: [`co-${i}`, `Co ${i}`] },
      { sql: "INSERT INTO contacts (id, company_id) VALUES (?, ?)", params: [`c-${i}`, `co-${i}`] },
      { sql: "INSERT INTO contact_phones (id, contact_id) VALUES (?, ?)", params: [`p-${i}`, `c-${i}`] },
      { sql: "INSERT INTO contact_emails (id, contact_id) VALUES (?, ?)", params: [`e-${i}`, `c-${i}`] },
    ];
  }

  it("collapses interleaved rows into one statement per table", () => {
    const rows = [0, 1, 2, 3, 4].flatMap(rowStatements);
    expect(rows).toHaveLength(20);
    const planned = planBatch(rows);
    expect(planned).toHaveLength(4);
    for (const statement of planned) {
      expect(statement.sql.match(/\(\?, \?\)/g)).toHaveLength(5);
    }
  });

  it("keeps a parent table ahead of the table that references it", () => {
    const planned = planBatch([
      { sql: "INSERT INTO contact_phones (id) VALUES (?)", params: ["p1"] },
      { sql: "INSERT INTO contacts (id) VALUES (?)", params: ["c1"] },
      { sql: "INSERT INTO companies (id) VALUES (?)", params: ["co1"] },
      { sql: "INSERT INTO tag_links (id) VALUES (?)", params: ["l1"] },
      { sql: "INSERT INTO tags (id) VALUES (?)", params: ["t1"] },
    ]);
    const tables = planned.map((s) => /INSERT INTO (\w+)/.exec(s.sql)?.[1]);
    expect(tables).toEqual([
      "companies",
      "tags",
      "contacts",
      "contact_phones",
      "tag_links",
    ]);
  });

  it("puts every non-insert last, in the order it was built", () => {
    const planned = planBatch([
      { sql: "UPDATE contacts SET notes = ? WHERE id = ?", params: ["a", "c1"] },
      { sql: "INSERT INTO contacts (id) VALUES (?)", params: ["c2"] },
      { sql: "UPDATE contacts SET notes = ? WHERE id = ?", params: ["b", "c1"] },
    ]);
    expect(planned.map((s) => s.sql.slice(0, 6))).toEqual(["INSERT", "UPDATE", "UPDATE"]);
    expect(planned[1].params).toEqual(["a", "c1"]);
  });

  it("leaves an unknown table after the ones it knows, and keeps every row", () => {
    const planned = planBatch([
      { sql: "INSERT INTO widgets (id) VALUES (?)", params: ["w1"] },
      { sql: "INSERT INTO contacts (id) VALUES (?)", params: ["c1"] },
    ]);
    const tables = planned.map((s) => /INSERT INTO (\w+)/.exec(s.sql)?.[1]);
    expect(tables).toEqual(["contacts", "widgets"]);
  });

  it("still respects the bound-parameter ceiling", () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => rowStatements(i)).flat();
    const planned = planBatch(rows);
    for (const statement of planned) {
      expect(statement.params.length).toBeLessThanOrEqual(MAX_BOUND_PARAMS);
    }
    const total = planned.reduce((sum, s) => sum + s.params.length, 0);
    expect(total).toBe(rows.length * 2);
  });
});

describe("the statement builders", () => {
  it("creates a company with nothing but a trimmed name", () => {
    const { id, statement } = companyCreateStatement("  Sandy Landscape Co  ");
    expect(id).toHaveLength(36);
    expect(statement.sql).toMatch(/^INSERT INTO companies \(/);
    expect(statement.params).toContain("Sandy Landscape Co");
  });

  it("normalises a phone on the way in and keeps what was typed", () => {
    const statement = contactPhoneStatement("c1", "801.555.0142", "mobile");
    expect(statement.params).toContain("+18015550142");
    expect(statement.params).toContain("801.555.0142");
  });

  it("stores an unparseable phone raw, with no E.164", () => {
    const statement = contactPhoneStatement("c1", "ask at the desk");
    expect(statement.params).toContain("ask at the desk");
    expect(statement.params).toContain(null);
  });

  it("links a tag polymorphically", () => {
    const tag = tagCreateStatement("landscaping");
    const link = tagLinkStatement(tag.id, "contact", "c1");
    expect(link.sql).toMatch(/^INSERT INTO tag_links \(/);
    expect(link.params).toEqual(expect.arrayContaining([tag.id, "contact", "c1"]));
  });

  it("creates a custom field as text on the right entity", () => {
    const { statement } = customFieldCreateStatement("contact", "Roof type", 3);
    expect(statement.params).toEqual(
      expect.arrayContaining(["contact", "Roof type", "text", 3]),
    );
  });
});

describe("contactUpdateStatement", () => {
  it("only fills a column that is empty today", () => {
    const statement = contactUpdateStatement("c1", { firstName: "Sarah" });
    expect(statement).not.toBeNull();
    expect(statement?.sql).toContain("first_name = COALESCE(NULLIF(first_name, ''), ?)");
  });

  it("appends notes instead of replacing them", () => {
    const statement = contactUpdateStatement("c1", { notes: "Called Tuesday" });
    expect(statement?.sql).toContain("notes = CASE WHEN notes IS NULL OR notes = ''");
    expect(statement?.params.filter((p) => p === "Called Tuesday")).toHaveLength(2);
  });

  it("ignores empty values, and writes nothing when there is nothing to write", () => {
    expect(contactUpdateStatement("c1", { firstName: "", notes: "  " })).toBeNull();
    expect(contactUpdateStatement("c1", {})).toBeNull();
  });

  it("puts the id last, after every bound value", () => {
    const statement = contactUpdateStatement("c1", {
      firstName: "Sarah",
      companyId: "co-1",
    });
    expect(statement?.params[statement.params.length - 1]).toBe("c1");
  });
});
