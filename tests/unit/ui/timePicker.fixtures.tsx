// @vitest-environment jsdom
/**
 * JSX render helpers for tests/unit/ui/timePicker.test.ts.
 *
 * Vitest's include pattern only picks up "*.test.ts" files, so JSX cannot
 * live in the test file itself (see tests/unit/ui/fixtures.tsx). TimePicker is
 * imported from "@/ui/TimePicker" directly rather than the "@/ui" barrel,
 * because the barrel export for it does not exist yet — that is the
 * integration lead's job, not this task's.
 */
import { useState } from "react";
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { TimePicker } from "@/ui/TimePicker";

export type TimePickerFixtureProps = {
  initialValue?: string | null;
  onChangeSpy?: (v: string | null) => void;
  step?: 5 | 15 | 30;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
  min?: string;
  max?: string;
  ariaLabel?: string;
};

export function TimePickerFixture(props: TimePickerFixtureProps) {
  const [value, setValue] = useState<string | null>(props.initialValue ?? null);
  return (
    <TimePicker
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onChangeSpy?.(v);
      }}
      step={props.step}
      disabled={props.disabled}
      placeholder={props.placeholder}
      clearable={props.clearable}
      min={props.min}
      max={props.max}
      aria-label={props.ariaLabel ?? "Time"}
    />
  );
}

export function renderTimePicker(props?: TimePickerFixtureProps): RenderResult {
  return render(<TimePickerFixture {...props} />);
}
