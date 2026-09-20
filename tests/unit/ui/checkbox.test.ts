// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Checkbox } from "@/ui";

afterEach(() => {
  cleanup();
});

/**
 * The kit's one accessible-label prop is `aria-label`; `ariaLabel` is a
 * deprecated alias kept so no existing caller breaks (docs/DESIGN.md,
 * round-3 CDQO pass). These three cases are the contract every component
 * that carries the alias has to hold.
 */
describe("Checkbox aria-label", () => {
  it("aria-label sets the accessible name", () => {
    render(
      React.createElement(Checkbox, {
        checked: false,
        onCheckedChange: () => {},
        "aria-label": "Select row",
      }),
    );
    expect(screen.getByRole("checkbox", { name: "Select row" })).toBeTruthy();
  });

  it("the deprecated ariaLabel alias still works", () => {
    render(
      React.createElement(Checkbox, {
        checked: false,
        onCheckedChange: () => {},
        ariaLabel: "Select row",
      }),
    );
    expect(screen.getByRole("checkbox", { name: "Select row" })).toBeTruthy();
  });

  it("aria-label wins when both are passed", () => {
    render(
      React.createElement(Checkbox, {
        checked: false,
        onCheckedChange: () => {},
        "aria-label": "New name",
        ariaLabel: "Old name",
      }),
    );
    expect(screen.getByRole("checkbox", { name: "New name" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Old name" })).toBeNull();
  });
});
