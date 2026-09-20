/**
 * Step 2 for companies, deals and services: which column is which.
 *
 * The same table the contacts wizard shows - the column, a real value from the
 * file, and a select of every field - built from the type's field definitions
 * instead of from the contacts field list. A field that can only be filled once
 * is disabled in the other rows' selects, so two columns cannot both claim
 * "Deal".
 *
 * The state of the guess is a sentence, not a tinted badge: "needs you" in this
 * product is position and weight (docs/DESIGN.md section 3), and a mapping that
 * guessed correctly needs nothing.
 */
import { useMemo } from "react";
import { Card, Select, Table, TBody, TD, TH, THead, TR } from "@/ui";
import {
  SKIP,
  typedMappingSummary,
  type TypedColumnMapping,
} from "@/features/data/lib/typedMapping";
import type { ImportTypeDefinition } from "@/features/data/import/fields/types";

function sampleFor(rows: string[][], index: number): string {
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (value.length > 0) return value.length > 48 ? `${value.slice(0, 47)}…` : value;
  }
  return "";
}

export function TypedMappingStep(props: {
  type: ImportTypeDefinition;
  sampleRows: string[][];
  mapping: TypedColumnMapping[];
  remembered: boolean;
  onChange: (mapping: TypedColumnMapping[]) => void;
}) {
  const { type, sampleRows, mapping, remembered, onChange } = props;

  const summary = useMemo(() => typedMappingSummary(type, mapping), [type, mapping]);

  const options = useMemo(
    () => [
      { value: SKIP, label: "Skip this column" },
      ...type.fields.map((field) => ({
        value: field.key,
        label: field.required === true ? `${field.label} (needed)` : field.label,
        multiple: field.multiple === true,
      })),
    ],
    [type],
  );

  function setField(index: number, field: string) {
    onChange(
      mapping.map((column) =>
        column.index === index ? { ...column, field, guessed: false } : column,
      ),
    );
  }

  /** A single-value field another column already claimed. */
  function takenElsewhere(key: string, index: number): boolean {
    if (key === SKIP) return false;
    if (type.fields.find((f) => f.key === key)?.multiple === true) return false;
    return mapping.some((c) => c.field === key && c.index !== index);
  }

  const hintFor = (key: string) => type.fields.find((f) => f.key === key)?.hint;

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="flex flex-col gap-[var(--space-1)]">
        <p className="text-[length:var(--text-base)] text-[var(--color-text)]">
          {remembered
            ? "Using your last mapping for this file"
            : "Guessed from the column names"}
          .{" "}
          <span className="text-[var(--color-text-muted)]">
            {summary.mapped} of {mapping.length} columns will be imported
            {summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""}.
          </span>
        </p>

        {summary.missingRequired.length > 0 ? (
          <p role="note" className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Nothing is mapped to{" "}
            {summary.missingRequired.map((f) => f.label.toLowerCase()).join(", ")}, and
            every row needs it. Pick the column that holds it, or go back and choose a
            different file.
          </p>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Column in your file</TH>
              <TH>First value</TH>
              <TH>Import as</TH>
            </TR>
          </THead>
          <TBody>
            {mapping.map((column) => {
              const sample = sampleFor(sampleRows, column.index);
              const hint = hintFor(column.field);
              return (
                <TR key={`${column.header}-${column.index}`}>
                  <TD primary title={column.header}>
                    {column.header.length > 0 ? column.header : "(unnamed column)"}
                  </TD>
                  <TD muted>{sample.length > 0 ? sample : "—"}</TD>
                  <TD className="w-[34%]">
                    <div className="flex max-w-[22rem] flex-col gap-[var(--space-1)]">
                      <Select
                        value={column.field}
                        onValueChange={(v) => setField(column.index, v)}
                        options={options.map((option) => ({
                          value: option.value,
                          label: option.label,
                          disabled: takenElsewhere(option.value, column.index),
                        }))}
                        ariaLabel={`Import "${column.header}" as`}
                        className="min-w-0"
                      />
                      {hint ? (
                        <span className="text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
                          {hint}
                        </span>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
