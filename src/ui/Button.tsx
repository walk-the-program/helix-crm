import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/ui/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-[var(--space-2)]",
    "rounded-[var(--radius-md)] font-medium",
    "text-[length:var(--text-sm)] leading-[var(--leading-normal)]",
    "transition-colors disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-accent)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-hover)]",
        secondary:
          "bg-[var(--color-surface-raised)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]",
        ghost: "bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface)]",
        danger: "bg-[var(--color-danger)] text-[var(--color-accent-text)] hover:opacity-90",
      },
      size: {
        sm: "min-h-[var(--space-8)] px-[var(--space-3)] text-[length:var(--text-sm)]",
        md: "min-h-[var(--space-9)] px-[var(--space-4)] text-[length:var(--text-sm)]",
        lg: "min-h-[var(--space-9)] px-[var(--space-5)] py-[var(--space-2)] text-[length:var(--text-base)]",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    iconLeft?: ReactNode;
    iconRight?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, loading, iconLeft, iconRight, disabled, children, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <Loader2
            className="w-[var(--space-4)] h-[var(--space-4)] animate-spin"
            aria-hidden="true"
          />
        ) : (
          iconLeft
        )}
        {children}
        {!loading && iconRight}
      </button>
    );
  },
);
Button.displayName = "Button";
