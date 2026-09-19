import type { HTMLAttributes } from "react";
import { cn } from "@/ui/cn";
import { sectionLabel } from "@/ui/styles";

/**
 * A card is a grouped inset list (docs/DESIGN.md §9 "Cards"): white surface,
 * one hairline, --radius-lg, and no shadow at all. The grouped list is the
 * central structure of a native settings or detail pane — a panel of related
 * rows, separated by hairlines, under a small capitals label.
 *
 * Cards never nest inside cards, and a card never casts a shadow: only a
 * floating layer does.
 *
 * `attention` no longer paints a coloured rail. "This needs you" is carried by
 * position and weight in this product, not by a loud colour (§5), so the
 * attention form is the same card with a visible hairline instead of an
 * invisible one.
 */
export function Card({
  className,
  attention,
  ...props
}: HTMLAttributes<HTMLDivElement> & { attention?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border bg-[var(--color-surface)]",
        attention ? "border-[var(--color-border-strong)]" : "border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-[var(--space-3)]",
        "px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]",
        "leading-[var(--leading-tight)] tracking-[var(--tracking-title)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[var(--space-4)]", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-[var(--space-2)]",
        "px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The label above a grouped list. Small capitals, tertiary ink, sitting in the
 * canvas rather than inside the card — the way a native settings pane titles a
 * group.
 */
export function CardGroupLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-[var(--space-1)] pb-[var(--space-2)]", sectionLabel, className)}
      {...props}
    />
  );
}

/**
 * One row of a grouped list: full-bleed, a hairline under every row but the
 * last, --row-h tall, label left and value right.
 *
 * Use it inside a `Card` with no `CardBody`, so the hairlines run edge to edge
 * the way they do in a native inset list.
 */
export function CardRow({
  className,
  interactive,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-[var(--row-h)] items-center justify-between gap-[var(--space-3)]",
        "px-[var(--space-4)] py-[var(--space-2)]",
        "border-b border-[var(--color-border)] last:border-b-0",
        "text-[length:var(--text-base)] text-[var(--color-text)]",
        interactive && "cursor-default hover:bg-[var(--color-hover)]",
        className,
      )}
      {...props}
    />
  );
}
