// @vitest-environment jsdom
/**
 * The roving-tabindex arrow-key hook shared by VirtualList's `keyboardNav`
 * and TasksScreen's non-virtualised groups (apple-hig-review.md finding 6 /
 * top-ten item 9).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { useRovingRowNav } from "@/ui";

function keyEvent(key: string): KeyboardEvent<HTMLElement> {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLElement>;
}

describe("useRovingRowNav", () => {
  it("starts the roving stop on row 0: exactly one row is tabIndex 0", () => {
    const { result } = renderHook(() => useRovingRowNav({ count: 3, scrollAndFocus: vi.fn() }));

    expect(result.current.focusedIndex).toBe(0);
    expect(result.current.getRowProps(0).tabIndex).toBe(0);
    expect(result.current.getRowProps(1).tabIndex).toBe(-1);
    expect(result.current.getRowProps(2).tabIndex).toBe(-1);
  });

  it("ArrowDown moves the roving stop forward and scrolls/focuses the new row", () => {
    const scrollAndFocus = vi.fn();
    const { result } = renderHook(() => useRovingRowNav({ count: 3, scrollAndFocus }));

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("ArrowDown")));

    expect(result.current.focusedIndex).toBe(1);
    expect(scrollAndFocus).toHaveBeenCalledWith(1);
    expect(result.current.getRowProps(1).tabIndex).toBe(0);
    expect(result.current.getRowProps(0).tabIndex).toBe(-1);
  });

  it("ArrowUp moves the roving stop back and stops at the first row", () => {
    const scrollAndFocus = vi.fn();
    const { result } = renderHook(() => useRovingRowNav({ count: 3, scrollAndFocus }));

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("ArrowDown")));
    act(() => result.current.getRowProps(1).onKeyDown(keyEvent("ArrowUp")));
    expect(result.current.focusedIndex).toBe(0);

    scrollAndFocus.mockClear();
    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("ArrowUp")));
    expect(result.current.focusedIndex).toBe(0);
    expect(scrollAndFocus).not.toHaveBeenCalled();
  });

  it("ArrowDown stops at the last row rather than wrapping", () => {
    const scrollAndFocus = vi.fn();
    const { result } = renderHook(() => useRovingRowNav({ count: 2, scrollAndFocus }));

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("ArrowDown")));
    expect(result.current.focusedIndex).toBe(1);

    scrollAndFocus.mockClear();
    act(() => result.current.getRowProps(1).onKeyDown(keyEvent("ArrowDown")));
    expect(result.current.focusedIndex).toBe(1);
    expect(scrollAndFocus).not.toHaveBeenCalled();
  });

  it("Home and End jump to the first and last row", () => {
    const scrollAndFocus = vi.fn();
    const { result } = renderHook(() => useRovingRowNav({ count: 5, scrollAndFocus }));

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("End")));
    expect(result.current.focusedIndex).toBe(4);

    act(() => result.current.getRowProps(4).onKeyDown(keyEvent("Home")));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("skips a row isFocusable marks unfocusable, such as a group header", () => {
    const scrollAndFocus = vi.fn();
    // Row 1 stands in for a flattened group header: present in the list, but
    // not something the roving stop may land on.
    const isFocusable = (index: number) => index !== 1;
    const { result } = renderHook(() =>
      useRovingRowNav({ count: 3, isFocusable, scrollAndFocus }),
    );

    expect(result.current.focusedIndex).toBe(0);
    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("ArrowDown")));
    expect(result.current.focusedIndex).toBe(2);

    act(() => result.current.getRowProps(2).onKeyDown(keyEvent("ArrowUp")));
    expect(result.current.focusedIndex).toBe(0);
  });

  it("Enter and Space call onActivate with the focused row's index", () => {
    const onActivate = vi.fn();
    const { result } = renderHook(() =>
      useRovingRowNav({ count: 2, onActivate, scrollAndFocus: vi.fn() }),
    );

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("Enter")));
    expect(onActivate).toHaveBeenCalledWith(0);

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent(" ")));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("activateKeys can narrow activation to just Enter", () => {
    const onActivate = vi.fn();
    const { result } = renderHook(() =>
      useRovingRowNav({ count: 2, onActivate, activateKeys: ["Enter"], scrollAndFocus: vi.fn() }),
    );

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent(" ")));
    expect(onActivate).not.toHaveBeenCalled();

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("Enter")));
    expect(onActivate).toHaveBeenCalledWith(0);
  });

  it("resets the roving stop to the first focusable row once the old one stops being valid", () => {
    const scrollAndFocus = vi.fn();
    let isFocusable = (_index: number) => true;
    const { result, rerender } = renderHook(
      (props: { resetSignal: string }) =>
        useRovingRowNav({ count: 3, isFocusable, scrollAndFocus, resetSignal: props.resetSignal }),
      { initialProps: { resetSignal: "a" } },
    );

    act(() => result.current.getRowProps(0).onKeyDown(keyEvent("ArrowDown")));
    expect(result.current.focusedIndex).toBe(1);

    // Row 1 is now a header (a sort/filter change reshaped the list) and the
    // reset signal - the screen's memoised row array - changes identity.
    isFocusable = (index: number) => index !== 1;
    act(() => rerender({ resetSignal: "b" }));

    expect(result.current.focusedIndex).toBe(0);
  });
});
