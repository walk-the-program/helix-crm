import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "@/ui/cn";
import { focusRing, quietTransition } from "@/ui/styles";

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<
  ElementRef<typeof RadixTabs.List>,
  ComponentPropsWithoutRef<typeof RadixTabs.List>
>(({ className, ...props }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn(
      "flex items-center gap-[var(--space-1)]",
      "border-b border-[var(--color-border)]",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

/**
 * The selected tab is marked in ink, not in the accent. Tabs are chrome: they
 * are on screen whatever the state of the owner's queue, and the accent means
 * "this needs you" and nothing else (docs/DESIGN.md section 5).
 */
export const TabsTrigger = forwardRef<
  ElementRef<typeof RadixTabs.Trigger>,
  ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      "inline-flex flex-none items-center h-[var(--control-h)] px-[var(--space-3)]",
      "text-[length:var(--text-base)] text-[var(--color-text-muted)]",
      "border-b-2 border-transparent -mb-px",
      "data-[state=active]:text-[var(--color-text)] data-[state=active]:font-medium",
      "data-[state=active]:border-[var(--color-text)]",
      "enabled:hover:text-[var(--color-text)]",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      quietTransition,
      focusRing,
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  ElementRef<typeof RadixTabs.Content>,
  ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(({ className, ...props }, ref) => (
  <RadixTabs.Content ref={ref} className={cn("pt-[var(--space-4)]", focusRing, className)} {...props} />
));
TabsContent.displayName = "TabsContent";
