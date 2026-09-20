/**
 * Today's section chrome: a heading with a count, and a panel of rows.
 *
 * DESIGN.md §3 fixes the order. A section heading is a plain `h2`, which
 * globals.css sets in the brand's slab at the 20px subhead step — the thing
 * that gives Today real hierarchy against a 15px row. The one-line
 * explanation beside it is tertiary; a count is not an alarm.
 *
 * The brand guide allows the primary colour once per view, as a single
 * confident block. On Today that block is the Due now count, and only when
 * something is actually due: it passes `emphasis` and nothing else does. Every
 * other count is plain tabular text in secondary ink. "Needs you" is still
 * mostly position and weight — Due now is first, its rows are in full ink, and
 * an overdue row's badge says the number of days out loud. Rows are separated
 * by one hairline and nothing else; there is no rail on the first cell.
 */

import type { ReactNode } from "react";
import { EmptyState } from "@/ui";

export function SectionHeading(props: {
  id: string;
  title: string;
  count?: number;
  note?: ReactNode;
  action?: ReactNode;
  /**
   * Paints the count as the screen's one primary block. Due now sets it and
   * nothing else does: the brand guide allows the primary colour once per
   * view, and on Today the thing that earns it is the number of promises
   * that are due. With nothing due the block is not drawn at all.
   */
  emphasis?: boolean;
  /**
   * The collapsed empty state: a short muted sentence appended to the same
   * line as the heading, with an optional text link after it. Set only when
   * the section is empty and asked to collapse to one line instead of a
   * panel (see `Section.emptyInline`).
   */
  emptyInline?: { text: string; action?: ReactNode };
}) {
  const { id, title, count, note, action, emphasis, emptyInline } = props;
  return (
    <div
      className={[
        emptyInline ? "" : "mb-[var(--space-3)]",
        "flex flex-wrap items-baseline gap-[var(--space-3)]",
      ].join(" ")}
    >
      <h2 id={id}>
        {title}
      </h2>
      {typeof count === "number" && count > 0 ? (
        emphasis ? (
          <span className="tabular inline-flex min-w-[var(--control-h-sm)] items-center justify-center bg-[var(--color-accent)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-body)] font-semibold text-[var(--color-accent-text)]">
            {count}
          </span>
        ) : (
          <span className="tabular text-[length:var(--text-body)] text-[var(--color-text-muted)]">
            {count}
          </span>
        )
      ) : null}
      {note ? (
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
          {note}
        </span>
      ) : null}
      {emptyInline ? (
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          · {emptyInline.text}
          {emptyInline.action ? <> {emptyInline.action}</> : null}
        </span>
      ) : null}
      {action ? <div className="ml-auto self-center">{action}</div> : null}
    </div>
  );
}

/**
 * The grouped inset list every Today section's rows sit in: white surface, one
 * hairline, hard corners (radius 0 everywhere, per the brand guide), and no
 * shadow at all — only a floating layer casts one.
 */
export function Panel(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        "overflow-hidden border border-[var(--color-border)]",
        "bg-[var(--color-surface)]",
        props.className ?? "",
      ].join(" ")}
    >
      {props.children}
    </div>
  );
}

/**
 * One whole section: heading, then either the rows, its empty state, or —
 * when `emptyInline` is given — a single quiet line in place of a panel.
 *
 * The full empty state is the kit's: a title, one sentence, and at most one
 * action. It still accepts an icon and deliberately does not draw one
 * (DESIGN.md §9), so the call sites here pass none. Today keeps that
 * full-panel treatment only for the sections that still use `empty`; Coming
 * up, New leads and Gone quiet collapse instead, because three of those
 * panels stacked empty read as three failures rather than as "nothing is
 * wrong here" (see the sections' own files).
 */
export function Section(props: {
  id: string;
  title: string;
  count?: number;
  note?: ReactNode;
  headerAction?: ReactNode;
  /** Passed straight to SectionHeading; only Due now sets it. */
  emphasis?: boolean;
  isLoading?: boolean;
  isEmpty: boolean;
  /** The full panel empty state. Ignored once loading has resolved if `emptyInline` is set. */
  empty?: { title: string; description: ReactNode; action?: ReactNode };
  /**
   * Collapses an empty, finished-loading section to one line: the heading,
   * "·", a short muted sentence, and an optional inline text link — no panel
   * at all. Takes priority over `empty` once loading has resolved.
   */
  emptyInline?: { text: string; action?: ReactNode };
  children: ReactNode;
}) {
  const headingId = `today-${props.id}-heading`;
  const collapsed = props.isEmpty && !props.isLoading && Boolean(props.emptyInline);
  return (
    <section aria-labelledby={headingId} data-today-section={props.id}>
      <SectionHeading
        id={headingId}
        title={props.title}
        count={collapsed ? undefined : props.count}
        note={collapsed ? undefined : props.note}
        action={collapsed ? undefined : props.headerAction}
        emphasis={props.emphasis}
        emptyInline={collapsed ? props.emptyInline : undefined}
      />
      {collapsed ? null : (
        <Panel>
          {props.isLoading ? (
            <p className="px-[var(--space-4)] py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
              Reading the database.
            </p>
          ) : props.isEmpty ? (
            <EmptyState
              title={props.empty?.title ?? ""}
              description={props.empty?.description}
              action={props.empty?.action}
            />
          ) : (
            <ul className="m-0 list-none p-0">{props.children}</ul>
          )}
        </Panel>
      )}
    </section>
  );
}

/**
 * A Today row. Fixed anatomy left to right: a tag, the name and a sub-line,
 * money on the right in tabular figures, then the actions.
 *
 * Two lines of type, so the height comes from the padding rather than from
 * `--row-h`: `--space-3` top and bottom puts a comfortable row at 52px and a
 * compact one at 42px, which is the native two-line list metric. One hairline
 * under every row but the last, and a calm `--color-hover` on hover.
 */
export function Row(props: {
  badge?: ReactNode;
  title: ReactNode;
  /** Plain text, for the `title` attribute on a name that may be truncated. */
  titleText?: string;
  subtitle?: ReactNode;
  subtitleText?: string;
  /**
   * Overrides the default single-line truncation. Gone quiet uses it to keep
   * the "No activity for 30 days" explanation whole and truncate the deal
   * title instead — the number is the reason the row is on the screen.
   */
  subtitleClassName?: string;
  money?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li
      className={[
        "flex items-center gap-[var(--space-3)]",
        "border-b border-[var(--color-border)] last:border-b-0",
        "px-[var(--space-4)] py-[var(--space-3)] hover:bg-[var(--color-hover)]",
      ].join(" ")}
    >
      {/* A fixed column, so every title down the section starts at the same
          x. Badges are different widths and a ragged left edge on the one
          thing the owner reads is the definition of sloppy. */}
      {props.badge ? <div className="w-[116px] flex-none">{props.badge}</div> : null}

      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[length:var(--text-base)] font-medium leading-[var(--leading-tight)] text-[var(--color-text)]"
          title={props.titleText}
        >
          {props.title}
        </div>
        {props.subtitle ? (
          <div
            className={[
              props.subtitleClassName ?? "truncate",
              "mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
            ].join(" ")}
            title={props.subtitleText}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>

      {props.money ? (
        <div className="money flex-none text-right text-[length:var(--text-base)] font-medium text-[var(--color-text)]">
          {props.money}
        </div>
      ) : null}

      {props.actions ? (
        <div className="flex flex-none items-center gap-[var(--space-1)]">
          {props.actions}
        </div>
      ) : null}
    </li>
  );
}
