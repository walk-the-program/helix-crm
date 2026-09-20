// @vitest-environment jsdom
/**
 * The table rules the kit owns, so no screen has to re-derive them
 * (phase-two design direction, rules 1 and 7).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Table, THead, TBody, TFoot, TR, TH, TD, TableScroll } from "@/ui";

afterEach(() => {
  cleanup();
});

function renderTable() {
  return render(
    <Table>
      <THead>
        <TR>
          <TH>Name</TH>
          <TH align="right">Value</TH>
        </TR>
      </THead>
      <TBody>
        <TR>
          <TD primary>Ana</TD>
          <TD align="right">$40.00</TD>
        </TR>
        <TR>
          <TD primary>Bo</TD>
          <TD align="right" dashZero data-testid="zero">
            —
          </TD>
        </TR>
      </TBody>
      <TFoot>
        <TR>
          <TD>Total</TD>
          <TD align="right">$40.00</TD>
        </TR>
      </TFoot>
    </Table>,
  );
}

describe("Table", () => {
  /**
   * The empty panel below the last row. Every screen was patching this out by
   * hand with `[&>tr:last-child]:border-b-0`, which meant the ones that forgot
   * drew a row rule and the surface's own border as a double line with a white
   * band trapped between them.
   */
  it("does not draw a hairline under the last row", () => {
    const { container } = renderTable();
    const tbody = container.querySelector("tbody");
    expect(tbody?.className).toContain("[&>tr:last-child]:border-b-0");
  });

  it("keeps a caller's own tbody class alongside the last-row rule", () => {
    const { container } = render(
      <Table>
        <TBody className="text-left">
          <TR>
            <TD>x</TD>
          </TR>
        </TBody>
      </Table>,
    );
    const tbody = container.querySelector("tbody");
    expect(tbody?.className).toContain("[&>tr:last-child]:border-b-0");
    expect(tbody?.className).toContain("text-left");
  });

  /** A numeric column asks for align="right"; it never brings its own classes. */
  it("stamps data-numeric and tabular figures on a right-aligned cell", () => {
    renderTable();
    const zero = screen.getByTestId("zero");
    expect(zero.getAttribute("data-numeric")).toBe("");
    expect(zero.className).toContain("tabular-nums");
    expect(zero.className).toContain("text-right");
  });

  /** A zero in a period table is a dash in faint ink, and says so in the DOM. */
  it("draws a dashZero cell in faint ink", () => {
    renderTable();
    const zero = screen.getByTestId("zero");
    expect(zero.getAttribute("data-zero")).toBe("");
    expect(zero.className).toContain("text-[var(--color-text-faint)]");
    const paid = screen.getByText("$40.00", { selector: "tbody td" });
    expect(paid.hasAttribute("data-zero")).toBe(false);
    expect(paid.className).not.toContain("text-[var(--color-text-faint)]");
  });

  /** Density is a token, so nothing in the kit's table hard-codes a height. */
  it("sizes its rows from --row-h, never from a pixel", () => {
    renderTable();
    const cell = screen.getByTestId("zero");
    expect(cell.className).toContain("h-[var(--row-h)]");
    expect(cell.className).not.toMatch(/h-\[\d+px\]/);
  });

  /** The sticky header needs a scrollport; TableScroll is it. */
  it("gives the sticky header a bounded scroll region", () => {
    render(
      <TableScroll maxHeight="calc(100vh - 20rem)" data-testid="scroll">
        <Table />
      </TableScroll>,
    );
    const scroll = screen.getByTestId("scroll");
    expect(scroll.className).toContain("overflow-y-auto");
    expect(scroll.className).toContain("min-h-0");
    expect(scroll.style.maxHeight).toBe("calc(100vh - 20rem)");
  });

  it("leaves the header sticky so it survives inside that region", () => {
    const { container } = renderTable();
    expect(container.querySelector("thead")?.className).toContain("sticky");
  });
});
