// @vitest-environment jsdom
/**
 * JSX render helpers for tests/unit/settings/*.test.ts.
 *
 * Vitest's include pattern only picks up "*.test.ts" files (see
 * vitest.config.ts), so JSX cannot live in the test files themselves —
 * tests/unit/app/fixtures.tsx and tests/unit/ui/fixtures.tsx use the same
 * split for the same reason. These wrap the JSX and expose plain functions
 * the .test.ts files call without touching JSX syntax.
 */
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/app/queryClient";
import { TagsScreen } from "@/features/settings/components/TagsScreen";
import { FieldsScreen } from "@/features/settings/components/FieldsScreen";
import { DiagnosticsScreen } from "@/features/settings/components/DiagnosticsScreen";
import { WorkspaceScreen } from "@/features/settings/components/WorkspaceScreen";

/**
 * Both screens invalidate through the real `queryClient` singleton
 * (`import { queryClient } from "@/app/queryClient"`) rather than the client
 * from React context, so the provider here has to be that same singleton —
 * a fresh `new QueryClient()` would leave the screen's own invalidation
 * calls talking to an instance nothing is reading from.
 */
export function renderTagsScreen(): RenderResult {
  return render(
    <QueryClientProvider client={queryClient}>
      <TagsScreen />
    </QueryClientProvider>,
  );
}

export function renderFieldsScreen(): RenderResult {
  return render(
    <QueryClientProvider client={queryClient}>
      <FieldsScreen />
    </QueryClientProvider>,
  );
}

export function renderDiagnosticsScreen(): RenderResult {
  return render(
    <QueryClientProvider client={queryClient}>
      <DiagnosticsScreen />
    </QueryClientProvider>,
  );
}

export function renderWorkspaceScreen(): RenderResult {
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceScreen />
    </QueryClientProvider>,
  );
}
