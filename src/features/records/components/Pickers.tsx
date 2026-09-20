/**
 * The pickers a record page and quick add both need: contact, company, stage
 * and source.
 *
 * Contact and company are `Combobox` over the repositories' `search` helpers,
 * because a workspace with four hundred contacts cannot be a dropdown: Walker
 * opened New deal on a short window and the list ran off the bottom of the
 * screen. The combobox's popover stays inside the viewport and the owner types
 * instead of scrolling. Typing a name nothing matches offers "Add “…”", which
 * creates the record and selects it without leaving the form.
 *
 * Stage and source stay `Select`. Both are short, fixed, workspace-level lists
 * where seeing every option at once is the point — and a stage list is an
 * ordered thing the owner arranged, not something to search.
 *
 * Optional links carry an explicit "None" option instead of a blank row: an
 * empty value in a Radix select is indistinguishable from "not answered yet".
 */
import { useCallback, useMemo } from "react";
import { Select, type SelectOption } from "@/ui";
import { Combobox, type ComboboxItem } from "@/ui/Combobox";
import * as contactsRepo from "@/db/repos/contacts";
import * as companiesRepo from "@/db/repos/companies";
import { contactName } from "@/db/repos/contacts";
import {
  useCompany,
  useContact,
  useSources,
  useStages,
} from "@/features/records/lib/hooks";
import { invalidateRecords, reportError } from "@/features/records/lib/mutations";

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

export function useSourceOptions(): SelectOption[] {
  const { data } = useSources();
  return useMemo(
    () => (data ?? []).map((source) => ({ value: source.id, label: source.name })),
    [data],
  );
}

/**
 * Stages, always in pipeline order.
 *
 * Walker's workspace ended up with two preset sets appended one after the
 * other and read them back interleaved. Position is the order the owner
 * arranged, so it is the only correct sort here; sorting defensively rather
 * than trusting the caller costs nothing on a list this short.
 */
export function useStageOptions(pipelineId: string | undefined): SelectOption[] {
  const { data } = useStages(pipelineId);
  return useMemo(
    () =>
      [...(data ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((stage) => ({ value: stage.id, label: stage.name })),
    [data],
  );
}

/* -------------------------------------------------------------------------- */
/* contact and company: type-ahead                                            */
/* -------------------------------------------------------------------------- */

/**
 * What the picker hands back when a contact is chosen, so the form beside it
 * can fill the company in. Walker: "if I pick one, it should automatically
 * fill the company."
 */
export type PickedContact = {
  id: string;
  label: string;
  companyId: string | null;
  companyName: string | null;
};

/** Split what the owner typed into a first and last name, as a person would. */
export function splitTypedName(query: string): { firstName: string; lastName: string } {
  const parts = query.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * The company a form should show after a contact was picked beside it.
 *
 * Picking the person fills their company, because that is the sentence the
 * owner is saying — "this job is for Priya at Acme". A contact with no company
 * changes nothing rather than blanking a company the owner chose deliberately,
 * and the field stays editable either way.
 */
export function companyAfterContactPick(
  contact: PickedContact | null | undefined,
  current: string | null,
): string | null {
  if (!contact) return current;
  return contact.companyId ?? current;
}

type LinkPickerProps = {
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  id?: string;
  disabled?: boolean;
};

/**
 * `onChange` gains a second argument carrying the chosen contact. It is
 * optional, so every existing caller that ignores it keeps working; the forms
 * that also pick a company use it to fill that company in.
 */
export type ContactPickerProps = Omit<LinkPickerProps, "onChange"> & {
  onChange: (id: string | null, contact?: PickedContact | null) => void;
};

function contactItem(row: contactsRepo.ContactSearchResult): ComboboxItem {
  return {
    id: row.id,
    label: row.label,
    ...(row.detail ? { detail: row.detail } : {}),
  };
}

export function ContactPicker(props: ContactPickerProps) {
  const { value, onChange, label, id, disabled } = props;
  // The chosen contact by id, so the closed trigger prints a name rather than
  // an id on a page the owner has only just opened.
  const { data: chosen } = useContact(value ?? "");

  const search = useCallback(async (query: string): Promise<ComboboxItem[]> => {
    const rows = await contactsRepo.search(query);
    return rows.map(contactItem);
  }, []);

  const selectedItem = useMemo<ComboboxItem | null>(() => {
    if (!value || !chosen) return null;
    const name = contactName(chosen);
    return {
      id: chosen.id,
      label: name,
      ...(chosen.companyName ? { detail: chosen.companyName } : {}),
    };
  }, [value, chosen]);

  const pick = useCallback(
    async (nextId: string | null) => {
      if (nextId === null) {
        onChange(null, null);
        return;
      }
      // Read the contact back rather than trusting the row we rendered: the
      // company is about to be written to another record, so it comes from
      // the database, not from a list that may be a keystroke out of date.
      const full = await contactsRepo.get(nextId);
      onChange(
        nextId,
        full
          ? {
              id: full.id,
              label: contactName(full),
              companyId: full.companyId,
              companyName: full.companyName,
            }
          : null,
      );
    },
    [onChange],
  );

  const create = useCallback(
    async (query: string) => {
      const { firstName, lastName } = splitTypedName(query);
      if (firstName.length === 0) return;
      try {
        const created = await contactsRepo.create({ firstName, lastName });
        await invalidateRecords();
        onChange(created.id, {
          id: created.id,
          label: contactName(created),
          companyId: created.companyId,
          companyName: created.companyName,
        });
      } catch (err: unknown) {
        reportError(err, "That contact was not created.");
      }
    },
    [onChange],
  );

  return (
    <Combobox
      id={id}
      aria-label={label}
      disabled={disabled}
      value={value}
      selectedItem={selectedItem}
      items={search}
      clearable
      placeholder="Search contacts"
      emptyText="No contact matches"
      onCreate={(query) => void create(query)}
      onChange={(nextId) => void pick(nextId)}
    />
  );
}

export function CompanyPicker(props: LinkPickerProps) {
  const { value, onChange, label, id, disabled } = props;
  const { data: chosen } = useCompany(value ?? "");

  const search = useCallback(async (query: string): Promise<ComboboxItem[]> => {
    const rows = await companiesRepo.search(query);
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      ...(row.detail ? { detail: row.detail } : {}),
    }));
  }, []);

  const selectedItem = useMemo<ComboboxItem | null>(
    () => (value && chosen ? { id: chosen.id, label: chosen.name } : null),
    [value, chosen],
  );

  const create = useCallback(
    async (query: string) => {
      const name = query.trim();
      if (name.length === 0) return;
      try {
        const created = await companiesRepo.create({ name });
        await invalidateRecords();
        onChange(created.id);
      } catch (err: unknown) {
        reportError(err, "That company was not created.");
      }
    },
    [onChange],
  );

  return (
    <Combobox
      id={id}
      aria-label={label}
      disabled={disabled}
      value={value}
      selectedItem={selectedItem}
      items={search}
      clearable
      placeholder="Search companies"
      emptyText="No company matches"
      onCreate={(query) => void create(query)}
      onChange={(nextId) => onChange(nextId)}
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
