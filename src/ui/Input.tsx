import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, quietTransition } from "@/ui/styles";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

/**
 * Field height --control-h, 1px --color-border, --radius-sm, --color-surface
 * fill, 16px text (docs/DESIGN.md section 9, "Inputs").
 *
 * An invalid field turns its BORDER --color-danger. It does not recolour the
 * focus ring: the ring is --color-focus and means "the keyboard is here",
 * nothing else.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full h-[var(--control-h)] rounded-[var(--radius-sm)]",
          "bg-[var(--color-surface)] text-[var(--color-text)]",
          "border border-[var(--color-border)]",
          "px-[var(--space-3)] text-[length:var(--text-base)]",
          "placeholder:text-[var(--color-text-faint)]",
          quietTransition,
          focusRing,
          disabledState,
          invalid && "border-[var(--color-danger)]",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
