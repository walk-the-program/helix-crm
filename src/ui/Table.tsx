import type {
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cn } from "@/ui/cn";
import { focusRingInset, sectionLabel } from "@/ui/styles";
import { ariaSortValue, SortHeaderButton, type SortDirection } from "@/ui/SortableHeader";

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

/**
 * The bounded region a long list scrolls inside, so `THead`'s `position:
 * sticky` has a scrollport to stick to.
 *
 * `sticky` resolves against the nearest scrolling ancestor. A table dropped
 * straight into a `Card` has none — the page scrolls instead — so the header
 * scrolls away with the rows, and a `Card` with `overflow: hidden` is worse:
 * it IS a scroll container, but it cannot scroll, so the header is pinned to a
 * viewport that never moves. Wrap the table in this and the header behaves the
 * way a native list view's column strip does.
 *
 * `maxHeight` is the caller's decision (it is the only thing a shared
 * primitive cannot know) and is passed as a CSS length, never a hard-coded
 * pixel class, so density and the window still decide the rest.
 */
export function TableScroll({
  className,
  maxHeight,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { maxHeight?: string }) {
  return (
    <div
      className={cn("min-h-0 overflow-y-auto overflow-x-hidden", className)}
      style={maxHeight ? { maxHeight, ...style } : style}
      {...props}
    />
  );
}

/**
 * The rows.
 *
 * The last row does NOT draw its hairline. The surface a table sits on — a
 * `Card`, a settings panel, a dialog — already ends in a border of its own, and
 * a row rule immediately above it read as a double line with a 1px white band
 * trapped between them, which is the "empty panel below the last row" that
 * every screen was patching out by hand with
 * `className="[&>tr:last-child]:border-b-0"`. It belongs here once: the surface
 * ends at the last hairline, everywhere, and a screen never has to know.
 */
export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child]:border-b-0", className)} {...props} />;
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
  sortDirection?: SortDirection;
  onSort?: () => void;
}) {
  // The button, caret and aria-sort mapping are shared with the column strip
  // above Contacts' and Companies' virtualised lists - see SortableHeader.tsx.
  const content: ReactNode = sortable ? (
    <SortHeaderButton sortDirection={sortDirection} onSort={onSort} align={align}>
      {children}
    </SortHeaderButton>
  ) : (
    children
  );

  return (
    <th
      scope="col"
      aria-sort={ariaSortValue(sortable, sortDirection)}
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
 * figures in globals.css — a money or count column asks for `align="right"`
 * and never for its own `text-right tabular-nums` classes.
 *
 * `dashZero` is the money-table rule: over a period, a zero is an em dash in
 * muted ink rather than a row of "$0.00" that the eye has to read before it
 * can discard it. A headline figure still says "$0.00", because there the zero
 * is the answer. The caller supplies the text — `useFormats().moneyOrDash` in
 * src/app/formats.ts returns the dash — and sets `dashZero` for the same
 * condition, so the cell knows to drop the ink without the kit having to
 * inspect its own children. A dashed cell still sums as zero; nothing about
 * the arithmetic changes.
 */
export function TD({
  className,
  align = "left",
  primary,
  muted,
  dashZero,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right";
  primary?: boolean;
  muted?: boolean;
  dashZero?: boolean;
}) {
  return (
    <td
      data-numeric={align === "right" ? "" : undefined}
      data-zero={dashZero ? "" : undefined}
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
        // Last, so it wins over `primary`/`muted`: a zero placeholder is the
        // quietest thing in the column whatever else the cell is.
        dashZero && "text-[var(--color-text-faint)]",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
