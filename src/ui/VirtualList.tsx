import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/ui/cn";

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

/**
 * 10 000 rows are virtualised (docs/DESIGN.md section 9). Only the rows in
 * view, plus the overscan, are ever in the DOM.
 */
export function VirtualList<T>(props: {
  items: T[];
  estimateSize?: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
  getKey?: (item: T, index: number) => string | number;
  ariaLabel?: string;
}) {
  const { items, estimateSize, overscan = 8, renderRow, className, getKey, ariaLabel } = props;
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

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      role="list"
      aria-label={ariaLabel}
      className={cn("relative w-full overflow-auto", className)}
    >
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
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
              {renderRow(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
