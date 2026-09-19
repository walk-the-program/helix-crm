import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/ui/cn";

export const SelectPrimitive = RadixSelect;

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

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
          "flex w-full min-h-[var(--space-9)] items-center justify-between gap-[var(--space-2)]",
          "rounded-[var(--radius-md)] border border-[var(--color-border)]",
          "bg-[var(--color-surface-raised)] text-[var(--color-text)]",
          "px-[var(--space-3)] text-[length:var(--text-sm)]",
          "disabled:opacity-50 disabled:pointer-events-none",
          "focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2",
          "data-[placeholder]:text-[var(--color-text-faint)]",
          invalid && "border-[var(--color-danger)]",
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 overflow-hidden rounded-[var(--radius-md)]",
            "border border-[var(--color-border)] bg-[var(--color-surface-raised)]",
            "shadow-[var(--shadow-md)]",
          )}
        >
          <RadixSelect.ScrollUpButton className="flex items-center justify-center h-[var(--space-6)]">
            <ChevronUp className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-[var(--space-1)]">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex min-h-[var(--space-8)] cursor-pointer items-center",
                  "rounded-[var(--radius-sm)] pl-[var(--space-7)] pr-[var(--space-3)]",
                  "text-[length:var(--text-sm)] text-[var(--color-text)]",
                  "data-[highlighted]:bg-[var(--color-accent-soft)] data-[highlighted]:outline-none",
                  "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
                )}
              >
                <RadixSelect.ItemIndicator className="absolute left-[var(--space-2)] inline-flex items-center">
                  <Check className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex items-center justify-center h-[var(--space-6)]">
            <ChevronDown className="w-[var(--space-4)] h-[var(--space-4)]" aria-hidden="true" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
