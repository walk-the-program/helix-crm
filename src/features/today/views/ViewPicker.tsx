/**
 * A compact list of this entity type's saved views, with "All records"
 * always first. Every row is a real <button> — Tab and Enter work with no
 * extra keyboard wiring — and the pin toggle is its own button inside the
 * row, so pinning a view never also picks it.
 *
 * This component only reads and reports; it never decides what a screen's
 * "current" filters look like. Picking a row calls `onPick` with the
 * deserialised query so the caller can apply it to its own list state, and
 * separately moves the shared `?view=` URL param through `useSavedViews`'s
 * `select` so a `SaveViewPopover` on the same screen sees the same active
 * view.
 */
import { PushPin, PushPinSlash } from "@/ui/icons";
import { CardGroupLabel, cn, EmptyState, IconButton, Spinner } from "@/ui";
import type { SavedView } from "@/db/repos/savedViews";
import * as savedViewsRepo from "@/db/repos/savedViews";
import { deserialiseQuery, describeQuery, emptyQuery } from "@/features/today/views/serialise";
import { useSavedViews } from "@/features/today/views/useSavedViews";
import type { ViewEntityType, ViewQuery } from "@/features/today/views/types";

export type ViewPickerProps = {
  entityType: ViewEntityType;
  current: ViewQuery;
  onPick: (query: ViewQuery, view: SavedView | null) => void;
};

const rowClass = cn(
  "flex min-h-[var(--row-h)] flex-1 flex-col items-start justify-center",
  "px-[var(--space-3)] py-[var(--space-1)] text-left",
  "hover:bg-[var(--color-hover)]",
  "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-1",
);

export function ViewPicker(props: ViewPickerProps) {
  const { entityType, current, onPick } = props;
  const { views, isLoading, activeId, select, setPinned } = useSavedViews(entityType, current);

  function pick(query: ViewQuery, view: SavedView | null) {
    select(view ? view.id : null);
    onPick(query, view);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-[var(--space-6)]">
        <Spinner label="Loading saved views" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <CardGroupLabel>Views</CardGroupLabel>

      <button
        type="button"
        aria-current={activeId === null ? "true" : undefined}
        onClick={() => pick(emptyQuery(), null)}
        className={cn(
          rowClass,
          "w-full border-b border-[var(--color-border)]",
          activeId === null && "bg-[var(--color-selected)]",
        )}
      >
        <span
          className={cn(
            "text-[length:var(--text-sm)] text-[var(--color-text)]",
            activeId === null ? "font-semibold" : "font-medium",
          )}
        >
          All records
        </span>
        <span className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
          No filters
        </span>
      </button>

      {views.length === 0 ? (
        <EmptyState
          title="No saved views yet"
          description="Filter this list the way you want it, then choose Save view to put it here."
        />
      ) : (
        views.map((view, index) => {
          const query = deserialiseQuery(savedViewsRepo.parseQuery(view));
          const isActive = view.id === activeId;
          return (
            <div
              key={view.id}
              className={cn(
                "flex items-center gap-[var(--space-1)]",
                isActive && "bg-[var(--color-selected)]",
                index < views.length - 1 && "border-b border-[var(--color-border)]",
              )}
            >
              <button
                type="button"
                aria-current={isActive ? "true" : undefined}
                onClick={() => pick(query, view)}
                className={rowClass}
              >
                <span
                  className={cn(
                    "text-[length:var(--text-sm)] text-[var(--color-text)]",
                    isActive ? "font-semibold" : "font-medium",
                  )}
                >
                  {view.name}
                </span>
                <span className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
                  {describeQuery(query)}
                </span>
              </button>
              <IconButton
                label={view.pinned ? `Unpin ${view.name}` : `Pin ${view.name} to the sidebar`}
                variant="ghost"
                size="sm"
                className="mr-[var(--space-2)]"
                icon={
                  view.pinned ? (
                    <PushPinSlash size={16} weight="bold" aria-hidden="true" />
                  ) : (
                    <PushPin size={16} weight="bold" aria-hidden="true" />
                  )
                }
                onClick={(event) => {
                  event.stopPropagation();
                  void setPinned(view.id, !view.pinned);
                }}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
