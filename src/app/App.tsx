/**
 * App: runs the boot sequence, shows the full-screen states while it does, and
 * mounts the shell when the database is open. Feature onBoot hooks start after
 * the first paint, never before it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { boot, runFeatureBoot, type BootResult } from "@/app/boot";
import { queryClient } from "@/app/queryClient";
import { AppErrorBoundary, BootFailure, BootingScreen } from "@/app/BootScreens";
import { ShellRoot } from "@/app/Shell";

type State =
  | { phase: "booting" }
  | { phase: "ready"; result: BootResult }
  | { phase: "failed"; error: unknown };

export function App() {
  const [state, setState] = useState<State>({ phase: "booting" });
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

  // Background work begins only once Today is on screen.
  useEffect(() => {
    if (state.phase !== "ready") return;
    const id = window.setTimeout(() => {
      void runFeatureBoot();
    }, 0);
    return () => window.clearTimeout(id);
  }, [state.phase]);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {state.phase === "booting" ? <BootingScreen /> : null}
        {state.phase === "failed" ? (
          <BootFailure error={state.error} onRetry={start} />
        ) : null}
        {state.phase === "ready" ? (
          <ShellRoot
            registry={state.result.registry}
            workspace={state.result.workspace}
          />
        ) : null}
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
