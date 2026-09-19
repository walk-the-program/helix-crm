import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { cn } from "@/ui/cn";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;

export const PopoverContent = forwardRef<
  ElementRef<typeof RadixPopover.Content>,
  ComponentPropsWithoutRef<typeof RadixPopover.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <RadixPopover.Portal>
    <RadixPopover.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // --radius-lg: a popover is an overlay, and overlays carry the large
        // radius (docs/DESIGN.md section 6).
        "z-50 rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-surface-raised)] shadow-[var(--shadow-md)]",
        "p-[var(--space-4)]",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  </RadixPopover.Portal>
));
PopoverContent.displayName = "PopoverContent";
