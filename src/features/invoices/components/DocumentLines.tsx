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
import { Plus, Trash } from "@/ui/icons";
import { Badge, Button, Checkbox, IconButton, Input, Table, TBody, TD, TFoot, TH, THead, TR } from "@/ui";
import { centsToDecimalString, formatMoney, parseMoneyToCents } from "@/lib/money";
import { computeTotals, type DocumentItem, type NewDocumentItem } from "@/db/repos/documents";
import { intervalLabel } from "@/features/invoices/lib/format";
import { formatTaxRate } from "@/features/invoices/lib/settings";
import { hasMixedTaxability, summarizeTaxLines, taxRowLabel } from "@/features/invoices/lib/taxLabel";
import { ServicesPicker } from "@/features/invoices/components/ServicesPicker";
import type { PickedService } from "@/features/invoices/lib/newService";

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
  /**
   * The deal line this row came from, when the row was prefilled from a deal
   * on the New document screen.
   *
   * It is what lets an edit go back to the deal as an UPDATE rather than as a
   * delete and a re-add, which would throw away the line's `product_id` and
   * with it the Services page's deal counts and the price history that points
   * at the catalog row. Undefined on a line the owner typed himself and on
   * every line of an existing document, where the document's own items are
   * the record and the deal is not being touched.
   */
  dealItemId?: string;
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

/**
 * A service picked out of the catalog, as a line. The price and the kind come
 * from the catalog row, not from a default: a monthly service quoted as a
 * one-off is the kind of mistake that only shows up on the invoice.
 */
export function fromPickedService(service: PickedService): DraftLine {
  return {
    key: nextKey(),
    name: service.name,
    description: service.description ?? "",
    qty: "1",
    unit: centsToDecimalString(service.unitCents),
    taxable: service.taxable,
    kind: service.kind,
    interval: service.kind === "recurring" ? (service.interval ?? "month") : null,
  };
}

/**
 * A deal's own line items, as document lines.
 *
 * `selection` matches `documents.selectLines`: a quote carries the whole
 * agreement, an invoice for the work carries the one-time lines because the
 * recurring ones are billed month by month by the schedule. The price is the
 * ACTUAL one - what the deal agreed, not what the catalog suggests.
 */
