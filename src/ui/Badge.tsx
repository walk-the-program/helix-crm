import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/ui/cn";

/**
 * Accent-coloured TEXT is --color-accent-ink, never --color-accent: #C1440E
 * measures 4.44:1 on the canvas and fails AA (tokens.css, docs/DESIGN.md
 * section 5). The same applies to every semantic tone — the fill is the
 * `-soft` tint and the label is the matching `-ink`.
 *
 * --radius-sm by default; --radius-full is for count pills only, which is what
 * `pill` is for. A badge is never colour alone: the word is always there.
 */
const toneClasses = {
  neutral:
    "bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)]",
  accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)] border-transparent",
  success: "bg-[var(--color-success-soft)] text-[var(--color-success-ink)] border-transparent",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning-ink)] border-transparent",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger-ink)] border-transparent",
} as const;

/**
 * The filled form, for a count pill: --color-accent with --color-accent-text
 * when the count is a "needs you" count, and --color-border with
 * --color-text-muted when it is not (docs/DESIGN.md section 9, "Badges").
 */
const solidToneClasses: Record<keyof typeof toneClasses, string> = {
  neutral: "bg-[var(--color-border)] text-[var(--color-text-muted)] border-transparent",
  accent: "bg-[var(--color-accent)] text-[var(--color-accent-text)] border-transparent",
  success: "bg-[var(--color-success)] text-[var(--color-accent-text)] border-transparent",
  warning: "bg-[var(--color-warning)] text-[var(--color-accent-text)] border-transparent",
  danger: "bg-[var(--color-danger)] text-[var(--color-accent-text)] border-transparent",
};

export function Badge(props: {
  children: ReactNode;
  tone?: keyof typeof toneClasses;
  dotColor?: string;
  /** Count pills only: --radius-full. Everything else stays --radius-sm. */
  pill?: boolean;
  /** Filled rather than tinted. The "needs you" count pill is `accent` + `solid`. */
  solid?: boolean;
  className?: string;
}) {
  const { children, tone = "neutral", dotColor, pill, solid, className } = props;
  const dotStyle: CSSProperties | undefined = dotColor ? { background: dotColor } : undefined;

  // A stage badge is the stage colour at 12% behind full-strength ink, with an
  // 8px dot in the stage colour itself (docs/DESIGN.md section 9). The stage
  // name is always spelled out beside it: stage colour is never the only cue.
  // Stages are user-created, so the tint is mixed at render time rather than
  // read from a token — tokens.css documents the same 12% for its own ramp.
  const stage = Boolean(dotColor) && tone === "neutral" && !solid;
  const stageStyle: CSSProperties | undefined = stage
    ? {
        background: `color-mix(in srgb, ${dotColor} 12%, var(--color-surface))`,
        borderColor: "transparent",
      }
    : undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[var(--space-1)] border",
        pill ? "rounded-[var(--radius-full)]" : "rounded-[var(--radius-sm)]",
        "px-[var(--space-2)] py-[var(--space-1)]",
        "text-[length:var(--text-xs)] font-medium leading-[var(--leading-tight)]",
        "tabular-nums whitespace-nowrap",
        solid ? solidToneClasses[tone] : toneClasses[tone],
        stage && "text-[var(--color-text)]",
        className,
      )}
      style={stageStyle}
    >
      {dotColor ? (
        <span
          className="w-[8px] h-[8px] rounded-[var(--radius-full)] flex-none"
          style={dotStyle}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}
