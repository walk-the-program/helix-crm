// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Select } from "@/ui";
import { installRadixStubs } from "./radixSetup";

installRadixStubs();

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: "estimate", label: "Estimate sent" },
  { value: "won", label: "Won" },
];

/**
 * The kit's one accessible-label prop is `aria-label`; `ariaLabel` is a
 * deprecated alias kept so no existing caller breaks (docs/DESIGN.md,
 * round-3 CDQO pass). Radix's `Select.Trigger` renders `role="combobox"`.
 */
describe("Select aria-label", () => {
  it("aria-label sets the accessible name", () => {
    render(
      React.createElement(Select, {
        value: "estimate",
        onValueChange: () => {},
        options: OPTIONS,
        "aria-label": "Stage",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Stage" })).toBeTruthy();
  });

  it("the deprecated ariaLabel alias still works", () => {
    render(
      React.createElement(Select, {
        value: "estimate",
        onValueChange: () => {},
        options: OPTIONS,
        ariaLabel: "Stage",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Stage" })).toBeTruthy();
  });

  it("aria-label wins when both are passed", () => {
    render(
      React.createElement(Select, {
        value: "estimate",
        onValueChange: () => {},
        options: OPTIONS,
        "aria-label": "New name",
        ariaLabel: "Old name",
      }),
    );
    expect(screen.getByRole("combobox", { name: "New name" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Old name" })).toBeNull();
  });
});
