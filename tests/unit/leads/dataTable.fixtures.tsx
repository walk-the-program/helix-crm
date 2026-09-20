// @vitest-environment jsdom
/**
 * JSX render helper for dataTable.test.ts.
 *
 * Vitest only collects tests/unit/**\/*.test.ts (see vitest.config.ts), so
 * JSX cannot live in the test file itself - the same split
 * tests/unit/leads/overview.fixtures.tsx uses.
 */
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { DataTable } from "@/features/leads/components/DataTable";
import type { DataTableColumn } from "@/features/leads/components/DataTable";

export type MoneyRow = { id: string; label: string; cents: number };

const columns: DataTableColumn<MoneyRow>[] = [
  { key: "label", header: "Label", render: (row) => row.label },
  {
    key: "cents",
    header: "Amount",
    numeric: true,
    dashZero: (row) => row.cents === 0,
    render: (row) => (row.cents === 0 ? "—" : `$${(row.cents / 100).toFixed(2)}`),
  },
];

export function renderMoneyTable(rows: MoneyRow[]): RenderResult {
  return render(<DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />);
}
