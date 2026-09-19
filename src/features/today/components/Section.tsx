/**
 * Today's section chrome: a heading with a count, and a panel of rows.
 *
 * DESIGN.md §3 fixes the order and §4 fixes the type. A section heading is
 * `--text-xl` semibold and tracked, which is the contract's "section heading"
 * step and the thing that gives Today real hierarchy against a `--text-base`
 * row. The count beside it is plain tabular text in secondary ink, and the
 * one-line explanation is tertiary — a count is not an alarm.
 *
 * There is no attention colour on this screen any more (§5). "Needs you" is
 * carried by position and weight: Due now is first, its rows are in full ink,
 * and an overdue row's own badge says the number of days out loud. The old
 * black count pill and the 3px accent left rail on a row are both gone — a
 * rail on the first cell is a web-app device, and a native list separates rows
 * with one hairline and nothing else.
 */

import type { ReactNode } from "react";
import { EmptyState } from "@/ui";

export function SectionHeading(props: {
  id: string;
  title: string;
  count?: number;
  note?: ReactNode;
  action?: ReactNode;
}) {
  const { id, title, count, note, action } = props;
  return (
    <div className="mb-[var(--space-3)] flex flex-wrap items-baseline gap-[var(--space-3)]">
      <h2
        id={id}
        className="text-[length:var(--text-xl)] font-semibold leading-[var(--leading-tight)] tracking-[var(--tracking-title)] text-[var(--color-text)]"
      >
        {title}
      </h2>
      {typeof count === "number" && count > 0 ? (
        <span className="tabular text-[length:var(--text-base)] text-[var(--color-text-muted)]">
          {count}
        </span>
      ) : null}
      {note ? (
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
          {note}
        </span>
      ) : null}
      {action ? <div className="ml-auto self-center">{action}</div> : null}
    </div>
  );
}

/**
 * The grouped inset list every Today section's rows sit in: white surface, one
 * hairline, `--radius-lg`, and no shadow at all — only a floating layer casts
 * one (DESIGN.md §6).
 */
export function Panel(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        "overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-surface)]",
        props.className ?? "",
      ].join(" ")}
    >
      {props.children}
    </div>
  );
}

/**
 * One whole section: heading, then either the rows or its empty state.
 *
 * The empty state is the kit's: a title, one sentence, and at most one action.
 * It still accepts an icon and deliberately does not draw one (DESIGN.md §9),
 * so the call sites here pass none.
 */
export function Section(props: {
  id: string;
  title: string;
  count?: number;
  note?: ReactNode;
  headerAction?: ReactNode;
  isLoading?: boolean;
  isEmpty: boolean;
  empty: { title: string; description: ReactNode; action?: ReactNode };
  children: ReactNode;
}) {
  const headingId = `today-${props.id}-heading`;
  return (
    <section aria-labelledby={headingId} data-today-section={props.id}>
      <SectionHeading
        id={headingId}
        title={props.title}
        count={props.count}
        note={props.note}
        action={props.headerAction}
      />
      <Panel>
        {props.isLoading ? (
          <p className="px-[var(--space-4)] py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Reading the database.
          </p>
        ) : props.isEmpty ? (
          <EmptyState
            title={props.empty.title}
            description={props.empty.description}
            action={props.empty.action}
          />
        ) : (
          <ul className="m-0 list-none p-0">{props.children}</ul>
        )}
      </Panel>
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
