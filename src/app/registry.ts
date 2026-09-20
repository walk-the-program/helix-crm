/**
 * The feature registry: the single shared touch point between the shell and
 * the six feature areas (docs/CONTRACTS.md). Foundations writes this file once
 * with all six entries; feature agents never edit it. They change their own
 * src/features/<area>/index.tsx, and their routes, sidebar items and commands
 * appear here automatically.
 */
import { createElement, type FunctionComponent, type ReactNode } from "react";
import type {
  FeatureCommand,
  FeatureId,
  FeatureModule,
  FeatureNavItem,
  FeatureNavSection,
  FeatureRoute,
} from "@/app/feature";
import { feature as records } from "@/features/records";
import { feature as today } from "@/features/today";
import { feature as data } from "@/features/data";
import { feature as leads } from "@/features/leads";
import { feature as ai } from "@/features/ai";
import { feature as settings } from "@/features/settings";
import { feature as onboarding } from "@/features/onboarding";
import { feature as recurring } from "@/features/recurring";
import { feature as templates } from "@/features/templates";
import { feature as help } from "@/features/help";
import { feature as catalog } from "@/features/catalog";
import { feature as invoices } from "@/features/invoices";
import { undoCommands } from "@/app/undo";

export const registry: FeatureModule[] = [
  today,
  records,
  data,
  leads,
  ai,
  settings,
  onboarding,
  recurring,
  templates,
  help,
  catalog,
  invoices,
];

/** Every route, in registration order. */
export function allRoutes(): FeatureRoute[] {
  return registry.flatMap((f) => f.routes);
}

/** Sidebar items, sorted by the order the contract fixes. */
export function allNavItems(): FeatureNavItem[] {
  return registry
    .flatMap((f) => f.nav ?? [])
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/**
 * Every feature's `navProvider`, in registry order. The shell calls each one
 * during its own render, so the list must be stable across renders: it is, the
 * registry is fixed at module load.
 */
export function allNavProviders(): (() => FeatureNavSection[])[] {
  return registry
    .map((f) => f.navProvider)
    .filter((provider): provider is () => FeatureNavSection[] => Boolean(provider));
}

/**
 * Commands that belong to the application rather than to any feature area.
 *
 * Undo and redo are the whole list and are likely to stay it. They cannot live
 * in a feature: every feature's writes go on the same stack, and the shell,
 * the macOS Edit menu and the command palette all have to reach them by id.
 * They are listed first so a feature cannot shadow "undo" by accident —
 * registry order breaks a tie (docs/CONTRACTS.md, "The keys the shell binds").
 */
const appCommands: FeatureCommand[] = undoCommands;

/** Everything the command palette offers, and everything the shell binds. */
export function allCommands(): FeatureCommand[] {
  return [...appCommands, ...registry.flatMap((f) => f.commands ?? [])];
}

/**
 * Every feature's always-mounted overlay content, keyed by feature id.
 *
 * A function is wrapped as a component rather than called here, so it gets its
 * own render and may use hooks (see `FeatureModule.overlays`). This file has no
 * JSX — it is a .ts — which is why it reaches for `createElement`.
 */
export function allOverlays(): { id: FeatureId; node: ReactNode }[] {
  return registry.flatMap((feature) => {
    const overlays = feature.overlays;
    if (overlays === undefined || overlays === null) return [];
    const node =
      typeof overlays === "function"
        ? createElement(overlays as FunctionComponent)
        : overlays;
    return [{ id: feature.id, node }];
  });
}

/** One command by id, looked up when it is needed rather than at mount. */
export function findCommand(id: string): FeatureCommand | null {
  const app = appCommands.find((command) => command.id === id);
  if (app) return app;
  for (const feature of registry) {
    const found = (feature.commands ?? []).find((command) => command.id === id);
    if (found) return found;
  }
  return null;
}
