/**
 * A mounting point for things that must exist on every screen.
 *
 * The shell renders one route at a time and has no slot for a global overlay,
 * and a feature agent may not edit it (docs/CONTRACTS.md). A feature that owns
 * a dialog reachable from anywhere - the shortcuts sheet, the workspace picker,
 * paste-to-record - mounts it here from its `onBoot` hook instead: a second
 * React root on a div appended to <body>, sharing the app's QueryClient so the
 * same cache and the same invalidations apply.
 *
 * The shell also does not bind the shortcuts it shows in the command palette,
 * so the components mounted here are where a feature's `mod+...` bindings live.
 *
 * Mounting is idempotent: onBoot may run again after a workspace switch.
 */
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/app/queryClient";
import { TooltipProvider } from "@/ui";

const mounted = new Map<string, Root>();

export function mountOverlay(id: string, node: ReactNode): void {
  if (typeof document === "undefined") return;
  if (mounted.has(id)) return;

  const container = document.createElement("div");
  container.setAttribute("data-helix-overlay", id);
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
  mounted.set(id, root);
}

/** Tests only: drop a host so the next mount rebuilds it. */
export function __unmountOverlayForTests(id: string): void {
  const root = mounted.get(id);
  if (!root) return;
  root.unmount();
  mounted.delete(id);
}

/**
 * The smallest possible event bus: a command in the registry has no React
 * context, so it flips a subscribable boolean that the mounted host reads.
 */
export function createOpener(): {
  open: () => void;
  close: () => void;
  subscribe: (listener: () => void) => () => void;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
} {
  let open = false;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  return {
    open: () => {
      if (open) return;
      open = true;
      publish();
    },
    close: () => {
      if (!open) return;
      open = false;
      publish();
    },
    setOpen: (next: boolean) => {
      if (open === next) return;
      open = next;
      publish();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isOpen: () => open,
  };
}
