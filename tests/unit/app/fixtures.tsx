// @vitest-environment jsdom
/**
 * JSX render helpers shared by tests/unit/app/commandShortcuts.test.ts and
 * tests/unit/app/shellFooter.test.ts.
 *
 * Vitest's include pattern only picks up "*.test.ts" files, so JSX cannot
 * live in the test files themselves (see tests/unit/ui/fixtures.tsx for the
 * same pattern). These helpers wrap the JSX and expose plain functions the
 * .test.ts files can call without touching JSX syntax.
 */
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { Router } from "wouter";
import type { FeatureCommand } from "@/app/feature";
import { useCommandShortcuts, type CommandShortcutOptions } from "@/app/shortcuts";
import type { HelixRegistry, WorkspaceEntry } from "@/app/appSettings";

// ---------------------------------------------------------------------------
// useCommandShortcuts
// ---------------------------------------------------------------------------

function CommandShortcutsHost(props: {
  commands: readonly FeatureCommand[];
  options?: CommandShortcutOptions;
}) {
  useCommandShortcuts(props.commands, props.options);
  return null;
}

export function renderCommandShortcuts(
  commands: readonly FeatureCommand[],
  options?: CommandShortcutOptions,
): RenderResult {
  return render(<CommandShortcutsHost commands={commands} options={options} />);
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
//
// `@/app/Shell` imports `@/app/registry`, which loads every one of the six
// feature areas. shellFooter.test.ts mocks that module with `vi.mock` before
// rendering, so the real registry is never touched. `@/app/Shell` is loaded
// with a dynamic `import()` here, rather than a static import at the top of
// this file, specifically so that commandShortcuts.test.ts — which imports
// this same fixtures file for `renderCommandShortcuts` but never calls
// `renderShell` — never triggers that module graph at all. A static import
// here would load Shell (and therefore the real registry) the moment this
// file is imported, regardless of which helper a test actually calls.

const DEFAULT_REGISTRY: HelixRegistry = {
  workspaces: [],
  lastOpened: null,
  theme: "auto",
  density: "comfortable",
};

const DEFAULT_WORKSPACE: WorkspaceEntry = {
  id: "ws-1",
  name: "Acme Co",
  path: "/tmp/acme.db",
  lastPolledAt: null,
  lastBackupAt: null,
  archived: false,
};

export async function renderShell(props?: {
  registry?: HelixRegistry;
  workspace?: WorkspaceEntry;
}): Promise<RenderResult> {
  const { Shell } = await import("@/app/Shell");
  return render(
    <Router>
      <Shell
        registry={props?.registry ?? DEFAULT_REGISTRY}
        workspace={props?.workspace ?? DEFAULT_WORKSPACE}
      />
    </Router>,
  );
}
