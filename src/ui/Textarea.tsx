import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, quietTransition } from "@/ui/styles";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full min-h-[calc(var(--control-h)*2)] rounded-[var(--radius-sm)]",
          "bg-[var(--color-surface)] text-[var(--color-text)]",
          "border border-[var(--color-border)]",
          "px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-base)]",
          "leading-[var(--leading-normal)]",
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
Textarea.displayName = "Textarea";
