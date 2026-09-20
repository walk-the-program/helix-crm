// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VirtualList } from "@/ui";
import { installRadixStubs } from "./radixSetup";
import { renderRovingListFixture } from "./fixtures";

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

/**
 * The kit's one accessible-label prop is `aria-label`; `ariaLabel` is a
 * deprecated alias kept so no existing caller breaks (docs/DESIGN.md,
 * round-3 CDQO pass). The suite above already renders with `ariaLabel` and
 * checks it reaches the list (proving the deprecated alias still works);
 * this block adds the other two legs of the same contract.
 */
describe("VirtualList aria-label", () => {
  it("aria-label sets the list's accessible name", () => {
    const items = makeItems(10);
    render(
      React.createElement(VirtualList<Row>, {
        items,
        estimateSize: ESTIMATE_SIZE,
        renderRow: (item: Row) => React.createElement("span", null, item.label),
        "aria-label": "Companies",
      }),
    );
    expect(screen.getByRole("list", { name: "Companies" })).toBeTruthy();
  });

  it("aria-label wins when both are passed", () => {
    const items = makeItems(10);
    render(
      React.createElement(VirtualList<Row>, {
        items,
        estimateSize: ESTIMATE_SIZE,
        renderRow: (item: Row) => React.createElement("span", null, item.label),
        "aria-label": "New name",
        ariaLabel: "Old name",
      }),
    );
    expect(screen.getByRole("list", { name: "New name" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Old name" })).toBeNull();
  });
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

/**
 * `keyboardNav`: roving tabIndex, arrow-key movement, and Enter/Space
 * activation over VirtualList's own rows (apple-hig-review.md finding 6 /
 * top-ten item 9 - "arrow-key row navigation with Enter to open, matching the
 * keyboard path the pipeline board already has"). ContactsScreen and
 * CompaniesScreen wire this exact prop; RovingListFixture (fixtures.tsx)
 * mirrors that wiring with a plain row.
 */
describe("VirtualList keyboardNav", () => {
  function makeRows(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `row-${index}`,
      label: `Item ${index}`,
    }));
  }

  it("gives exactly one row tabIndex 0 - the roving stop, not one tab stop per row", () => {
    const items = makeRows(5);
    renderRovingListFixture({ items, onActivate: vi.fn() });

    const rows = items.map((item) => screen.getByTestId(item.id));
    const tabbable = rows.filter((row) => row.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(rows[0].tabIndex).toBe(0);
    rows.slice(1).forEach((row) => expect(row.tabIndex).toBe(-1));
  });

  it("ArrowDown moves DOM focus to the next row and updates the roving tabIndex", async () => {
    const items = makeRows(5);
    renderRovingListFixture({ items, onActivate: vi.fn() });

    const rows = items.map((item) => screen.getByTestId(item.id));
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });

    await waitFor(() => expect(document.activeElement).toBe(rows[1]));
    expect(rows[1].tabIndex).toBe(0);
    expect(rows[0].tabIndex).toBe(-1);
  });

  it("Enter on the focused row fires the activate handler with that row's item", () => {
    const items = makeRows(3);
    const onActivate = vi.fn();
    renderRovingListFixture({ items, onActivate });

    const rows = items.map((item) => screen.getByTestId(item.id));
    fireEvent.keyDown(rows[0], { key: "Enter" });

    expect(onActivate).toHaveBeenCalledWith("row-0");
  });
});

/**
 * `fit`: the list stops at its last row instead of painting a slab of surface
 * white underneath it, and it still has a real height for the virtualiser to
 * measure — which is why simply dropping `flex-1` at the call site is not the
 * fix (the scroll element then measures zero and no row renders at all).
 */
describe("VirtualList fit", () => {
  it("takes the rows' own height and shrinks rather than grows", () => {
    render(
      React.createElement(VirtualList<Row>, {
        items: makeItems(4),
        estimateSize: 40,
        fit: true,
        "aria-label": "Contacts",
        renderRow: (item: Row) => React.createElement("div", null, item.label),
      }),
    );
    const list = screen.getByRole("list", { name: "Contacts" });
    expect(list.getAttribute("data-fit")).toBe("");
    expect(list.style.flex).toBe("0 0 auto");
    // The scroller is exactly as tall as the virtualiser's own sizer — the
    // content — so there is nothing left over to paint white.
    const sizer = list.firstElementChild as HTMLElement;
    expect(list.style.height).toBe(sizer.style.height);
    expect(Number.parseFloat(list.style.height)).toBeGreaterThan(0);
  });

  /**
   * The bug the first version of this prop shipped: with no rows yet, the
   * content height is zero, and a list that took its height from its content
   * collapsed, measured a zero-height viewport, and then had nowhere to render
   * the rows into when they arrived. An empty list, permanently. So with no
   * content the height is the whole of the space available instead.
   */
  it("still has a viewport before any row exists", () => {
    render(
      React.createElement(VirtualList<Row>, {
        items: [],
        estimateSize: 40,
        fit: true,
        "aria-label": "Empty",
        renderRow: (item: Row) => React.createElement("div", null, item.label),
      }),
    );
    const list = screen.getByRole("list", { name: "Empty" });
    expect(Number.parseFloat(list.style.height)).toBeGreaterThan(0);
    expect(list.style.flex).toBe("0 0 auto");
  });

  /** A long list is capped and scrolls rather than running off the screen. */
  it("caps at the space available and keeps scrolling", () => {
    render(
      React.createElement(VirtualList<Row>, {
        items: makeItems(500),
        estimateSize: 40,
        fit: true,
        "aria-label": "Long",
        renderRow: (item: Row) => React.createElement("div", null, item.label),
      }),
    );
    const list = screen.getByRole("list", { name: "Long" });
    const max = Number.parseFloat(list.style.maxHeight);
    expect(max).toBeGreaterThan(0);
    expect(Number.parseFloat(list.style.height)).toBeLessThanOrEqual(max);
    expect(list.className).toContain("overflow-auto");
  });

  it("keeps a measurable, non-zero height so the rows still render", () => {
    render(
      React.createElement(VirtualList<Row>, {
        items: makeItems(3),
        estimateSize: 40,
        fit: true,
        "aria-label": "Companies",
        renderRow: (item: Row) => React.createElement("div", null, item.label),
      }),
    );
    expect(Number.parseFloat(screen.getByRole("list", { name: "Companies" }).style.height)).
      toBeGreaterThan(0);
    expect(screen.getByText("Item 0")).toBeTruthy();
  });

  it("changes nothing at all when it is off", () => {
    render(
      React.createElement(VirtualList<Row>, {
        items: makeItems(4),
        estimateSize: 40,
        "aria-label": "Plain",
        renderRow: (item: Row) => React.createElement("div", null, item.label),
      }),
    );
    const list = screen.getByRole("list", { name: "Plain" });
    expect(list.hasAttribute("data-fit")).toBe(false);
    expect(list.style.height).toBe("");
    expect(list.style.flex).toBe("");
    expect(list.style.maxHeight).toBe("");
  });
});
