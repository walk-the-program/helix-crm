import { useRef } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/ui/cn";

export function VirtualList<T>(props: {
  items: T[];
  estimateSize?: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
  getKey?: (item: T, index: number) => string | number;
  ariaLabel?: string;
}) {
  const { items, estimateSize = 48, overscan = 8, renderRow, className, getKey, ariaLabel } = props;
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
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
      <div
        style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
      >
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
