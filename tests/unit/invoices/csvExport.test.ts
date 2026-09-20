/**
 * F-LB-19 ("Copy as CSV" on Receivables) - `agingCsv` / `receivablesCsv`,
 * extracted from AgingBlock.tsx / ReceivablesScreen.tsx so the exact columns
 * and number formatting are testable without rendering anything.
 */
import { describe, it, expect } from "vitest";
import { agingCsv, receivablesCsv } from "@/features/invoices/lib/format";
import { formatDateDisplay } from "@/lib/dates";
import type { Aging, ReceivableRow } from "@/db/repos/receivables";

const BUCKET_LABEL = (bucket: Aging["rows"][number]["bucket"]): string => {
  const labels: Record<string, string> = {
    current: "Not yet due",
    "1-30": "1 to 30 days",
    "31-60": "31 to 60 days",
    "61-90": "61 to 90 days",
    "90+": "Over 90 days",
  };
  return labels[bucket];
};

describe("agingCsv", () => {
  it("emits the header row, every bucket in order, and the total - money as a plain decimal", () => {
    const aging: Aging = {
      rows: [
        { bucket: "current", count: 2, cents: 150000 },
        { bucket: "1-30", count: 1, cents: 25000 },
        { bucket: "31-60", count: 0, cents: 0 },
        { bucket: "61-90", count: 0, cents: 0 },
        { bucket: "90+", count: 1, cents: 500 },
      ],
      totalCents: 175500,
      totalCount: 4,
    };

    const csv = agingCsv(aging, BUCKET_LABEL);
    const lines = csv.trim().split("\r\n");

    expect(lines[0]).toBe("Bucket,Invoices,Amount");
    expect(lines[1]).toBe("Not yet due,2,1500.00");
    expect(lines[2]).toBe("1 to 30 days,1,250.00");
    expect(lines[5]).toBe("Over 90 days,1,5.00");
    expect(lines[6]).toBe("Total owed,4,1755.00");
    // No "$" anywhere - every amount above is asserted as a plain decimal
    // ("1500.00"), never a formatted currency string.
    expect(csv).not.toContain("$");
  });
});

describe("receivablesCsv", () => {
  it("uses the table's own five column labels and a plain decimal amount", () => {
    const rows: ReceivableRow[] = [
      {
        id: "doc-1",
        number: "INV-2026-0007",
        customer: "Acme Landscaping",
        dueOn: "2026-08-01",
        daysOverdue: 12,
        totalCents: 432100,
      },
      {
        id: "doc-2",
        number: "INV-2026-0009",
        customer: "No customer",
        dueOn: "2026-09-25",
        daysOverdue: 0,
        totalCents: 5000,
      },
    ];

    const csv = receivablesCsv(rows);
    const lines = csv.trim().split("\r\n");

    // A rendered date like "Aug 1, 2026" carries a comma, so `toCsv` quotes
    // that cell the same way it would quote any other cell with one - this
    // is exercising the real CSV-quoting path, not working around it.
    const quotedDue = (dueOn: string) => `"${formatDateDisplay(dueOn)}"`;

    expect(lines[0]).toBe("Number,Customer,Due,Days over,Amount");
    expect(lines[1]).toBe(
      `INV-2026-0007,Acme Landscaping,${quotedDue("2026-08-01")},12,4321.00`,
    );
    // A row that is not yet late keeps the table's own em dash, not a 0.
    expect(lines[2]).toBe(
      `INV-2026-0009,No customer,${quotedDue("2026-09-25")},—,50.00`,
    );
  });
});
