import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/ui/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full min-h-[var(--space-9)] rounded-[var(--radius-md)]",
          "bg-[var(--color-surface-raised)] text-[var(--color-text)]",
          "border border-[var(--color-border)]",
          "px-[var(--space-3)] text-[length:var(--text-sm)]",
          "placeholder:text-[var(--color-text-faint)]",
          "transition-colors",
          "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
          "disabled:opacity-50 disabled:pointer-events-none",
          invalid &&
            "border-[var(--color-danger)] focus-visible:outline-[var(--color-danger)]",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
