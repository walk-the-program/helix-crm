/**
 * LR-SEC-W2, item 6: hostile-input coverage for `toMatchQuery` in
 * src/db/repos/search.ts.
 *
 * `toMatchQuery` quotes every whitespace-split token and doubles internal
 * quotes before handing the result to FTS5's MATCH operator, specifically so
 * a stray quote, hyphen, colon or FTS5 keyword typed into the search box
 * cannot be read as FTS5 query syntax. This proves it against a real FTS5
 * table (better-sqlite3 compiles FTS5 in) rather than only checking the
 * string `toMatchQuery` produces - a syntactically-plausible MATCH string can
 * still throw at query time (for example a quoted phrase that tokenizes to
 * nothing), which only running it against the engine can catch.
 *
 * New file under tests/unit/security per the packet's ownership rule (new
 * test files only under tests/unit/**); it opens its own throwaway in-memory
 * FTS5 table rather than using the tests/repo harness.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toMatchQuery } from "../../../src/db/repos/search";

describe("toMatchQuery: the string it produces", () => {
  it("quotes a bare word and adds a prefix star", () => {
    expect(toMatchQuery("ada")).toBe(`"ada"*`);
  });

  it("quotes every whitespace-separated token independently", () => {
    expect(toMatchQuery("ada lovelace")).toBe(`"ada"* "lovelace"*`);
  });

  it("doubles an internal quote", () => {
    expect(toMatchQuery(`o'brien`)).toBe(`"o'brien"*`);
    expect(toMatchQuery(`say "hi"`)).toBe(`"say"* """hi"""*`);
  });

  it("returns empty for whitespace-only input", () => {
    expect(toMatchQuery("   ")).toBe("");
    expect(toMatchQuery("")).toBe("");
  });
});

describe("toMatchQuery: hostile queries never throw an FTS5 syntax error", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE VIRTUAL TABLE search_index USING fts5(text)`);
    const insert = db.prepare(`INSERT INTO search_index (text) VALUES (?)`);
    for (const text of [
      "Ada Lovelace, ada@example.com",
      "O'Brien Plumbing near 801 555 0147",
      "NEAR miss - the deal is (still) open",
      "quotation marks say \"hello\" to everyone",
      "a caret ^ and a colon: appear here",
    ]) {
      insert.run(text);
    }
  });

  afterEach(() => {
    db.close();
  });

  function runQuery(input: string): unknown[] {
    const match = toMatchQuery(input);
    if (match.length === 0) return [];
    return db
      .prepare(`SELECT text FROM search_index WHERE search_index MATCH ?`)
      .all(match);
  }

  const hostileInputs: Record<string, string> = {
    'a single double quote (")': `"`,
    'two double quotes ("")': `""`,
    "a bare asterisk": "*",
    "a trailing-star word": "a*",
    "NEAR(a b)": "NEAR(a b)",
    "a OR b": "a OR b",
    "a AND NOT b": "a AND NOT b",
    "a leading caret": "^a",
    "a column-filter-shaped token": "a:b",
    "a bare open paren": "(",
    "a bare close paren": ")",
    "a 10 kB single token": "x".repeat(10_000),
    "an all-punctuation token": "!@#$%^&*()_+-={}[]|\\:;<>,.?/~`",
    "an emoji": "🎉",
    "an emoji mixed with a word": "party 🎉 time",
    "nested quotes and stars": `"a*" "b`,
    "just whitespace": "   \t  ",
  };

  for (const [label, input] of Object.entries(hostileInputs)) {
    it(`does not throw for ${label} (${JSON.stringify(input.length > 40 ? input.slice(0, 40) + "…" : input)})`, () => {
      expect(() => runQuery(input)).not.toThrow();
    });
  }

  it("a real word inside a hostile-looking phrase still finds the row a human means", () => {
    const rows = runQuery("lovelace") as { text: string }[];
    expect(rows.some((r) => r.text.includes("Ada Lovelace"))).toBe(true);
  });

  it("an apostrophe in the query still finds the apostrophe'd name", () => {
    const rows = runQuery("o'brien") as { text: string }[];
    expect(rows.some((r) => r.text.includes("O'Brien"))).toBe(true);
  });

  it("a quote character in the query returns cleanly (empty or a match), never a thrown error", () => {
    expect(() => runQuery('say "hi"')).not.toThrow();
    const rows = runQuery('say "hi"');
    expect(Array.isArray(rows)).toBe(true);
  });
});
