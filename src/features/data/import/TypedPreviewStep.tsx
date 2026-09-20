/**
 * Step 3 for companies, deals and services: twenty rows as Helix will file
 * them, plus the duplicate question.
 *
 * The columns are the type's own fields rather than a fixed set, capped at the
 * first six that anything was mapped to - a deal export has fourteen columns
 * and a table that shows all of them shows none of them. The full row is in the
 * title attribute, and the last column is always what Helix noticed.
 *
 * Money and dates are shown the way they will be stored, because this is the
 * last screen where anything is free to change.
 */
import { Badge, Card, CardGroupLabel, CardRow, Table, TBody, TD, TH, THead, TR } from "@/ui";
import { policiesFor } from "@/features/data/lib/typedImportRun";
import type { DedupePolicy } from "@/features/data/lib/importRun";
import type { DraftRow } from "@/features/data/lib/typedMapping";
import type {
  FieldDefinition,
  ImportTypeDefinition,
} from "@/features/data/import/fields/types";
import { useFormats, type Formats } from "@/app/formats";

/** How many of the type's fields fit across the table before it stops helping. */
const MAX_COLUMNS = 6;

/**
 * One cell, formatted the way this workspace writes money and dates.
 *
 * `formats` is passed in rather than read here: this is a module function, not
 * a component, and the preview renders a few hundred of these per paint.
 */
function cellText(field: FieldDefinition, row: DraftRow, formats: Formats): string {
  const value = row.draft[field.key];
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") {
    return field.parser === "money" ? formats.money(value) : String(value);
  }
  if (field.parser === "date") return formats.date(value);
  return value;
}

export function TypedPreviewStep(props: {
  type: ImportTypeDefinition;
  rows: DraftRow[];
  mappedFieldKeys: string[];
  totalRows: number;
  policy: DedupePolicy;
  onPolicyChange: (policy: DedupePolicy) => void;
}) {
  const { type, rows, mappedFieldKeys, totalRows, policy, onPolicyChange } = props;
  const formats = useFormats();

  const columns = type.fields
    .filter((field) => mappedFieldKeys.includes(field.key))
    .slice(0, MAX_COLUMNS);

  const problems = rows.filter((r) => r.warnings.length > 0).length;
  const unimportable = rows.filter((r) => !r.importable).length;
  const policies = policiesFor(type.id);

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <p className="text-[length:var(--text-base)] text-[var(--color-text)]">
          The first {rows.length} of{" "}
          <span className="font-medium tabular-nums">{totalRows.toLocaleString()}</span>{" "}
          rows, as they will be filed.
        </p>
        {problems > 0 ? (
          <Badge tone="warning">{problems} to look at</Badge>
        ) : (
          <Badge tone="success">Nothing looks wrong</Badge>
        )}
        {unimportable > 0 ? (
          <Badge tone="danger">{unimportable} cannot be filed</Badge>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {/* table-fixed: one line per row, the whole value in a title. */}
        <Table className="table-fixed">
          <THead>
            <TR>
              <TH align="right" className="w-[6%]">
                Row
              </TH>
              {columns.map((field) => (
                <TH key={field.key}>{field.label}</TH>
              ))}
              <TH className="w-[20%]">What Helix noticed</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.rowNumber}>
                <TD align="right" muted>
                  {row.rowNumber}
                </TD>
                {columns.map((field, i) => {
                  const text = cellText(field, row, formats);
                  const first = i === 0;
                  return (
                    <TD
                      key={field.key}
                      muted={!first}
                      title={text || undefined}
                      className={[
                        "truncate",
                        first ? "font-medium" : "",
                        first && !row.importable
                          ? "text-[var(--color-text-faint)] line-through"
                          : "",
                      ].join(" ")}
                    >
                      {text || "—"}
                    </TD>
                  );
                })}
                <TD muted>
                  {row.warnings.length === 0 ? (
                    "—"
                  ) : (
                    <ul className="flex flex-col gap-[var(--space-1)]">
                      {row.warnings.map((warning, i) => (
                        <li
                          key={i}
                          className={
                            warning.level === "error"
                              ? "text-[var(--color-danger-ink)]"
                              : "text-[var(--color-warning-ink)]"
                          }
                        >
                          {warning.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">
          When something is already in Helix
        </legend>
        <CardGroupLabel aria-hidden="true">
          {type.id === "deals"
            ? "When the job is already on your board"
            : type.id === "services"
              ? "When the service is already in your catalog"
              : "When the business is already in Helix"}
        </CardGroupLabel>
        <Card>
          {policies.map((option) => (
            <CardRow key={option.value} interactive>
              <label className="flex w-full cursor-pointer items-start gap-[var(--space-3)]">
                <input
                  type="radio"
                  name="dedupe-policy"
                  value={option.value}
                  checked={policy === option.value}
                  onChange={() => onPolicyChange(option.value)}
                  className="mt-[var(--space-1)] flex-none accent-[var(--color-accent)]"
                />
                <span className="flex flex-col gap-[var(--space-1)]">
                  <span className="font-medium text-[var(--color-text)]">{option.label}</span>
                  <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                    {option.hint}
                  </span>
                </span>
              </label>
            </CardRow>
          ))}
        </Card>
        <p className="px-[var(--space-1)] pt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
          {type.id === "deals"
            ? "Matched on the deal name and the customer, against the deals you still have open."
            : type.id === "services"
              ? "Matched on the service name."
              : "Matched on the business name."}
        </p>
      </fieldset>
    </div>
  );
}
