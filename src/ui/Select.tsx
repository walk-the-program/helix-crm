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
  "aria-label"?: string;
  /** @deprecated Use `aria-label`. */
  ariaLabel?: string;
  /**
   * Wired by `Field` when it wraps this control (it clones its child and
   * injects both). Before this, `Field`'s error text rendered in red and was
   * never connected to the control, because this function destructured only
   * its named props and dropped everything else on the floor (CPO finding
   * F-LC-11). `invalid` stays as the direct prop for a caller that is not
   * inside a `Field`; whichever says so wins.
   */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const { value, onValueChange, options, placeholder, disabled, invalid, id, className } = props;
  const ariaLabel = props["aria-label"] ?? props.ariaLabel;
  const ariaDescribedBy = props["aria-describedby"];
  const isInvalid = invalid || props["aria-invalid"] === true;

  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={isInvalid || undefined}
        className={cn(
          "flex w-full h-[var(--control-h)] flex-none items-center justify-between gap-[var(--space-2)]",
          "border border-[var(--color-border-strong)]",
          "bg-[var(--color-surface)] text-[var(--color-text)]",
          "px-[var(--space-3)] text-[length:var(--text-base)]",
          "enabled:hover:bg-[var(--color-hover)]",
          quietTransition,
          disabledState,
          focusRing,
          "data-[placeholder]:text-[var(--color-text-faint)]",
          isInvalid && "border-[var(--color-danger)]",
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
            "z-50 overflow-hidden",
            "border border-[var(--color-border)] bg-[var(--color-surface-raised)]",
            "shadow-[var(--shadow-md)]",
            "min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          <RadixSelect.ScrollUpButton className="flex items-center justify-center h-[var(--space-6)] text-[var(--color-text-muted)]">
            <CaretUp size={16} weight="bold" aria-hidden="true" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-[var(--space-1)]">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "relative flex min-h-[var(--control-h-sm)] cursor-default items-center",
                  "pl-[var(--space-7)] pr-[var(--space-3)]",
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
            <CaretDown size={16} weight="bold" aria-hidden="true" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
