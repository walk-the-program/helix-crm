/**
 * Pinned saved views, on Today.
 *
 * DESIGN.md wants these in the sidebar, under Pipeline, in a "Views" group.
 * They are not there, and the reason is structural rather than a shortcut:
 * `FeatureModule.nav` is a plain array that `allNavItems()` flattens once,
 * inside a `useMemo(..., [])` in Shell.tsx, when the shell mounts. A feature
 * cannot contribute a nav item that only exists after a database read, and
 * `src/app` belongs to the foundations agent.
 *
 * So pinned views surface here — the first thing on the first screen, which is
 * where the owner looks anyway — and the sidebar group is written up in
 * docs/STATUS.md as the right long-term home, with order 15 reserved for it.
 * When the shell grows either a `nav?: () => FeatureNavItem[]` or a subscribed
 * "Views" section, this strip goes away and nothing else changes.
 *
 * It renders nothing at all when no view is pinned, because an empty row of
 * chrome above Due now would push the only thing that matters down the page.
 */

import { Link } from "wouter";
import { Bookmark } from "lucide-react";
import { usePinnedViews, viewRoute } from "@/features/today/views/useSavedViews";

export function PinnedViewsStrip() {
  const { views } = usePinnedViews();
  if (views.length === 0) return null;

  return (
    <nav
      aria-label="Pinned views"
      data-today-section="pinned-views"
      className="mb-[var(--space-5)] flex flex-wrap items-center gap-[var(--space-2)]"
    >
      <span className="mr-[var(--space-1)] inline-flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
        <Bookmark size={14} aria-hidden />
        Views
      </span>
      {views.map((view) => (
        <Link
          key={view.id}
          href={viewRoute(view)}
          className="inline-flex min-h-[44px] items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-text)] hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          title={view.name}
        >
          <span className="max-w-[220px] truncate">{view.name}</span>
        </Link>
      ))}
    </nav>
  );
}
