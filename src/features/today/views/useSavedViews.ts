/**
 * Saved views, wired to the repository and to the URL.
 *
 * "Which view is active" is deliberately not component state: it lives in the
 * `?view=<id>` search param of the screen's own route (see `viewRoute`
 * below), read through wouter's `useSearchParams`. That is what lets a
 * `ViewPicker` and a `SaveViewPopover` sitting side by side on the same
 * screen agree on the active view without either one owning the other or a
 * parent threading `activeId` down as a prop — they both call `useSavedViews`
 * and both read the same URL. It also means the active view survives a
 * reload and is shareable as a link, which is the whole point of
 * `viewRoute` existing.
 *
 * Every exported mutator here makes exactly one call into
 * `@/db/repos/savedViews`. The write lock is not reentrant (see
 * docs/STATUS.md, the foundations TypeScript entry, "Contract changes
 * needed" item 2: "the write lock is not reentrant. A repository write must
 * never call another"), so this file never composes two repo writes into
 * one of its own — `saveAs` calls `create` and stops, `remove` calls
 * `softDelete` and stops, and so on.
 */
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "wouter";
import { qk } from "@/app/queryClient";
import * as savedViewsRepo from "@/db/repos/savedViews";
import type { SavedView } from "@/db/repos/savedViews";
import { deserialiseQuery, queryEquals, serialiseQuery } from "@/features/today/views/serialise";
import type { ViewEntityType, ViewQuery } from "@/features/today/views/types";

/**
 * Where each entity type's saved views live. Activities have no screen of
 * their own yet, so a saved activity filter opens on Contacts, where the
 * timeline lives.
 */
export const ENTITY_ROUTES: Record<ViewEntityType, string> = {
  contact: "/contacts",
  company: "/companies",
  deal: "/pipeline",
  task: "/tasks",
  activity: "/contacts",
};

function isViewEntityType(value: string): value is ViewEntityType {
  return value in ENTITY_ROUTES;
}

/** A deep link that opens the view's screen with it already picked. */
export function viewRoute(view: SavedView): string {
  const base = isViewEntityType(view.entityType) ? ENTITY_ROUTES[view.entityType] : ENTITY_ROUTES.contact;
  return `${base}?view=${view.id}`;
}

export type UseSavedViews = {
  views: SavedView[];
  isLoading: boolean;
  activeId: string | null;
  active: SavedView | null;
  activeQuery: ViewQuery | null;
  dirty: boolean;
  select: (id: string | null) => void;
  saveAs: (name: string, options?: { pinned?: boolean }) => Promise<SavedView>;
  saveOver: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export function useSavedViews(entityType: ViewEntityType, current: ViewQuery): UseSavedViews {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get("view");

  const { data: views = [], isLoading } = useQuery({
    queryKey: qk.savedViews(entityType),
    queryFn: () => savedViewsRepo.list(entityType),
  });

  const active = useMemo(() => views.find((v) => v.id === activeId) ?? null, [views, activeId]);

  const activeQuery = useMemo(
    () => (active ? deserialiseQuery(savedViewsRepo.parseQuery(active)) : null),
    [active],
  );

  const dirty = useMemo(
    () => (activeQuery ? !queryEquals(current, activeQuery) : false),
    [current, activeQuery],
  );

  // Pin state is visible both on this entity type's list and on the
  // cross-entity pinned list the sidebar reads (`usePinnedViews`, keyed on
  // `qk.savedViews()` with no entity type), so every mutation below refreshes
  // both.
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.savedViews(entityType) });
    void queryClient.invalidateQueries({ queryKey: qk.savedViews() });
  }, [queryClient, entityType]);

  const select = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) {
            next.set("view", id);
          } else {
            next.delete("view");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const saveAs = useCallback(
    async (name: string, options?: { pinned?: boolean }): Promise<SavedView> => {
      const created = await savedViewsRepo.create({
        entityType,
        name,
        query: serialiseQuery(current),
        pinned: options?.pinned ?? false,
      });
      invalidate();
      select(created.id);
      return created;
    },
    [entityType, current, invalidate, select],
  );

  const saveOver = useCallback(
    async (id: string): Promise<void> => {
      await savedViewsRepo.update(id, { query: serialiseQuery(current) });
      invalidate();
    },
    [current, invalidate],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<void> => {
      await savedViewsRepo.update(id, { name });
      invalidate();
    },
    [invalidate],
  );

  const setPinned = useCallback(
    async (id: string, pinned: boolean): Promise<void> => {
      await savedViewsRepo.setPinned(id, pinned);
      invalidate();
    },
    [invalidate],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await savedViewsRepo.softDelete(id);
      if (activeId === id) select(null);
      invalidate();
    },
    [activeId, select, invalidate],
  );

  return { views, isLoading, activeId, active, activeQuery, dirty, select, saveAs, saveOver, rename, setPinned, remove };
}

/** Every pinned view, across all entity types — what the sidebar renders. */
export function usePinnedViews(): { views: SavedView[]; isLoading: boolean } {
  const { data: views = [], isLoading } = useQuery({
    queryKey: qk.savedViews(),
    queryFn: () => savedViewsRepo.listPinned(),
  });
  return { views, isLoading };
}
