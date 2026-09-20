// @vitest-environment jsdom
/**
 * The macOS menu bar's other half (`src/app/menu.ts`).
 *
 * The Rust menu emits one `menu` event carrying an item id; everything
 * interesting is what this side does with that string. Three routes, and the
 * one that matters most is the third: on macOS the menu accelerator takes
 * Cmd+Z before the web view sees it, so a text field only keeps its own undo
 * because this module hands the keystroke back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn<(to: string) => void>();
const run = vi.fn<() => void>();
const findCommand = vi.fn<(id: string) => { id: string; run: () => void } | null>();

vi.mock("wouter/use-browser-location", () => ({
  navigate: (to: string) => navigate(to),
}));

vi.mock("@/app/registry", () => ({
  findCommand: (id: string) => findCommand(id),
}));

vi.mock("@/app/appSettings", () => ({
  isTauri: () => false,
}));

import { editableHasFocus, installMenuBridge, runMenuId } from "@/app/menu";

beforeEach(() => {
  navigate.mockReset();
  run.mockReset();
  findCommand.mockReset().mockImplementation((id) => ({ id, run }));
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a nav item", () => {
  it("goes to the route after the prefix", () => {
    expect(runMenuId("nav:/contacts")).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/contacts");
    expect(findCommand).not.toHaveBeenCalled();
  });

  it("handles Today, which is the bare root", () => {
    runMenuId("nav:/");
    expect(navigate).toHaveBeenCalledWith("/");
  });
});

describe("a command item", () => {
  it("runs the registry command with that id", () => {
    expect(runMenuId("open-settings")).toBeNull();
    expect(findCommand).toHaveBeenCalledWith("open-settings");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports an id no command answers, rather than swallowing the click", () => {
    findCommand.mockReturnValue(null);
    expect(runMenuId("not-a-command")).toBe("not-a-command");
  });
});

describe("Undo and Redo", () => {
  it("run the application command when nothing is being typed in", () => {
    expect(runMenuId("undo")).toBeNull();
    expect(findCommand).toHaveBeenCalledWith("undo");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("go to the focused text field instead, so it keeps its own undo", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(editableHasFocus()).toBe(true);

    const execCommand = vi.fn<(id: string) => boolean>().mockReturnValue(true);
    // jsdom has no execCommand at all, so it is defined rather than spied on.
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
      writable: true,
    });

    expect(runMenuId("undo")).toBeNull();
    expect(execCommand).toHaveBeenCalledWith("undo");
    expect(findCommand).not.toHaveBeenCalled();

    expect(runMenuId("redo")).toBeNull();
    expect(execCommand).toHaveBeenCalledWith("redo");
  });

  it("do not treat a focused button as a text field", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    expect(editableHasFocus()).toBe(false);
  });
});

describe("outside Tauri", () => {
  it("installs nothing, because there is no menu and no event source", () => {
    const stop = installMenuBridge();
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });
});
