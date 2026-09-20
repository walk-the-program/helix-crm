import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/ui/cn";
import { Tooltip } from "@/ui/Tooltip";
import { focusRing, quietTransition, sectionLabel } from "@/ui/styles";

/** The bounds the sidebar can be dragged between, and what "collapsed" means. */
export const SIDEBAR_MIN_W = 200;
export const SIDEBAR_MAX_W = 360;
export const SIDEBAR_DEFAULT_W = 240;
export const SIDEBAR_COLLAPSED_W = 48;

/** Clamp a stored or dragged width into the allowed range. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_W;
  return Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, Math.round(width)));
}

/**
 * The sidebar (docs/DESIGN.md §3): the primary tint, a single hairline right
 * edge, and nothing else. It carries no shadow and it is the only chrome that
 * is not white.
 *
 * ROUND 3 changed three things, all of them from Walker using the app.
 *
 * 1. IT RESIZES AND IT COLLAPSES. 240px was a guess. An owner whose companies
 *    are called "Fitzgerald & Daughters Groundworks" wants more; an owner on a
 *    13" MacBook wants the room back. The right edge is a real drag handle
 *    between 200 and 360px, and the whole thing collapses to a 48px rail of
 *    icons with a tooltip on each. Both are remembered in helix.json, app-wide
 *    rather than per workspace, because it is a property of the machine and
 *    the screen, not of the business.
 *
 * 2. IT IS FULL HEIGHT AND IT HAS ITS OWN SCROLLER. A tall screen used to
 *    scroll the whole page: the sidebar ended at the content's height with the
 *    bare window under it, there were two scrollbars down the right, and the
 *    nav rows slid up under the macOS traffic lights. Now the header is
 *    pinned, the nav area between the header and the footer is the only part
 *    that scrolls, and the content column is the only other scroller in the
 *    window.
 *
 * 3. THE TITLE-BAR INSET IS ALWAYS RESERVED on macOS. It used to be paid by
 *    the brand slot, which meant a sidebar rendered without a brand (never, in
 *    practice, but the prop allowed it) put row one under the lights. The
 *    header element is always rendered now, so the room is always bought.
 *
 * `dragRegion` makes the header a place you can pick the window up by, which
 * is what a native app does with the space beside its traffic lights. The
 * resize handle inside it deliberately does NOT carry the attribute — Tauri
 * reads it off the element the pointer actually landed on, so a drag that
 * starts on the handle resizes and a drag that starts on the header moves the
 * window.
 */
export function Sidebar(props: {
  children: ReactNode;
  brand?: ReactNode;
  footer?: ReactNode;
  /** macOS: let the window be dragged (and zoomed on a double-click) by the header. */
  dragRegion?: boolean;
  /** Current width in px. Ignored while collapsed. */
  width?: number;
  collapsed?: boolean;
  /** Called continuously while the edge is dragged, and on each arrow key. */
  onResize?: (width: number) => void;
  /** Called when the drag ends, so the caller can persist once rather than 200 times. */
  onResizeEnd?: (width: number) => void;
}) {
  const { width = SIDEBAR_DEFAULT_W, collapsed = false, onResize, onResizeEnd } = props;
  const asideRef = useRef<HTMLElement | null>(null);
  const latestWidth = useRef(width);
  latestWidth.current = width;

  /**
   * Pointer capture rather than window listeners: the pointer keeps reporting
   * to the handle even when it crosses the content column or leaves the
   * window, which is what stops the sidebar sticking to a half-finished drag.
   */
  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (collapsed || !onResize) return;
      event.preventDefault();
      const handle = event.currentTarget;
      const left = asideRef.current?.getBoundingClientRect().left ?? 0;
      handle.setPointerCapture(event.pointerId);

      const move = (e: PointerEvent) => {
        const next = clampSidebarWidth(e.clientX - left);
        latestWidth.current = next;
        onResize(next);
      };
      const up = (e: PointerEvent) => {
        handle.releasePointerCapture?.(e.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        onResizeEnd?.(latestWidth.current);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    },
    [collapsed, onResize, onResizeEnd],
  );

  const onHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (collapsed || !onResize) return;
      const step = event.shiftKey ? 32 : 8;
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = clampSidebarWidth(width - step);
      if (event.key === "ArrowRight") next = clampSidebarWidth(width + step);
      if (event.key === "Home") next = SIDEBAR_MIN_W;
      if (event.key === "End") next = SIDEBAR_MAX_W;
      if (next === null) return;
      event.preventDefault();
      onResize(next);
      onResizeEnd?.(next);
    },
    [collapsed, onResize, onResizeEnd, width],
  );

  const resolvedWidth = collapsed ? SIDEBAR_COLLAPSED_W : clampSidebarWidth(width);

  return (
    <aside
      ref={asideRef}
      aria-label="Sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      data-testid="sidebar"
      style={{ width: `${resolvedWidth}px` }}
      className={cn(
        // h-full against a fixed #root is the whole viewport, so the sidebar
        // reaches the bottom of the window however tall the content is.
        "relative flex h-full min-h-0 flex-none flex-col",
        "border-r border-[var(--color-border)] bg-[var(--color-sidebar)]",
      )}
    >
      {/* Always rendered, even with no brand: on macOS this is the element
          that buys the traffic lights their room, and a nav row must never be
          able to reach the top of the window. */}
      <div
        data-titlebar-inset=""
        data-tauri-drag-region={props.dragRegion ? "" : undefined}
        data-testid="sidebar-header"
        className={cn(
          "flex flex-none items-center pb-[var(--space-2)] pt-[var(--space-4)]",
          collapsed ? "justify-center px-0" : "px-[var(--space-2)]",
        )}
      >
        {props.brand}
      </div>

      <nav
        aria-label="Main"
        data-testid="sidebar-nav"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-[var(--space-2)]"
      >
        {props.children}
      </nav>

      {props.footer ? (
        <div className="flex-none border-t border-[var(--color-border)] p-[var(--space-2)]">
          {props.footer}
        </div>
      ) : null}

      {/* The drag edge. A 5px strip straddling the hairline, so it is easy to
          hit without being visible; it takes the resize cursor and announces
          itself as a separator with a value, which is what a screen reader
          needs to make the arrow keys discoverable. */}
      {!collapsed && onResize ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={resolvedWidth}
          aria-valuemin={SIDEBAR_MIN_W}
          aria-valuemax={SIDEBAR_MAX_W}
          tabIndex={0}
          data-testid="sidebar-resize"
          onPointerDown={onHandlePointerDown}
          onKeyDown={onHandleKeyDown}
          className={cn(
            "absolute inset-y-0 right-[-2px] z-10 w-[5px] cursor-col-resize",
            "hover:bg-[var(--color-border-strong)]",
            quietTransition,
            focusRing,
          )}
        />
      ) : null}
    </aside>
  );
}

