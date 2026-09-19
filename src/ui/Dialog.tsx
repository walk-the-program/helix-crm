import { forwardRef, useState } from "react";
import type { ComponentPropsWithoutRef, ElementRef, HTMLAttributes, ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/Button";
import { focusRing, quietTransition } from "@/ui/styles";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/**
 * 520px for a confirm, 720px for a form (docs/DESIGN.md section 9). `lg` is
 * the reference sheet: wider than a form, still not the whole window.
 */
const sizeClasses = {
  sm: "max-w-[520px]",
  md: "max-w-[720px]",
  lg: "max-w-[880px]",
} as const;

export const DialogContent = forwardRef<
  ElementRef<typeof RadixDialog.Content>,
  ComponentPropsWithoutRef<typeof RadixDialog.Content> & { size?: keyof typeof sizeClasses }
>(({ className, size = "md", children, ...props }, ref) => (
  <RadixDialog.Portal>
    {/* The scrim is its own token. Painting --color-text at 40% opacity put a
        second, slightly different scrim in the product. */}
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay)]" />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-var(--space-6))]",
        sizeClasses[size],
        "max-h-[calc(100vh-var(--space-9))] overflow-y-auto",
        "rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-surface-raised)] shadow-[var(--shadow-lg)]",
        "p-[var(--space-6)]",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      {children}
      <RadixDialog.Close asChild>
        <button
          type="button"
          aria-label="Close"
          className={cn(
            "absolute right-[var(--space-4)] top-[var(--space-4)]",
            "inline-flex flex-none items-center justify-center",
            "w-[var(--control-h-sm)] h-[var(--control-h-sm)] rounded-[var(--radius-md)]",
            "text-[var(--color-text-muted)]",
            "enabled:hover:bg-[var(--color-hover)] enabled:hover:text-[var(--color-text)]",
            quietTransition,
            focusRing,
          )}
        >
          <X className="w-[20px] h-[20px]" aria-hidden="true" />
        </button>
      </RadixDialog.Close>
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mb-[var(--space-4)] pr-[var(--space-8)] flex flex-col gap-[var(--space-1)]", className)}
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
      "text-[length:var(--text-xl)] font-semibold text-[var(--color-text)]",
      "leading-[var(--leading-tight)]",
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

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-[var(--space-6)] flex flex-wrap items-center justify-end gap-[var(--space-2)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Cancel sits to the left of the confirm, and it is the first focusable thing
 * in the dialog: the safe action is the one the keyboard lands on.
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
            variant={destructive ? "danger" : "primary"}
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
