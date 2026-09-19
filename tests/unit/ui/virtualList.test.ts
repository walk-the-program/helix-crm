// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VirtualList } from "@/ui";
import { installRadixStubs } from "./radixSetup";

installRadixStubs();

type Row = { id: string; label: string };

function makeItems(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    label: `Item ${index}`,
  }));
}

/**
 * jsdom does no layout, so every element reports offsetHeight 0. @tanstack/
 * react-virtual reads the scroll container's height straight off
 * `element.offsetHeight` (see @tanstack/virtual-core's `getRect`) to decide
 * how many rows fit on screen, so without this stub the virtualizer believes
 * its viewport is 0px tall.
 *
 * VirtualList also wires `ref={virtualizer.measureElement}` onto every row,
 * which re-measures each mounted row's real `offsetHeight` against its
 * estimate the moment it mounts. If that real height (0, unstubbed) disagrees
 * with `estimateSize`, the virtualizer schedules a re-render to correct it —
 * which mounts a possibly-different set of rows, which measure 0 again, and
 * so on forever ("Maximum update depth exceeded"). So every element, not
 * just the scroll container, needs a stubbed height, and row items are given
 * exactly `estimateSize` so their "real" measurement always agrees with the
 * estimate and the virtualizer never re-measures a second time.
 */
function stubElementHeights(containerHeight: number, itemHeight: number): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute("role") === "list" ? containerHeight : itemHeight;
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
    }
  };
}

const ESTIMATE_SIZE = 48;
let restoreOffsetHeight: (() => void) | null = null;

beforeEach(() => {
  restoreOffsetHeight = stubElementHeights(480, ESTIMATE_SIZE);
});

afterEach(() => {
  restoreOffsetHeight?.();
  restoreOffsetHeight = null;
  cleanup();
});

describe("VirtualList", () => {
  it("renders only a small window of rows out of 10,000, with the first item present and the last absent", () => {
    const items = makeItems(10000);
    render(
      React.createElement(VirtualList<Row>, {
        items,
        estimateSize: ESTIMATE_SIZE,
        renderRow: (item: Row) => React.createElement("span", null, item.label),
        ariaLabel: "Companies",
      }),
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeLessThan(60);
    expect(rows.length).toBeGreaterThan(0);

    expect(screen.getByText("Item 0")).toBeTruthy();
    expect(screen.queryByText("Item 9999")).toBeNull();
  });

  it("sizes the inner sizer to roughly count * estimateSize", () => {
    const items = makeItems(10000);
    render(
      React.createElement(VirtualList<Row>, {
        items,
        estimateSize: ESTIMATE_SIZE,
        renderRow: (item: Row) => React.createElement("span", null, item.label),
        ariaLabel: "Companies",
      }),
    );

    const list = screen.getByRole("list", { name: "Companies" });
    const sizer = list.firstElementChild as HTMLElement;
    expect(sizer).toBeTruthy();

    const expectedTotal = items.length * ESTIMATE_SIZE;
    const actualTotal = parseFloat(sizer.style.height);
    // Allow a small tolerance either side rather than an exact pixel match.
    expect(actualTotal).toBeGreaterThan(expectedTotal * 0.95);
    expect(actualTotal).toBeLessThanOrEqual(expectedTotal * 1.05);
  });

  it("honours getKey and puts ariaLabel on the list", () => {
    const items = makeItems(10000);
    const getKey = vi.fn((item: Row) => item.id);
    render(
      React.createElement(VirtualList<Row>, {
        items,
        estimateSize: ESTIMATE_SIZE,
        renderRow: (item: Row) => React.createElement("span", null, item.label),
        getKey,
        ariaLabel: "Companies",
      }),
    );

    expect(getKey).toHaveBeenCalled();
    expect(getKey).toHaveBeenCalledWith(items[0], 0);

    expect(screen.getByRole("list", { name: "Companies" })).toBeTruthy();
  });
});