/**
 * A group of nav rows under an optional label.
 *
 * The label is the section-label style — the guide's 11px caption step in the
 * body face, uppercase, tracked 0.05em, tertiary ink — which is how a native
 * sidebar names a group. It is the only place in the product where type is set
 * in capitals, and it is never longer than three words.
 *
 * Collapsed, a label would be four letters of nothing, so it is dropped and
 * the hairline between groups carries the grouping on its own.
 */
export function SidebarSection(props: {
  label?: string;
  collapsed?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-testid="sidebar-section"
      className={cn(
        "flex flex-col gap-[1px] py-[var(--space-2)]",
        props.collapsed ? "px-[var(--space-1)]" : "px-[var(--space-2)]",
      )}
    >
      {props.label && !props.collapsed ? (
        <div className={cn("px-[var(--space-3)] pb-[var(--space-2)] pt-[var(--space-1)]", sectionLabel)}>
          {props.label}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

/**
 * The hairline between two groups of nav rows (round 3, criterion 21).
 *
 * The sidebar's order now means something — records together, money together,
 * work together — and a run of eleven identical rows hides that. One hairline
 * per boundary is the whole treatment: no heading, no extra air, nothing that
 * would turn a grouping into a set of sections.
 */
export function SidebarSeparator() {
  return (
    <div
      role="presentation"
      data-testid="sidebar-separator"
      className="mx-[var(--space-3)] border-t border-[var(--color-border)]"
    />
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
 *
 * COLLAPSED, the row is the icon and the tooltip is the label. The label still
 * reaches a screen reader through `aria-label`, and the badge becomes a dot in
 * the corner — a count in a 48px rail is unreadable, and the thing it has to
 * say is "there is something here", which a dot says.
 */
export function NavItem(props: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  href?: string;
  badge?: ReactNode;
  collapsed?: boolean;
}) {
  const { label, icon, active, onClick, href, badge, collapsed } = props;

  const className = cn(
    "flex min-h-[var(--control-h)] w-full items-center gap-[var(--space-2)]",
    "no-underline",
    collapsed ? "justify-center px-0" : "px-[var(--space-3)]",
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

  const content = collapsed ? (
    <span className="relative inline-flex items-center justify-center text-current" aria-hidden="true">
      {icon}
      {badge ? (
        <span className="absolute right-[-3px] top-[-2px] h-[6px] w-[6px] bg-[var(--color-accent)]" />
      ) : null}
    </span>
  ) : (
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

  const row = href ? (
    <a
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={className}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={className}
    >
      {content}
    </button>
  );

  if (!collapsed) return row;
  return (
    <Tooltip content={label} side="right">
      {row}
    </Tooltip>
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
 *
 * The attribute is only half of it: `core:window:allow-start-dragging` has to
 * be in src-tauri/capabilities/default.json or the IPC call the attribute
 * triggers is refused and the window does not move. That was the round-3 drag
 * bug — the markup was right and the permission was missing.
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
      data-testid="topbar"
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
