import { cloneElement, isValidElement, useId } from "react";
import type { ReactElement, ReactNode } from "react";
import { WarningCircle } from "@/ui/icons";
import { cn } from "@/ui/cn";

export function FormRow(props: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-[var(--space-4)]", props.className)}>
      {props.children}
    </div>
  );
}

type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Label above the field, always visible, --text-sm, --color-text-muted.
 * Required is marked with the word "Required", not an asterisk.
 * Helper text sits under the field at --text-xs --color-text-faint; an error
 * replaces it, in --color-danger-ink, with a 14px alert-circle beside it.
 * (docs/DESIGN.md section 9, "Inputs".)
 *
 * Both the hint and the error are wired to the control through
 * aria-describedby, so a screen reader reads the sentence that says what to
 * fix rather than just "invalid".
 */
export function Field(props: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  const { label, htmlFor, error, hint, required, children } = props;
  const generatedId = useId();
  const controlId = htmlFor ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const child = isValidElement<FieldControlProps>(children)
    ? cloneElement(children, {
        id: children.props.id ?? controlId,
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error) || undefined,
      })
    : children;

  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <label
        htmlFor={controlId}
        className={cn(
          "flex items-baseline gap-[var(--space-2)]",
          "text-[length:var(--text-sm)] text-[var(--color-text-muted)]",
        )}
      >
        <span>{label}</span>
        {required ? (
          <span className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
            Required
          </span>
        ) : null}
      </label>
      {child as ReactElement}
      {hint && !error ? (
        <p id={hintId} className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          {hint}
        </p>
      ) : null}
      {hint && error ? (
        <p id={hintId} className="sr-only">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className={cn(
            "flex items-start gap-[var(--space-1)]",
            "text-[length:var(--text-xs)] text-[var(--color-danger-ink)]",
          )}
        >
          <WarningCircle size={14} weight="bold" className="flex-none translate-y-[1px]" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function FieldSet(props: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-[var(--space-4)] border-0 p-0 m-0">
      <legend className="text-[length:var(--text-sm)] font-semibold text-[var(--color-text)] mb-[var(--space-2)]">
        {props.legend}
      </legend>
      {props.children}
    </fieldset>
  );
}
