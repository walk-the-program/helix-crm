/**
 * The pure arithmetic behind the deal page's "Add services" control
 * (`DealServicesPanel`).
 *
 * The picker is a `MultiCombobox` whose `values` are the catalog ids already
 * on the deal, so a tick is "add this service" and an untick is "remove the
 * line for it" - the checkbox always tells the truth about what is on the
 * deal, including after a reopen. "Custom line" is not a real catalog row; it
 * rides along in the same list as a sentinel id so it is always the first
 * option, and this function is what keeps that sentinel from ever being
 * treated as a service to add or remove.
 */

/** Not a real product id - a synthetic row pinned to the top of the picker's
 *  results so "Custom line" is always one option among the real services. */
export const CUSTOM_LINE_ID = "__custom_line__";

export type ServiceSelectionDiff = {
  /** Catalog ids newly ticked: add each as a deal item. */
  added: string[];
  /** Catalog ids newly unticked: remove the deal item for each. */
  removed: string[];
  /** The synthetic "Custom line" row was ticked this call. */
  customLineRequested: boolean;
};

/**
 * `previousIds` is what the deal's lines say right now (their product ids,
 * deduplicated); `nextIdsRaw` is whatever `MultiCombobox.onChange` just
 * reported, which may include the "Custom line" sentinel.
 */
export function diffServiceSelection(
  previousIds: readonly string[],
  nextIdsRaw: readonly string[],
): ServiceSelectionDiff {
  const customLineRequested = nextIdsRaw.includes(CUSTOM_LINE_ID);
  const nextIds = nextIdsRaw.filter((id) => id !== CUSTOM_LINE_ID);
  const previousSet = new Set(previousIds);
  const nextSet = new Set(nextIds);

  return {
    added: nextIds.filter((id) => !previousSet.has(id)),
    removed: previousIds.filter((id) => !nextSet.has(id)),
    customLineRequested,
  };
}
