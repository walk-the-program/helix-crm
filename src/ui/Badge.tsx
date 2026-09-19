import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/ui/cn";

const toneClasses = {
  neutral: "bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)]",
  accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-transparent",
  success: "bg-[var(--color-success-soft)] text-[var(--color-success)] border-transparent",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border-transparent",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-transparent",
} as const;

export function Badge(props: {
  children: ReactNode;
  tone?: keyof typeof toneClasses;
  dotColor?: string;
  className?: string;
}) {
  const { children, tone = "neutral", dotColor, className } = props;
  const dotStyle: CSSProperties | undefined = dotColor ? { background: dotColor } : undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-full)] border",
        "px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] font-medium leading-[var(--leading-tight)]",
        toneClasses[tone],
        className,
      )}
    >
      {dotColor ? (
        <span
          className="w-[var(--space-2)] h-[var(--space-2)] rounded-[var(--radius-full)] shrink-0"
          style={dotStyle}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}
