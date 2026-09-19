/**
 * The workspace's custom fields on one record. The field definitions belong to
 * Settings; this only reads them and edits the values, with the same autosave
 * the rest of the record page uses.
 */
import * as customFieldsRepo from "@/db/repos/customFields";
import type { CustomField, CustomValueWithField } from "@/db/repos/customFields";
import { useCustomFields, useCustomValues } from "@/features/records/lib/hooks";
import { invalidateRecords } from "@/features/records/lib/mutations";
import { queryClient } from "@/app/queryClient";
import { InlineText, InlineSelect } from "@/features/records/components/InlineEdit";

function currentValue(
  values: CustomValueWithField[] | undefined,
  field: CustomField,
): CustomValueWithField | undefined {
  return values?.find((value) => value.fieldId === field.id);
}

function choices(field: CustomField): string[] {
  if (!field.optionsJson) return [];
  try {
    const parsed: unknown = JSON.parse(field.optionsJson);
    if (Array.isArray(parsed)) return parsed.map((option) => String(option));
    return [];
  } catch {
    return [];
  }
}

export function CustomFieldsPanel(props: { entityType: string; entityId: string }) {
  const { entityType, entityId } = props;
  const { data: fields } = useCustomFields(entityType);
  const { data: values } = useCustomValues(entityId);

  async function save(
    field: CustomField,
    value: { text?: string | null; num?: number | null; date?: string | null },
  ): Promise<void> {
    const empty =
      (value.text ?? "") === "" && value.num === undefined && (value.date ?? "") === "";
    if (empty) {
      await customFieldsRepo.clearValue(field.id, entityId);
    } else {
      await customFieldsRepo.setValue(field.id, entityId, value);
    }
    await queryClient.invalidateQueries({ queryKey: ["customValues", entityId] });
    await invalidateRecords();
  }

  if (!fields || fields.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
        No custom fields yet. Settings is where you add the ones this business needs.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-[var(--space-4)]">
      {fields.map((field) => {
        const value = currentValue(values, field);

        if (field.kind === "choice") {
          const options = choices(field).map((option) => ({ value: option, label: option }));
          return (
            <InlineSelect
              key={field.id}
              label={field.name}
              value={value?.valueText ?? ""}
              options={options}
              placeholder="Not set"
              onSave={(next) => save(field, { text: next })}
            />
          );
        }

        if (field.kind === "number") {
          return (
            <InlineText
              key={field.id}
              label={field.name}
              value={value?.valueNum === null || value?.valueNum === undefined ? "" : String(value.valueNum)}
              placeholder="0"
              onSave={(next) => {
                const parsed = Number(next.trim());
                if (next.trim().length === 0) return save(field, { num: null, text: null });
                if (!Number.isFinite(parsed)) {
                  return Promise.reject(new Error("Enter a number, for example 1200."));
                }
                return save(field, { num: parsed });
              }}
            />
          );
        }

        if (field.kind === "date") {
          return (
            <InlineText
              key={field.id}
              type="date"
              label={field.name}
              value={value?.valueDate ?? ""}
              onSave={(next) => save(field, { date: next.trim().length > 0 ? next : null })}
            />
          );
        }

        return (
          <InlineText
            key={field.id}
            label={field.name}
            value={value?.valueText ?? ""}
            placeholder="Not set"
            onSave={(next) => save(field, { text: next })}
          />
        );
      })}
    </div>
  );
}
