/**
 * Today's section chrome: a heading with a count, and a panel of rows.
 *
 * DESIGN.md section 3 fixes the order and the anatomy — heading, count pill, a
 * quiet one-line explanation on the right — and section 9 fixes the panel
 * (a card: surface, hairline border, modest radius, one shadow level, and
 * never a card inside a card). Everything here is tokens and `src/ui`; there
 * is not a colour value in the file.
 */

import type { ReactNode } from "react";
import { EmptyState } from "@/ui";

export function SectionHeading(props: {
  id: string;
  title: string;
  count?: number;
  /** Accent the count when it is the thing asking for attention. */
  needsYou?: boolean;
  note?: ReactNode;
  action?: ReactNode;
}) {
  const { id, title, count, needsYou, note, action } = props;
  return (
    <div className="mb-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-3)]">
      <h2
        id={id}
        className="text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]"
      >
        {title}
      </h2>
      {typeof count === "number" ? (
        <span
          className={[
            "inline-flex min-w-[24px] items-center justify-center rounded-[var(--radius-full)]",
            "px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)] font-semibold tabular-nums",
            needsYou && count > 0
              ? "bg-[var(--color-accent)] text-[var(--color-accent-text)]"
              : "bg-[var(--color-border)] text-[var(--color-text-muted)]",
          ].join(" ")}
        >
          {count}
        </span>
      ) : null}
      {note ? (
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
          {note}
        </span>
      ) : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

/** The bordered container every Today section's rows sit in. */
export function Panel(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        "overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-surface)] shadow-[var(--shadow-sm)]",
        props.className ?? "",
      ].join(" ")}
    >
      {props.children}
    </div>
  );
}

/**
 * One whole section: heading, then either the rows or its designed empty
 * state. The empty state is not an afterthought — DESIGN.md section 9 asks for
 * an icon, a heading in the owner's words, a sentence about how the list
 * fills, and at most one action. A cleared list and a first-run list read
 * differently and each section says which it is.
 */
export function Section(props: {
  id: string;
  title: string;
  count?: number;
  needsYou?: boolean;
  note?: ReactNode;
  headerAction?: ReactNode;
  isLoading?: boolean;
  isEmpty: boolean;
  empty: { icon?: ReactNode; title: string; description: ReactNode; action?: ReactNode };
  children: ReactNode;
}) {
  const headingId = `today-${props.id}-heading`;
  return (
    <section aria-labelledby={headingId} data-today-section={props.id}>
      <SectionHeading
        id={headingId}
        title={props.title}
        count={props.count}
        needsYou={props.needsYou}
        note={props.note}
        action={props.headerAction}
      />
      <Panel>
        {props.isLoading ? (
          <p className="px-[var(--space-5)] py-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Reading the database.
          </p>
        ) : props.isEmpty ? (
          <EmptyState
            icon={props.empty.icon}
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
 * A Today row. Fixed anatomy left to right: a status badge, the name and a
 * sub-line, money on the right in tabular figures, then the actions.
 *
 * `needsYou` draws the 3 px accent left rail from DESIGN.md section 9 — the
 * row keeps its normal background; only the rail changes, so the accent stays
 * under 2% of the pixels.
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
  needsYou?: boolean;
}) {
  return (
    <li
      className={[
        "flex items-center gap-[var(--space-3)] border-b border-[var(--color-border)] last:border-b-0",
        "px-[var(--space-4)] py-[var(--space-3)] hover:bg-[var(--color-hover)]",
        props.needsYou
          ? "border-l-[3px] border-l-[var(--color-accent)]"
          : "border-l-[3px] border-l-transparent",
      ].join(" ")}
    >
      {props.badge ? <div className="shrink-0">{props.badge}</div> : null}

      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[length:var(--text-base)] font-medium text-[var(--color-text)]"
          title={props.titleText}
        >
          {props.title}
        </div>
        {props.subtitle ? (
          <div
            className={[
              props.subtitleClassName ?? "truncate",
              "text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
            ].join(" ")}
            title={props.subtitleText}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>

      {props.money ? (
        <div className="shrink-0 text-right text-[length:var(--text-base)] tabular-nums text-[var(--color-text-muted)]">
          {props.money}
        </div>
      ) : null}

      {props.actions ? (
        <div className="flex shrink-0 items-center gap-[var(--space-2)]">
          {props.actions}
        </div>
      ) : null}
    </li>
  );
}
