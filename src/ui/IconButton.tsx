import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/ui/cn";

const iconButtonVariants = cva(
  [
    "inline-flex items-center justify-center shrink-0",
    "rounded-[var(--radius-md)]",
    "transition-colors disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
  ].join(" "),
  {
    variants: {
      variant: {
        ghost: "bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface)]",
        secondary:
          "bg-[var(--color-surface-raised)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]",
        danger: "bg-transparent text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]",
      },
      size: {
        sm: "w-[var(--space-8)] h-[var(--space-8)]",
        md: "w-[var(--space-9)] h-[var(--space-9)]",
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
