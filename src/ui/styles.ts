/**
 * Shared class fragments for the component kit.
 *
 * Internal to src/ui — deliberately not re-exported from index.ts, so the
 * feature code keeps talking to components rather than to class strings.
 *
 * Rules these encode (docs/DESIGN.md sections 6, 7, 8):
 *  - the focus ring is 2px of --color-focus with a 1px offset, on every
 *    interactive element, and is never removed;
 *  - motion answers an action: colour changes take --dur-fast on --ease-out,
 *    and nothing transitions at all under prefers-reduced-motion;
 *  - a control never shrinks below its hit target inside a flex row, which is
 *    what `flex: none` is for.
 */

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-1";

/** Focus ring drawn inside the box, for rows and cells in a dense table. */
export const focusRingInset =
  "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:-outline-offset-2";

/** Quiet colour transition. Reduced motion removes it outright. */
export const quietTransition =
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none";

/** Quiet transform transition (switch thumb only). */
export const quietTransform =
  "transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none";

/** A control never shrinks below its hit target inside a flex row. */
export const noShrink = "flex-none";

/** The only transform in the UI: a button presses down slightly on click.
 *  Reduced motion holds it at rest. */
export const pressScale =
  "active:scale-[var(--press-scale)] motion-reduce:active:scale-100";

/** The one uppercase type in the product: the brand guide's caption step
 *  (11px / 1.4) in Lato, tracked out, in tertiary ink. It labels a group of
 *  rows or a table column, never a paragraph (docs/DESIGN.md section 4). */
export const sectionLabel = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-caption)] font-semibold uppercase",
  "leading-[var(--leading-caption)] tracking-[var(--tracking-label)]",
  "text-[var(--color-text-faint)]",
].join(" ");

/** The slab. Every title in the product is set in it, in the near-black, with
 *  the guide's -0.01em tracking. Zilla Slab ships at 600 and 700 only, so a
 *  heading never asks for a weight that would have to be synthesised. */
export const headingFont =
  "font-[family-name:var(--font-heading)] tracking-[var(--tracking-title)] text-[var(--color-heading)]";

/** Prose leading: the guide sets body copy at 15/1.65. Controls and rows keep
 *  --leading-normal, where 1.65 would push a label off a 32px control. */
export const proseLeading = "leading-[var(--leading-body)]";

/** Disabled: muted, and the cursor says so. Never pointer-events: none, which
 *  would also kill the tooltip that explains why the control is disabled. */
export const disabledState =
  "disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed";
