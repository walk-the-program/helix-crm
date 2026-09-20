/**
 * LR-SEC-W2, item 5: LIKE escaping consistency.
 *
 * `src/db/repos/_pickers.ts` already escapes % and _ and pairs it with
 * ESCAPE '\' for the type-ahead pickers. `companies.ts:145`, `products.ts:167`,
 * `deals.ts:242`, `contacts.ts:304` and `documents.ts:409` used `LIKE ?` with
 * no escaping at all on the owner's free-text search box - a literal % or _
 * the owner typed acted as a SQL wildcard instead of matching itself (a
 * search for "100%" matched everything containing "100", and a search for
 * "a_b" matched "aXb" too). All five now build their pattern through
 * `contains()` and pair it with `ESCAPE '\''`, exactly like `_pickers.ts`.
 *
 * This is a real-SQLite proof rather than a string-level one: better-sqlite3
 * is already a devDependency (tests/repo uses it), and LIKE/ESCAPE is a
 * property of the SQLite engine itself, not of the JS string that builds the
 * pattern. This file stays under tests/unit/security per the packet's
 * ownership rule (new test files only under tests/unit/**) rather than
 * tests/repo/, so it opens its own throwaway in-memory database instead of
 * using the shared repo harness.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contains, likeEscape } from "../../../src/db/repos/_pickers";

describe("likeEscape / contains: escaping the LIKE metacharacters", () => {
  it("escapes %, _ and the escape character itself", () => {
    expect(likeEscape("100%")).toBe("100\\%");
    expect(likeEscape("a_b")).toBe("a\\_b");
    expect(likeEscape("back\\slash")).toBe("back\\\\slash");
    expect(likeEscape("100%_off\\")).toBe("100\\%\\_off\\\\");
  });

  it("wraps the escaped value in % wildcards for a contains search", () => {
    expect(contains("100%")).toBe("%100\\%%");
    expect(contains("a_b")).toBe("%a\\_b%");
  });
});

describe("LIKE ... ESCAPE '\\' against a real SQLite connection", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE rows (label TEXT)`);
    const insert = db.prepare(`INSERT INTO rows (label) VALUES (?)`);
    for (const label of [
      "100% off",
      "100 off",
      "aXb",
      "a_b",
      "back\\slash literal",
      "nothing special here",
    ]) {
      insert.run(label);
    }
  });

  afterEach(() => {
    db.close();
  });

  function matches(query: string): string[] {
    const pattern = contains(query);
    const rows = db
      .prepare(`SELECT label FROM rows WHERE label LIKE ? ESCAPE '\\'`)
      .all(pattern) as { label: string }[];
    return rows.map((r) => r.label).sort();
  }

  /** The naive, unescaped `%${query}%` pattern this packet is fixing. */
  function unescapedMatches(query: string): string[] {
    const rows = db
      .prepare(`SELECT label FROM rows WHERE label LIKE ?`)
      .all(`%${query}%`) as { label: string }[];
    return rows.map((r) => r.label).sort();
  }

  it('a literal "%" only matches rows that actually contain a percent sign', () => {
    expect(matches("100%")).toEqual(["100% off"]);
  });

  it('the naive unescaped pattern over-matches on "%" (the bug this fixes)', () => {
    // Without ESCAPE, "%100%%" collapses to "contains 100", so it also
    // matches "100 off", which has no percent sign at all.
    expect(unescapedMatches("100%")).toEqual(["100 off", "100% off"]);
  });

  it('a literal "_" only matches rows with that literal underscore, not any single character', () => {
    expect(matches("a_b")).toEqual(["a_b"]);
  });

  it('the naive unescaped pattern over-matches on "_" (the bug this fixes)', () => {
    // "_" is SQLite's own single-character wildcard, so the unescaped
    // pattern also matches "aXb".
    expect(unescapedMatches("a_b")).toEqual(["aXb", "a_b"]);
  });

  it('a literal backslash matches only rows containing a literal backslash', () => {
    expect(matches("back\\slash")).toEqual(["back\\slash literal"]);
  });

  it("an ordinary search still finds the row a human means", () => {
    expect(matches("nothing special")).toEqual(["nothing special here"]);
    expect(matches("100")).toEqual(["100 off", "100% off"]);
  });

  it("a query with no matches returns nothing, not everything", () => {
    expect(matches("xyz-nonexistent")).toEqual([]);
  });
});
