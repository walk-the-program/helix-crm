import type { ReactElement, ReactNode } from "react";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";

/**
 * The bar a list grows a hairline footer for once a run of rows is ticked.
 *
 * It renders nothing at zero (docs/DESIGN.md's empty-state rule extends here:
 * no bar is the honest state for no selection). It is a sticky footer INSIDE
 * the list's own bordered surface, not an overlay: an overlay that floats
 * above the rows would cover the last one or two, which is exactly the "does
 * not cover the last row" rule this component exists to keep. A screen gets
 * that placement for free by rendering `<BulkBar>` as the last child of the
 * same flex column the list scrolls inside.
 *
 * Design rules, all literal (DESIGN.md §6/§9): zero radius, one
 * `--color-border` hairline (top, since this sits below the rows), a flat
 * `--color-surface` fill, and NO shadow — a floating layer gets a second
 * hairline, never a blur, and this is not a floating layer at all. It never
 * carries a `primary` button: the screen has already spent its one primary
 * block on "New contact" / "New job", so every action passed as `children`
 * must be `secondary` or `ghost`.
 */
export function BulkBar(props: {
  count: number;
  /** "contact"/"contacts", or the workspace's word for a deal. */
  noun: { one: string; many: string };
  onClear: () => void;
  children: ReactNode;
  className?: string;
}): ReactElement | null {
  const { count: selectedCount, noun, onClear, children, className } = props;
  if (selectedCount <= 0) return null;

  const word = selectedCount === 1 ? noun.one : noun.many;

  return (
    <div
      data-testid="bulk-bar"
      role="toolbar"
      aria-label="Bulk actions"
      className={cn(
        "sticky bottom-0 left-0 z-[1] flex w-full flex-none flex-wrap items-center",
        "gap-[var(--space-3)] border-t border-[var(--color-border)] bg-[var(--color-surface)]",
        "px-[var(--space-4)] py-[var(--space-2)]",
        className,
      )}
    >
      <span
        data-testid="bulk-bar-count"
        className="text-[length:var(--text-sm)] font-medium text-[var(--color-text)]"
      >
        {selectedCount.toLocaleString()} {word} selected
      </span>

      <div className="flex flex-1 flex-wrap items-center gap-[var(--space-2)]">{children}</div>

      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
