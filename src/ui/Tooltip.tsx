import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "@/ui/cn";

export const TooltipProvider = RadixTooltip.Provider;

export function Tooltip(props: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const { content, children, side = "top" } = props;

  return (
    <RadixTooltip.Root delayDuration={200}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 max-w-[280px] rounded-[var(--radius-md)]",
            "border border-[var(--color-border)]",
            "bg-[var(--color-surface-raised)] text-[var(--color-text)]",
            "px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)]",
            "leading-[var(--leading-tight)] shadow-[var(--shadow-md)]",
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-[var(--color-surface-raised)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
