/**
 * Quick add has to work from every screen, and the shell renders only route
 * elements — so the dialog is mounted once into its own root beside the app,
 * from the feature's `onBoot`, and opened through the module store.
 *
 * The FeatureCommand in `index.tsx` is the same entry point through the
 * command palette; the keyboard shortcut is registered here so it also works
 * with the palette closed. Both are idempotent: `onBoot` may be called again
 * after a workspace switch.
 */
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/ui";
import { queryClient } from "@/app/queryClient";
import { isMac } from "@/app/hooks";
import { QuickAddDialog } from "@/features/records/quickAdd/QuickAddDialog";
import { openQuickAdd } from "@/features/records/quickAdd/store";

const HOST_ID = "helix-quick-add-host";

let root: Root | null = null;
let shortcutBound = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key.toLowerCase() !== "n") return;
  const mod = isMac() ? event.metaKey : event.ctrlKey;
  if (!mod || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openQuickAdd();
}

/** Mount the dialog and bind Cmd/Ctrl+N. Safe to call more than once. */
export function mountQuickAdd(): void {
  if (typeof document === "undefined") return;

  if (!root) {
    let container = document.getElementById(HOST_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = HOST_ID;
      document.body.appendChild(container);
    }
    root = createRoot(container);
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <QuickAddDialog />
          </TooltipProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  }

  if (!shortcutBound) {
    window.addEventListener("keydown", onKeyDown);
    shortcutBound = true;
  }
}
