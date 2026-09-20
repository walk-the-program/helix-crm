/**
 * A thin, generic wrapper over `src/ui`'s `Table` primitives, used for the
 * table view of every report card. Each report defines its own column list
 * (see `ReportsScreen.tsx`); this file only owns the row/column mechanics
 * that are the same across all five: numeric columns right-aligned and
 * tabular via `data-numeric` (the hook `globals.css` already styles), text
 * columns left-aligned.
 */
import type { ReactNode } from "react";
import { TBody, THead, TD, TH, TR, Table } from "@/ui";

export type DataTableColumn<Row> = {
  key: string;
  header: string;
  /** Right-aligns the column and gives it tabular figures. */
  numeric?: boolean;
  /**
   * True when this row's value in this column is a period-table zero: the
   * cell draws in the kit's faint dash ink (`TD`'s `dashZero`) instead of
   * reading as one more "$0.00" the eye has to discard (docs/DESIGN.md rule
   * 1 and 5; CDQO phase two design review, decision A). Pair with
   * `useFormats().moneyOrDash` in `render`. Leave unset for a column whose
   * zero is a true, standalone answer rather than "nothing on this clock."
   */
  dashZero?: (row: Row) => boolean;
  render: (row: Row) => ReactNode;
};

export function DataTable<Row>(props: {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row, index: number) => string;
}) {
  const { columns, rows, getRowKey } = props;

  return (
    // A report table can carry more columns than fit a 1024px card (Revenue's
    // per-deal table is Deal, Customer and four money columns). Without this,
    // the extra columns had nowhere to go but past the card's own edge, with
    // no scrollbar to say so - the row was just cut off. This scrolls the
    // table horizontally inside its own card instead, so the window's 1024px
    // floor (docs/DESIGN.md §11) never hides a column.
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            {columns.map((column) => (
              <TH
                key={column.key}
                align={column.numeric ? "right" : "left"}
                data-numeric={column.numeric || undefined}
              >
                {column.header}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((row, index) => (
            <TR key={getRowKey(row, index)}>
              {columns.map((column) => (
                <TD
                  key={column.key}
                  align={column.numeric ? "right" : "left"}
                  data-numeric={column.numeric || undefined}
                  dashZero={column.dashZero?.(row)}
                >
                  {column.render(row)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
