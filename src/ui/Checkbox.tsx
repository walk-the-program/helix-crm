import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Minus } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { focusRing, quietTransition } from "@/ui/styles";

/**
 * The box people see is 16px. The thing they can hit is --control-h-sm
 * (32px comfortable, 28px compact), which is the hit-target floor in
 * docs/DESIGN.md section 7 — a bare 18px box is not clickable by a
 * two-finger typist with a trackpad.
 *
 * A ticked box is ink, not the accent: selecting rows is not "this needs you".
 * `tone="success"` is the completed-task tick, which the contract does colour
 * (--color-success, section 5).
 */
export function Checkbox(props: {
  checked: boolean | "indeterminate";
  onCheckedChange: (c: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  tone?: "default" | "success";
  className?: string;
}) {
  const { checked, onCheckedChange, disabled, id, ariaLabel, tone = "default", className } = props;

  const filled =
    tone === "success"
      ? [
          "group-data-[state=checked]:bg-[var(--color-success)]",
          "group-data-[state=checked]:border-[var(--color-success)]",
          "group-data-[state=indeterminate]:bg-[var(--color-success)]",
          "group-data-[state=indeterminate]:border-[var(--color-success)]",
        ]
      : [
          "group-data-[state=checked]:bg-[var(--color-text)]",
          "group-data-[state=checked]:border-[var(--color-text)]",
          "group-data-[state=indeterminate]:bg-[var(--color-text)]",
          "group-data-[state=indeterminate]:border-[var(--color-text)]",
        ];

  return (
    <RadixCheckbox.Root
      id={id}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "group inline-flex flex-none items-center justify-center",
        "w-[var(--control-h-sm)] h-[var(--control-h-sm)] rounded-[var(--radius-sm)]",
        "bg-transparent",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        focusRing,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex items-center justify-center",
          "w-[16px] h-[16px] rounded-[var(--radius-sm)]",
          "border border-[var(--color-border-strong)] bg-[var(--color-surface)]",
          "text-[var(--color-surface)]",
          quietTransition,
          ...filled,
        )}
      >
        <RadixCheckbox.Indicator className="inline-flex items-center justify-center">
          {checked === "indeterminate" ? (
            <Minus size={12} weight="bold" aria-hidden="true" />
          ) : (
            <Check size={12} weight="bold" aria-hidden="true" />
          )}
        </RadixCheckbox.Indicator>
      </span>
    </RadixCheckbox.Root>
  );
}
