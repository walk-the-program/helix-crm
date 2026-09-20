/**
 * The lines on a quote or an invoice.
 *
 * Two modes, one component, because a draft and a sent document have to line
 * up column for column - the owner reads the same table before and after he
 * sends it, and a table that reflows when it locks looks like a different
 * document. While it is a draft the cells are inputs; once it is sent they are
 * text, and the document says so above rather than leaving him poking at a
 * field that will not take.
 *
 * Money is typed as a decimal and stored as integer cents. A recurring line
 * carries "per month" or "per year" beside its name, which is what makes a
 * quote for a monthly service honest about what is being agreed to.
 */
import { useEffect, useState } from "react";
import { Trash } from "@/ui/icons";
import { Button, Checkbox, IconButton, Input, Table, TBody, TD, TFoot, TH, THead, TR } from "@/ui";
import { centsToDecimalString, formatMoney, parseMoneyToCents } from "@/lib/money";
import { computeTotals, type DocumentItem, type NewDocumentItem } from "@/db/repos/documents";
import { intervalLabel } from "@/features/invoices/lib/format";
import { formatTaxRate } from "@/features/invoices/lib/settings";

/** A line while it is being edited: money as the text in the box. */
export type DraftLine = {
  key: string;
  name: string;
  description: string;
  qty: string;
  unit: string;
  taxable: boolean;
  kind: "one_time" | "recurring";
  interval: "month" | "year" | null;
};

let keySeed = 0;
function nextKey(): string {
  keySeed += 1;
  return `line-${keySeed}`;
}

export function blankLine(): DraftLine {
  return {
    key: nextKey(),
    name: "",
    description: "",
    qty: "1",
    unit: "0.00",
    taxable: false,
    kind: "one_time",
    interval: null,
  };
}

export function toDraftLines(items: DocumentItem[]): DraftLine[] {
  return items.map((item) => ({
    key: nextKey(),
    name: item.name,
    description: item.description ?? "",
    qty: String(item.qty),
    unit: centsToDecimalString(item.unitCents),
    taxable: item.taxable,
    kind: item.kind === "recurring" ? "recurring" : "one_time",
    interval: item.interval === "year" ? "year" : item.kind === "recurring" ? "month" : null,
  }));
}

/** Null when any line will not parse, so the caller can refuse to save. */
export function toNewItems(lines: DraftLine[]): NewDocumentItem[] | null {
  const out: NewDocumentItem[] = [];
  for (const line of lines) {
    const name = line.name.trim();
    const qty = Number.parseInt(line.qty, 10);
    const unitCents = parseMoneyToCents(line.unit);
    if (name.length === 0 || !Number.isFinite(qty) || qty < 1 || unitCents === null) {
      return null;
    }
    out.push({
      name,
      description: line.description.trim().length > 0 ? line.description.trim() : null,
      qty,
      unitCents,
      taxable: line.taxable,
      kind: line.kind,
      interval: line.kind === "recurring" ? (line.interval ?? "month") : null,
    });
  }
  return out.length > 0 ? out : null;
}

function lineCents(line: DraftLine): number {
  const qty = Number.parseInt(line.qty, 10);
  const unit = parseMoneyToCents(line.unit);
  if (!Number.isFinite(qty) || unit === null) return 0;
  return qty * unit;
}

const numericCell = "money text-right";

/**
 * A totals label spans Description, Qty, Unit and Tax so its figure lands
 * under Amount. Four in both modes: the editable table's sixth column is the
 * remove button, which gets its own empty cell after the figure.
 */
const TOTALS_LABEL_SPAN = 4;

