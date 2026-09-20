import type { ReactNode } from "react";
import { cn } from "@/ui/cn";
import { headingFont, proseLeading } from "@/ui/styles";

/**
 * An empty screen is an invitation, and it is centred in air (docs/DESIGN.md
 * §9 "Empty states"): a short title, one sentence in secondary grey, and one
 * primary button. Nothing else — no illustration, no glyph, no border, no card.
 *
 * `icon` is still accepted so the call sites that pass one keep compiling, and
 * it is deliberately not drawn: a decorative glyph in the middle of an empty
 * pane is the thing that makes a desktop app look like a marketing page.
 *
 * TWO SIZES, ONE COMPONENT
 * ------------------------
 * The full form above answers "this whole screen has nothing on it". It is
 * wrong inside a card or a section that is one of six on a page: a centred
 * 17px heading with 40px of padding above and below, repeated down a column,
 * turns a quiet page into a page of announcements about absence. Screens were
 * hand-rolling the small form instead — a bare `<p>` in muted ink, each with
 * its own padding and its own idea of the type size — which is how the same
 * situation ended up looking different in six places.
 *
 * So `variant="quiet"` is the section-level form: one muted sentence on the
 * left, no title, no centring, no vertical air beyond a row's worth. It takes
 * the same props; `title` becomes the sentence when there is no `description`,
 * so a caller can switch between the two forms without rewriting its copy.
 *
 * Both forms obey the same rule (the phase-two design direction, rule 6): a
 * title, one sentence and at most one action, and the sentence has to be true
 * for a workspace with zero records — no "every invoice you have sent has been
 * paid" to someone who has never sent one.
 */
export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** `full` (default) centres in the pane; `quiet` is one inline sentence. */
  variant?: "full" | "quiet";
  className?: string;
}) {
  const { title, description, action, variant = "full", className } = props;

  if (variant === "quiet") {
    return (
      <div
        className={cn(
          "flex min-h-[var(--row-h)] flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-2)]",
          "px-[var(--space-4)] py-[var(--space-2)]",
          className,
        )}
      >
        <p
          className={cn(
            "min-w-0 text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
            proseLeading,
          )}
        >
          {description ?? title}
        </p>
        {action ? <div className="flex flex-none items-center">{action}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[var(--content-max)] flex-col items-center text-center",
        "gap-[var(--space-2)] px-[var(--space-6)] py-[var(--space-10)]",
        className,
      )}
    >
      <h3
        className={cn(
          headingFont,
          "text-[length:var(--text-subhead)] font-bold leading-[var(--leading-subhead)]",
        )}
      >
        {title}
      </h3>
      {description ? (
        <p
          className={cn(
            "text-[length:var(--text-base)] text-[var(--color-text-muted)]",
            proseLeading,
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-[var(--space-4)] flex items-center gap-[var(--space-3)]">{action}</div>
      ) : null}
    </div>
  );
}
