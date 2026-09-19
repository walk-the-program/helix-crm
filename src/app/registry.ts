/**
 * The feature registry: the single shared touch point between the shell and
 * the six feature areas (docs/CONTRACTS.md). Foundations writes this file once
 * with all six entries; feature agents never edit it. They change their own
 * src/features/<area>/index.tsx, and their routes, sidebar items and commands
 * appear here automatically.
 */
import type { FeatureCommand, FeatureModule, FeatureNavItem, FeatureRoute } from "@/app/feature";
import { feature as records } from "@/features/records";
import { feature as today } from "@/features/today";
import { feature as data } from "@/features/data";
import { feature as leads } from "@/features/leads";
import { feature as ai } from "@/features/ai";
import { feature as settings } from "@/features/settings";

export const registry: FeatureModule[] = [
  today,
  records,
  data,
  leads,
  ai,
  settings,
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

/** Everything the command palette offers. */
export function allCommands(): FeatureCommand[] {
  return registry.flatMap((f) => f.commands ?? []);
}
