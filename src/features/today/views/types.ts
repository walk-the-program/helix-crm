/**
 * The saved-view wire format.
 *
 * A `ViewQuery` is what a list screen (Contacts, Pipeline, Tasks, Deals, ...)
 * hands to `saved_views.query_json` and gets back later. It only describes
 * *what to look at* — a shopping list of filters, a sort order, and a set of
 * visible columns. It never describes *how to run it*: turning a `ViewFilter`
 * into a SQL clause is the owning screen's job, because only that screen knows
 * its own columns and repository filter shape. Keeping this file dependency
 * free (no `@/db`, no React) is what lets `serialise.ts` be pure and
 * unit-tested without a database.
 */

export const VIEW_QUERY_VERSION = 1;

export type SortDirection = "asc" | "desc";

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | { from?: string | null; to?: string | null };

export type ViewFilterOp =
  | "eq"
  | "neq"
  | "in"
  | "contains"
  | "between"
  | "gte"
  | "lte"
  | "isNull"
  | "notNull";

export type ViewFilter = {
  field: string;
  op: ViewFilterOp;
  value: FilterValue;
};

export type ViewSort = {
  field: string;
  direction: SortDirection;
};

export type ViewQuery = {
  version: number;
  filters: ViewFilter[];
  sort: ViewSort[];
  columns: string[];
};

/**
 * The entity types a saved view can belong to. `activity` exists because the
 * timeline can be filtered and saved too, even though it has no screen of its
 * own yet — it lands on the Contacts screen's activity tab (see
 * `ENTITY_ROUTES` in `useSavedViews.ts`).
 */
export type ViewEntityType = "contact" | "company" | "deal" | "task" | "activity";
