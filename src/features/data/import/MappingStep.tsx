/**
 * Step 2: which column is which.
 *
 * One row per column in the file, with the guess already made, a sample value
 * so the owner can see what they are deciding about, and a select of every
 * field. "Create a custom field" asks for the name. Deal columns are called
 * out: v1 does not import deals.
 */
import { useMemo } from "react";
import { AlertTriangle, Check, Wand2 } from "lucide-react";
import { Badge, Input, Select, Table, TBody, TD, TH, THead, TR } from "@/ui";
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
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <Badge tone={remembered ? "accent" : "neutral"}>
          {remembered ? (
            <>
              <Check size={12} aria-hidden="true" /> Using your last mapping for this file
            </>
          ) : (
            <>
              <Wand2 size={12} aria-hidden="true" /> Guessed from the column names
            </>
          )}
        </Badge>
        <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          {summary.mapped} of {mapping.length} columns will be imported
          {summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""}.
        </span>
      </div>

      {summary.missing.length > 0 ? (
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
          Nothing is mapped to{" "}
          {summary.missing.map((f) => fieldLabel(f).toLowerCase()).join(", ")}. That is
          fine if the file does not have it.
        </p>
      ) : null}

      {dealColumns.length > 0 ? (
        <div
          role="note"
          className="flex items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-soft)] px-[var(--space-4)] py-[var(--space-3)]"
        >
          <AlertTriangle
            size={16}
            className="mt-[2px] shrink-0 text-[var(--color-warning)]"
            aria-hidden="true"
          />
          <p className="text-[length:var(--text-sm)] text-[var(--color-text)]">
            This file has deal columns ({dealColumns.join(", ")}). Helix imports
            people and companies in this version; deals are not imported, so
            those columns stay on Skip. You can add the deals by hand afterwards.
          </p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
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
              const options = FIELDS.map((field) => ({
                value: field.id,
                label: field.label,
                disabled: takenElsewhere(field.id, column.index),
              }));
              return (
                <TR key={`${column.header}-${column.index}`}>
                  <TD>
                    <span className="font-medium text-[var(--color-text)]">
                      {column.header.length > 0 ? column.header : "(unnamed column)"}
                    </span>
                  </TD>
                  <TD>
                    <span className="text-[var(--color-text-muted)]">
                      {sample.length > 0 ? sample : "—"}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-[var(--space-2)]">
                      <Select
                        value={column.field}
                        onValueChange={(v) => setField(column.index, v as FieldId)}
                        options={options}
                        ariaLabel={`Import "${column.header}" as`}
                        className="w-[220px]"
                      />
                      {column.field === "custom" ? (
                        <Input
                          value={column.customName ?? ""}
                          onChange={(e) => setCustomName(column.index, e.target.value)}
                          aria-label={`Name of the custom field for "${column.header}"`}
                          placeholder="Field name"
                          className="w-[180px]"
                        />
                      ) : null}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
