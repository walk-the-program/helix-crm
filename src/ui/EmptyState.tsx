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
 */
export function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { title, description, action, className } = props;

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
