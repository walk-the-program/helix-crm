// @vitest-environment jsdom
/**
 * The JSX half of bootFailure.test.ts.
 *
 * Vitest only collects tests/unit/**\/*.test.ts, so JSX cannot live in the
 * test file itself — the same split tests/unit/ui/combobox.fixtures.tsx uses.
 */
import { render, type RenderResult } from "@testing-library/react";
import { BootFailure } from "@/app/BootScreens";

export function renderBootFailure(props: {
  error: unknown;
  path?: string;
  onRetry?: () => void;
}): RenderResult {
  return render(
    <BootFailure error={props.error} path={props.path} onRetry={props.onRetry} />,
  );
}