export function fromDealItems(
  items: {
    id: string;
    name: string;
    description: string | null;
    qty: number;
    actualUnitCents: number;
    taxable: boolean;
    kind: string;
    interval: string | null;
  }[],
  selection: "all" | "one_time",
): DraftLine[] {
  return items
    .filter((item) => selection === "all" || item.kind !== "recurring")
    .map((item) => ({
      key: nextKey(),
      dealItemId: item.id,
      name: item.name,
      description: item.description ?? "",
      qty: String(item.qty),
      unit: centsToDecimalString(item.actualUnitCents),
      taxable: item.taxable,
      kind: item.kind === "recurring" ? ("recurring" as const) : ("one_time" as const),
      interval:
        item.kind === "recurring" ? (item.interval === "year" ? "year" : "month") : null,
    }));
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

export function DocumentLines(props: {
  lines: DraftLine[];
  onChange?: (lines: DraftLine[]) => void;
  editable: boolean;
  taxRateBp: number;
  currency?: string;
  locale?: string;
}) {
  const { lines, onChange, editable, taxRateBp, currency, locale } = props;
  // "Add a line" opens the catalog rather than dropping an empty row: the
  // owner is almost always billing something he already sells, and typing the
  // name and the price again is where a wrong price comes from.
  const [picking, setPicking] = useState(false);

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

  const taxSummary = summarizeTaxLines(
    lines.map((line) => ({ taxable: line.taxable, amountCents: lineCents(line) })),
  );
  const mixedTax = hasMixedTaxability(taxSummary);
  const taxRow = taxRowLabel(taxSummary, totals.taxCents, formatTaxRate(taxRateBp), (cents) =>
    formatMoney(cents, currency, locale),
  );

  // The TAX column is a control while the owner is drafting - he needs
  // somewhere to tick a line taxable before a rate even exists - but on a
  // locked, sent document it is read-only, and a column of identical "Yes" (or
  // a $0.00 tax row underneath a column that says every line is taxed) is
  // noise a rule-1 table should not spend a whole column on. `renderDocument.ts`
  // already draws the PDF this way: a per-line taxability note appears only
  // when the document actually mixes taxable and non-taxable lines, and the
  // totals' own tax row carries it otherwise. The freed width goes back to
  // Description, which was truncating real service names at 1024px.
  const showTaxColumn = editable || mixedTax;
  /**
   * The totals label spans every column left of Amount so its figure lands
   * under Amount. Description, Qty, Unit, and Tax when it is showing; the
   * editable table's extra column is the remove button, which gets its own
   * empty cell after the figure.
   */
  const totalsLabelSpan = showTaxColumn ? 4 : 3;

  function patch(key: string, values: Partial<DraftLine>) {
    onChange?.(lines.map((line) => (line.key === key ? { ...line, ...values } : line)));
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <Table>
        <THead>
          <TR>
            {/* Claimed explicitly. The table sizes itself off its content, and
                with four fixed-width columns beside it the description column
                was collapsing to the width of the word "Description" - which
                is what left the two inputs in it too narrow to read what you
                had typed. */}
            <TH className={showTaxColumn ? "w-[40%]" : "w-[52%]"}>Description</TH>
            <TH className="w-[72px] min-w-[72px] text-right">Qty</TH>
            <TH className="w-[120px] min-w-[112px] text-right">Unit</TH>
            {showTaxColumn ? <TH className="w-[72px] text-center">Tax</TH> : null}
            <TH className="w-[120px] min-w-[104px] text-right">Amount</TH>
            {editable ? <TH className="w-[var(--control-h)]" /> : null}
          </TR>
        </THead>
        <TBody>
          {lines.map((line) => (
            <TR key={line.key}>
              <TD className={editable ? "h-auto py-[var(--space-3)] align-top" : undefined}>
                {editable ? (
                  // The description is the line; the detail is a note about
                  // it. Two identically-bordered boxes this close together
                  // used to read as one field wearing a seam - especially in
                  // compact, where --space-2 is 6px - so only the primary
                  // input keeps the full field border. The detail row drops
                  // its border and sits in tertiary ink, closer to a caption
                  // under the description than a second field beside it
                  // (round 3 criterion 10: clear separation between the two).
                  <div className="flex flex-col gap-[var(--space-2)]">
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
                      className="border-transparent bg-transparent px-0 text-[length:var(--text-sm)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)] hover:px-[var(--space-3)] focus-visible:border-[var(--color-border-strong)] focus-visible:bg-[var(--color-surface)] focus-visible:px-[var(--space-3)]"
                      onChange={(event) =>
                        patch(line.key, { description: event.target.value })
                      }
                    />
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="flex items-center text-[length:var(--text-base)] font-medium text-[var(--color-text)]">
                      {line.name}
                      {line.kind === "recurring" ? (
                        <span className="ml-[var(--space-2)] text-[length:var(--text-sm)] font-normal text-[var(--color-text-muted)]">
                          {intervalLabel(line.kind, line.interval)}
                        </span>
                      ) : null}
                      {mixedTax && line.taxable ? (
                        <Badge tone="neutral" className="ml-[var(--space-2)]">
                          Taxable
                        </Badge>
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
              <TD className={editable ? `${numericCell} h-auto py-[var(--space-3)] align-top` : numericCell}>
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
              <TD className={editable ? `${numericCell} h-auto py-[var(--space-3)] align-top` : numericCell}>
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
              {showTaxColumn ? (
                <TD className={editable ? "h-auto py-[var(--space-3)] text-center align-top" : "text-center"}>
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
              ) : null}
              <TD
                className={
                  editable ? `${numericCell} h-auto py-[var(--space-3)] align-top` : numericCell
                }
              >
                {formatMoney(lineCents(line), currency, locale)}
              </TD>
              {editable ? (
                <TD className="h-auto py-[var(--space-3)] align-top">
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
            <TD colSpan={totalsLabelSpan} className="text-right">
              Subtotal
            </TD>
            <TD className={numericCell}>
              {formatMoney(totals.subtotalCents, currency, locale)}
            </TD>
            {editable ? <TD /> : null}
          </TR>
          {taxRow.show ? (
            <TR>
              <TD colSpan={totalsLabelSpan} className="text-right">
                {taxRow.label}
              </TD>
              <TD className={numericCell}>
                {formatMoney(totals.taxCents, currency, locale)}
              </TD>
              {editable ? <TD /> : null}
            </TR>
          ) : null}
          <TR>
            <TD colSpan={totalsLabelSpan} className="text-right font-semibold text-[var(--color-text)]">
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
            iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
            onClick={() => setPicking(true)}
          >
            Add a line
          </Button>
        </div>
      ) : null}

      <ServicesPicker
        open={picking}
        onOpenChange={setPicking}
        onAdd={(services) => {
          onChange?.([...lines, ...services.map(fromPickedService)]);
          setPicking(false);
        }}
        onCustomLine={() => onChange?.([...lines, blankLine()])}
      />
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
