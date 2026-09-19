import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, quietTransition } from "@/ui/styles";

export const SelectPrimitive = RadixSelect;

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/**
 * The trigger matches Input exactly: --control-h, --radius-sm,
 * --color-surface, 16px text.
 *
 * The highlighted item is --color-selected, NOT the accent. An open menu
 * highlight is not "this needs you" (docs/DESIGN.md section 5), and
 * --color-hover is within a point of --color-surface-raised in the dark theme,
 * so it would have made the keyboard highlight invisible at 10pm.
 */
export function Select(props: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const { value, onValueChange, options, placeholder, disabled, invalid, id, className, ariaLabel } =
    props;

  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex w-full h-[var(--control-h)] flex-none items-center justify-between gap-[var(--space-2)]",
          "rounded-[var(--radius-sm)] border border-[var(--color-border)]",
          "bg-[var(--color-surface)] text-[var(--color-text)]",
          "px-[var(--space-3)] text-[length:var(--text-base)]",
          "enabled:hover:bg-[var(--color-hover)]",
          quietTransition,
          disabledState,
          focusRing,
          "data-[placeholder]:text-[var(--color-text-faint)]",
          invalid && "border-[var(--color-danger)]",
          className,
        )}
      >
        <span className="truncate text-left">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className="flex-none text-[var(--color-text-muted)]">
          <ChevronDown className="w-[16px] h-[16px]" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 overflow-hidden rounded-[var(--radius-lg)]",
            "border border-[var(--color-border)] bg-[var(--color-surface-raised)]",
            "shadow-[var(--shadow-md)]",
          )}
        >
          <RadixSelect.ScrollUpButton className="flex items-center justify-center h-[var(--space-6)] text-[var(--color-text-muted)]">
            <ChevronUp className="w-[16px] h-[16px]" aria-hidden="true" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-[var(--space-1)]">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex min-h-[var(--control-h-sm)] cursor-default items-center",
                  "rounded-[var(--radius-sm)] pl-[var(--space-7)] pr-[var(--space-3)]",
                  "text-[length:var(--text-base)] text-[var(--color-text)]",
                  "data-[highlighted]:bg-[var(--color-selected)] data-[highlighted]:outline-none",
                  "data-[disabled]:opacity-50",
                )}
              >
                <RadixSelect.ItemIndicator className="absolute left-[var(--space-2)] inline-flex items-center text-[var(--color-text-muted)]">
                  <Check className="w-[16px] h-[16px]" aria-hidden="true" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex items-center justify-center h-[var(--space-6)] text-[var(--color-text-muted)]">
            <ChevronDown className="w-[16px] h-[16px]" aria-hidden="true" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
