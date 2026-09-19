// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installRadixStubs } from "./radixSetup";
import { renderConfirmDialogFixture, renderDialogFixture } from "./fixtures";

installRadixStubs();

afterEach(() => {
  cleanup();
});

describe("Dialog", () => {
  /**
   * The height bound. A form taller than the window used to run its footer off
   * the bottom of the screen and the Save button was unreachable — the settings
   * e2e caught it as "element is outside of the viewport". The fix lives in the
   * shared component so every call site gets it, and it cannot be seen in the
   * component gallery, whose harness forces `position: static` on overlay
   * content to render it inline. So it is asserted here.
   */
  it("caps its own height and scrolls internally, with the header and footer pinned", async () => {
    const user = userEvent.setup();
    renderDialogFixture();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    const dialog = screen.getByRole("dialog");
    const classes = dialog.className;
    expect(classes).toContain("max-h-[calc(100vh-var(--space-9)*2)]");
    expect(classes).toContain("flex-col");
    expect(classes).toContain("overflow-hidden");

    // The one scroll box, between the panel edge and the content.
    const scroller = dialog.querySelector(".overflow-y-auto");
    expect(scroller).toBeTruthy();
    expect(scroller?.className).toContain("min-h-0");
    expect(scroller?.className).toContain("flex-1");

    // The header sticks to the top of that box and the footer to the bottom,
    // so the confirm button is reachable however tall the form is.
    const heading = screen.getByRole("heading", { level: 2 });
    const header = heading.parentElement;
    expect(header?.className).toContain("sticky");
    expect(header?.className).toContain("top-0");

    cleanup();
    renderConfirmDialogFixture({ destructive: true });
    const footer = screen.getByRole("button", { name: "Delete" }).parentElement;
    expect(footer?.className).toContain("sticky");
    expect(footer?.className).toContain("bottom-0");
  });


  it("closes on Escape: onOpenChange(false) fires and the content leaves the DOM", async () => {
    const user = userEvent.setup();
    const onOpenChangeSpy = vi.fn();
    renderDialogFixture({ onOpenChangeSpy });

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("traps focus inside the dialog and wraps Tab from the last element to the first", async () => {
    const user = userEvent.setup();
    renderDialogFixture();

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = screen.getByRole("dialog");

    // Focus starts somewhere inside the dialog once it opens.
    expect(dialog.contains(document.activeElement)).toBe(true);

    const firstAction = screen.getByRole("button", { name: "First action" });
    const lastAction = screen.getByRole("button", { name: "Last action" });
    const closeButton = screen.getByRole("button", { name: "Close" });

    // Walk forward through every tabbable element in the dialog and confirm
    // focus never lands outside it, then confirm Tab from the very last
    // focusable element (the close button) wraps back to the first.
    await user.click(firstAction);
    await user.tab();
    expect(document.activeElement).toBe(lastAction);
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.tab();
    expect(document.activeElement).toBe(closeButton);
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.tab();
    expect(document.activeElement).toBe(firstAction);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the trigger after closing", async () => {
    const user = userEvent.setup();
    renderDialogFixture();

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });
});

// Each ConfirmDialog fixture renders already open (it has no trigger of its
// own — it is controlled from outside), so focus assertions can run
// immediately after render.
describe("ConfirmDialog", () => {
  it("focuses the Cancel button first — the safe action is the one the keyboard lands on", () => {
    renderConfirmDialogFixture();

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancelButton);
  });

  it("clicking Cancel closes the dialog without calling onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChangeSpy = vi.fn();
    renderConfirmDialogFixture({ onConfirm, onOpenChangeSpy });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
  });

  it("renders the destructive confirm button with danger styling and calls onConfirm exactly once", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderConfirmDialogFixture({ destructive: true, onConfirm, confirmLabel: "Delete" });

    const confirmButton = screen.getByRole("button", { name: "Delete" });
    expect(confirmButton.className).toContain("--color-danger)");
    expect(confirmButton.className).not.toContain("--color-accent)");

    await user.click(confirmButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
