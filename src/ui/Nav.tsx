import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

export function Sidebar(props: { children: ReactNode; footer?: ReactNode }) {
  return (
    <aside
      className={[
        "flex h-full w-[var(--sidebar-w)] shrink-0 flex-col",
        "border-r border-[var(--color-border)] bg-[var(--color-surface)]",
      ].join(" ")}
    >
      <div className="flex-1 overflow-y-auto py-[var(--space-3)]">{props.children}</div>
      {props.footer ? (
        <div className="border-t border-[var(--color-border)] p-[var(--space-3)]">
          {props.footer}
        </div>
      ) : null}
    </aside>
  );
}

export function SidebarSection(props: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-2)]">
      {props.label ? (
        <div className="px-[var(--space-2)] text-[length:var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-text-faint)]">
          {props.label}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

export function NavItem(props: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  badge?: ReactNode;
}) {
  const { label, icon, active, onClick, href, badge } = props;

  const className = cn(
    "flex min-h-[var(--space-9)] w-full items-center gap-[var(--space-2)]",
    "rounded-[var(--radius-md)] px-[var(--space-3)]",
    "text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
    "hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]",
    "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
    active && "bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium",
  );

  const content = (
    <>
      {icon ? (
        <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="flex-1 truncate text-left">{label}</span>
      {badge ? <span className="shrink-0">{badge}</span> : null}
    </>
  );

  if (href) {
    return (
      <a href={href} onClick={onClick} aria-current={active ? "page" : undefined} className={className}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={className}>
      {content}
    </button>
  );
}

export function Topbar(props: { children?: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <div
      className={[
        "flex h-[var(--topbar-h)] w-full items-center justify-between",
        "border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]",
        "px-[var(--space-4)] gap-[var(--space-3)]",
      ].join(" ")}
    >
      <div className="flex items-center gap-[var(--space-3)] min-w-0">{props.left}</div>
      <div className="flex-1 min-w-0">{props.children}</div>
      <div className="flex items-center gap-[var(--space-2)] shrink-0">{props.right}</div>
    </div>
  );
}
