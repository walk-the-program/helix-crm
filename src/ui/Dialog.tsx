import { forwardRef, useState } from "react";
import type { ComponentPropsWithoutRef, ElementRef, HTMLAttributes, ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/Button";
import { focusRing, headingFont, quietTransition } from "@/ui/styles";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/**
 * 480px for a confirm, 680px for a form (docs/DESIGN.md §9 "Dialogs"). `lg` is
 * the reference sheet: wider than a form, still not the whole window.
 */
const sizeClasses = {
  sm: "max-w-[480px]",
  md: "max-w-[680px]",
  lg: "max-w-[840px]",
} as const;

/**
 * A floating panel: raised surface, one hairline, --radius-lg, the single
 * ultra-diffuse shadow, over a light scrim. Nothing else is elevated in this
 * product.
 *
 * **It is height-bound.** The content column is capped at
 * `100vh - 2 * --space-9` and scrolls internally, and `DialogHeader` and
 * `DialogFooter` stick to the top and bottom of that scroll box. Without the
 * cap, a form taller than the window ran its footer off-screen and the Save
 * button was unreachable — the settings e2e caught exactly that on the paste
 * dialog. Every call site gets the fix without changing a line, because the
 * pinning is done by the header and footer components rather than by a new
 * wrapper the features would have to adopt.
 */
export const DialogContent = forwardRef<
  ElementRef<typeof RadixDialog.Content>,
  ComponentPropsWithoutRef<typeof RadixDialog.Content> & { size?: keyof typeof sizeClasses }
>(({ className, size = "md", children, ...props }, ref) => (
  <RadixDialog.Portal>
    {/* The scrim is its own token: a light dim, not a black wash. */}
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay)]" />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-var(--space-6))]",
        sizeClasses[size],
        "flex max-h-[calc(100vh-var(--space-9)*2)] flex-col overflow-hidden",
        "border border-[var(--color-border)]",
        "bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--space-6)] py-[var(--space-5)]">
        {children}
      </div>
      <RadixDialog.Close asChild>
        <button
          type="button"
          aria-label="Close"
          className={cn(
            "absolute right-[var(--space-3)] top-[var(--space-3)] z-[2]",
            "inline-flex flex-none items-center justify-center",
            "w-[var(--control-h-sm)] h-[var(--control-h-sm)]",
            "text-[var(--color-text-muted)]",
            "enabled:hover:bg-[var(--color-hover)] enabled:hover:text-[var(--color-text)]",
            quietTransition,
            focusRing,
          )}
        >
          <X size={16} weight="bold" aria-hidden="true" />
        </button>
      </RadixDialog.Close>
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
DialogContent.displayName = "DialogContent";

/** Pinned to the top of the dialog's scroll box; the body scrolls under it. */
export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky top-0 z-[1] -mx-[var(--space-6)] -mt-[var(--space-5)]",
        "mb-[var(--space-4)] px-[var(--space-6)] pb-[var(--space-3)] pt-[var(--space-5)]",
        "bg-[var(--color-surface-raised)]",
        "flex flex-col gap-[var(--space-1)] pr-[var(--space-9)]",
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  ElementRef<typeof RadixDialog.Title>,
  ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...props }, ref) => (
  <RadixDialog.Title
    ref={ref}
    className={cn(
      headingFont,
      "text-[length:var(--text-subhead)] font-bold",
      "leading-[var(--leading-subhead)]",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  ElementRef<typeof RadixDialog.Description>,
  ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(({ className, ...props }, ref) => (
  <RadixDialog.Description
    ref={ref}
    className={cn("text-[length:var(--text-base)] text-[var(--color-text-muted)]", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

/**
 * Pinned to the bottom of the dialog's scroll box, so the confirm button is
 * reachable however tall the form is. A hairline above it appears only when
 * there is something scrolled underneath.
 */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-[1] -mx-[var(--space-6)] -mb-[var(--space-5)]",
        "mt-[var(--space-6)] px-[var(--space-6)] pb-[var(--space-5)] pt-[var(--space-3)]",
        "bg-[var(--color-surface-raised)] border-t border-[var(--color-border)]",
        "flex flex-wrap items-center justify-end gap-[var(--space-2)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Cancel sits to the left of the confirm, and it is the first focusable thing
 * in the dialog: the safe action is the one the keyboard lands on.
 *
 * A destructive confirm is the one place a red FILL is allowed — the sentence
 * above it has already explained what the red means.
 */
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const {
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive,
    onConfirm,
  } = props;
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            solid={destructive}
            onClick={handleConfirm}
            loading={pending}
            loadingLabel={`${confirmLabel}…`}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
