/**
 * The pickers a record page and quick add both need: contact, company, stage
 * and source. All four are the shared `Select`, so keyboard behaviour, the
 * focus ring and the 44 px target come from the design system rather than from
 * a hand-rolled combobox.
 *
 * Optional links carry an explicit "None" option instead of a blank row: an
 * empty value in a Radix select is indistinguishable from "not answered yet".
 */
import { useMemo } from "react";
import { Select, type SelectOption } from "@/ui";
import { contactName } from "@/db/repos/contacts";
import {
  useCompanies,
  useContacts,
  useSources,
  useStages,
} from "@/features/records/lib/hooks";

export const NONE = "__none__";

export function toId(value: string): string | null {
  return value === NONE ? null : value;
}

export function fromId(value: string | null | undefined): string {
  return value ?? NONE;
}

function withNone(options: SelectOption[], noneLabel: string): SelectOption[] {
  return [{ value: NONE, label: noneLabel }, ...options];
}

export function useContactOptions(): SelectOption[] {
  const { data } = useContacts({});
  return useMemo(
    () =>
      (data?.rows ?? []).map((contact) => ({
        value: contact.id,
        label: contact.companyName
          ? `${contactName(contact)} — ${contact.companyName}`
          : contactName(contact),
      })),
    [data],
  );
}

export function useCompanyOptions(): SelectOption[] {
  const { data } = useCompanies({});
  return useMemo(
    () => (data?.rows ?? []).map((company) => ({ value: company.id, label: company.name })),
    [data],
  );
}

export function useSourceOptions(): SelectOption[] {
  const { data } = useSources();
  return useMemo(
    () => (data ?? []).map((source) => ({ value: source.id, label: source.name })),
    [data],
  );
}

export function useStageOptions(pipelineId: string | undefined): SelectOption[] {
  const { data } = useStages(pipelineId);
  return useMemo(
    () => (data ?? []).map((stage) => ({ value: stage.id, label: stage.name })),
    [data],
  );
}

type LinkPickerProps = {
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  id?: string;
  disabled?: boolean;
};

export function ContactPicker(props: LinkPickerProps) {
  const options = useContactOptions();
  return (
    <Select
      id={props.id}
      ariaLabel={props.label}
      disabled={props.disabled}
      value={fromId(props.value)}
      options={withNone(options, "No contact")}
      placeholder="Pick a contact"
      onValueChange={(next) => props.onChange(toId(next))}
    />
  );
}

export function CompanyPicker(props: LinkPickerProps) {
  const options = useCompanyOptions();
  return (
    <Select
      id={props.id}
      ariaLabel={props.label}
      disabled={props.disabled}
      value={fromId(props.value)}
      options={withNone(options, "No company")}
      placeholder="Pick a company"
      onValueChange={(next) => props.onChange(toId(next))}
    />
  );
}

export function SourcePicker(props: LinkPickerProps) {
  const options = useSourceOptions();
  return (
    <Select
      id={props.id}
      ariaLabel={props.label}
      disabled={props.disabled}
      value={fromId(props.value)}
      options={withNone(options, "No source")}
      placeholder="Where it came from"
      onValueChange={(next) => props.onChange(toId(next))}
    />
  );
}

/** Stage is never optional: a deal always sits somewhere. */
export function StagePicker(props: {
  pipelineId: string | undefined;
  value: string;
  onChange: (stageId: string) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const options = useStageOptions(props.pipelineId);
  return (
    <Select
      id={props.id}
      ariaLabel={props.label}
      disabled={props.disabled}
      value={props.value === "" ? undefined : props.value}
      options={options}
      placeholder="Pick a stage"
      onValueChange={props.onChange}
    />
  );
}
