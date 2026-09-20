// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Switch } from "@/ui";

afterEach(() => {
  cleanup();
});

/**
 * The kit's one accessible-label prop is `aria-label`; `ariaLabel` is a
 * deprecated alias kept so no existing caller breaks (docs/DESIGN.md,
 * round-3 CDQO pass).
 */
describe("Switch aria-label", () => {
  it("aria-label sets the accessible name", () => {
    render(
      React.createElement(Switch, {
        checked: false,
        onCheckedChange: () => {},
        "aria-label": "Email notifications",
      }),
    );
    expect(screen.getByRole("switch", { name: "Email notifications" })).toBeTruthy();
  });

  it("the deprecated ariaLabel alias still works", () => {
    render(
      React.createElement(Switch, {
        checked: false,
        onCheckedChange: () => {},
        ariaLabel: "Email notifications",
      }),
    );
    expect(screen.getByRole("switch", { name: "Email notifications" })).toBeTruthy();
  });

  it("aria-label wins when both are passed", () => {
    render(
      React.createElement(Switch, {
        checked: false,
        onCheckedChange: () => {},
        "aria-label": "New name",
        ariaLabel: "Old name",
      }),
    );
    expect(screen.getByRole("switch", { name: "New name" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Old name" })).toBeNull();
  });
});
