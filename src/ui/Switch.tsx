import * as RadixSwitch from "@radix-ui/react-switch";
import { cn } from "@/ui/cn";
import { focusRing, quietTransform, quietTransition } from "@/ui/styles";

/**
 * A 38x22 track inside a --control-h-sm hit target, so the switch clears the
 * 32/28px floor without drawing a 32px-tall pill.
 *
 * "On" is ink, not the accent. A setting that is switched on is not asking for
 * the owner's attention, and the accent means exactly one thing
 * (docs/DESIGN.md section 5).
 */
export function Switch(props: {
  checked: boolean;
  onCheckedChange: (c: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const { checked, onCheckedChange, disabled, id, ariaLabel, className } = props;

  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "group relative inline-flex flex-none items-center",
        "w-[38px] h-[var(--control-h-sm)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        focusRing,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2",
          "h-[22px]",
          "bg-[var(--color-border-strong)]",
          "group-data-[state=checked]:bg-[var(--color-text)]",
          quietTransition,
        )}
      />
      <RadixSwitch.Thumb
        className={cn(
          "pointer-events-none absolute top-1/2 left-[2px] -translate-y-1/2",
          "block w-[18px] h-[18px]",
          "bg-[var(--color-surface)] border border-[var(--color-border)]",
          "data-[state=checked]:translate-x-[16px]",
          quietTransform,
        )}
      />
    </RadixSwitch.Root>
  );
}
