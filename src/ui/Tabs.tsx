import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "@/ui/cn";

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<
  ElementRef<typeof RadixTabs.List>,
  ComponentPropsWithoutRef<typeof RadixTabs.List>
>(({ className, ...props }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-[var(--space-1)]",
      "border-b border-[var(--color-border)]",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  ElementRef<typeof RadixTabs.Trigger>,
  ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center min-h-[var(--space-9)] px-[var(--space-3)]",
      "text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
      "border-b-2 border-transparent -mb-px",
      "data-[state=active]:text-[var(--color-text)] data-[state=active]:border-[var(--color-accent)]",
      "hover:text-[var(--color-text)]",
      "disabled:opacity-50 disabled:pointer-events-none",
      "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
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
  <RadixTabs.Content
    ref={ref}
    className={cn(
      "pt-[var(--space-4)]",
      "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
