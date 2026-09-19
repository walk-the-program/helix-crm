/**
 * Step 2: which column is which.
 *
 * One row per column in the file, with the guess already made, a sample value
 * so the owner can see what they are deciding about, and a select of every
 * field. "Create a custom field" asks for the name. Deal columns are called
 * out: v1 does not import deals.
 *
 * The state of the guess is a sentence rather than a tinted badge with a glyph
 * in it, and the deal-column note is a sentence rather than a yellow box:
 * "needs you" in this product is position and weight (docs/DESIGN.md §3), and
 * neither of these needs the owner to do anything.
 */
import { useMemo } from "react";
import { Card, Input, Select, Table, TBody, TD, TH, THead, TR } from "@/ui";
import {
  FIELDS,
  allowsMultiple,
  fieldLabel,
  labelFromHeader,
  looksLikeDealColumn,
  mappingSummary,
  type ColumnMapping,
  type FieldId,
} from "@/features/data/lib/mapping";

function sampleFor(rows: string[][], index: number): string {
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (value.length > 0) return value.length > 48 ? `${value.slice(0, 47)}…` : value;
  }
  return "";
}

export function MappingStep(props: {
  headers: string[];
  sampleRows: string[][];
  mapping: ColumnMapping[];
  remembered: boolean;
  onChange: (mapping: ColumnMapping[]) => void;
}) {
  const { headers, sampleRows, mapping, remembered, onChange } = props;

  const summary = useMemo(() => mappingSummary(mapping), [mapping]);
  const dealColumns = useMemo(
    () => headers.filter((h) => looksLikeDealColumn(h)),
    [headers],
  );

  function setField(index: number, field: FieldId) {
    onChange(
      mapping.map((column) =>
        column.index === index
          ? {
              ...column,
              field,
              guessed: false,
              label: labelFromHeader(column.header, field),
              customName:
                field === "custom" ? (column.customName ?? column.header) : undefined,
            }
          : column,
      ),
    );
  }

  function setCustomName(index: number, customName: string) {
    onChange(
      mapping.map((column) =>
        column.index === index ? { ...column, customName } : column,
      ),
    );
  }

  /** A single-value field already used by another column. */
  function takenElsewhere(field: FieldId, index: number): boolean {
    if (field === "skip" || allowsMultiple(field)) return false;
    return mapping.some((c) => c.field === field && c.index !== index);
  }

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

        {summary.missing.length > 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            Nothing is mapped to{" "}
            {summary.missing.map((f) => fieldLabel(f).toLowerCase()).join(", ")}. That is
            fine if the file does not have it.
          </p>
        ) : null}

        {dealColumns.length > 0 ? (
          <p role="note" className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
            This file has deal columns ({dealColumns.join(", ")}). Helix imports
            people and companies in this version; deals are not imported, so
            those columns stay on Skip. You can add the deals by hand afterwards.
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
          <TBody className="[&>tr:last-child]:border-b-0">
            {mapping.map((column) => {
              const sample = sampleFor(sampleRows, column.index);
              const options = FIELDS.map((field) => ({
                value: field.id,
                label: field.label,
                disabled: takenElsewhere(field.id, column.index),
              }));
              return (
                <TR key={`${column.header}-${column.index}`}>
                  <TD primary title={column.header}>
                    {column.header.length > 0 ? column.header : "(unnamed column)"}
                  </TD>
                  <TD muted>{sample.length > 0 ? sample : "—"}</TD>
                  <TD className="w-[34%]">
                    <div className="flex max-w-[22rem] items-center gap-[var(--space-2)]">
                      <Select
                        value={column.field}
                        onValueChange={(v) => setField(column.index, v as FieldId)}
                        options={options}
                        ariaLabel={`Import "${column.header}" as`}
                        className="min-w-0 flex-1"
                      />
                      {column.field === "custom" ? (
                        <Input
                          value={column.customName ?? ""}
                          onChange={(e) => setCustomName(column.index, e.target.value)}
                          aria-label={`Name of the custom field for "${column.header}"`}
                          placeholder="Field name"
                          className="min-w-0 flex-1"
                        />
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
