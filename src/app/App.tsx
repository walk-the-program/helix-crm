/**
 * App: runs the boot sequence, shows the full-screen states while it does, and
 * mounts the shell when the database is open. Feature onBoot hooks start after
 * the first paint, never before it.
 *
 * One thing sits between the boot and the shell: the onboarding gate. On a first
 * run — setup never finished or skipped, and no contacts and no deals in the
 * workspace — the first thing on screen is the three setup screens, full window,
 * with no sidebar. `boot()` makes that decision (see `BootResult.showOnboarding`
 * and `src/features/onboarding/gate.ts`); this file only acts on it, and the
 * feature's own `onFinish` is what puts the shell up.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { boot, runFeatureBoot, type BootResult } from "@/app/boot";
import { queryClient } from "@/app/queryClient";
import { AppErrorBoundary, BootFailure, BootingScreen } from "@/app/BootScreens";
import { ShellRoot } from "@/app/Shell";
import { OnboardingFlow } from "@/features/onboarding";

type State =
  | { phase: "booting" }
  | { phase: "ready"; result: BootResult }
  | { phase: "failed"; error: unknown };

export function App() {
  const [state, setState] = useState<State>({ phase: "booting" });
  const [setupDone, setSetupDone] = useState(false);
  const started = useRef(false);

  const start = useCallback(() => {
    setState({ phase: "booting" });
    boot()
      .then((result) => setState({ phase: "ready", result }))
      .catch((error: unknown) => setState({ phase: "failed", error }));
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  const inSetup =
    state.phase === "ready" && state.result.showOnboarding && !setupDone;

  // Background work begins only once the shell is on screen. During setup it
  // waits: a lead poller and four overlay roots have nothing to do behind a
  // full-window first-run flow, and the settings the flow is about to write are
  // the ones they would read.
  useEffect(() => {
    if (state.phase !== "ready" || inSetup) return;
    const id = window.setTimeout(() => {
      void runFeatureBoot();
    }, 0);
    return () => window.clearTimeout(id);
  }, [state.phase, inSetup]);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {state.phase === "booting" ? <BootingScreen /> : null}
        {state.phase === "failed" ? (
          <BootFailure error={state.error} onRetry={start} />
        ) : null}
        {state.phase === "ready" ? (
          inSetup ? (
            <OnboardingFlow onFinish={() => setSetupDone(true)} />
          ) : (
            <ShellRoot
              registry={state.result.registry}
              workspace={state.result.workspace}
            />
          )
        ) : null}
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
