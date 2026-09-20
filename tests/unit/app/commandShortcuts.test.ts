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

/* -------------------------------------------------------------------------- */
/* aliases: a command with more than one key (R17)                            */
/* -------------------------------------------------------------------------- */

describe("a command's aliases", () => {
  it("binds the alias exactly like the command's own key", () => {
    const run = vi.fn();
    const cmd = command({ id: "search", shortcut: "mod+k", aliases: ["mod+/"], run });
    renderCommandShortcuts([cmd], { mac: true });

    const first = dispatchKeydown(window, { key: "k", metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    const second = dispatchKeydown(window, { key: "/", metaKey: true });
    expect(run, "the alias runs the same command").toHaveBeenCalledTimes(2);
    expect(second.defaultPrevented).toBe(true);
  });

  it("runs the command once per press, not once per key it declares", () => {
    const run = vi.fn();
    renderCommandShortcuts(
      [command({ id: "search", shortcut: "mod+k", aliases: ["mod+/", "mod+k"], run })],
      { mac: true },
    );
    dispatchKeydown(window, { key: "k", metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("holds an alias to the same typing rule as the first key", () => {
    const quiet = vi.fn();
    renderCommandShortcuts(
      [command({ id: "search", shortcut: "mod+k", aliases: ["mod+/"], run: quiet })],
      { mac: true },
    );

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    // Neither key fires mid-sentence, because whileTyping is off — which is
    // the point: the alias gets the same answer as the command's own key, not
    // a looser one.
    dispatchKeydown(input, { key: "/", metaKey: true });
    dispatchKeydown(input, { key: "k", metaKey: true });
    expect(quiet).not.toHaveBeenCalled();

    input.blur();
    input.remove();
    dispatchKeydown(window, { key: "/", metaKey: true });
    expect(quiet).toHaveBeenCalledTimes(1);
    cleanup();

    // And with whileTyping on, both keys answer, still together.
    const loud = vi.fn();
    renderCommandShortcuts(
      [
        command({
          id: "search",
          shortcut: "mod+k",
          aliases: ["mod+/"],
          whileTyping: true,
          run: loud,
        }),
      ],
      { mac: true },
    );
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    dispatchKeydown(field, { key: "/", metaKey: true });
    dispatchKeydown(field, { key: "k", metaKey: true });
    expect(loud).toHaveBeenCalledTimes(2);
    field.remove();
  });

  it("never fires a BARE alias while the owner is typing", () => {
    const run = vi.fn();
    renderCommandShortcuts([command({ id: "help", shortcut: "mod+h", aliases: ["?"], run })], {
      mac: true,
    });

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    dispatchKeydown(input, { key: "?" });
    expect(run, "a bare alias is what the owner is typing").not.toHaveBeenCalled();

    input.blur();
    input.remove();
    dispatchKeydown(window, { key: "?" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves an alias alone when the shell has reserved that key", () => {
    const run = vi.fn();
    renderCommandShortcuts(
      [command({ id: "search", shortcut: "mod+k", aliases: ["mod+/"], run })],
      { mac: true, reserved: ["mod+/"] },
    );
    dispatchKeydown(window, { key: "/", metaKey: true });
    expect(run, "the shell answers a key it reserved").not.toHaveBeenCalled();
    dispatchKeydown(window, { key: "k", metaKey: true });
    expect(run, "and the unreserved key still works").toHaveBeenCalledTimes(1);
  });

  it("changes nothing for a command with no aliases", () => {
    const run = vi.fn();
    renderCommandShortcuts([command({ id: "new", shortcut: "mod+n", run })], { mac: true });
    dispatchKeydown(window, { key: "n", metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    dispatchKeydown(window, { key: "/", metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
