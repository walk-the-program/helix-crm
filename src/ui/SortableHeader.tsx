import type { ReactNode } from "react";
import { CaretDown, CaretUp, CaretUpDown } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { focusRing, sectionLabel } from "@/ui/styles";

/**
 * The one sortable-header implementation in the product
 * (apple-hig-review.md finding 6 / top-ten item 9: "reuse the existing
 * sortable TH... do not duplicate the logic in three screens").
 *
 * `TH` (Table.tsx) renders this inside a `<th>` for the pipeline's table list
 * view; `ColumnHeaderCell` below renders it inside a `role="columnheader"`
 * `div` for the flex column strip above Contacts' and Companies' virtualised
 * lists, which cannot use a real `<table>` without giving up virtualisation.
 * Both end up with the same button, the same caret, and the same
 * `aria-sort` mapping, so a fix to either lands in both.
 */
export type SortDirection = "asc" | "desc" | null;

/** `aria-sort`'s three real values, or undefined when the column cannot be
 *  sorted at all. */
export function ariaSortValue(
  sortable: boolean | undefined,
  sortDirection: SortDirection | undefined,
): "ascending" | "descending" | "none" | undefined {
  if (!sortable) return undefined;
  if (sortDirection === "asc") return "ascending";
  if (sortDirection === "desc") return "descending";
  return "none";
}

/**
 * The clickable label + caret. The caret shows the current direction, and
 * fades in on hover when the column is not the one currently sorted (so an
 * idle list of columns does not read as a wall of carets).
 */
export function SortHeaderButton(props: {
  sortDirection?: SortDirection;
  onSort?: () => void;
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
}): ReactNode {
  const { sortDirection, onSort, align = "left", children, className } = props;
  const sorted = sortDirection === "asc" || sortDirection === "desc";

  const icon =
    sortDirection === "asc" ? (
      <CaretUp size={10} weight="bold" className="flex-none" aria-hidden="true" />
    ) : sortDirection === "desc" ? (
      <CaretDown size={10} weight="bold" className="flex-none" aria-hidden="true" />
    ) : (
      <CaretUpDown
        size={10}
        weight="bold"
        className="flex-none opacity-0 group-hover:opacity-100"
        aria-hidden="true"
      />
    );

  return (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        "group inline-flex items-center gap-[var(--space-1)]",
        sectionLabel,
        sorted ? "text-[var(--color-text-muted)]" : "hover:text-[var(--color-text-muted)]",
        focusRing,
        align === "right" && "flex-row-reverse",
        className,
      )}
    >
      {children}
      {icon}
    </button>
  );
}

/**
 * A column header for a flex "row" of cells above a virtualised list - the
 * same content and behaviour as `TH`, in a `role="columnheader"` `div`
 * instead of a `<th>`, since the rows below are `VirtualList`'s
 * `role="listitem"`s, not table rows. The strip that holds these needs
 * `role="row"` for the columnheader roles to have valid context; see
 * ContactsScreen.tsx / CompaniesScreen.tsx.
 */
export function ColumnHeaderCell(props: {
  className?: string;
  align?: "left" | "right";
  sortable?: boolean;
  sortDirection?: SortDirection;
  onSort?: () => void;
  children: ReactNode;
}): ReactNode {
  const { className, align = "left", sortable, sortDirection, onSort, children } = props;
  return (
    <div
      role="columnheader"
      aria-sort={ariaSortValue(sortable, sortDirection)}
      className={cn(align === "right" && "text-right", className)}
    >
      {sortable ? (
        <SortHeaderButton sortDirection={sortDirection} onSort={onSort} align={align}>
          {children}
        </SortHeaderButton>
      ) : (
        children
      )}
    </div>
  );
}
