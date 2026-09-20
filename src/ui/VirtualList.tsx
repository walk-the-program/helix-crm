import { useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/ui/cn";
import { useRovingRowNav, type RowNavProps } from "@/ui/useRovingRowNav";

/**
 * Reads the current --row-h rather than assuming 48px, so the initial estimate
 * is right in compact too. Components must never hard-code a row height
 * (docs/DESIGN.md section 7); rows are measured after first paint anyway, but
 * a wrong estimate shows as a scrollbar that jumps on the first scroll.
 */
function rowHeightToken(fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--row-h");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Enables roving-tabindex arrow-key navigation over a `VirtualList`'s rows
 *  (apple-hig-review.md finding 6 / top-ten item 9). See useRovingRowNav.ts
 *  for the shared mechanics; this is just the plumbing that hands it a
 *  virtualizer to scroll with. */
export type VirtualListKeyboardNav<T> = {
  /** False for a row that cannot take the roving stop - a group header
   *  flattened into `items`, for instance. Every row is focusable when this
   *  is omitted. */
  isFocusable?: (item: T, index: number) => boolean;
  /** Enter (and Space) on the focused row. */
  onActivate?: (item: T, index: number) => void;
  /** Defaults to Enter and Space; pass `["Enter"]` when Space needs to reach
   *  a control nested in the row instead. */
  activateKeys?: string[];
};

/**
 * 10 000 rows are virtualised (docs/DESIGN.md section 9). Only the rows in
 * view, plus the overscan, are ever in the DOM.
 *
 * `fit` is the phase-two answer to the empty white slab under a short list.
 *
 * A virtualised list needs a scroll element with a real, measurable height, so
 * every caller made it `flex-1` inside a bordered panel. That is right when
 * there are four hundred contacts and wrong when there are four: the scroller
 * fills the panel, the sizer inside it is only four rows tall, and the rest is
 * a slab of surface white with a border around it — worst in compact, where
 * the rows are shorter and the slab is taller. Dropping `flex-1` is not the
 * fix either: the parent goes content-height, the scroll element measures
 * zero, and the list renders nothing at all.
 *
 * With `fit`, the scroller takes the virtualiser's own total size as an
 * explicit height and becomes `flex: 0 1 auto`. Short list: the height is the
 * content and the panel ends at the last row. Long list: the flex parent
 * shrinks it to the space available and it scrolls exactly as before. Either
 * way the height is definite and non-zero on the very first paint, which is
 * the property the virtualiser actually needs.
 *
 * The panel around it has to stop stretching too — a `flex-1` surface still
 * paints white under a `fit` list. Give it `min-h-0 max-h-full` in place of
 * `min-h-0 flex-1` and it caps at the column instead of filling it.
 *
 * Default is off, so every existing caller behaves exactly as it did.
 */
export function VirtualList<T>(props: {
  items: T[];
  estimateSize?: number;
  overscan?: number;
  renderRow: (item: T, index: number, nav?: RowNavProps) => ReactNode;
  className?: string;
  getKey?: (item: T, index: number) => string | number;
  "aria-label"?: string;
  /** @deprecated Use `aria-label`. */
  ariaLabel?: string;
  /** When set, Up/Down/Home/End move a roving tabIndex between rows and the
   *  row that holds it is scrolled to by index rather than by
   *  `scrollIntoView` - the target row may not be mounted yet. `renderRow`
   *  gets the row's nav props as a third argument to spread onto whichever
   *  element in the row should hold keyboard focus. */
  keyboardNav?: VirtualListKeyboardNav<T>;
  /** Shrink to the rows' own height, capped by the space the flex parent has. */
  fit?: boolean;
}) {
  const { items, estimateSize, overscan = 8, renderRow, className, getKey, keyboardNav, fit } =
    props;
  const ariaLabel = props["aria-label"] ?? props.ariaLabel;
  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowHeight = useMemo(
    () => estimateSize ?? rowHeightToken(48),
    [estimateSize],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
    getItemKey: getKey ? (index) => getKey(items[index] as T, index) : undefined,
  });

  // The row at `index` may not exist in the DOM yet - it can be scrolled
  // past the overscan window - so scrollToIndex has to land first and the
  // focus() attempt is retried across a few frames until the row mounts.
  const scrollAndFocus = useCallback(
    (index: number) => {
      virtualizer.scrollToIndex(index, { align: "auto" });
      const tryFocus = (attempt: number) => {
        const node = parentRef.current?.querySelector<HTMLElement>(
          `[data-index="${index}"] [data-row-focus]`,
        );
        if (node) {
          node.focus();
          return;
        }
        if (attempt < 5) requestAnimationFrame(() => tryFocus(attempt + 1));
      };
      requestAnimationFrame(() => tryFocus(0));
    },
    [virtualizer],
  );

  const nav = useRovingRowNav({
    count: items.length,
    isFocusable: keyboardNav?.isFocusable
      ? (index) => keyboardNav.isFocusable!(items[index] as T, index)
      : undefined,
    onActivate: keyboardNav?.onActivate
      ? (index) => keyboardNav.onActivate!(items[index] as T, index)
      : undefined,
    activateKeys: keyboardNav?.activateKeys,
    scrollAndFocus,
    resetSignal: items,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      role="list"
      aria-label={ariaLabel}
      data-fit={fit ? "" : undefined}
      // Inline, so it wins over whatever `flex-1` a caller still has in
      // `className` and the two cannot silently disagree.
      style={fit ? { flex: "0 1 auto", height: totalSize } : undefined}
      className={cn("relative w-full overflow-auto", className)}
    >
      <div style={{ height: totalSize, width: "100%", position: "relative" }}>
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return null;
          return (
            <div
              key={virtualRow.key}
              role="listitem"
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderRow(
                item,
                virtualRow.index,
                keyboardNav ? nav.getRowProps(virtualRow.index) : undefined,
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
