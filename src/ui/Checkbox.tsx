import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/ui/cn";

export function Checkbox(props: {
  checked: boolean | "indeterminate";
  onCheckedChange: (c: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const { checked, onCheckedChange, disabled, id, ariaLabel, className } = props;

  return (
    <RadixCheckbox.Root
      id={id}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        "w-[var(--space-5)] h-[var(--space-5)] rounded-[var(--radius-sm)]",
        "border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)]",
        "data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)]",
        "data-[state=indeterminate]:bg-[var(--color-accent)] data-[state=indeterminate]:border-[var(--color-accent)]",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
        className,
      )}
    >
      <RadixCheckbox.Indicator className="inline-flex items-center justify-center text-[var(--color-accent-text)]">
        {checked === "indeterminate" ? (
          <Minus className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
        ) : (
          <Check className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
