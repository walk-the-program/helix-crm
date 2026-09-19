import type { ReactNode } from "react";

/**
 * Title at --text-xl, truncated with a title attribute rather than wrapped —
 * a 47-character company name is the normal case, not the exception
 * (docs/DESIGN.md sections 4 and 7).
 */
export function PageHeader(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  const { title, subtitle, actions, breadcrumb } = props;

  return (
    <div
      className={[
        "flex min-h-[var(--topbar-h)] w-full flex-wrap items-center justify-between",
        "gap-[var(--space-3)] border-b border-[var(--color-border)]",
        "px-[var(--space-6)] py-[var(--space-4)]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-[var(--space-1)] min-w-0">
        {breadcrumb ? (
          <div className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
            {breadcrumb}
          </div>
        ) : null}
        <h1
          className="truncate text-[length:var(--text-xl)] font-semibold leading-[var(--leading-tight)] text-[var(--color-text)]"
          title={typeof title === "string" ? title : undefined}
        >
          {title}
        </h1>
        {subtitle ? (
          <div className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            {subtitle}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-none items-center gap-[var(--space-2)]">{actions}</div>
      ) : null}
    </div>
  );
}
