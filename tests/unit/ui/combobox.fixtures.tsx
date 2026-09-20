// @vitest-environment jsdom
/**
 * JSX render helpers for combobox.test.ts.
 *
 * Vitest only collects tests/unit/**\/*.test.ts, so JSX cannot live in the
 * test file itself (see tests/unit/ui/fixtures.tsx for the same split).
 */
import { useState } from "react";
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { Combobox, MultiCombobox, type ComboboxItem } from "@/ui/Combobox";
import { Field } from "@/ui/Field";

export const CONTACTS: ComboboxItem[] = [
  { id: "c1", label: "Aisha Okafor", detail: "Okafor Roofing", keywords: ["07700 900111"] },
  { id: "c2", label: "Ben Whitcombe", detail: "Whitcombe & Sons" },
  { id: "c3", label: "Carla Nunes", detail: "Nunes Electrical" },
];

export function ComboboxFixture(props: {
  onChangeSpy?: (id: string | null, item?: ComboboxItem) => void;
  onCreateSpy?: (q: string) => void;
  items?: ComboboxItem[] | ((q: string) => Promise<ComboboxItem[]>);
  initialValue?: string | null;
  clearable?: boolean;
}) {
  const [value, setValue] = useState<string | null>(props.initialValue ?? null);
  return (
    <Combobox
      aria-label="Contact"
      value={value}
      items={props.items ?? CONTACTS}
      clearable={props.clearable}
      onCreate={props.onCreateSpy}
      onChange={(id, item) => {
        setValue(id);
        props.onChangeSpy?.(id, item);
      }}
    />
  );
}

export function renderCombobox(props?: {
  onChangeSpy?: (id: string | null, item?: ComboboxItem) => void;
  onCreateSpy?: (q: string) => void;
  items?: ComboboxItem[] | ((q: string) => Promise<ComboboxItem[]>);
  initialValue?: string | null;
  clearable?: boolean;
}): RenderResult {
  return render(
    <ComboboxFixture
      onChangeSpy={props?.onChangeSpy}
      onCreateSpy={props?.onCreateSpy}
      items={props?.items}
      initialValue={props?.initialValue}
      clearable={props?.clearable}
    />,
  );
}

export function MultiComboboxFixture(props: { onChangeSpy?: (ids: string[]) => void }) {
  const [values, setValues] = useState<string[]>([]);
  return (
    <MultiCombobox
      aria-label="Services"
      values={values}
      items={CONTACTS}
      onChange={(ids) => {
        setValues(ids);
        props.onChangeSpy?.(ids);
      }}
    />
  );
}

export function renderMultiCombobox(props?: {
  onChangeSpy?: (ids: string[]) => void;
}): RenderResult {
  return render(<MultiComboboxFixture onChangeSpy={props?.onChangeSpy} />);
}

/**
 * A long list, for the height-cap and scroll-into-view behaviour: a workspace
 * with four hundred contacts is what an owner has after one import, and it is
 * the case the component was written for (CPO finding F-LC-12).
 */
export const MANY: ComboboxItem[] = Array.from({ length: 400 }, (_, i) => ({
  id: `m${i}`,
  label: `Contact number ${i}`,
}));

export function renderLongCombobox(): RenderResult {
  return render(<ComboboxFixture items={MANY} />);
}

/** A Combobox inside a Field that is showing an error (CPO finding F-LC-11). */
export function renderComboboxInFieldWithError(): RenderResult {
  return render(
    <Field label="Company" error="Pick the customer this invoice is for.">
      <Combobox aria-label="Company" value={null} items={CONTACTS} onChange={() => {}} />
    </Field>,
  );
}
