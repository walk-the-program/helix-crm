/**
 * The bridge a list screen uses to adopt saved views: flat filter state in,
 * a ViewQuery out, and back again. Pure, so no database and no React here.
 */
import { describe, expect, it } from "vitest";
import {
  queryFromState,
  sortIdOf,
  stateFromQuery,
} from "@/features/today/views/screenState";
import { VIEW_QUERY_VERSION } from "@/features/today/views/types";

const ALL = "__all__";
const DEFAULTS = { search: "", tagId: ALL, sourceId: ALL, showArchived: false };

describe("queryFromState", () => {
  it("drops every filter that is still at the screen's default", () => {
    const query = queryFromState({ ...DEFAULTS }, DEFAULTS, "name-asc");
    expect(query.filters).toEqual([]);
    expect(query.version).toBe(VIEW_QUERY_VERSION);
  });

  it("keeps only what the owner actually changed", () => {
    const query = queryFromState(
      { ...DEFAULTS, search: "hendrickson", showArchived: true },
      DEFAULTS,
      "updated",
    );
    expect(query.filters).toEqual([
      { field: "search", op: "eq", value: "hendrickson" },
      { field: "showArchived", op: "eq", value: true },
    ]);
    expect(query.sort).toEqual([{ field: "updated", direction: "asc" }]);
  });

  it("is stable whatever order the state object was built in", () => {
    const a = queryFromState({ search: "x", tagId: "t1", sourceId: ALL, showArchived: false }, DEFAULTS, "name-asc");
    const b = queryFromState({ tagId: "t1", showArchived: false, search: "x", sourceId: ALL }, DEFAULTS, "name-asc");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("stateFromQuery", () => {
  it("round-trips the filters a screen serialised", () => {
    const state = { ...DEFAULTS, search: "hendrickson", tagId: "t1" };
    const back = stateFromQuery(queryFromState(state, DEFAULTS, "name-asc"), DEFAULTS);
    expect(back).toEqual(state);
  });

  it("falls back to the defaults for a null query", () => {
    expect(stateFromQuery(null, DEFAULTS)).toEqual(DEFAULTS);
  });

  it("ignores a field the screen no longer has", () => {
    const query = queryFromState({ search: "x", gone: "yes" }, { search: "", gone: "" }, null);
    expect(stateFromQuery(query, DEFAULTS)).toEqual({ ...DEFAULTS, search: "x" });
  });

  it("ignores a value of the wrong type, because a saved row outlives a screen", () => {
    const query = {
      version: VIEW_QUERY_VERSION,
      filters: [{ field: "showArchived", op: "eq" as const, value: "yes" }],
      sort: [],
      columns: [],
    };
    expect(stateFromQuery(query, DEFAULTS).showArchived).toBe(false);
  });
});

describe("sortIdOf", () => {
  it("reads the screen's own sort id back", () => {
    expect(sortIdOf(queryFromState(DEFAULTS, DEFAULTS, "name-desc"), "name-asc")).toBe("name-desc");
  });

  it("falls back when the view saved no sort", () => {
    expect(sortIdOf(queryFromState(DEFAULTS, DEFAULTS, null), "name-asc")).toBe("name-asc");
    expect(sortIdOf(null, "name-asc")).toBe("name-asc");
  });
});
