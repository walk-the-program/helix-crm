import { describe, expect, it } from "vitest";
import {
  VIEW_QUERY_VERSION,
  deserialiseQuery,
  describeQuery,
  emptyQuery,
  queryEquals,
  serialiseQuery,
} from "../../../src/features/today/views/serialise";
import type { ViewQuery } from "../../../src/features/today/views/types";

describe("emptyQuery", () => {
  it("has the current version and nothing in it", () => {
    expect(emptyQuery()).toEqual({
      version: VIEW_QUERY_VERSION,
      filters: [],
      sort: [],
      columns: [],
    });
  });
});

describe("serialiseQuery / deserialiseQuery round trip", () => {
  it("is lossless through JSON.stringify -> JSON.parse -> deserialise", () => {
    const query: ViewQuery = {
      version: VIEW_QUERY_VERSION,
      filters: [
        { field: "stage", op: "eq", value: "won" },
        { field: "value", op: "between", value: { from: "100", to: "500" } },
        { field: "tags", op: "in", value: ["hot", "referral"] },
        { field: "archived", op: "eq", value: false },
        { field: "assignee", op: "isNull", value: null },
      ],
      sort: [{ field: "value", direction: "desc" }],
      columns: ["name", "value", "stage"],
    };

    const normalised = serialiseQuery(query);
    const wire = JSON.parse(JSON.stringify(normalised)) as unknown;
    const roundTripped = deserialiseQuery(wire);

    expect(roundTripped).toEqual(normalised);
  });

  it("produces a stable JSON.stringify output for the same input, called twice", () => {
    const query: Partial<ViewQuery> = {
      filters: [{ field: "stage", op: "eq", value: "won" }],
      sort: [{ field: "stage", direction: "asc" }],
      columns: ["name", "stage"],
    };

    const first = JSON.stringify(serialiseQuery(query));
    const second = JSON.stringify(serialiseQuery(query));
    expect(first).toBe(second);
  });

  it("drops filters with an empty or blank field", () => {
    const result = serialiseQuery({
      filters: [
        { field: "", op: "eq", value: "x" },
        { field: "   ", op: "eq", value: "x" },
        { field: "stage", op: "eq", value: "won" },
      ],
    });
    expect(result.filters).toEqual([{ field: "stage", op: "eq", value: "won" }]);
  });

  it("collapses duplicate sort fields, first wins", () => {
    const result = serialiseQuery({
      sort: [
        { field: "value", direction: "desc" },
        { field: "name", direction: "asc" },
        { field: "value", direction: "asc" },
      ],
    });
    expect(result.sort).toEqual([
      { field: "value", direction: "desc" },
      { field: "name", direction: "asc" },
    ]);
  });

  it("de-duplicates columns, preserving first-seen order", () => {
    const result = serialiseQuery({
      columns: ["name", "stage", "name", "value", "stage"],
    });
    expect(result.columns).toEqual(["name", "stage", "value"]);
  });

  it("coerces missing arrays to empty arrays", () => {
    const result = serialiseQuery({});
    expect(result.filters).toEqual([]);
    expect(result.sort).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  it("always stamps the current version, regardless of what was passed in", () => {
    const result = serialiseQuery({ version: 999 });
    expect(result.version).toBe(VIEW_QUERY_VERSION);
  });
});

describe("deserialiseQuery never throws", () => {
  const junk: unknown[] = [
    null,
    undefined,
    "nonsense",
    42,
    true,
    [],
    {},
    { version: "x" },
    // a v0-shaped blob using an old, unrelated key name
    { filter: { stage: "won" }, orderBy: "name" },
  ];

  it.each(junk)("degrades %o to a valid, empty-ish ViewQuery", (raw) => {
    let result: ViewQuery | undefined;
    expect(() => {
      result = deserialiseQuery(raw);
    }).not.toThrow();
    expect(result).toEqual(emptyQuery());
  });

  it("drops a filter entry that is a string instead of an object", () => {
    const result = deserialiseQuery({
      filters: ["not-a-filter", { field: "stage", op: "eq", value: "won" }],
    });
    expect(result.filters).toEqual([{ field: "stage", op: "eq", value: "won" }]);
  });

  it("drops a sort entry whose direction is not asc/desc", () => {
    const result = deserialiseQuery({
      sort: [
        { field: "value", direction: "sideways" },
        { field: "name", direction: "asc" },
      ],
    });
    expect(result.sort).toEqual([{ field: "name", direction: "asc" }]);
  });

  it("drops columns entries that are not strings", () => {
    const result = deserialiseQuery({
      columns: ["name", 42, "stage", null, true],
    });
    expect(result.columns).toEqual(["name", "stage"]);
  });

  it("drops a filter with an unrecognised op", () => {
    const result = deserialiseQuery({
      filters: [{ field: "stage", op: "wat", value: "won" }],
    });
    expect(result.filters).toEqual([]);
  });

  it("reads what it can from a filter and ignores an unknown version", () => {
    const result = deserialiseQuery({
      version: 0,
      filters: [{ field: "stage", op: "eq", value: "won" }],
    });
    expect(result.version).toBe(VIEW_QUERY_VERSION);
    expect(result.filters).toEqual([{ field: "stage", op: "eq", value: "won" }]);
  });
});

describe("queryEquals", () => {
  it("is true for the same query built with keys in a different order", () => {
    const a: ViewQuery = {
      version: VIEW_QUERY_VERSION,
      filters: [{ field: "stage", op: "eq", value: "won" }],
      sort: [{ field: "value", direction: "desc" }],
      columns: ["name", "value"],
    };
    // Same content, object built with a different key order, and the range
    // filter value's own keys reversed.
    const b: ViewQuery = {
      columns: ["name", "value"],
      sort: [{ direction: "desc", field: "value" }],
      filters: [{ value: "won", op: "eq", field: "stage" }],
      version: VIEW_QUERY_VERSION,
    };
    expect(queryEquals(a, b)).toBe(true);
  });

  it("is true for equivalent range filter values with reversed keys", () => {
    const a = serialiseQuery({
      filters: [{ field: "value", op: "between", value: { from: "1", to: "2" } }],
    });
    const b = serialiseQuery({
      filters: [{ field: "value", op: "between", value: { to: "2", from: "1" } as never }],
    });
    expect(queryEquals(a, b)).toBe(true);
  });

  it("is false when a filter value differs", () => {
    const a = serialiseQuery({ filters: [{ field: "stage", op: "eq", value: "won" }] });
    const b = serialiseQuery({ filters: [{ field: "stage", op: "eq", value: "lost" }] });
    expect(queryEquals(a, b)).toBe(false);
  });

  it("is false when the filter count differs", () => {
    const a = serialiseQuery({ filters: [{ field: "stage", op: "eq", value: "won" }] });
    const b = emptyQuery();
    expect(queryEquals(a, b)).toBe(false);
  });
});

describe("describeQuery", () => {
  it("describes zero filters", () => {
    expect(describeQuery(emptyQuery())).toBe("No filters");
  });

  it("describes one filter with no sort", () => {
    const q = serialiseQuery({ filters: [{ field: "stage", op: "eq", value: "won" }] });
    expect(describeQuery(q)).toBe("1 filter");
  });

  it("describes several filters, sorted", () => {
    const q = serialiseQuery({
      filters: [
        { field: "stage", op: "eq", value: "won" },
        { field: "value", op: "gte", value: 100 },
      ],
      sort: [{ field: "value", direction: "desc" }],
    });
    expect(describeQuery(q)).toBe("2 filters, sorted by value");
  });
});