export function DocumentLines(props: {
  lines: DraftLine[];
  onChange?: (lines: DraftLine[]) => void;
  editable: boolean;
  taxRateBp: number;
  currency?: string;
  locale?: string;
}) {
  const { lines, onChange, editable, taxRateBp, currency, locale } = props;

  const totals = computeTotals(
    lines.map((line) => {
      const qty = Number.parseInt(line.qty, 10);
      const unit = parseMoneyToCents(line.unit) ?? 0;
      return {
        qty: Number.isFinite(qty) ? qty : 0,
        unitCents: unit,
        taxable: line.taxable,
      };
    }),
    taxRateBp,
  );

  function patch(key: string, values: Partial<DraftLine>) {
    onChange?.(lines.map((line) => (line.key === key ? { ...line, ...values } : line)));
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <Table>
        <THead>
          <TR>
            <TH>Description</TH>
            <TH className="w-[72px] text-right">Qty</TH>
            <TH className="w-[120px] text-right">Unit</TH>
            <TH className="w-[72px] text-center">Tax</TH>
            <TH className="w-[120px] text-right">Amount</TH>
            {editable ? <TH className="w-[var(--control-h)]" /> : null}
          </TR>
        </THead>
        <TBody>
          {lines.map((line) => (
            <TR key={line.key}>
              <TD>
                {editable ? (
                  <div className="flex flex-col gap-[var(--space-1)]">
                    <Input
                      aria-label="Description"
                      value={line.name}
                      placeholder="What the work was"
                      onChange={(event) => patch(line.key, { name: event.target.value })}
                    />
                    <Input
                      aria-label="Detail"
                      value={line.description}
                      placeholder="Detail, if it needs any"
                      onChange={(event) =>
                        patch(line.key, { description: event.target.value })
                      }
                    />
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="text-[length:var(--text-base)] font-medium text-[var(--color-text)]">
                      {line.name}
                      {line.kind === "recurring" ? (
                        <span className="ml-[var(--space-2)] text-[length:var(--text-sm)] font-normal text-[var(--color-text-muted)]">
                          {intervalLabel(line.kind, line.interval)}
                        </span>
                      ) : null}
                    </span>
                    {line.description ? (
                      <span className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                        {line.description}
                      </span>
                    ) : null}
                  </div>
                )}
              </TD>
              <TD className={numericCell}>
                {editable ? (
                  <Input
                    aria-label="Quantity"
                    inputMode="numeric"
                    className="text-right"
                    value={line.qty}
                    onChange={(event) => patch(line.key, { qty: event.target.value })}
                  />
                ) : (
                  line.qty
                )}
              </TD>
              <TD className={numericCell}>
                {editable ? (
                  <Input
                    aria-label="Unit price"
                    inputMode="decimal"
                    className="money text-right"
                    value={line.unit}
                    onChange={(event) => patch(line.key, { unit: event.target.value })}
                  />
                ) : (
                  formatMoney(parseMoneyToCents(line.unit) ?? 0, currency, locale)
                )}
              </TD>
              <TD className="text-center">
                {editable ? (
                  <Checkbox
                    checked={line.taxable}
                    onCheckedChange={(checked) =>
                      patch(line.key, { taxable: checked === true })
                    }
                    aria-label={`Charge tax on ${line.name || "this line"}`}
                  />
                ) : line.taxable ? (
                  "Yes"
                ) : (
                  <span className="text-[var(--color-text-faint)]">No</span>
                )}
              </TD>
              <TD className={numericCell}>
                {formatMoney(lineCents(line), currency, locale)}
              </TD>
              {editable ? (
                <TD>
                  <IconButton
                    label={`Remove ${line.name || "this line"}`}
                    icon={<Trash size={16} weight="bold" aria-hidden="true" />}
                    onClick={() =>
                      onChange?.(lines.filter((other) => other.key !== line.key))
                    }
                  />
                </TD>
              ) : null}
            </TR>
          ))}
        </TBody>
        <TFoot>
          <TR>
            <TD colSpan={TOTALS_LABEL_SPAN} className="text-right">
              Subtotal
            </TD>
            <TD className={numericCell}>
              {formatMoney(totals.subtotalCents, currency, locale)}
            </TD>
            {editable ? <TD /> : null}
          </TR>
          {taxRateBp > 0 ? (
            <TR>
              <TD colSpan={TOTALS_LABEL_SPAN} className="text-right">
                Tax ({formatTaxRate(taxRateBp)})
              </TD>
              <TD className={numericCell}>
                {formatMoney(totals.taxCents, currency, locale)}
              </TD>
              {editable ? <TD /> : null}
            </TR>
          ) : null}
          <TR>
            <TD colSpan={TOTALS_LABEL_SPAN} className="text-right font-semibold text-[var(--color-text)]">
              Total
            </TD>
            <TD className={`${numericCell} font-semibold text-[var(--color-text)]`}>
              {formatMoney(totals.totalCents, currency, locale)}
            </TD>
            {editable ? <TD /> : null}
          </TR>
        </TFoot>
      </Table>

      {editable ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange?.([...lines, blankLine()])}
          >
            Add a line
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Keeps a local draft in step with the row while the document is a draft. */
export function useDraftLines(items: DocumentItem[] | undefined, editable: boolean) {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const signature = (items ?? [])
    .map((item) => `${item.id}:${item.qty}:${item.unitCents}:${item.name}`)
    .join("|");

  useEffect(() => {
    if (!items) return;
    setLines(items.length > 0 ? toDraftLines(items) : editable ? [blankLine()] : []);
    // The signature, not `items`, is the dependency. A query result is a fresh
    // array every time it resolves, so depending on the array itself would
    // throw away whatever the owner is halfway through typing.
  }, [signature, editable]);

  return [lines, setLines] as const;
}
