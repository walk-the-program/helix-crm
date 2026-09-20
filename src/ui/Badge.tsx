import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/ui/cn";

/**
 * A tag: a flat tint with its own dark text partner, a hard edge, 12px type,
 * sentence case (docs/DESIGN.md §9 "Tags").
 *
 * Square, not a pill — `--radius-full` resolves to 0 under the brand guide's
 * corner language, so every badge in the product is a rectangle.
 *
 * The three brand tones (`brand`, `secondary`, `highlight`) are the brand's
 * own colours mixed into white at 10% — but as of round 3 their LABEL is plain
 * ink, not the matching brand ink. Walker's rule after using 0.1.0 is that no
 * text in the product is purple, blue or yellow, and a decorative tag is the
 * easiest place for that to creep back in: a tint says which tag it is, and
 * the word does not have to be tinted as well. `accent` and `info` keep the
 * informational pair, and danger, success and warning keep their muted
 * pastels — those four MEAN something, and the colour is the meaning.
 *
 * The label is always the matching `-ink`; the bare semantic value
 * (`--color-danger`) is a fill for light text and is used only by `solid`.
 * A tag is never colour alone: the word is always in it.
 *
 * Sentence case and not capitals: a stage name is user-typed ("Estimate sent"),
 * and shouting it back at the owner is both wrong and unreadable. The 11px
 * tracked capitals in this product belong to section labels only.
 */
const toneClasses = {
  neutral: "bg-[var(--color-accent-soft)] text-[var(--color-text-muted)]",
  accent: "bg-[var(--color-info-soft)] text-[var(--color-info-ink)]",
  info: "bg-[var(--color-info-soft)] text-[var(--color-info-ink)]",
  /** The brand primary at 10%, labelled in ink. */
  brand: "bg-[var(--color-brand-primary-soft)] text-[var(--color-text)]",
  /** The brand secondary at 10%, labelled in ink — never the purple. */
  secondary: "bg-[var(--color-brand-secondary-soft)] text-[var(--color-text)]",
  /** The brand accent at 10%, labelled in ink — never the yellow. A detail,
   *  never a background, which is why the tint is nearly white. */
  highlight: "bg-[var(--color-brand-accent-soft)] text-[var(--color-text)]",
  success: "bg-[var(--color-success-soft)] text-[var(--color-success-ink)]",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning-ink)]",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger-ink)]",
} as const;

/**
 * The filled form, for a count that has to read at a glance from the sidebar:
 * ink on the quiet neutral tint, or the semantic ink inverted onto its own
 * colour. There is no loud filled badge in this product.
 */
const solidToneClasses: Record<keyof typeof toneClasses, string> = {
  neutral: "bg-[var(--color-accent-soft)] text-[var(--color-text-muted)]",
  accent: "bg-[var(--color-accent)] text-[var(--color-accent-text)]",
  info: "bg-[var(--color-accent)] text-[var(--color-accent-text)]",
  brand: "bg-[var(--color-accent)] text-[var(--color-accent-text)]",
  secondary: "bg-[var(--color-brand-secondary-soft)] text-[var(--color-text)]",
  highlight: "bg-[var(--color-brand-accent-soft)] text-[var(--color-text)]",
  success: "bg-[var(--color-success)] text-[var(--color-surface)]",
  warning: "bg-[var(--color-warning)] text-[var(--color-surface)]",
  danger: "bg-[var(--color-danger)] text-[var(--color-surface)]",
};

export function Badge(props: {
  children: ReactNode;
  tone?: keyof typeof toneClasses;
  dotColor?: string;
  /** Count pills: tabular figures and a minimum width so digits do not jump. */
  pill?: boolean;
  /** Filled rather than tinted. Reserved for a count that must read instantly. */
  solid?: boolean;
  className?: string;
}) {
  const { children, tone = "neutral", dotColor, pill, solid, className } = props;
  const dotStyle: CSSProperties | undefined = dotColor ? { background: dotColor } : undefined;

  // A stage tag is the stage colour at 14% behind the stage's own ink, with a
  // 7px dot in the stage colour. Stages are user-created, so the tint is mixed
  // at render time rather than read from a token; tokens.css documents the same
  // pairing for the eight defaults.
  const stage = Boolean(dotColor) && tone === "neutral" && !solid;
  const stageStyle: CSSProperties | undefined = stage
    ? {
        background: `color-mix(in srgb, ${dotColor} 14%, var(--color-surface))`,
        color: dotColor,
      }
    : undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[var(--space-1)]",
        "px-[var(--space-2)] py-[1px]",
        "text-[length:var(--text-xs)] font-medium leading-[var(--leading-normal)]",
        "whitespace-nowrap",
        pill && "min-w-[1.5rem] justify-center tabular-nums",
        solid ? solidToneClasses[tone] : toneClasses[tone],
        className,
      )}
      style={stage ? stageStyle : undefined}
    >
      {dotColor ? (
        <span
          className="w-[7px] h-[7px] flex-none"
          style={dotStyle}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}
