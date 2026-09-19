import { describe, expect, it } from "vitest";
import {
  BREAKPOINT,
  orderMigrations,
  pendingTags,
  splitStatements,
} from "@/db/migrator";

describe("migration ordering", () => {
  it("sorts by journal index, not by file name", () => {
    const ordered = orderMigrations([
      { idx: 2, tag: "0002_aaa" },
      { idx: 0, tag: "0000_init" },
      { idx: 1, tag: "0001_search" },
    ]);
    expect(ordered.map((m) => m.tag)).toEqual([
      "0000_init",
      "0001_search",
      "0002_aaa",
    ]);
  });

  it("breaks ties on the tag so the order is total", () => {
    const ordered = orderMigrations([
      { idx: 1, tag: "0001_b" },
      { idx: 1, tag: "0001_a" },
    ]);
    expect(ordered.map((m) => m.tag)).toEqual(["0001_a", "0001_b"]);
  });

  it("leaves the input array alone", () => {
    const input = [
      { idx: 1, tag: "b" },
      { idx: 0, tag: "a" },
    ];
    orderMigrations(input);
    expect(input.map((m) => m.tag)).toEqual(["b", "a"]);
  });

  it("pending is everything not yet applied, still in order", () => {
    const files = [
      { idx: 0, tag: "0000_init" },
      { idx: 1, tag: "0001_search" },
      { idx: 2, tag: "0002_next" },
    ];
    expect(pendingTags(files, ["0000_init"])).toEqual([
      "0001_search",
      "0002_next",
    ]);
    expect(pendingTags(files, ["0000_init", "0001_search", "0002_next"])).toEqual(
      [],
    );
    expect(pendingTags([], [])).toEqual([]);
  });

  it("an applied version that is not on disk is simply ignored", () => {
    const files = [{ idx: 0, tag: "0000_init" }];
    expect(pendingTags(files, ["0000_init", "9999_from_the_future"])).toEqual([]);
  });
});

describe("statement splitting", () => {
  it("splits on the drizzle breakpoint and trims", () => {
    const sql = `CREATE TABLE a (id text);\n${BREAKPOINT}\nCREATE TABLE b (id text);`;
    expect(splitStatements(sql)).toEqual([
      "CREATE TABLE a (id text);",
      "CREATE TABLE b (id text);",
    ]);
  });

  it("drops empty and comment-only chunks, which SQLite cannot prepare", () => {
    const sql = [
      "-- a leading comment",
      BREAKPOINT,
      "CREATE TABLE a (id text);",
      BREAKPOINT,
      "   ",
      BREAKPOINT,
      "/* block only */",
    ].join("\n");
    expect(splitStatements(sql)).toEqual(["CREATE TABLE a (id text);"]);
  });

  it("keeps a comment that sits above real SQL", () => {
    const sql = "-- why this exists\nCREATE TABLE a (id text);";
    expect(splitStatements(sql)).toHaveLength(1);
    expect(splitStatements(sql)[0]).toContain("CREATE TABLE a");
  });

  it("handles a file with no breakpoints at all", () => {
    expect(splitStatements("SELECT 1;")).toEqual(["SELECT 1;"]);
    expect(splitStatements("")).toEqual([]);
  });
});
