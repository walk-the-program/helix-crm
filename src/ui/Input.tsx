import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, quietTransition } from "@/ui/styles";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  /** The soft grey rounded field of a macOS search bar, for search only. */
  search?: boolean;
};

/**
 * A macOS text field: white fill, one visible hairline
 * (--color-border-strong), --radius-md, --control-h tall, body type
 * (docs/DESIGN.md §9 "Fields").
 *
 * Focus is the system-blue ring and nothing else — the border does not thicken
 * and the field does not change colour, because a field that redraws itself on
 * focus reads as a web form.
 *
 * An invalid field turns its BORDER --color-danger. It never recolours the
 * ring: the ring means "the keyboard is here", and nothing else.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, search, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full h-[var(--control-h)] rounded-[var(--radius-md)]",
          "text-[var(--color-text)]",
          "px-[var(--space-3)] text-[length:var(--text-base)]",
          "placeholder:text-[var(--color-text-faint)]",
          search
            ? "border-0 bg-[var(--color-accent-soft)] rounded-[var(--radius-full)]"
            : "border border-[var(--color-border-strong)] bg-[var(--color-surface)]",
          quietTransition,
          focusRing,
          disabledState,
          invalid && "border border-[var(--color-danger)]",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
