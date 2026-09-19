import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/ui/cn";
import { focusRing, quietTransition, sectionLabel } from "@/ui/styles";

/**
 * The sidebar (docs/DESIGN.md §3): 240px, the warm --color-sidebar tint, a
 * single hairline right edge, and nothing else. It never collapses, it never
 * carries a shadow, and it is the only chrome that is not white.
 */
export function Sidebar(props: { children: ReactNode; brand?: ReactNode; footer?: ReactNode }) {
  return (
    <aside
      aria-label="Sidebar"
      className={[
        "flex h-full w-[var(--sidebar-w)] flex-none flex-col",
        "border-r border-[var(--color-border)] bg-[var(--color-sidebar)]",
      ].join(" ")}
    >
      {props.brand ? (
        <div className="flex flex-none items-center px-[var(--space-2)] pt-[var(--space-3)]">
          {props.brand}
        </div>
      ) : null}
      <nav aria-label="Main" className="flex-1 overflow-y-auto py-[var(--space-2)]">
        {props.children}
      </nav>
      {props.footer ? (
        <div className="border-t border-[var(--color-border)] p-[var(--space-2)]">
          {props.footer}
        </div>
      ) : null}
    </aside>
  );
}

/**
 * A group of nav rows under an optional label.
 *
 * The label is the section-label style — 11px, uppercase, tracked 0.05em,
 * tertiary ink — which is how a native sidebar names a group. It is the only
 * place in the product where type is set in capitals, and it is never longer
 * than three words.
 */
export function SidebarSection(props: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[1px] px-[var(--space-2)] py-[var(--space-2)]">
      {props.label ? (
        <div className={cn("px-[var(--space-3)] pb-[var(--space-2)] pt-[var(--space-1)]", sectionLabel)}>
          {props.label}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

/**
 * A nav row. Selected is the --color-selected tint (system blue at 10%) with
 * full-strength ink and weight 500 — the soft neutral-blue tint a macOS
 * sidebar paints behind its selected row. Hover is the plain --color-hover
 * tint, one step quieter.
 *
 * The icon takes the row's ink rather than its own colour: a sidebar full of
 * coloured glyphs is the single loudest tell of a web app pretending to be a
 * desktop one.
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
    "hover:no-underline",
    quietTransition,
    focusRing,
    active && "bg-[var(--color-selected)] text-[var(--color-text)] font-medium",
  );

  const content = (
    <>
      {icon ? (
        <span
          className="inline-flex flex-none items-center justify-center text-current"
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
 * The toolbar: 48px (44 compact), white, one hairline along the bottom, and it
 * holds three things — where you are, search, and quick add. Nothing else is
 * ever added to it, and nothing in it is coloured.
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
      <div className="flex flex-none items-center gap-[var(--space-1)]">{props.right}</div>
    </div>
  );
}
