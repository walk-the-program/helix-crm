import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, noShrink, quietTransition } from "@/ui/styles";

/**
 * Four variants and no more (docs/DESIGN.md section 9).
 *
 *   primary   -> the accent fill. One per screen, for the thing he came to do.
 *   secondary -> the "Default" button of the contract: surface fill, 1px
 *                border, full-strength ink. Everything else.
 *   ghost     -> the "Quiet" button: no fill, no border, muted ink. Row
 *                actions and toolbars.
 *   danger    -> a confirmed destructive action inside a dialog.
 *
 * The prop names are the ones the feature code already passes; only the looks
 * moved to match the contract.
 *
 * Height is --control-h (36/32) or --control-h-sm (32/28) and never a hard
 * pixel, so density is a token change rather than an edit here.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-[var(--space-2)]",
    noShrink,
    "whitespace-nowrap no-underline",
    "rounded-[var(--radius-md)] font-medium",
    "leading-[var(--leading-tight)]",
    quietTransition,
    disabledState,
    focusRing,
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--color-accent)] text-[var(--color-accent-text)]",
          "enabled:hover:bg-[var(--color-accent-hover)] enabled:active:bg-[var(--color-accent-hover)]",
        ].join(" "),
        secondary: [
          "bg-[var(--color-surface)] text-[var(--color-text)]",
          "border border-[var(--color-border)]",
          "enabled:hover:bg-[var(--color-hover)] enabled:active:bg-[var(--color-selected)]",
        ].join(" "),
        ghost: [
          "bg-transparent text-[var(--color-text-muted)]",
          "enabled:hover:bg-[var(--color-hover)] enabled:hover:text-[var(--color-text)]",
          "enabled:active:bg-[var(--color-selected)]",
        ].join(" "),
        danger: [
          "bg-[var(--color-danger)] text-[var(--color-accent-text)]",
          "enabled:hover:bg-[var(--color-danger-ink)] enabled:active:bg-[var(--color-danger-ink)]",
        ].join(" "),
      },
      size: {
        sm: "h-[var(--control-h-sm)] px-[var(--space-3)] text-[length:var(--text-base)]",
        md: "h-[var(--control-h)] px-[var(--space-4)] text-[length:var(--text-base)]",
        lg: "h-[var(--control-h)] px-[var(--space-5)] text-[length:var(--text-base)]",
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
    /** The progressive form of the same verb: "Import" -> "Importing…". */
    loadingLabel?: ReactNode;
    iconLeft?: ReactNode;
    iconRight?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading,
      loadingLabel,
      iconLeft,
      iconRight,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    // A loading button never shows a spinner alone: it keeps a label, and the
    // caller is expected to pass the progressive form of its own verb.
    const label = loading ? (loadingLabel ?? children) : children;

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
            className="w-[16px] h-[16px] animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          iconLeft
        )}
        {label}
        {!loading && iconRight}
      </button>
    );
  },
);
Button.displayName = "Button";
