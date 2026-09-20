import type { HTMLAttributes } from "react";
import { cn } from "@/ui/cn";
import { overlayPanel, overlayRow, overlayScrim, sectionLabel } from "@/ui/styles";

/**
 * The floating layer, for the two panels that cannot be a kit `Dialog`.
 *
 * `Dialog` is the answer for anything with a title and a form. The command
 * palette and the search dialog are not that: both are a `cmdk` `Command` root,
 * which owns its own roving focus, its own `aria-activedescendant` and its own
 * list semantics, and wrapping one in a Radix dialog puts two focus managers on
 * the same subtree. So they stay their own components — and they stopped
 * inventing their own surface. Everything about the layer that a user can see
 * lives here: the scrim, the panel, the row and the group heading.
 *
 * The rest of the kit's floating-layer contract still holds: one hairline,
 * radius 0, one shadow token, `--row-h` rows, `--color-selected` for the
 * highlight, and the scrim is a light dim rather than a black wash.
 *
 * `src/ui/styles.ts` holds the class strings; these are the components feature
 * code talks to, so nothing outside the kit has to know them.
 */

/**
 * The dim behind a floating panel, and the click target that dismisses it.
 *
 * `pt` is the one thing a caller sets: a Spotlight panel hangs a fifth of the
 * way down the window rather than sitting in the middle of it, and how far
 * down is the panel's decision.
 */
export function OverlayScrim({
  className,
  onDismiss,
  ...props
}: HTMLAttributes<HTMLDivElement> & { onDismiss?: () => void }) {
  return (
    <div
      className={cn(overlayScrim, "flex items-start justify-center pt-[14vh]", className)}
      onMouseDown={(event) => {
        // Only a press that starts AND ends on the scrim itself: a drag that
        // began inside the panel and released out here is a text selection,
        // not a dismissal.
        if (event.target === event.currentTarget) onDismiss?.();
      }}
      {...props}
    />
  );
}

/** The panel: raised surface, one hairline, one shadow, capped at 600px. */
export function OverlayPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(overlayPanel, "max-w-[600px]", className)} {...props} />;
}

/**
 * The class a row in a floating list wears.
 *
 * Exported as a string rather than a component because `cmdk` owns the markup
 * of `Command.Item` and only takes a `className`.
 */
export const overlayRowClass = overlayRow;

/**
 * The class a group heading in a floating list wears: the product's one
 * uppercase style, the same one a table column header uses.
 *
 * `cmdk` renders the heading node itself, so both panels pass this on a `span`
 * they hand to `heading`.
 */
export const overlayHeadingClass = cn(
  sectionLabel,
  "block px-[var(--space-3)] pb-[var(--space-1)] pt-[var(--space-2)]",
);
