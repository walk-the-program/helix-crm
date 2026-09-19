import type {
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/ui/cn";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full border-collapse text-[length:var(--text-sm)]", className)}
      {...props}
    />
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "bg-[var(--color-surface)] text-[var(--color-text-muted)]",
        "border-b border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

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
      className={cn(
        "border-b border-[var(--color-border)]",
        clickable && "cursor-pointer hover:bg-[var(--color-surface)]",
        selected && "bg-[var(--color-accent-soft)]",
        clickable &&
          "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:-outline-offset-2",
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
  const icon = !sortable ? null : sortDirection === "asc" ? (
    <ChevronUp className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
  ) : sortDirection === "desc" ? (
    <ChevronDown className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
  ) : (
    <ChevronsUpDown className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
  );

  const content: ReactNode = sortable ? (
    <button
      type="button"
      onClick={onSort}
      aria-sort={
        sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : "none"
      }
      className={cn(
        "inline-flex items-center gap-[var(--space-1)] min-h-[var(--space-8)]",
        "font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
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
      className={cn(
        "h-[var(--row-h)] px-[var(--space-3)] font-medium",
        "text-[length:var(--text-xs)] uppercase tracking-wide",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    >
      {content}
    </th>
  );
}

export function TD({
  className,
  align = "left",
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <td
      className={cn(
        "h-[var(--row-h)] px-[var(--space-3)] text-[var(--color-text)]",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
