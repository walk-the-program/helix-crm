// @vitest-environment jsdom
/**
 * Work item 3: confirm the sidebar footer runs the "switch-workspace"
 * command.
 *
 * Shell.tsx pulls in `@/app/registry`, which loads every feature area (all
 * six are being edited concurrently by other agents), plus `sonner` and
 * `cmdk` through `@/app/CommandPalette`, and Radix through `@/ui`. The
 * registry is mocked below so the real features never load; Radix's missing
 * jsdom APIs are covered by `installRadixStubs()` (already proven out by
 * tests/unit/ui/dialog.test.ts). sonner's `Toaster` and cmdk's `Command`
 * (rendered only once the palette is open, which it never is in these tests)
 * needed no stubbing — they mounted cleanly under jsdom.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { FeatureCommand, FeatureId } from "@/app/feature";
import type { WorkspaceEntry } from "@/app/appSettings";
import { installRadixStubs } from "../ui/radixSetup";
import { renderShell } from "./fixtures";

installRadixStubs();

const registryState = vi.hoisted(() => ({
  commands: [] as FeatureCommand[],
  overlays: [] as { id: FeatureId; node: ReactNode }[],
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

const WORKSPACE: WorkspaceEntry = {
  id: "w1",
  name: "Acme Co",
  path: "/tmp/acme.db",
  lastPolledAt: null,
  lastBackupAt: null,
  archived: false,
};

function switchWorkspaceCommand(run: () => void): FeatureCommand {
  return { id: "switch-workspace", label: "Switch workspace", run };
}

afterEach(() => {
  cleanup();
  registryState.commands = [];
  registryState.overlays = [];
  registryState.findCommandImpl = () => null;
});

describe("Shell sidebar footer", () => {
  it("is a button named for the workspace and runs the command once per click", async () => {
    const run = vi.fn();
    registryState.findCommandImpl = (id) => (id === "switch-workspace" ? switchWorkspaceCommand(run) : null);

    await renderShell({ workspace: WORKSPACE });

    const button = screen.getByRole("button", { name: "Acme Co" });
    // Round 3: the "Switch workspace" hint moved from a native `title` to the
    // kit's Tooltip, which also carries the live workspace name — the same
    // rule the toolbar's appearance button follows, so a hover never shows two
    // tooltips saying different things. Radix wires it as aria-describedby.
    expect(button.getAttribute("title")).toBeNull();
    expect(button.getAttribute("data-testid")).toBe("workspace-footer");

    fireEvent.click(button);
    fireEvent.click(button);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("looks the command up again on every click rather than reusing the one bound at mount", async () => {
    const first = vi.fn();
    const second = vi.fn();
    let active = first;
    registryState.findCommandImpl = (id) =>
      id === "switch-workspace" ? switchWorkspaceCommand(active) : null;

    await renderShell({ workspace: WORKSPACE });
    const button = screen.getByRole("button", { name: "Acme Co" });

    // Swap what findCommand("switch-workspace") answers after mount, before
    // the click — this is the "looked up at click time" seam Shell.tsx's own
    // header comment describes.
    active = second;
    fireEvent.click(button);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("renders the workspace name as plain text with no button when there is no switch-workspace command", async () => {
    registryState.findCommandImpl = () => null;

    await renderShell({ workspace: WORKSPACE });

    expect(screen.queryByRole("button", { name: "Acme Co" })).toBeNull();
    expect(screen.getByText("Acme Co")).toBeTruthy();
  });

  /**
   * `hasWorkspaceSwitcher` in Shell.tsx is a plain `const` computed once in
   * the render body from `findCommand("switch-workspace")`, not a
   * useEffect/useMemo keyed off anything that changes over time. Registering
   * the command only after the first render, with nothing forcing Shell to
   * re-render, therefore does NOT retroactively turn the static footer into a
   * button — this asserts that actual (current) behaviour rather than the
   * behaviour a "some day" registration might suggest. See the report for
   * this run for whether that is worth flagging.
   */
  it("does not grow the button from a command registered after the first render, with no re-render in between", async () => {
    let registered = false;
    registryState.findCommandImpl = (id) =>
      registered && id === "switch-workspace" ? switchWorkspaceCommand(vi.fn()) : null;

    await renderShell({ workspace: WORKSPACE });
    expect(screen.queryByRole("button", { name: "Acme Co" })).toBeNull();

    registered = true;
    expect(screen.queryByRole("button", { name: "Acme Co" })).toBeNull();
  });

  it("renders a registered overlay inside the shell", async () => {
    // `createElement` is a plain function call, not JSX syntax, so it is fine
    // in a .test.ts file — only JSX markup needs to live in fixtures.tsx.
    registryState.overlays = [
      { id: "today" as FeatureId, node: createElement("div", { "data-testid": "overlay-probe" }, "hi") },
    ];

    await renderShell({ workspace: WORKSPACE });

    expect(screen.getByTestId("overlay-probe")).toBeTruthy();
  });
});
