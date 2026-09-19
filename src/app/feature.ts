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

/**
 * A group of sidebar items a feature produces at render time.
 *
 * `order` places the group among the static nav items, using the same scale:
 * a group with order 15 renders after Today (10) and before Contacts (20).
 */
export type FeatureNavSection = {
  /** Sidebar heading, sentence case. Omit for an unlabelled group. */
  label?: string;
  order: number;
  items: FeatureNavItem[];
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
  /**
   * Sidebar items that do not exist until something has been read from the
   * database — pinned saved views are the reason this exists. `nav` above is a
   * static array the shell flattens once; this is called by the shell on every
   * render, once per feature, in registry order.
   *
   * It is a React hook slot: it may call hooks (that is the point — it is how
   * Today subscribes to `qk.savedViews()`), and it must therefore obey the
   * rules of hooks. The registry is fixed at module load, so the set of
   * providers never changes between renders and the call order is stable.
   * Return an empty array to contribute nothing.
   */
  navProvider?: () => FeatureNavSection[];
  commands?: FeatureCommand[];
  /** Started once after the database is open. Must be idempotent. */
  onBoot?: () => Promise<void>;
};

/** Sidebar orders the contract fixes, so features agree without talking. */
export const NAV_ORDER = {
  today: 10,
  /** The dynamic "Views" group: pinned saved views, between Today and Contacts. */
  views: 15,
  contacts: 20,
  companies: 30,
  pipeline: 40,
  tasks: 50,
  reports: 60,
  import: 70,
  settings: 90,
} as const;
