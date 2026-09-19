import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

/**
 * An empty state is a designed screen, and it is LEFT-ALIGNED in a column
 * capped at --content-max (docs/DESIGN.md section 9). Top to bottom: a 24px
 * icon in --color-text-faint, a heading at --text-lg that says what belongs
 * here, one or two sentences at --text-base --color-text-muted, then one
 * primary action and at most one secondary link.
 */
export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { icon, title, description, action, className } = props;

  return (
    <div
      className={cn(
        "flex w-full max-w-[var(--content-max)] flex-col items-start text-left",
        "gap-[var(--space-3)] px-[var(--space-6)] py-[var(--space-8)]",
        className,
      )}
    >
      {icon ? (
        <div className="text-[var(--color-text-faint)]" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)] leading-[var(--leading-tight)]">
        {title}
      </h3>
      {description ? (
        <p className="text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-[var(--space-2)] flex items-center gap-[var(--space-3)]">{action}</div>
      ) : null}
    </div>
  );
}
