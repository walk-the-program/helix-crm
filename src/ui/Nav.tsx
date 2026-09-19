import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/ui/cn";
import { focusRing, quietTransition } from "@/ui/styles";

/**
 * The nav rail: --sidebar-w, --color-sidebar, never collapses
 * (docs/DESIGN.md section 3).
 */
export function Sidebar(props: { children: ReactNode; footer?: ReactNode }) {
  return (
    <aside
      aria-label="Sidebar"
      className={[
        "flex h-full w-[var(--sidebar-w)] flex-none flex-col",
        "border-r border-[var(--color-border)] bg-[var(--color-sidebar)]",
      ].join(" ")}
    >
      <nav aria-label="Main" className="flex-1 overflow-y-auto py-[var(--space-3)]">
        {props.children}
      </nav>
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
      {/* Sentence case. There are no all-caps tracked-out labels in this
          product — small caps at 13px is the opposite of legible for the
          reader this is built for (docs/DESIGN.md section 4). */}
      {props.label ? (
        <div className="px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] font-medium text-[var(--color-text-faint)]">
          {props.label}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

/**
 * The active item is --color-selected with full-strength ink.
 *
 * It was --color-accent-soft with accent text, which is the same defect
 * design/review.md finding 1 caught in the comps: global chrome never carries
 * the accent, because the sidebar is on screen at all times and the accent
 * has to keep meaning "this needs you".
 */
export function NavItem(props: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  href?: string;
  badge?: ReactNode;
}) {
  const { label, icon, active, onClick, href, badge } = props;

  const className = cn(
    "flex min-h-[var(--control-h)] w-full items-center gap-[var(--space-2)]",
    "rounded-[var(--radius-md)] px-[var(--space-3)] no-underline",
    "text-[length:var(--text-base)] text-[var(--color-text-muted)]",
    "hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]",
    quietTransition,
    focusRing,
    active && "bg-[var(--color-selected)] text-[var(--color-text)] font-medium",
  );

  const content = (
    <>
      {icon ? (
        <span
          className="inline-flex flex-none items-center justify-center text-[var(--color-text-muted)]"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <span className="flex-1 truncate text-left" title={label}>
        {label}
      </span>
      {badge ? <span className="flex-none">{badge}</span> : null}
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

/**
 * 56px (48px compact) and it holds three things: where you are, search, and
 * quick add. Nothing else is ever added to it, and nothing in it is the accent.
 */
export function Topbar(props: { children?: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <div
      className={[
        "flex h-[var(--topbar-h)] w-full flex-none items-center justify-between",
        "border-b border-[var(--color-border)] bg-[var(--color-surface)]",
        "px-[var(--space-4)] gap-[var(--space-3)]",
      ].join(" ")}
    >
      <div className="flex flex-none items-center gap-[var(--space-3)] min-w-0">{props.left}</div>
      <div className="flex-1 min-w-0">{props.children}</div>
      <div className="flex flex-none items-center gap-[var(--space-2)]">{props.right}</div>
    </div>
  );
}
