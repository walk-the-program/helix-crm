/**
 * Step 1, first question: what is in this file?
 *
 * A grouped inset list of radios under a small-capitals label - the same shape
 * the duplicate policy uses one step later, which is how a native settings
 * pane asks a closed question. Not tabs and not a segmented control: the list
 * has room for the sentence under each option, and that sentence is what stops
 * an owner picking Deals for a file full of people.
 *
 * Nothing here is coloured. The one confident block on this screen is the
 * "Choose a file" button below it (docs/DESIGN.md: one primary block per view).
 */
import { Card, CardGroupLabel, CardRow } from "@/ui";
import { IMPORT_TYPES } from "@/features/data/import/fields/index";
import type { ImportTypeId } from "@/features/data/import/fields/types";

export function TypePicker(props: {
  value: ImportTypeId;
  onChange: (value: ImportTypeId) => void;
  disabled?: boolean;
}) {
  const { value, onChange, disabled } = props;

  return (
    <fieldset className="m-0 border-0 p-0" data-testid="import-type-picker">
      <legend className="sr-only">What are you importing?</legend>
      <CardGroupLabel aria-hidden="true">What are you importing?</CardGroupLabel>
      <Card>
        {IMPORT_TYPES.map((type) => (
          <CardRow key={type.id} interactive>
            <label className="flex w-full cursor-pointer items-start gap-[var(--space-3)]">
              <input
                type="radio"
                name="import-type"
                value={type.id}
                checked={value === type.id}
                disabled={disabled}
                onChange={() => onChange(type.id)}
                className="mt-[var(--space-1)] flex-none accent-[var(--color-accent)]"
              />
              <span className="flex flex-col gap-[var(--space-1)]">
                <span className="font-medium text-[var(--color-text)]">{type.label}</span>
                <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                  {type.hint}
                </span>
              </span>
            </label>
          </CardRow>
        ))}
      </Card>
    </fieldset>
  );
}
