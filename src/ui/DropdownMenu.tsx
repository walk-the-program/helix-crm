import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { sectionLabel } from "@/ui/styles";

export const DropdownMenu = RadixDropdownMenu.Root;
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof RadixDropdownMenu.Content>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <RadixDropdownMenu.Portal>
    <RadixDropdownMenu.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[200px] overflow-hidden",
        "border border-[var(--color-border)] bg-[var(--color-surface-raised)]",
        "shadow-[var(--shadow-md)] p-[var(--space-1)]",
        // A macOS menu that has a tick anywhere indents every row to the same
        // text origin, so the labels line up down the left edge. Without this
        // a plain item sat 20px left of a checkable one.
        "[&:has([role=menuitemcheckbox])_[role=menuitem]]:pl-[var(--space-7)]",
        "[&:has([role=menuitemcheckbox])_[role=menuitem]]:pr-[var(--space-3)]",
        "[&:has([role=menuitemcheckbox])_[data-menu-label]]:pl-[var(--space-7)]",
        className,
      )}
      {...props}
    />
  </RadixDropdownMenu.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

/**
 * The highlighted item is --color-selected.
 *
 * It was --color-accent-soft, which put "this needs you" orange under the
 * pointer on every menu in the product — the accent means one thing, and a
 * menu highlight is not it (docs/DESIGN.md section 5). --color-hover is the
 * other candidate and it is wrong here: in the dark theme --color-hover sits
 * too close to --color-surface-raised to read as a keyboard highlight.
 *
 * A destructive item is --color-danger-ink, which is the readable weight of
 * danger on a surface; --color-danger is the fill.
 */
export const DropdownMenuItem = forwardRef<
  ElementRef<typeof RadixDropdownMenu.Item>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <RadixDropdownMenu.Item
    ref={ref}
    className={cn(
      "flex min-h-[var(--control-h-sm)] cursor-default items-center gap-[var(--space-2)]",
      "px-[var(--space-3)]",
      "text-[length:var(--text-base)] text-[var(--color-text)]",
      "data-[highlighted]:bg-[var(--color-selected)] data-[highlighted]:outline-none",
      "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
      destructive &&
        "text-[var(--color-danger-ink)] data-[highlighted]:bg-[var(--color-danger-soft)]",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof RadixDropdownMenu.CheckboxItem>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <RadixDropdownMenu.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex min-h-[var(--control-h-sm)] cursor-default items-center gap-[var(--space-2)]",
      "pl-[var(--space-7)] pr-[var(--space-3)]",
      "text-[length:var(--text-base)] text-[var(--color-text)]",
      "data-[highlighted]:bg-[var(--color-selected)] data-[highlighted]:outline-none",
      "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
      className,
    )}
    {...props}
  >
    <RadixDropdownMenu.ItemIndicator className="absolute left-[var(--space-2)] inline-flex items-center text-[var(--color-text-muted)]">
      <Check size={16} weight="bold" aria-hidden="true" />
    </RadixDropdownMenu.ItemIndicator>
    {children}
  </RadixDropdownMenu.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof RadixDropdownMenu.Separator>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>
>(({ className, ...props }, ref) => (
  <RadixDropdownMenu.Separator
    ref={ref}
    className={cn("my-[var(--space-1)] h-px bg-[var(--color-border)]", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export const DropdownMenuLabel = forwardRef<
  ElementRef<typeof RadixDropdownMenu.Label>,
  ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label>
>(({ className, ...props }, ref) => (
  <RadixDropdownMenu.Label
    ref={ref}
    data-menu-label=""
    className={cn("px-[var(--space-3)] py-[var(--space-1)]", sectionLabel, className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";
