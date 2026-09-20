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
