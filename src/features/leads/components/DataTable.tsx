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
  render: (row: Row) => ReactNode;
};

export function DataTable<Row>(props: {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row, index: number) => string;
}) {
  const { columns, rows, getRowKey } = props;

  return (
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
              >
                {column.render(row)}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
