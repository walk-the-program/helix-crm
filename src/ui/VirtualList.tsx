import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
 * The height available below `el`, measured from something that is not sized
 * by `el` itself.
 *
 * Walks up for the first scrollable ancestor — `<main>` in this app — and
 * takes the distance from the list's top edge to that ancestor's content
 * bottom. Anything content-sized in between is skipped precisely because its
 * height is the thing we are trying to decide. The viewport is the backstop,
 * so the answer is never zero and never absent.
 */
function useAvailableHeight(
  ref: { current: HTMLElement | null },
  enabled: boolean,
  floor: number,
): number | null {
  const [available, setAvailable] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setAvailable(null);
      return;
    }
    const el = ref.current;
    if (!el || typeof window === "undefined") return;

    /**
     * The nearest ancestor that SCROLLS.
     *
     * `overflow: hidden` is deliberately not accepted, and the first version
     * of this walk accepting it is what made the Contacts list unreachable:
     * the bordered panel around the list is `overflow-hidden` and is sized by
     * its content, so "the space available" resolved to the list's own current
     * height. The list then froze at roughly one viewport of rows, reported no
     * overflow, and six of sixteen contacts could not be reached at all. A
     * height may only ever be measured from something whose own height does
     * not depend on the rows — in this app that is `<main>`, and the viewport
     * behind it.
     */
    function scrollingAncestor(node: HTMLElement): HTMLElement | null {
      for (let cursor = node.parentElement; cursor; cursor = cursor.parentElement) {
        const overflowY = getComputedStyle(cursor).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          if (cursor.getBoundingClientRect().height > 0) return cursor;
        }
      }
      return null;
    }

    const bound = scrollingAncestor(el);

    const measure = () => {
      const top = el.getBoundingClientRect().top;
      let bottom = window.innerHeight;
      if (bound) {
        const rect = bound.getBoundingClientRect();
        const padding = Number.parseFloat(getComputedStyle(bound).paddingBottom) || 0;
        bottom = rect.bottom - padding;
      }
      // Never taller than the screen, whatever the ancestor says.
      bottom = Math.min(bottom, window.innerHeight);
      const next = Math.max(Math.round(bottom - top), floor);
      // Identical values bail out of the render, so observing a container
      // whose own height moves with the list cannot become a loop.
      setAvailable((current) => (current === next ? current : next));
    };

    measure();
    // Again once the first layout has settled: on the very first paint the
    // toolbar above the list may not have its final height yet, which moves
    // the list's top edge and therefore the space below it.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      // Only things that are NOT sized by the list: the scrolling ancestor and
      // the document itself.
      if (bound) observer.observe(bound);
      observer.observe(document.documentElement);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [ref, enabled, floor]);

  return available;
}

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
 * the rows are shorter and the slab is taller.
 *
 * WHY THIS MEASURES INSTEAD OF ASKING THE PARENT
 * ----------------------------------------------
 * The obvious fix — stop growing, take the virtualiser's total size as the
 * height, let the flex parent shrink you — is circular, and the first version
 * of this prop shipped that bug. The list's height came from its content; the
 * panel's height came from the list; and the panel's available space came from
 * a parent that was now sized by its content. So on the first paint, before
 * the query resolves, `items` is empty, the total size is zero, the panel
 * collapses, the virtualiser measures a zero-height viewport and returns no
 * visible rows — and when the data arrives there is still no viewport to
 * render into. An empty list, permanently. `listNav.e2e.ts` caught it on
 * Contacts.
 *
 * So `fit` owns the whole arrangement and never asks the parent for a height
 * it might not have. It measures the space between the top of the list and the
 * bottom of the nearest ancestor that genuinely bounds it — the first
 * ancestor that SCROLLS (`overflow-y: auto` or `scroll`, never `hidden`),
 * less its own bottom padding, clamped to the viewport, and the viewport
 * itself if there is no such ancestor — and then:
 *
 *   height     min(content, available), or the whole of `available` while
 *              there is no content yet, so the viewport is never zero and
 *              every row past the cap is reachable by scrolling;
 *   max-height available, so a long list scrolls instead of running off;
 *   flex       0 0 auto, so a parent that has collapsed for any other reason
 *              cannot squash the list to nothing.
 *
 * Nothing in that chain reads a height that depends on the rows, which is what
 * makes it safe on the first paint and on every resize after it.
 *
 * The one thing the call site still does is not fight it: the bordered surface
 * around the list must not be `flex-1`, or it keeps stretching and paints the
 * same slab under a list that is now the right height. Dropping `flex-1` is
 * safe now — the list carries its own height and can no longer collapse.
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
  const available = useAvailableHeight(parentRef, Boolean(fit), rowHeight);
  // No content yet (the query has not resolved) means the whole of the space
  // available, so the virtualiser always has a viewport to render into.
  const fitHeight =
    totalSize > 0
      ? available === null
        ? totalSize
        : Math.min(totalSize, available)
      : (available ?? undefined);

  return (
    <div
      ref={parentRef}
      role="list"
      aria-label={ariaLabel}
      data-fit={fit ? "" : undefined}
      // Inline, so it wins over whatever `flex-1` a caller still has in
      // `className` and the two cannot silently disagree.
      style={
        fit
          ? {
              // `0 0 auto`: a parent that has collapsed for some other reason
              // must not be able to squash this to nothing.
              flex: "0 0 auto",
              height: fitHeight,
              maxHeight: available ?? undefined,
            }
          : undefined
      }
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
