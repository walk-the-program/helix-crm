// @vitest-environment jsdom
/**
 * JSX render helper for overview.test.ts.
 *
 * Vitest only collects tests/unit/**\/*.test.ts (see vitest.config.ts), so
 * JSX cannot live in the test file itself - the same split
 * tests/unit/ui/combobox.fixtures.tsx and tests/unit/app/fixtures.tsx use.
 *
 * `OverviewScreen` renders `ReportsFrame`, whose tab strip calls
 * `useLocation` from wouter, so the render needs a `Router` the way
 * tests/unit/app/fixtures.tsx wraps `Shell`.
 */
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { Router } from "wouter";
import { OverviewScreen } from "@/features/leads/screens/OverviewScreen";

export function renderOverview(): RenderResult {
  return render(
    <Router>
      <OverviewScreen />
    </Router>,
  );
}
