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
 *
 * It also needs a `QueryClientProvider`: the tab strip reads the workspace's
 * vocabulary so a landscaping setup's Deals tab says "Jobs" (F-LC-9), and that
 * is a real `useQuery`. The client retries nothing and the settings read has
 * no database behind it here, so the tab falls back to "Deals" - which is
 * exactly what production does while the setting is loading.
 */
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { OverviewScreen } from "@/features/leads/screens/OverviewScreen";

export function renderOverview(): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <OverviewScreen />
      </Router>
    </QueryClientProvider>,
  );
}
