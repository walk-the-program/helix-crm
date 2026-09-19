// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { FeatureCommand } from "@/app/feature";
import type { CommandShortcutOptions } from "@/app/shortcuts";
import { renderCommandShortcuts } from "./fixtures";

afterEach(() => {
  cleanup();
});

function command(overrides: Partial<FeatureCommand> & { id: string; run: () => void }): FeatureCommand {
  return {
    label: overrides.id,
    ...overrides,
  };
}

function dispatchKeydown(
  target: EventTarget,
  init: KeyboardEventInit,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("useCommandShortcuts, mounted", () => {
  it("runs the matching command once and marks the event handled", () => {
    const run = vi.fn();
    const cmd = command({ id: "new", shortcut: "mod+n", run });
    renderCommandShortcuts([cmd], { mac: true });

    const event = dispatchKeydown(window, { key: "n", metaKey: true });

    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("binds mod to ctrl instead of meta when mac is false", () => {
    const run = vi.fn();
    const cmd = command({ id: "new", shortcut: "mod+n", run });
    renderCommandShortcuts([cmd], { mac: false });

    dispatchKeydown(window, { key: "n", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);

    dispatchKeydown(window, { key: "n", metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not fire an ordinary command for a keystroke inside an input", () => {
    const run = vi.fn();
    const cmd = command({ id: "new", shortcut: "mod+n", run });
    renderCommandShortcuts([cmd], { mac: true });

    const input = document.createElement("input");
    document.body.appendChild(input);
    dispatchKeydown(input, { key: "n", metaKey: true });

    expect(run).not.toHaveBeenCalled();
    input.remove();
  });

  it("stopImmediatePropagation keeps a matching chord from reaching a listener registered after mount", () => {
    const run = vi.fn();
    const cmd = command({ id: "new", shortcut: "mod+n", run });
    renderCommandShortcuts([cmd], { mac: true });

    const legacy = vi.fn();
    window.addEventListener("keydown", legacy);
    try {
      dispatchKeydown(window, { key: "n", metaKey: true });
      expect(run).toHaveBeenCalledTimes(1);
      expect(legacy).not.toHaveBeenCalled();

      // A non-matching chord is left alone: it reaches the other listener.
      dispatchKeydown(window, { key: "z", metaKey: true });
      expect(legacy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", legacy);
    }
  });

  it("does not fire a reserved shortcut", () => {
    const run = vi.fn();
    const cmd = command({ id: "k", shortcut: "mod+k", run });
    const options: CommandShortcutOptions = { mac: true, reserved: ["mod+k"] };
    renderCommandShortcuts([cmd], options);

    dispatchKeydown(window, { key: "k", metaKey: true });

    expect(run).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const run = vi.fn();
    const cmd = command({ id: "new", shortcut: "mod+n", run });
    const { unmount } = renderCommandShortcuts([cmd], { mac: true });

    unmount();
    dispatchKeydown(window, { key: "n", metaKey: true });

    expect(run).not.toHaveBeenCalled();
  });
});
