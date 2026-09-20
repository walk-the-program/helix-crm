// @vitest-environment jsdom
/**
 * F-LC-21: the toolbar needs an on-screen affordance for quick add, not only
 * the mod+n shortcut and the command palette. Shell.tsx looks up
 * `findCommand("quick-add")` at click time, the same defensive shape the
 * sidebar footer already uses for "switch-workspace" (see shellFooter.test.ts
 * for why the registry is mocked and Radix is stubbed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { FeatureCommand, FeatureId } from "@/app/feature";
import { installRadixStubs } from "../ui/radixSetup";
import { renderShell } from "./fixtures";

installRadixStubs();

const registryState = vi.hoisted(() => ({
  commands: [] as FeatureCommand[],
  overlays: [] as { id: FeatureId; node: unknown }[],
  findCommandImpl: (_id: string) => null as FeatureCommand | null,
}));

vi.mock("@/app/registry", () => ({
  allRoutes: () => [],
  allNavItems: () => [],
  allNavProviders: () => [],
  allCommands: () => registryState.commands,
  allOverlays: () => registryState.overlays,
  findCommand: (id: string) => registryState.findCommandImpl(id),
}));

function quickAddCommand(run: () => void): FeatureCommand {
  return { id: "quick-add", label: "Quick add", shortcut: "mod+n", run };
}

afterEach(() => {
  cleanup();
  registryState.commands = [];
  registryState.overlays = [];
  registryState.findCommandImpl = () => null;
});

describe("Shell toolbar quick add button", () => {
  it("renders a Quick add button that runs the registered command when clicked", async () => {
    const run = vi.fn();
    registryState.findCommandImpl = (id) => (id === "quick-add" ? quickAddCommand(run) : null);

    await renderShell();

    const button = screen.getByRole("button", { name: "Quick add" });
    fireEvent.click(button);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("looks the command up again on every click rather than reusing the one bound at mount", async () => {
    const first = vi.fn();
    const second = vi.fn();
    let active = first;
    registryState.findCommandImpl = (id) => (id === "quick-add" ? quickAddCommand(active) : null);

    await renderShell();
    const button = screen.getByRole("button", { name: "Quick add" });

    active = second;
    fireEvent.click(button);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("renders nothing, and throws nothing, when no quick-add command is registered", async () => {
    registryState.findCommandImpl = () => null;

    await renderShell();

    expect(screen.queryByRole("button", { name: "Quick add" })).toBeNull();
  });
});
