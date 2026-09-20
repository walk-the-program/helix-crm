import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/ui/cn";
import { focusRing, quietTransition, sectionLabel } from "@/ui/styles";

/**
 * The sidebar (docs/DESIGN.md §3): 240px, the primary tint (#97B1C3 at 8%
 * over the neutral light — the guide's own 8% ceiling), a single hairline
 * right edge, and nothing else. It never collapses, it never carries a
 * shadow, and it is the only chrome that is not white.
 *
 * The brand slot at the top has room under it for the lockup's offset sticker
 * shadow, which overhangs the mark by 4px and would otherwise be clipped by
 * the first nav group.
 *
 * On macOS the window runs an integrated title bar, so the web view starts at
 * the very top of the window and the traffic lights sit over this slot. The
 * slot carries `data-titlebar-inset`, and globals.css pays the 38px under
 * `[data-platform="macos"]` — the lockup lands below the lights, and nothing
 * on Windows moves. `dragRegion` makes the same slot a place you can pick the
 * window up by, which is what a native app does with the space beside its
 * traffic lights.
 */
export function Sidebar(props: {
  children: ReactNode;
  brand?: ReactNode;
  footer?: ReactNode;
  /** macOS: let the window be dragged (and zoomed on a double-click) by the brand slot. */
  dragRegion?: boolean;
}) {
  return (
    <aside
      aria-label="Sidebar"
      className={[
        "flex h-full min-h-0 w-[var(--sidebar-w)] flex-none flex-col",
        "border-r border-[var(--color-border)] bg-[var(--color-sidebar)]",
      ].join(" ")}
    >
      {props.brand ? (
        <div
          data-titlebar-inset=""
          data-tauri-drag-region={props.dragRegion ? "" : undefined}
          className="flex flex-none items-center px-[var(--space-2)] pb-[var(--space-2)] pt-[var(--space-4)]"
        >
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
 * The label is the section-label style — the guide's 11px caption step in
 * Lato, uppercase, tracked 0.05em, tertiary ink — which is how a native
 * sidebar names a group. It is the only place in the product where type is set
 * in capitals, and it is never longer than three words.
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
 * A nav row.
 *
 * THE SELECTED ROW IS THE ONE CONFIDENT BLOCK. The brand guide allows the
 * primary exactly once per view — "Primary appears once per view as a single
 * confident block" — and this is where the application spends it: a flat
 * #97B1C3 fill, square, with the near-black ink that measures 8.24:1 on it.
 * It is the same block in light and dark, because the primary does not invert.
 *
 * Everything else stays quiet. Hover is --color-hover, one step off the
 * sidebar tint, and a hovered selected row deepens the primary rather than
 * losing it.
 *
 * The icon takes the row's ink rather than its own colour: a sidebar full of
 * coloured glyphs is the single loudest tell of a web app pretending to be a
 * desktop one. On the selected row that ink is the near-black, so the glyph
 * reads against the block without being given a colour of its own.
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
    "px-[var(--space-3)] no-underline",
    "text-[length:var(--text-base)] text-[var(--color-text-muted)]",
    "hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]",
    "hover:no-underline",
    quietTransition,
    focusRing,
    active && [
      "bg-[var(--color-accent)] text-[var(--color-accent-text)] font-medium",
      "hover:bg-[var(--color-accent-hover)] hover:text-[var(--color-accent-text)]",
    ].join(" "),
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
 *
 * With `dragRegion` the bar itself is how you move the window on macOS, and a
 * double-click on it zooms, which is the platform convention. Tauri only reads
 * the attribute off the element the pointer actually landed on, so the search
 * field and the buttons inside stay clickable.
 */
export function Topbar(props: {
  children?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  /** macOS: let the window be dragged (and zoomed on a double-click) by the bar. */
  dragRegion?: boolean;
}) {
  return (
    <div
      data-tauri-drag-region={props.dragRegion ? "" : undefined}
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
