import type { HTMLAttributes } from "react";
import { cn } from "@/ui/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--color-border)]",
        "bg-[var(--color-surface-raised)] shadow-[var(--shadow-sm)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-[var(--space-3)]",
        "px-[var(--space-5)] py-[var(--space-4)] border-b border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[length:var(--text-base)] font-semibold text-[var(--color-text)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[var(--space-5)]", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-[var(--space-2)]",
        "px-[var(--space-5)] py-[var(--space-4)] border-t border-[var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}
