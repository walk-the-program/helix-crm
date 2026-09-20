// @vitest-environment jsdom
/**
 * JSX render helper for tests/unit/ui/datePicker.test.ts.
 *
 * Vitest's include pattern only picks up "*.test.ts" files, so JSX cannot
 * live in the test file itself (see tests/unit/ui/fixtures.tsx for the same
 * convention). DatePicker is imported from "@/ui/DatePicker" directly rather
 * than "@/ui", because the barrel export in src/ui/index.ts is added by the
 * round's implementation lead, not by this task.
 */
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { DatePicker } from "@/ui/DatePicker";

export type DatePickerFixtureProps = {
  value?: string | null;
  onChange?: (v: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  locale?: string;
  ariaLabel?: string;
};

/** `locale` defaults to "en-US" so weekday/month formatting and the Sunday
 *  week start are stable regardless of the machine running the suite. */
export function renderDatePicker(props?: DatePickerFixtureProps): RenderResult {
  return render(
    <DatePicker
      value={props?.value ?? null}
      onChange={props?.onChange ?? (() => {})}
      min={props?.min}
      max={props?.max}
      placeholder={props?.placeholder}
      disabled={props?.disabled}
      clearable={props?.clearable}
      locale={props?.locale ?? "en-US"}
      aria-label={props?.ariaLabel}
    />,
  );
}
