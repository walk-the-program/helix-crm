/**
 * The bridge between a list screen's own filter state and a `ViewQuery`.
 *
 * Every list in Helix keeps its filters as a handful of flat values — a search
 * box, two or three `Select`s, a checkbox — plus one sort id like
 * `"name-asc"`. This turns that into the library's wire shape and back, so a
 * screen adopts saved views with two small functions rather than writing its
 * own serialiser. Added in wave 3 when Records and Data adopted the library.
 *
 * Two conventions, both allowed by the library's README ("`field` is whatever
 * column id the owning screen uses internally; it is opaque"):
 *
 * - A filter is `{ field: <state key>, op: "eq", value }`. A value equal to
 *   the screen's default is dropped, so "no filters" round-trips as an empty
 *   list rather than a list of nothing-in-particular.
 * - The sort is `[{ field: <the screen's own sort id>, direction: "asc" }]`.
 *   These screens bake the direction into the id ("name-desc"), so the id is
 *   the whole sort and `direction` carries no information. A screen that
 *   separates the two can use `direction` properly; `sortIdOf` below only
 *   reads `field`.
 *
 * Pure: no React, no database, so it is unit-testable on its own.
 */
import { serialiseQuery } from "@/features/today/views/serialise";
import type { ViewQuery } from "@/features/today/views/types";

/** What a list screen's filter controls hold: scalars, nothing nested. */
export type ScreenFilters = Record<string, string | boolean>;

/**
 * A `ViewQuery` for the screen's current filters and sort, normalised.
 *
 * Values matching `defaults` are left out: two screens showing "everything"
 * produce the same query whether or not the owner has touched a dropdown, so
 * `dirty` on `useSavedViews` means what it says.
 */
export function queryFromState(
  filters: ScreenFilters,
  defaults: ScreenFilters,
  sortId: string | null,
  columns: string[] = [],
): ViewQuery {
  return serialiseQuery({
    filters: Object.entries(filters)
      .filter(([key, value]) => value !== defaults[key])
      // Sorted by field: filters are an unordered set, and a screen that
      // happens to build its state object differently on one render must not
      // look "dirty" against the view it just saved.
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, value]) => ({ field, op: "eq" as const, value })),
    sort: sortId ? [{ field: sortId, direction: "asc" as const }] : [],
    columns,
  });
}

/**
 * The screen's filter state for a picked view: the defaults, with whatever the
 * view names written over them.
 *
 * A field the screen no longer has is ignored, and a value of the wrong type
 * falls back to the default — a saved view is a row that can outlive the
 * screen that wrote it.
 */
export function stateFromQuery<S extends ScreenFilters>(
  query: ViewQuery | null,
  defaults: S,
): S {
  const next: ScreenFilters = { ...defaults };
  for (const filter of query?.filters ?? []) {
    if (!(filter.field in defaults)) continue;
    const expected = typeof defaults[filter.field];
    if (typeof filter.value === expected) {
      next[filter.field] = filter.value as string | boolean;
    }
  }
  return next as S;
}

/** The screen's own sort id out of a view, or the screen's default. */
export function sortIdOf(query: ViewQuery | null, fallback: string): string {
  const first = query?.sort[0]?.field;
  return typeof first === "string" && first.length > 0 ? first : fallback;
}
