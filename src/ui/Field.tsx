import { cloneElement, isValidElement, useId } from "react";
import type { ReactElement, ReactNode } from "react";
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
        className="text-[length:var(--text-sm)] font-medium text-[var(--color-text)]"
      >
        {label}
        {required ? (
          <span className="text-[var(--color-danger)]" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {child as ReactElement}
      {hint ? (
        <p id={hintId} className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[length:var(--text-xs)] text-[var(--color-danger)]">
          {error}
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
