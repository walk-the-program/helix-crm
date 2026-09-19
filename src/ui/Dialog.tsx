import { forwardRef, useState } from "react";
import type { ComponentPropsWithoutRef, ElementRef, HTMLAttributes, ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/Button";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

const sizeClasses = {
  sm: "max-w-[420px]",
  md: "max-w-[560px]",
  lg: "max-w-[800px]",
} as const;

export const DialogContent = forwardRef<
  ElementRef<typeof RadixDialog.Content>,
  ComponentPropsWithoutRef<typeof RadixDialog.Content> & { size?: keyof typeof sizeClasses }
>(({ className, size = "md", children, ...props }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-text)] opacity-40" />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-var(--space-6))]",
        sizeClasses[size],
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
            "inline-flex items-center justify-center",
            "w-[var(--space-8)] h-[var(--space-8)] rounded-[var(--radius-md)]",
            "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]",
            "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
          )}
        >
          <X className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
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
    className={cn("text-[length:var(--text-lg)] font-semibold text-[var(--color-text)]", className)}
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
    className={cn("text-[length:var(--text-sm)] text-[var(--color-text-muted)]", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-[var(--space-6)] flex items-center justify-end gap-[var(--space-2)]",
        className,
      )}
      {...props}
    />
  );
}

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
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
