// @vitest-environment jsdom
/**
 * The JSX half of crashScreenConsent.test.ts (LA-W3, J8j).
 *
 * Vitest only collects tests/unit/**\/*.test.ts, so JSX cannot live in the
 * test file itself — the same split tests/unit/app/bootFailure.fixtures.tsx
 * uses for the sibling boot-failure screens.
 */
import { render, type RenderResult } from "@testing-library/react";
import { AppErrorBoundary } from "@/app/BootScreens";

/** Throws on render, every time, so the boundary always catches it. */
function Bomb({ message }: { message: string }): never {
  throw new Error(message);
}

export function renderCrashedApp(message = "Cannot read properties of undefined (reading 'x')"): RenderResult {
  // React logs the thrown error to the console during the act() that trips
  // the boundary; that is expected here; the assertions are on the rendered
  // screen, not on console output.
  return render(
    <AppErrorBoundary>
      <Bomb message={message} />
    </AppErrorBoundary>,
  );
}
