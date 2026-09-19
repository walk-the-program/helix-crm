import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/ui/cn";

/**
 * A tag: a muted pastel fill with its own dark text partner, a pill radius,
 * 12px type, sentence case (docs/DESIGN.md §9 "Tags").
 *
 * Every tone is a washed-out pastel — pale blue, green, yellow, red, and the
 * two derived tints — and the label is always the matching `-ink`. The bare
 * semantic value (`--color-danger`) is a fill for white text and is not used
 * here. A tag is never colour alone: the word is always in it.
 *
 * Sentence case and not capitals: a stage name is user-typed ("Estimate sent"),
 * and shouting it back at the owner is both wrong and unreadable. The 11px
 * tracked capitals in this product belong to section labels only.
 */
const toneClasses = {
  neutral: "bg-[var(--color-accent-soft)] text-[var(--color-text-muted)]",
  accent: "bg-[var(--color-info-soft)] text-[var(--color-info-ink)]",
  info: "bg-[var(--color-info-soft)] text-[var(--color-info-ink)]",
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
  info: "bg-[var(--color-info)] text-[var(--color-surface)]",
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
        "rounded-[var(--radius-full)]",
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
          className="w-[7px] h-[7px] rounded-[var(--radius-full)] flex-none"
          style={dotStyle}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}
