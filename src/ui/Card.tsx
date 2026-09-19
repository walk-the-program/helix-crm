import type { HTMLAttributes } from "react";
import { cn } from "@/ui/cn";

/**
 * --color-surface, 1px --color-border, --radius-md, --shadow-sm, padding
 * --space-4 (docs/DESIGN.md section 9). Modest radius on purpose: a large one
 * makes a dense row read as a loose card, which is the wrong signal for a tool.
 *
 * `attention` draws the 3px --color-accent left rail. It is a rail, not a
 * background wash, and it is the only way a card is allowed to use the accent.
 * It is a pseudo-element rather than a box-shadow so it composes with the
 * card's own elevation — design/review.md finding 9 is the same bug in CSS.
 *
 * Cards never nest inside cards.
 */
export function Card({
  className,
  attention,
  ...props
}: HTMLAttributes<HTMLDivElement> & { attention?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)]",
        "bg-[var(--color-surface)] shadow-[var(--shadow-sm)]",
        attention && [
          "relative",
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
          "before:rounded-l-[var(--radius-md)] before:bg-[var(--color-accent)]",
          "before:content-['']",
        ],
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
        "leading-[var(--leading-tight)]",
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
