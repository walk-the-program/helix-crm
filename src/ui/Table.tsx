import type {
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/ui/cn";
import { focusRing, focusRingInset } from "@/ui/styles";

/**
 * The ledger (docs/DESIGN.md section 9, "Tables").
 *
 * A white surface, a sticky header at --text-sm weight 600, rows separated by
 * a single hairline. No zebra striping and no vertical cell borders: they
 * fight the data. Row height is --row-h, so density is a token change.
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full border-collapse text-[length:var(--text-base)]", className)}
      {...props}
    />
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "sticky top-0 z-[1]",
        "bg-[var(--color-surface)] text-[var(--color-text-muted)]",
        "[&_th]:border-b [&_th]:border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

/**
 * The totals row: at the foot of the table, 2px --color-border-strong top
 * rule, weight 600.
 *
 * Deliberately NOT `position: sticky`. `bottom: 0` means "never fall below the
 * scrollport's bottom edge", so while the table is still below the fold the
 * browser lifts the foot and clamps it to the top of the table — measured at
 * 1280x900 in the gallery, the totals row sat at the table's y-origin and
 * covered the header row completely. A totals row is pinned to the foot by
 * being a <tfoot>; pinning it to a viewport is only correct inside a dedicated
 * scroll container, and a shared primitive cannot know that it is in one.
 */
export function TFoot({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn(
        "bg-[var(--color-surface)] font-semibold",
        "[&_td]:border-t-2 [&_td]:border-[var(--color-border-strong)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A selected row is --color-selected plus a 3px --color-focus left rail. The
 * rail is drawn by the first cell rather than by a shadow on the row: a
 * border-collapse table does not reliably paint a box-shadow on a <tr>.
 */
export function TR({
  className,
  selected,
  onClick,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; onClick?: () => void }) {
  const clickable = Boolean(onClick);

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <tr
      role={clickable ? "row" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? handleKeyDown : undefined}
      aria-selected={selected || undefined}
      className={cn(
        "border-b border-[var(--color-border)]",
        clickable && "cursor-pointer hover:bg-[var(--color-hover)]",
        selected && [
          "bg-[var(--color-selected)]",
          "[&>td:first-child]:relative",
          "[&>td:first-child]:before:absolute [&>td:first-child]:before:content-['']",
          "[&>td:first-child]:before:inset-y-0 [&>td:first-child]:before:left-0",
          "[&>td:first-child]:before:w-[3px] [&>td:first-child]:before:bg-[var(--color-focus)]",
        ],
        clickable && focusRingInset,
        className,
      )}
      {...props}
    />
  );
}

export function TH({
  className,
  align = "left",
  sortable,
  sortDirection,
  onSort,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right";
  sortable?: boolean;
  sortDirection?: "asc" | "desc" | null;
  onSort?: () => void;
}) {
  const sorted = sortDirection === "asc" || sortDirection === "desc";

  const icon = !sortable ? null : sortDirection === "asc" ? (
    <ChevronUp className="w-[16px] h-[16px] flex-none" aria-hidden="true" />
  ) : sortDirection === "desc" ? (
    <ChevronDown className="w-[16px] h-[16px] flex-none" aria-hidden="true" />
  ) : (
    <ChevronsUpDown className="w-[16px] h-[16px] flex-none" aria-hidden="true" />
  );

  const content: ReactNode = sortable ? (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        "inline-flex items-center gap-[var(--space-1)] min-h-[var(--control-h-sm)]",
        "font-semibold hover:text-[var(--color-text)]",
        sorted ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
        focusRing,
        align === "right" && "flex-row-reverse",
      )}
    >
      {children}
      {icon}
    </button>
  ) : (
    children
  );

  return (
    <th
      scope="col"
      aria-sort={
        !sortable
          ? undefined
          : sortDirection === "asc"
            ? "ascending"
            : sortDirection === "desc"
              ? "descending"
              : "none"
      }
      // The column header is sentence case at --text-sm weight 600. There are
      // no all-caps tracked-out labels in this product (docs/DESIGN.md s4).
      data-numeric={align === "right" ? "" : undefined}
      className={cn(
        "h-[var(--row-h)] px-[var(--space-3)] font-semibold",
        "text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    >
      {content}
    </th>
  );
}

/**
 * `primary` is the row's customer name: --text-lg weight 500. `muted` is every
 * subordinate cell. `align="right"` stamps data-numeric, which is what turns
 * on tabular figures in globals.css — a column of amounts that does not line
 * up reads as sloppy bookkeeping to this audience.
 */
export function TD({
  className,
  align = "left",
  primary,
  muted,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right";
  primary?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      data-numeric={align === "right" ? "" : undefined}
      className={cn(
        "h-[var(--row-h)] px-[var(--space-3)]",
        // A name truncates at one line and carries a title attribute; it never
        // wraps inside a fixed-height row (docs/DESIGN.md section 4). max-w-0
        // is what makes truncate work in an auto-layout table: the cell still
        // takes its share of the width, and the ellipsis happens inside it.
        primary
          ? "max-w-0 truncate text-[length:var(--text-lg)] font-medium text-[var(--color-text)]"
          : muted
            ? "text-[var(--color-text-muted)]"
            : "text-[var(--color-text)]",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
