// @vitest-environment jsdom
/**
 * JSX render helpers for tests/unit/onboarding/round3.test.ts.
 *
 * Vitest's include pattern only picks up "*.test.ts" files (see
 * tests/unit/ui/timePicker.fixtures.tsx for the same note), so the JSX for
 * round 3 / criterion 17 (docs/rounds/2026-09-20-round-3.md — equal trade
 * tiles, no sources step, public website wording) lives here instead of in
 * the test file itself.
 */
import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { ChoiceTile } from "@/features/onboarding/components/frame";
import { TrackingScreen } from "@/features/onboarding/screens/TrackingScreen";
import { CustomersScreen } from "@/features/onboarding/screens/CustomersScreen";
import { planFromPreset, type SetupPlan } from "@/features/onboarding/lib/applyPreset";
import { PRESETS } from "@/features/onboarding/presets";

export function renderChoiceTile(hint?: string): RenderResult {
  return render(
    <ChoiceTile label="Landscaping" hint={hint} selected={false} onSelect={() => {}} />,
  );
}

export function renderTrackingScreen(): RenderResult & { plan: SetupPlan } {
  const preset = PRESETS.landscaping;
  const plan = planFromPreset(preset);
  const result = render(
    <TrackingScreen
      preset={preset}
      plan={plan}
      onChange={() => {}}
      onApply={() => {}}
      onBack={() => {}}
    />,
  );
  return { ...result, plan };
}

export function renderCustomersScreen(): RenderResult {
  return render(<CustomersScreen onChoose={() => {}} />);
}
