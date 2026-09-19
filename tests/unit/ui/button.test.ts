// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/ui";
import type { ButtonProps } from "@/ui";

afterEach(() => {
  cleanup();
});

function renderButton(props: ButtonProps, children: React.ReactNode = "Save") {
  return render(React.createElement(Button, props, children));
}

describe("Button", () => {
  it("disabled: sets the disabled attribute and swallows clicks", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderButton({ disabled: true, onClick });

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveProperty("disabled", true);

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading: disables the button and sets aria-busy=true", () => {
    renderButton({ loading: true });

    const button = screen.getByRole("button");
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("loading with loadingLabel: shows the loading label instead of children, never a bare spinner", () => {
    renderButton({ loading: true, loadingLabel: "Saving…" }, "Save");

    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Saving…");
    expect(button.textContent?.trim().length).toBeGreaterThan(0);
    // The plain "Save" label must not still be present alongside the loading one.
    expect(screen.queryByText("Save", { exact: true })).toBeNull();
  });

  it("does not render iconLeft while loading", () => {
    const icon = React.createElement("svg", { "data-testid": "left-icon" });
    renderButton({ loading: true, loadingLabel: "Saving…", iconLeft: icon });

    expect(screen.queryByTestId("left-icon")).toBeNull();
  });

  it("renders iconLeft when not loading", () => {
    const icon = React.createElement("svg", { "data-testid": "left-icon" });
    renderButton({ iconLeft: icon });

    expect(screen.queryByTestId("left-icon")).toBeTruthy();
  });

  it("reserves the accent token for variant=primary only", () => {
    renderButton({ variant: "primary" }, "Primary");
    const primaryClass = screen.getByRole("button", { name: "Primary" }).className;
    expect(primaryClass).toContain("--color-accent)");
    cleanup();

    renderButton({ variant: "secondary" }, "Secondary");
    const secondaryClass = screen.getByRole("button", { name: "Secondary" }).className;
    expect(secondaryClass).not.toContain("--color-accent)");
    cleanup();

    renderButton({ variant: "ghost" }, "Ghost");
    const ghostClass = screen.getByRole("button", { name: "Ghost" }).className;
    expect(ghostClass).not.toContain("--color-accent)");
    cleanup();

    renderButton({ variant: "danger" }, "Danger");
    const dangerClass = screen.getByRole("button", { name: "Danger" }).className;
    // Danger legitimately carries --color-accent-text) (the readable ink
    // colour on a filled button) — only the base --color-accent) fill token
    // is reserved for primary.
    expect(dangerClass).toContain("--color-accent-text)");
    expect(dangerClass).not.toContain("--color-accent)");
  });
});
