/**
 * The report range control: This month / This quarter / This year / Custom.
 *
 * Custom mode reveals two date fields, but a period only ever changes when
 * `customPeriod()` can build a valid one from them - an invalid or backwards
 * range shows an inline message and leaves the previously applied period in
 * force, so the reports underneath never render against a range nobody chose.
 */
import { useState } from "react";
import { Field, Input, Select } from "@/ui";
import type { SelectOption } from "@/ui";
import { customPeriod, periodFor, toDateInputValue } from "@/lib/periods";
import type { Period, PeriodId } from "@/lib/periods";

const PRESET_OPTIONS: SelectOption[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom" },
];

/** The day before an exclusive ISO boundary, as a local calendar day. Used to seed the "to" field when Custom is opened from a preset. */
function lastInclusiveDay(exclusiveIsoTo: string): string {
  const exclusive = new Date(exclusiveIsoTo);
  const inclusive = new Date(exclusive.getTime() - 86_400_000);
  return toDateInputValue(inclusive.toISOString());
}

export function PeriodPicker(props: { value: Period; onChange: (period: Period) => void }) {
  const { value, onChange } = props;
  const [mode, setMode] = useState<PeriodId>(value.id);
  const [fromInput, setFromInput] = useState<string>(() => toDateInputValue(value.from));
  const [toInput, setToInput] = useState<string>(() => lastInclusiveDay(value.to));
  const [error, setError] = useState<string | null>(null);

  function handleModeChange(next: string) {
    if (next === "month" || next === "quarter" || next === "year") {
      setMode(next);
      setError(null);
      onChange(periodFor(next));
      return;
    }
    // Custom: reveal the date fields, seeded from whatever period is active now.
    setMode("custom");
    setFromInput(toDateInputValue(value.from));
    setToInput(lastInclusiveDay(value.to));
    setError(null);
  }

  function handleDateChange(which: "from" | "to", raw: string) {
    const nextFrom = which === "from" ? raw : fromInput;
    const nextTo = which === "to" ? raw : toInput;
    setFromInput(nextFrom);
    setToInput(nextTo);

    if (!nextFrom || !nextTo) {
      // Still typing the other half of the range; nothing to validate yet.
      setError(null);
      return;
    }
    const next = customPeriod(nextFrom, nextTo);
    if (!next) {
      setError("Enter an end date on or after the start date.");
      return;
    }
    setError(null);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-start gap-[var(--space-3)]">
      <Select
        value={mode}
        onValueChange={handleModeChange}
        options={PRESET_OPTIONS}
        ariaLabel="Report period"
        className="w-auto min-w-[10rem]"
      />
      {mode === "custom" ? (
        <div className="flex flex-wrap items-start gap-[var(--space-3)]">
          <Field label="From" error={error ?? undefined}>
            <Input
              type="date"
              value={fromInput}
              max={toInput || undefined}
              onChange={(event) => handleDateChange("from", event.target.value)}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={toInput}
              min={fromInput || undefined}
              onChange={(event) => handleDateChange("to", event.target.value)}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}
