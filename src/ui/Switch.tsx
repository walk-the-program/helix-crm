import * as RadixSwitch from "@radix-ui/react-switch";
import { cn } from "@/ui/cn";

export function Switch(props: {
  checked: boolean;
  onCheckedChange: (c: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  const { checked, onCheckedChange, disabled, id, ariaLabel } = props;

  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex shrink-0 items-center",
        "w-[var(--space-9)] h-[var(--space-5)] rounded-[var(--radius-full)]",
        "bg-[var(--color-border-strong)] data-[state=checked]:bg-[var(--color-accent)]",
        "transition-colors disabled:opacity-50 disabled:pointer-events-none",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block w-[var(--space-4)] h-[var(--space-4)] rounded-[var(--radius-full)]",
          "bg-[var(--color-surface-raised)] shadow-[var(--shadow-sm)]",
          "translate-x-[var(--space-1)] transition-transform",
          "data-[state=checked]:translate-x-[var(--space-5)]",
        )}
      />
    </RadixSwitch.Root>
  );
}
