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
 * own colours mixed into white at 10%, each with the AA ink partner measured
 * beside it in tokens.css. `accent` and `info` share the primary's pair, which
 * is what makes an informational tag look like it belongs to the chrome.
 * Danger, success and warning keep their muted pastels: they are the only
 * three hues in the product that mean something on their own.
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
  /** The brand primary at 10%: #2C5670 on #F5F7F9, 7.32:1. */
  brand:
    "bg-[var(--color-brand-primary-soft)] text-[var(--color-brand-primary-ink)]",
  /** The brand secondary at 10%: #5F58A6 on #F3F3F9, 5.53:1. */
  secondary:
    "bg-[var(--color-brand-secondary-soft)] text-[var(--color-brand-secondary-ink)]",
  /** The brand accent at 10%. A detail, never a background — which is why the
   *  tint is nearly white: #5A5D18 on #FDFEF6, 6.86:1. */
  highlight:
    "bg-[var(--color-brand-accent-soft)] text-[var(--color-brand-accent-ink)]",
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
  secondary: "bg-[var(--color-brand-secondary-soft)] text-[var(--color-brand-secondary-ink)]",
  highlight: "bg-[var(--color-brand-accent-soft)] text-[var(--color-brand-accent-ink)]",
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
