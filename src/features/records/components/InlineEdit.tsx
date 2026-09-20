/**
 * Inline editing with autosave. There are no save buttons anywhere on a record
 * page: the field debounces, writes, and says "Saved" for two seconds.
 *
 * Escape reverts to the last saved value; blur flushes immediately so tabbing
 * away never loses a keystroke.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { WarningCircle } from "@/ui/icons";
import { DatePicker, Input, Textarea, Select, Spinner, type SelectOption } from "@/ui";
import { useAutosave, type SaveState } from "@/features/records/lib/hooks";
import { reportError } from "@/features/records/lib/mutations";

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return <span className="sr-only">No unsaved changes</span>;

  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
        <Spinner size={12} label="Saving" />
        Saving
      </span>
    );
  }

  if (state === "error") {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-danger-ink)]"
      >
        <WarningCircle size={14} aria-hidden="true" />
        Not saved
      </span>
    );
  }

  return (
    <span
      role="status"
      data-testid="saved-indicator"
      className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]"
    >
      Saved
    </span>
  );
}

type BaseProps = {
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  placeholder?: string;
  hint?: ReactNode;
  /** Renders the label to screen readers only, for tight record headers. */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
};

function useInlineValue(value: string, onSave: (value: string) => Promise<void>) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  const autosave = useAutosave<string>(
    async (next) => {
      await onSave(next);
      committed.current = next;
    },
    { onError: (err) => reportError(err, "That change did not save.") },
  );

  // A change from elsewhere (undo, a merge, a refetch) wins over a stale draft.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  return { draft, setDraft, committed, autosave };
}

export function InlineText(props: BaseProps & { type?: "text" | "tel" | "email" | "url" }) {
  const { label, value, onSave, placeholder, hint, hideLabel, disabled, className, inputClassName, type = "text" } =
    props;
  const id = useId();
  const { draft, setDraft, committed, autosave } = useInlineValue(value, onSave);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <label
          htmlFor={id}
          className={
            hideLabel
              ? "sr-only"
              : "text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          }
        >
          {label}
        </label>
        <SaveIndicator state={autosave.state} />
      </div>
      <Input
        id={id}
        type={type}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        className={inputClassName}
        onChange={(event) => {
          setDraft(event.target.value);
          autosave.schedule(event.target.value);
        }}
        onBlur={() => autosave.flush()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(committed.current);
          }
          if (event.key === "Enter") {
            event.preventDefault();
            autosave.flush();
          }
        }}
      />
      {hint ? (
        <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The date twin of `InlineText`. Same autosave, same "no save button" and
 * Saved/Saving/Not saved contract, but the control is the in-app `DatePicker`
 * rather than a native date input (the `<input>` with the date `type`
 * attribute) — DESIGN.md's r3 rule is that one never appears in the product.
 *
 * The external contract is untouched: `value` and what `onSave` receives are
 * still the "YYYY-MM-DD" string the record already stores, or "" when unset.
 * `DatePicker` itself speaks `string | null`; the empty string and `null` are
 * the same "nothing chosen" state, converted at this boundary only.
 *
 * A pick is a single discrete action, not a burst of keystrokes, so there is
 * no debounce to wait out: the autosave is scheduled and flushed in the same
 * tick, which still gives the caller the same Saving/Saved sequence as a
 * typed field, just without the 600ms pause first.
 */
export function InlineDate(
  props: BaseProps & { min?: string; max?: string },
) {
  const { label, value, onSave, hideLabel, disabled, className, hint, min, max } = props;
  const id = useId();
  const { draft, setDraft, autosave } = useInlineValue(value, onSave);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <label
          htmlFor={id}
          className={
            hideLabel
              ? "sr-only"
              : "text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          }
        >
          {label}
        </label>
        <SaveIndicator state={autosave.state} />
      </div>
      <DatePicker
        id={id}
        value={draft.trim().length > 0 ? draft : null}
        min={min}
        max={max}
        disabled={disabled}
        clearable
        className="tabular"
        onChange={(next) => {
          const nextValue = next ?? "";
          setDraft(nextValue);
          autosave.schedule(nextValue);
          autosave.flush();
        }}
      />
      {hint ? (
        <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function InlineTextarea(props: BaseProps & { rows?: number }) {
  const { label, value, onSave, placeholder, hideLabel, disabled, className, rows = 4 } = props;
  const id = useId();
  const { draft, setDraft, committed, autosave } = useInlineValue(value, onSave);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <label
          htmlFor={id}
          className={
            hideLabel
              ? "sr-only"
              : "text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
          }
        >
          {label}
        </label>
        <SaveIndicator state={autosave.state} />
      </div>
      <Textarea
        id={id}
        rows={rows}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
          autosave.schedule(event.target.value);
        }}
        onBlur={() => autosave.flush()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(committed.current);
          }
        }}
      />
    </div>
  );
}

export function InlineSelect(props: {
  label: string;
  value: string;
  options: SelectOption[];
  onSave: (value: string) => Promise<void>;
  placeholder?: string;
  className?: string;
}) {
  const { label, value, options, onSave, placeholder, className } = props;
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<SaveState>("idle");

  useEffect(() => setDraft(value), [value]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <label
          htmlFor={id}
          className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
        >
          {label}
        </label>
        <SaveIndicator state={state} />
      </div>
      <Select
        id={id}
        ariaLabel={label}
        value={draft}
        options={options}
        placeholder={placeholder}
        onValueChange={(next) => {
          setDraft(next);
          setState("saving");
          void onSave(next)
            .then(() => {
              setState("saved");
              window.setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2000);
            })
            .catch((err: unknown) => {
              setState("error");
              reportError(err, "That change did not save.");
            });
        }}
      />
    </div>
  );
}
