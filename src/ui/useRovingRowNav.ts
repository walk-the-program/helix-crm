import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/**
 * Roving-tabindex arrow-key navigation for a list of rows
 * (apple-hig-review.md finding 6 / top-ten item 9: "every row is its own tab
 * stop with no arrow-key handling").
 *
 * One implementation shared by every list that needs it, rather than a copy
 * per screen: `VirtualList` uses it internally for its `keyboardNav` prop
 * (Contacts, Companies, and a long Tasks group), and `TasksScreen` uses it
 * directly for the short groups that render as a plain, fully-mounted
 * `.map()` instead of going through the virtualizer.
 *
 * Up/Down move the roving tab stop to the next or previous *focusable* row
 * (a group header is not one - see `isFocusable`), Home/End jump to the
 * first/last, and Enter (or Space, unless `activateKeys` says otherwise)
 * calls `onActivate`. Only the row that currently holds the roving stop gets
 * `tabIndex={0}`; every other row gets `tabIndex={-1}`, which is what makes
 * Tab move into and out of the list once instead of once per row.
 *
 * `scrollAndFocus` is the only DOM-specific piece, and it is left to the
 * caller because a virtualised list and a fully-mounted one need different
 * strategies: a virtualised row may not exist in the DOM yet, so it has to be
 * scrolled to by index through the virtualizer before it can be focused; a
 * mounted list can just call `scrollIntoView` and focus the node directly.
 */
export type RowNavProps = {
  tabIndex: 0 | -1;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  "data-row-focus": "true";
};

export type UseRovingRowNavOptions = {
  /** Number of rows in the list, focusable or not. */
  count: number;
  /** False for a row that cannot take the roving stop - a group header, for
   *  instance. Every row is focusable when this is omitted. */
  isFocusable?: (index: number) => boolean;
  /** Fired on Enter (and Space, unless `activateKeys` overrides it) while a
   *  row holds the roving stop. */
  onActivate?: (index: number) => void;
  /** Defaults to Enter and Space, matching a `role="button"` row. Pass just
   *  `["Enter"]` for a row whose Space is meaningful for something else (a
   *  nested checkbox, say). */
  activateKeys?: string[];
  /** Scrolls the target row into view and focuses it. Called synchronously
   *  once the roving index is committed, so a virtualised caller can defer
   *  the actual `.focus()` to whatever frame the row mounts on. */
  scrollAndFocus: (index: number) => void;
  /** Any value that should reset the roving stop back to the first focusable
   *  row when it changes identity - the screen's own (memoised) row array is
   *  the usual choice, since that is exactly when a stale index could now
   *  point at a different row, or at a header. */
  resetSignal?: unknown;
};

const DEFAULT_ACTIVATE_KEYS = ["Enter", " "];

export function useRovingRowNav(options: UseRovingRowNavOptions): {
  focusedIndex: number;
  getRowProps: (index: number) => RowNavProps;
} {
  const { count, isFocusable, onActivate, activateKeys, scrollAndFocus, resetSignal } = options;

  const isRowFocusable = useCallback(
    (index: number) => index >= 0 && index < count && (!isFocusable || isFocusable(index)),
    [count, isFocusable],
  );

  const findNavigable = useCallback(
    (start: number, direction: 1 | -1): number | null => {
      let i = start;
      while (i >= 0 && i < count) {
        if (isRowFocusable(i)) return i;
        i += direction;
      }
      return null;
    },
    [count, isRowFocusable],
  );

  const firstFocusable = useCallback(() => findNavigable(0, 1) ?? 0, [findNavigable]);

  const [focusedIndex, setFocusedIndex] = useState<number>(() => firstFocusable());
  const focusedRef = useRef(focusedIndex);
  focusedRef.current = focusedIndex;

  // The row array changed shape underneath us (a filter, a sort, a grouping
  // toggle): if the roving stop no longer points at a focusable row, land
  // back on the first one rather than stranding it on a header or past the
  // end of a now-shorter list.
  useEffect(() => {
    if (!isRowFocusable(focusedRef.current)) {
      setFocusedIndex(firstFocusable());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, resetSignal]);

  const activationKeys = activateKeys ?? DEFAULT_ACTIVATE_KEYS;

  const moveTo = useCallback(
    (target: number | null) => {
      if (target === null || target === focusedRef.current) return;
      setFocusedIndex(target);
      scrollAndFocus(target);
    },
    [scrollAndFocus],
  );

  const getRowProps = useCallback(
    (index: number): RowNavProps => ({
      tabIndex: index === focusedIndex ? 0 : -1,
      onFocus: () => setFocusedIndex(index),
      "data-row-focus": "true",
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            moveTo(findNavigable(index + 1, 1));
            return;
          case "ArrowUp":
            event.preventDefault();
            moveTo(findNavigable(index - 1, -1));
            return;
          case "Home":
            event.preventDefault();
            moveTo(findNavigable(0, 1));
            return;
          case "End":
            event.preventDefault();
            moveTo(findNavigable(count - 1, -1));
            return;
          default:
            break;
        }
        if (onActivate && activationKeys.includes(event.key)) {
          event.preventDefault();
          onActivate(index);
        }
      },
    }),
    [focusedIndex, moveTo, findNavigable, count, onActivate, activationKeys],
  );

  return { focusedIndex, getRowProps };
}
