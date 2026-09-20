/**
 * The onboarding feature: the first run, the trade presets and the sample data.
 *
 * What it contributes to the shell:
 *   route    "/setup"              the three screens, reopenable at any time
 *   command  "run-setup"           "Set up your business"
 *   command  "remove-sample-data"  "Remove sample data"
 *   overlays the confirm dialog behind that command
 *
 * It contributes no sidebar item on purpose. Setup is not a place in the
 * product; it is something that happens once, and the sidebar is for the screens
 * the owner lives in.
 *
 * The one thing outside this folder is the gate in `src/app/boot.ts` and
 * `src/app/App.tsx`, which decides whether the first paint is setup or the
 * shell. `gate.ts` holds the decision; those two files only act on it.
 *
 * `RemoveSampleDataButton` is exported for the Settings feature to mount in its
 * Workspace section and for Today's first-run card. It renders nothing when the
 * workspace has no sample data in it, so mounting it costs nothing.
 */
import type { FeatureModule } from "@/app/feature";
import { navigate } from "wouter/use-browser-location";
import { SetupScreen } from "@/features/onboarding/OnboardingFlow";
import {
  openRemoveSampleData,
  SampleDataHost,
} from "@/features/onboarding/components/RemoveSampleData";

export const feature: FeatureModule = {
  id: "onboarding",
  routes: [{ path: "/setup", element: <SetupScreen /> }],
  commands: [
    {
      id: "run-setup",
      label: "Set up your business",
      group: "Setup",
      keywords: ["onboarding", "first run", "trade", "preset", "stages", "wizard"],
      run: () => navigate("/setup"),
    },
    {
      id: "remove-sample-data",
      label: "Remove sample data",
      group: "Setup",
      keywords: ["example", "demo", "sample", "clear", "delete"],
      run: () => openRemoveSampleData(),
    },
  ],
  overlays: () => <SampleDataHost />,
};

export { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
export { RemoveSampleDataButton } from "@/features/onboarding/components/RemoveSampleData";
export { shouldShowOnboarding } from "@/features/onboarding/gate";

export default feature;
