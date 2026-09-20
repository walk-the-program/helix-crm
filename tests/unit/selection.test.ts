import { describe, expect, it } from "vitest";
import {
  clear,
  count,
  emptySelection,
  isSelected,
  reconcile,
  selectAll,
  selectedInOrder,
  selectOnly,
  selectRange,
  toggle,
  type SelectionState,
} from "@/lib/selection";

const ORDER = ["a", "b", "c", "d", "e"];

describe("selectOnly", () => {
  it("replaces the selection with just the one row", () => {
    const state = toggle(toggle(emptySelection, "a"), "b");
    const next = selectOnly(state, "c");
    expect([...next.ids]).toEqual(["c"]);
    expect(next.anchor).toBe("c");
  });
});

describe("toggle", () => {
  it("adds an unselected row and sets the anchor", () => {
    const next = toggle(emptySelection, "a");
    expect(isSelected(next, "a")).toBe(true);
    expect(next.anchor).toBe("a");
  });

  it("removes a selected row", () => {
    const state = toggle(emptySelection, "a");
    const next = toggle(state, "a");
    expect(isSelected(next, "a")).toBe(false);
  });

  it("does not disturb other selected rows", () => {
    const state = toggle(toggle(emptySelection, "a"), "b");
    const next = toggle(state, "c");
    expect([...next.ids].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("selectAll", () => {
  it("selects every id in the given order", () => {
    const next = selectAll(ORDER);
    expect(count(next)).toBe(ORDER.length);
    for (const id of ORDER) expect(isSelected(next, id)).toBe(true);
  });

  it("anchors on the last id", () => {
    const next = selectAll(ORDER);
    expect(next.anchor).toBe("e");
  });

  it("is empty for an empty list", () => {
    const next = selectAll([]);
    expect(count(next)).toBe(0);
    expect(next.anchor).toBeNull();
  });
});

describe("clear", () => {
  it("returns the empty selection", () => {
    expect(clear()).toEqual(emptySelection);
  });
});

describe("reconcile", () => {
  it("drops ids that vanished from the ordered list", () => {
    const state: SelectionState = { ids: new Set(["a", "b", "z"]), anchor: "b" };
    const next = reconcile(state, ORDER);
    expect([...next.ids].sort()).toEqual(["a", "b"]);
  });

  it("clears the anchor when the anchor itself vanished", () => {
    const state: SelectionState = { ids: new Set(["a"]), anchor: "z" };
    const next = reconcile(state, ORDER);
    expect(next.anchor).toBeNull();
  });

  it("returns the same object when nothing changed (scrolling must be a no-op)", () => {
    const state: SelectionState = { ids: new Set(["a", "b"]), anchor: "a" };
    const next = reconcile(state, ORDER);
    expect(next).toBe(state);
  });

  it("is a no-op on the empty selection", () => {
    expect(reconcile(emptySelection, ORDER)).toBe(emptySelection);
  });
});

describe("selectRange", () => {
  it("selects the inclusive run from the anchor forward", () => {
    const state = toggle(emptySelection, "b"); // anchor = b
    const next = selectRange(state, "d", ORDER);
    expect([...next.ids].sort()).toEqual(["b", "c", "d"]);
  });

  it("selects the inclusive run when the target is BELOW the anchor", () => {
    const state = toggle(emptySelection, "d"); // anchor = d
    const next = selectRange(state, "b", ORDER);
    expect([...next.ids].sort()).toEqual(["b", "c", "d"]);
  });

  it("keeps everything already selected outside the new range", () => {
    const state: SelectionState = { ids: new Set(["a", "e"]), anchor: "e" };
    const next = selectRange(state, "d", ORDER);
    expect([...next.ids].sort()).toEqual(["a", "d", "e"]);
  });

  it("behaves like toggle when there is no anchor", () => {
    const next = selectRange(emptySelection, "c", ORDER);
    expect([...next.ids]).toEqual(["c"]);
    expect(next.anchor).toBe("c");
  });

  it("behaves like toggle when the shift-clicked id is no longer in the list", () => {
    const state = toggle(emptySelection, "b");
    const next = selectRange(state, "missing", ORDER);
    // toggle("missing") on top of {b}: adds "missing", anchor moves to it.
    expect([...next.ids].sort()).toEqual(["b", "missing"]);
    expect(next.anchor).toBe("missing");
  });

  it("behaves like toggle when the anchor itself is no longer in the list", () => {
    const state: SelectionState = { ids: new Set(["gone"]), anchor: "gone" };
    const next = selectRange(state, "c", ORDER);
    expect([...next.ids].sort()).toEqual(["c", "gone"]);
    expect(next.anchor).toBe("c");
  });
});

describe("selectedInOrder", () => {
  it("returns selected ids in the list's own order, not insertion order", () => {
    const state: SelectionState = { ids: new Set(["d", "a", "c"]), anchor: "d" };
    expect(selectedInOrder(state, ORDER)).toEqual(["a", "c", "d"]);
  });
});
