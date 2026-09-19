// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installRadixStubs } from "./radixSetup";
import { renderDropdownMenuFixture } from "./fixtures";

installRadixStubs();

afterEach(() => {
  cleanup();
});

// Radix's dropdown menu moves real DOM focus between items (a roving
// tabindex group backed by @radix-ui/react-roving-focus) and toggles
// data-highlighted from the same onFocus/onBlur handlers, so the two signals
// stay in lockstep here. These tests assert on document.activeElement, since
// it is the one jsdom reports without any ambiguity.

describe("DropdownMenu", () => {
  it("opens on Enter and moves focus into the menu", async () => {
    const user = userEvent.setup();
    renderDropdownMenuFixture();

    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it("opens on Space and moves focus into the menu", async () => {
    const user = userEvent.setup();
    renderDropdownMenuFixture();

    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await user.keyboard(" ");

    const menu = await screen.findByRole("menu");
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it("moves the highlight with ArrowDown/ArrowUp and skips a disabled item", async () => {
    const user = userEvent.setup();
    renderDropdownMenuFixture();

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");

    const alpha = screen.getByRole("menuitem", { name: "Alpha" });
    const gamma = screen.getByRole("menuitem", { name: "Gamma" });

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(alpha);
    expect(alpha.getAttribute("data-highlighted")).toBe("");

    // Beta is disabled and must be skipped entirely.
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(gamma);
    expect(gamma.getAttribute("data-highlighted")).toBe("");

    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(alpha);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderDropdownMenuFixture();

    const trigger = screen.getByRole("button", { name: "Actions" });
    await user.click(trigger);
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("fires onSelect for the highlighted item on Enter and closes the menu", async () => {
    const user = userEvent.setup();
    const onSelectAlpha = vi.fn();
    renderDropdownMenuFixture({ onSelectAlpha });

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await screen.findByRole("menu");

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Alpha" }));

    await user.keyboard("{Enter}");

    expect(onSelectAlpha).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });
});
