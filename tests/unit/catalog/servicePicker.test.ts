import { describe, expect, it } from "vitest";
import { CUSTOM_LINE_ID, diffServiceSelection } from "@/features/catalog/lib/servicePicker";

describe("diffServiceSelection", () => {
  it("reports every newly ticked id as added when nothing was ticked before", () => {
    const result = diffServiceSelection([], ["svc-1", "svc-2"]);
    expect(result.added).toEqual(["svc-1", "svc-2"]);
    expect(result.removed).toEqual([]);
    expect(result.customLineRequested).toBe(false);
  });

  it("reports an untick as removed", () => {
    const result = diffServiceSelection(["svc-1", "svc-2"], ["svc-1"]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(["svc-2"]);
  });

  it("reports both an add and a remove in the same change", () => {
    const result = diffServiceSelection(["svc-1"], ["svc-2"]);
    expect(result.added).toEqual(["svc-2"]);
    expect(result.removed).toEqual(["svc-1"]);
  });

  it("changes nothing when the selection is unchanged", () => {
    const result = diffServiceSelection(["svc-1", "svc-2"], ["svc-1", "svc-2"]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("strips the custom-line sentinel out of added/removed and flags it separately", () => {
    const result = diffServiceSelection(["svc-1"], ["svc-1", CUSTOM_LINE_ID, "svc-2"]);
    expect(result.added).toEqual(["svc-2"]);
    expect(result.removed).toEqual([]);
    expect(result.customLineRequested).toBe(true);
    expect(result.added).not.toContain(CUSTOM_LINE_ID);
  });

  it("never reports the sentinel as removed once it drops back out of the selection", () => {
    const result = diffServiceSelection(["svc-1"], ["svc-1"]);
    expect(result.customLineRequested).toBe(false);
    expect(result.removed).toEqual([]);
  });
});
