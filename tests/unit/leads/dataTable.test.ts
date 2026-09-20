// @vitest-environment jsdom
/**
 * DataTable's `dashZero` column option (CDQO phase two design review,
 * decision A): a period table's own zero cell carries the kit's `TD
 * dashZero` treatment (`data-zero`, faint ink) rather than reading as one
 * more "$0.00" the eye has to discard, while a real, non-zero cell in the
 * same column renders and carries ink normally. `docs/DESIGN.md` rule 1 and
 * 5; `src/ui/Table.tsx`'s `TD` and `src/app/formats.ts`'s `moneyOrDash` are
 * the kit-level half of the same convention this wires per column.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

const { renderMoneyTable } = await import("./dataTable.fixtures");

afterEach(cleanup);

describe("DataTable dashZero", () => {
  it("marks a zero cell with the kit's dash treatment and renders the dash text", () => {
    const { container } = renderMoneyTable([{ id: "r1", label: "No job", cents: 0 }]);

    const cell = screen.getByText("—");
    expect(cell.closest("td")?.getAttribute("data-zero")).toBe("");
    // Exactly one dashed cell for one zero-valued row.
    expect(container.querySelectorAll("td[data-zero]")).toHaveLength(1);
  });

  it("leaves a non-zero cell in the same column undashed", () => {
    const { container } = renderMoneyTable([{ id: "r1", label: "Weed control", cents: 361_000 }]);

    screen.getByText("$3610.00");
    expect(container.querySelectorAll("td[data-zero]")).toHaveLength(0);
  });

  it("dashes only the zero rows in a mixed table, never the real numbers beside them", () => {
    const { container } = renderMoneyTable([
      { id: "r1", label: "Quoted in an earlier month", cents: 0 },
      { id: "r2", label: "Won this month", cents: 361_000 },
    ]);

    expect(container.querySelectorAll("td[data-zero]")).toHaveLength(1);
    screen.getByText("$3610.00");
    screen.getByText("—");
  });
});
