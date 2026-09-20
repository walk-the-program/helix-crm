// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BulkBar } from "@/ui/BulkBar";

afterEach(() => {
  cleanup();
});

const NOUN = { one: "contact", many: "contacts" };

describe("BulkBar", () => {
  it("renders nothing at zero", () => {
    const { container } = render(
      React.createElement(BulkBar, {
        count: 0,
        noun: NOUN,
        onClear: () => {},
        children: "children",
      }),
    );
    expect(container.innerHTML).toBe("");
  });

  it("states the count with the singular noun for one", () => {
    const { getByTestId } = render(
      React.createElement(BulkBar, {
        count: 1,
        noun: NOUN,
        onClear: () => {},
        children: "children",
      }),
    );
    expect(getByTestId("bulk-bar-count").textContent).toBe("1 contact selected");
  });

  it("states the count with the plural noun for more than one", () => {
    const { getByTestId } = render(
      React.createElement(BulkBar, {
        count: 12,
        noun: NOUN,
        onClear: () => {},
        children: "children",
      }),
    );
    expect(getByTestId("bulk-bar-count").textContent).toBe("12 contacts selected");
  });

  it("uses the workspace's own noun (e.g. jobs, not deals)", () => {
    const { getByTestId } = render(
      React.createElement(BulkBar, {
        count: 3,
        noun: { one: "job", many: "jobs" },
        onClear: () => {},
        children: "children",
      }),
    );
    expect(getByTestId("bulk-bar-count").textContent).toBe("3 jobs selected");
  });

  it("renders the passed-in actions", () => {
    const { getByText } = render(
      React.createElement(BulkBar, {
        count: 2,
        noun: NOUN,
        onClear: () => {},
        children: React.createElement("button", null, "Move to trash"),
      }),
    );
    expect(getByText("Move to trash")).toBeTruthy();
  });

  it("calls onClear when Clear is clicked", () => {
    const onClear = vi.fn();
    const { getByRole } = render(
      React.createElement(BulkBar, {
        count: 5,
        noun: NOUN,
        onClear,
        children: "children",
      }),
    );
    fireEvent.click(getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("carries the bulk-bar test id", () => {
    const { getByTestId } = render(
      React.createElement(BulkBar, {
        count: 1,
        noun: NOUN,
        onClear: () => {},
        children: "children",
      }),
    );
    expect(getByTestId("bulk-bar")).toBeTruthy();
  });
});
