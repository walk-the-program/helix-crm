import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleNotch } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, noShrink, pressScale, quietTransition } from "@/ui/styles";

/**
 * Four variants and no more (docs/DESIGN.md §9).
 *
 *   primary     -> the solid near-black control. One per screen, for the thing
 *                  the owner came to do. Inverts to near-white in the dark
 *                  theme, which is what a native dark app does with its
 *                  default button.
 *   secondary   -> white, hairline, full-strength ink. The default. This is
 *                  the macOS push button.
 *   ghost       -> no fill, no border, secondary ink. Toolbars and row
 *                  actions.
 *   destructive -> text-only red. It gets a fill only when it is the confirm
 *                  button inside a dialog, which is what `solid` is for.
 *
 * `danger` is kept as an alias of `destructive` because feature code passes it
 * today; both spell the same variant.
 *
 * Height is --control-h (32/28) or --control-h-sm (28/24), never a hard pixel,
 * so density is a token change rather than an edit here.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-[var(--space-2)]",
    noShrink,
    "whitespace-nowrap no-underline",
    "rounded-[var(--radius-md)] font-medium",
    "leading-[var(--leading-tight)]",
    quietTransition,
    pressScale,
    disabledState,
    focusRing,
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--color-accent)] text-[var(--color-accent-text)]",
          "enabled:hover:bg-[var(--color-accent-hover)]",
        ].join(" "),
        secondary: [
          "bg-[var(--color-surface)] text-[var(--color-text)]",
          "border border-[var(--color-border-strong)]",
          "enabled:hover:bg-[var(--color-hover)]",
        ].join(" "),
        ghost: [
          "bg-transparent text-[var(--color-text-muted)]",
          "enabled:hover:bg-[var(--color-hover)] enabled:hover:text-[var(--color-text)]",
        ].join(" "),
        destructive: [
          "bg-transparent text-[var(--color-danger-ink)]",
          "enabled:hover:bg-[var(--color-danger-soft)]",
        ].join(" "),
        danger: [
          "bg-transparent text-[var(--color-danger-ink)]",
          "enabled:hover:bg-[var(--color-danger-soft)]",
        ].join(" "),
      },
      size: {
        sm: "h-[var(--control-h-sm)] px-[var(--space-3)] text-[length:var(--text-sm)]",
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

/**
 * The one case where destructive is a fill rather than text: the confirm
 * button of a destructive dialog, where the red has already been explained by
 * the sentence above it.
 */
const solidDestructive = [
  "bg-[var(--color-danger)] text-[var(--color-surface)]",
  "enabled:hover:opacity-90",
].join(" ");

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    /** The progressive form of the same verb: "Import" -> "Importing…". */
    loadingLabel?: ReactNode;
    iconLeft?: ReactNode;
    iconRight?: ReactNode;
    /** Destructive only: draw it as a fill. For a dialog's confirm button. */
    solid?: boolean;
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
      solid,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    // A loading button never shows a spinner alone: it keeps a label, and the
    // caller is expected to pass the progressive form of its own verb.
    const label = loading ? (loadingLabel ?? children) : children;
    const destructive = variant === "danger" || variant === "destructive";

    return (
      <button
        ref={ref}
        className={cn(
          buttonVariants({ variant, size }),
          solid && destructive && solidDestructive,
          className,
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <CircleNotch
            size={16}
            weight="bold"
            className="animate-spin motion-reduce:animate-none"
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
