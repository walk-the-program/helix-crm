import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, noShrink, pressScale, quietTransition } from "@/ui/styles";

/**
 * An icon-only button. It exists only inside a row's action cluster, and it
 * always carries an aria-label and a title (docs/DESIGN.md section 10).
 *
 * The box is --control-h-sm / --control-h, never a hard pixel, and it carries
 * `flex: none` so a flex row cannot squeeze it under the hit-target floor —
 * the 27px defect design/review.md finding 7 caught in the comps.
 */
const iconButtonVariants = cva(
  [
    "inline-flex items-center justify-center",
    noShrink,
    "rounded-[var(--radius-md)]",
    quietTransition,
    pressScale,
    disabledState,
    focusRing,
  ].join(" "),
  {
    variants: {
      variant: {
        ghost: [
          "bg-transparent text-[var(--color-text-muted)]",
          "enabled:hover:bg-[var(--color-hover)] enabled:hover:text-[var(--color-text)]",
          "enabled:active:bg-[var(--color-selected)]",
        ].join(" "),
        secondary: [
          "bg-[var(--color-surface)] text-[var(--color-text)]",
          "border border-[var(--color-border)]",
          "enabled:hover:bg-[var(--color-hover)] enabled:active:bg-[var(--color-selected)]",
        ].join(" "),
        danger: [
          "bg-transparent text-[var(--color-danger-ink)]",
          "enabled:hover:bg-[var(--color-danger-soft)] enabled:active:bg-[var(--color-danger-soft)]",
        ].join(" "),
      },
      size: {
        sm: "w-[var(--control-h-sm)] h-[var(--control-h-sm)]",
        md: "w-[var(--control-h)] h-[var(--control-h)]",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  },
);

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  VariantProps<typeof iconButtonVariants> & {
    label: string;
    icon?: ReactNode;
    children?: ReactNode;
  };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, label, icon, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cn(iconButtonVariants({ variant, size }), className)}
        {...props}
      >
        {icon ?? children}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
