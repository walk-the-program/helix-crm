import type { ReactNode } from "react";

export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const { icon, title, description, action } = props;

  return (
    <div
      className={[
        "flex flex-col items-center justify-center text-center",
        "gap-[var(--space-3)] px-[var(--space-6)] py-[var(--space-10)]",
      ].join(" ")}
    >
      {icon ? (
        <div className="text-[var(--color-text-faint)]" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]">
        {title}
      </h3>
      {description ? (
        <p className="max-w-[420px] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-[var(--space-3)]">{action}</div> : null}
    </div>
  );
}
