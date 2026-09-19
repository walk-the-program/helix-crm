/**
 * The feature module contract (docs/CONTRACTS.md "Feature module contract").
 *
 * A feature area owns its folder and nothing else. It exports one FeatureModule
 * from src/features/<area>/index.tsx; the registry lists all six, and the shell
 * renders routes, sidebar items and the command palette from them. No feature
 * ever edits the registry.
 */
import type { ComponentType, ReactNode } from "react";

export type FeatureId =
  | "records"
  | "today"
  | "data"
  | "leads"
  | "ai"
  | "settings";

export type IconComponent = ComponentType<{
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean;
}>;

export type FeatureRoute = {
  /** wouter path, e.g. "/contacts" or "/contacts/:id" */
  path: string;
  element: ReactNode;
};

export type FeatureNavItem = {
  label: string;
  to: string;
  icon?: IconComponent;
  /** Sidebar order from the contract: Today 10 ... Settings 90. */
  order: number;
  /** Optional live count or dot, rendered by the shell. */
  badge?: ReactNode;
};

export type FeatureCommand = {
  id: string;
  label: string;
  /** "mod+n" style; mod is Cmd on macOS and Ctrl elsewhere. */
  shortcut?: string;
  group?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

export type FeatureModule = {
  id: FeatureId;
  routes: FeatureRoute[];
  nav?: FeatureNavItem[];
  commands?: FeatureCommand[];
  /** Started once after the database is open. Must be idempotent. */
  onBoot?: () => Promise<void>;
};

/** Sidebar orders the contract fixes, so features agree without talking. */
export const NAV_ORDER = {
  today: 10,
  contacts: 20,
  companies: 30,
  pipeline: 40,
  tasks: 50,
  reports: 60,
  import: 70,
  settings: 90,
} as const;
