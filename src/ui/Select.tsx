import * as RadixSelect from "@radix-ui/react-select";
import { CaretDown, CaretUp, Check } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { disabledState, focusRing, quietTransition } from "@/ui/styles";

export const SelectPrimitive = RadixSelect;

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/**
 * The trigger matches Input exactly: --control-h, --radius-md, a
 * --color-border-strong hairline, --color-surface, body type. A caret in
 * secondary ink sits at the right edge, the way a macOS pop-up button draws it.
 *
 * The menu is a floating layer: --color-surface-raised, hairline,
 * --radius-lg, --shadow-md, items at --radius-md. The highlighted item is
 * --color-selected — a menu highlight is chrome, and --color-hover sits within
 * a point of the raised surface in the dark theme, which would make the
 * keyboard highlight invisible at 10 pm.
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
          "rounded-[var(--radius-md)] border border-[var(--color-border-strong)]",
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
          <CaretDown size={14} weight="bold" aria-hidden="true" />
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
            "min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          <RadixSelect.ScrollUpButton className="flex items-center justify-center h-[var(--space-6)] text-[var(--color-text-muted)]">
            <CaretUp size={14} weight="bold" aria-hidden="true" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-[var(--space-1)]">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex min-h-[var(--control-h-sm)] cursor-default items-center",
                  "rounded-[var(--radius-md)] pl-[var(--space-7)] pr-[var(--space-3)]",
                  "text-[length:var(--text-base)] text-[var(--color-text)]",
                  "data-[highlighted]:bg-[var(--color-selected)] data-[highlighted]:outline-none",
                  "data-[disabled]:opacity-50",
                )}
              >
                <RadixSelect.ItemIndicator className="absolute left-[var(--space-2)] inline-flex items-center text-[var(--color-text-muted)]">
                  <Check size={14} weight="bold" aria-hidden="true" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex items-center justify-center h-[var(--space-6)] text-[var(--color-text-muted)]">
            <CaretDown size={14} weight="bold" aria-hidden="true" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
