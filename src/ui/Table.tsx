import type {
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { CaretDown, CaretUp, CaretUpDown } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { focusRing, focusRingInset, sectionLabel } from "@/ui/styles";

/**
 * The list (docs/DESIGN.md §9 "Tables").
 *
 * A white surface, rows separated by a single hairline, no zebra striping, no
 * vertical rules, no shadow. The header is the product's section-label style:
 * 11px uppercase tracked in tertiary ink, which is how a native list view
 * labels its columns. Row height is --row-h, so density is a token change.
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
        "bg-[var(--color-surface)]",
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
 * The totals row: at the foot of the table, a single hairline above it, weight
 * 600. A 2px rule was the old ledger look; a native list separates its summary
 * row with the same hairline as everything else and lets the weight do the
 * work.
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
        "[&_td]:border-t [&_td]:border-[var(--color-border-strong)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A selected row is the --color-selected tint and full-strength ink, the way a
 * macOS list marks its selection. There is no left rail: a 3px bar on the
 * first cell is a web-app device, and the tint plus the ink is enough.
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
        clickable && "cursor-default hover:bg-[var(--color-hover)]",
        selected && "bg-[var(--color-selected)] [&>td]:text-[var(--color-text)]",
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
    <CaretUp size={10} weight="bold" className="flex-none" aria-hidden="true" />
  ) : sortDirection === "desc" ? (
    <CaretDown size={10} weight="bold" className="flex-none" aria-hidden="true" />
  ) : (
    <CaretUpDown size={10} weight="bold" className="flex-none opacity-0 group-hover:opacity-100" aria-hidden="true" />
  );

  const content: ReactNode = sortable ? (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        "group inline-flex items-center gap-[var(--space-1)]",
        sectionLabel,
        sorted ? "text-[var(--color-text-muted)]" : "hover:text-[var(--color-text-muted)]",
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
      // The column header is the section-label style: 11px, uppercase, tracked
      // 0.05em, tertiary ink. It is the only uppercase type in the product
      // (docs/DESIGN.md §4).
      data-numeric={align === "right" ? "" : undefined}
      className={cn(
        "h-[var(--control-h)] px-[var(--space-3)] align-middle",
        sectionLabel,
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
 * `primary` is the row's customer name: body size, weight 500, full ink — not
 * a larger size. A native list keeps one size down a column and separates the
 * name from its meta with weight and colour. `muted` is every subordinate
 * cell. `align="right"` stamps data-numeric, which is what turns on tabular
 * figures in globals.css.
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
        // wraps inside a fixed-height row (docs/DESIGN.md §4). max-w-0 is what
        // makes truncate work in an auto-layout table: the cell still takes its
        // share of the width, and the ellipsis happens inside it.
        primary
          ? "max-w-0 truncate font-medium text-[var(--color-text)]"
          : muted
            ? "text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
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
