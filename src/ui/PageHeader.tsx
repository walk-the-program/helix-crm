import type { ReactNode } from "react";

/**
 * The page title (docs/DESIGN.md §4): --text-2xl, semibold, tracked -0.01em,
 * truncated with a title attribute rather than wrapped — a 47-character company
 * name is the normal case, not the exception.
 *
 * No bottom hairline. The toolbar above it already draws one, and a second rule
 * 24px below the first is the kind of detail that makes a window look assembled
 * rather than designed. Air separates the header from the content instead.
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
        "flex w-full flex-wrap items-end justify-between",
        "gap-[var(--space-3)] pb-[var(--space-5)]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-[var(--space-1)] min-w-0">
        {breadcrumb ? (
          <div className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
            {breadcrumb}
          </div>
        ) : null}
        <h1
          className="truncate text-[length:var(--text-2xl)] font-semibold leading-[var(--leading-tight)] tracking-[var(--tracking-title)] text-[var(--color-text)]"
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
