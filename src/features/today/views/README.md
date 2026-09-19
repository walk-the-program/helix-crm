# Saved views

A small, self-contained library any list screen (Contacts, Companies, Pipeline,
Tasks) can adopt to get named, ordered, optionally-pinned filter/sort/column
recipes, stored in `saved_views.query_json` through the existing
`src/db/repos/savedViews.ts` repository. This document is what the Records and
Data agents read to wire a screen up to it.

## The `ViewQuery` shape

```ts
type ViewQuery = {
  version: number;      // always VIEW_QUERY_VERSION on anything this library hands back
  filters: ViewFilter[];
  sort: ViewSort[];
  columns: string[];
};

type ViewFilter = { field: string; op: ViewFilterOp; value: FilterValue };
type ViewFilterOp = "eq" | "neq" | "in" | "contains" | "between" | "gte" | "lte" | "isNull" | "notNull";
type FilterValue = string | number | boolean | null | string[] | { from?: string | null; to?: string | null };

type ViewSort = { field: string; direction: "asc" | "desc" };
```

- **`version`** — a format tag for this library's own wire shape, not for the
  screen's data. It exists so a future change to how filters/sort/columns are
  encoded has somewhere to branch. Do not use it to version the screen's own
  filter vocabulary.
- **`filters`** — an unordered list of conditions. `field` is whatever column
  id the owning screen uses internally (see "column ids" below); it is opaque
  to this library. `op` picks the comparison; `value`'s shape depends on `op`
  by convention, not by validation — `in`/`contains` typically carry a
  `string[]`, `between` carries `{ from, to }`, `isNull`/`notNull` typically
  carry `null` and ignore whatever is there, and everything else carries a
  scalar. This library does not enforce which `value` shape goes with which
  `op`; the screen that turns a `ViewFilter` into a real query is responsible
  for reading it sensibly.
- **`sort`** — ordered, first-to-last. Most screens will only ever use the
  first entry; the type allows more for screens with a stable secondary sort.
- **`columns`** — an ordered list of visible column ids, in the screen's own
  vocabulary. Empty means "the screen's default set."

## Wiring up a list screen

```tsx
import { useState } from "react";
import {
  emptyQuery,
  SaveViewPopover,
  serialiseQuery,
  ViewPicker,
  type SavedView,
  type ViewQuery,
} from "@/features/today/views";
import { Popover, PopoverContent, PopoverTrigger, Button } from "@/ui";

function ContactsToolbar() {
  const [current, setCurrent] = useState<ViewQuery>(emptyQuery());

  function applyPicked(query: ViewQuery, _view: SavedView | null) {
    // Translate ViewQuery into this screen's own repo filter shape here.
    setCurrent(query);
  }

  return (
    <div className="flex gap-[var(--space-2)]">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary">Views</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[280px]">
          <ViewPicker entityType="contact" current={current} onPick={applyPicked} />
        </PopoverContent>
      </Popover>

      <SaveViewPopover
        entityType="contact"
        current={current}
        onSaved={() => {
          /* optional: toast, etc. */
        }}
      />
    </div>
  );
}
```

The screen owns `current: ViewQuery` and is the only thing that turns it into
an actual repository call (e.g. building a `ContactFilter` for
`contactsRepo.list`). `useSavedViews(entityType, current)` — used internally
by both `ViewPicker` and `SaveViewPopover` — tracks which view is active via
the URL's `?view=` param (see "Deep links" below), so the two components stay
in sync without the screen threading state between them. A screen that wants
the active view's id or its "unsaved changes" flag directly can call
`useSavedViews` itself too; calling it more than once for the same
`entityType`/`current` pair is cheap — it is backed by the same TanStack Query
cache entry.

`serialiseQuery` is exported for screens that build a `ViewQuery` by hand
(e.g. from URL params or a filter builder's own state) and want it normalised
— version stamped, blank-field filters dropped, duplicate sort fields and
columns collapsed — before comparing or saving it.

## Version and migration

`deserialiseQuery(raw: unknown)` never throws. It is meant to sit directly on
top of `savedViewsRepo.parseQuery(view)` (which itself never throws on bad
JSON): whatever `filters`/`sort`/`columns` arrays it finds, it keeps the
entries that parse as valid and silently drops the rest — an unrecognised
`op`, a non-`asc`/`desc` `direction`, a non-string column, a filter that
isn't even an object. It does not attempt to migrate old shapes into new
ones; there is only one wire shape so far. If a future version changes the
shape, `deserialiseQuery` is the one place that grows a branch on the
incoming `version` — every caller of this library keeps working unchanged
because they only ever see the current `ViewQuery` shape, never the raw
stored JSON.

## Entity type to route

```ts
export const ENTITY_ROUTES: Record<ViewEntityType, string> = {
  contact: "/contacts",
  company: "/companies",
  deal: "/pipeline",
  task: "/tasks",
  activity: "/contacts", // no screen of its own yet; the timeline lives on Contacts
};
```

`viewRoute(view)` turns a `SavedView` into `"<route>?view=<id>"` — a link that
opens the right screen with that view already picked. Any screen using
`useSavedViews` reads the active view from that same `?view=` param via
wouter's `useSearchParams`, so a `ViewPicker`/`SaveViewPopover` pair on one
screen agree on "the active view" for free, and a pinned-view link from the
sidebar (`usePinnedViews` + `viewRoute`) lands on an already-picked view.

## What this does not do

- **It does not execute the query.** A `ViewQuery` is a description, not a
  runnable filter. The owning screen translates it into whatever shape its
  own repository's `list(filter)` expects.
- **It does not store per-user state.** A saved view is a workspace-wide row
  like any other record; there is no separate "my views" concept here.
- **Column ids are the screen's own vocabulary.** This library treats every
  `field` and `columns` entry as an opaque string. It does not know or care
  what columns Contacts has versus Pipeline.
