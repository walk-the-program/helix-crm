// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { trashSuffix, TrashMark } from "@/features/records/components/RecordChip";

afterEach(() => {
  cleanup();
});

/** F-LA-9 / F-W1-4: the one shared mark for a trashed linked record. */
describe("trashSuffix", () => {
  it("is empty for a live record", () => {
    expect(trashSuffix(null)).toBe("");
  });

  it("is ' (in Trash)' for a deleted record", () => {
    expect(trashSuffix("2026-06-10T00:00:00.000Z")).toBe(" (in Trash)");
  });
});

describe("TrashMark", () => {
  it("renders nothing for a live record", () => {
    const { container } = render(React.createElement(TrashMark, { deletedAt: null }));
    expect(container.innerHTML).toBe("");
  });

  it("renders the muted suffix for a trashed record", () => {
    const { container } = render(
      React.createElement(TrashMark, { deletedAt: "2026-06-10T00:00:00.000Z" }),
    );
    const mark = container.querySelector("span");
    expect(mark?.textContent).toBe(" (in Trash)");
    expect(mark?.className).toContain("text-[var(--color-text-faint)]");
  });
});
