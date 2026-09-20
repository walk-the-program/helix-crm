/**
 * The feature module contract (docs/CONTRACTS.md "Feature module contract").
 *
 * A feature area owns its folder and nothing else. It exports one FeatureModule
 * from src/features/<area>/index.tsx; the registry lists all six, and the shell
 * renders routes, sidebar items and the command palette from them. No feature
 * ever edits the registry.
 */
import { lazy } from "react";
import type { ComponentType, ReactNode } from "react";

export type FeatureId =
  | "records"
  | "today"
  | "data"
  | "leads"
  | "ai"
  | "settings"
  | "onboarding"
  | "recurring"
  | "templates"
  | "help"
  | "catalog"
  | "invoices";

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
  /**
   * "mod+n" style; mod is Cmd on macOS and Ctrl elsewhere. Since the shell
   * binds `allCommands()` centrally this is a real binding, not just the label
   * the palette prints: the only modifier names are `mod`, `shift` and `alt`,
   * and a bare key ("?") is bound too. See `src/app/shortcuts.ts`.
   */
  shortcut?: string;
  /**
   * More keys that run the same command, in the same chord grammar as
   * `shortcut` above, and bound by the same binder.
   *
   * Search is why this exists: `mod+/` has always opened the search dialog,
   * but the feature bound it with its own listener outside the command
   * system, so the shell did not know about it and the shortcuts sheet could
   * not print it — a working key that appeared nowhere (F-LC-7, ruling R17).
   * A second key belongs to the command, not to a listener somewhere else.
   */
  aliases?: string[];
  group?: string;
  keywords?: string[];
  /**
   * Answer the shortcut even while the owner is typing in an input, a textarea
   * or a contenteditable. Off by default, because a command that fires
   * mid-sentence is a bug; opt in only for a key that is genuinely about the
   * field being typed in. A bare key ("?") is never bound while typing, with or
   * without this flag — a bare key is what the owner is typing.
   */
  whileTyping?: boolean;
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
  /**
   * Always-mounted content: the dialogs a feature opens from anywhere (quick
   * add, the AI paste dialog, the workspace switcher, the shortcuts sheet).
   *
   * The shell renders these once, inside its own providers, on every screen.
   * That is what this slot is for: before it existed, a feature that needed a
   * dialog on every screen mounted a *second* React root on `<body>` from
   * `onBoot` and had to re-create the providers around it by hand.
   *
   * Either a ReactNode, or a function, which the shell renders as a component
   * (`<Overlays />`) — so a function may use hooks, with its own render and its
   * own state, and is not bound by the rules that make `navProvider` delicate.
   * Overlays render below the routed screen and outside `<main>`, so they must
   * position themselves (every dialog in `src/ui` already does).
   */
  overlays?: ReactNode | (() => ReactNode);
  /** Started once after the database is open. Must be idempotent. */
  onBoot?: () => Promise<void>;
};

/**
 * Sidebar orders the contract fixes, so features agree without talking.
 *
 * ROUND 3 (criteria 21 and 23) regrouped these. Eleven rows in one column,
 * ordered by when each feature happened to be built, made the sidebar a list
 * to read rather than a shape to recognise. The order now puts related things
 * together, and `NAV_GROUPS` below draws a hairline between each run:
 *
 *   Today · Contacts, Companies · Deals, Services, Invoices, Reports ·
 *   Tasks, Reminders · Import · Trash · Settings, Help
 */
export const NAV_ORDER = {
  today: 10,
  /** The dynamic "Views" group: pinned saved views, between Today and Contacts. */
  views: 15,
  contacts: 20,
  companies: 30,
  pipeline: 40,
  /** The services catalogue, between Deals and Invoices (round 3, criterion 23). */
  services: 45,
  invoices: 48,
  reports: 50,
  tasks: 60,
  reminders: 65,
  import: 70,
  trash: 80,
  settings: 90,
  help: 95,
} as const;

/**
 * The sidebar's groups, in order, each one a list of nav `to` paths in the
 * order they should appear inside it.
 *
 * WHY BY PATH AND NOT BY NUMBER. Three features spell their order as a literal
 * rather than reading `NAV_ORDER` (Invoices, Reminders, Trash, Help), and they
 * are owned by other agents this round. Grouping on the route means the shape
 * of the sidebar is decided in one place and cannot be knocked out of shape by
 * a feature picking a number — which is the failure `NAV_ORDER` alone has had
 * twice now. `NAV_ORDER` stays as the contract name features import, and the
 * two agree.
 *
 * A nav item whose `to` is not listed here — a pinned saved view, a feature
 * added after this file was last touched — is not dropped: the shell puts it
 * in its own group, positioned by its numeric `order`.
 */
export const NAV_GROUPS: readonly (readonly string[])[] = [
  ["/"],
  ["/contacts", "/companies"],
  ["/pipeline", "/services", "/invoices", "/reports"],
  ["/tasks", "/recurring"],
  ["/import"],
  ["/trash"],
  ["/settings", "/help"],
];

/** Where a known `to` sits: which group, and where inside it. */
export function navGroupPosition(to: string): { group: number; index: number } | null {
  for (let group = 0; group < NAV_GROUPS.length; group += 1) {
    const index = NAV_GROUPS[group].indexOf(to);
    if (index !== -1) return { group, index };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Route-level code splitting                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Declare a routed screen that is only downloaded when someone opens it.
 *
 * The app ships as one JavaScript chunk, and most of its weight belongs to a
 * handful of screens: the reports draw with a charting library and the invoice
 * PDF is rendered by a PDF library, neither of which the owner touches on the
 * way to Today. Splitting them off is a `React.lazy` at the route, and the
 * only reason it was not already one is the boilerplate — `lazy()` wants a
 * module whose `default` is the component, and every screen in this codebase
 * is a named export. So this writes that once:
 *
 *     const RevenueScreen = lazyScreen(
 *       () => import("@/features/leads/screens/RevenueScreen"),
 *       (m) => m.RevenueScreen,
 *     );
 *     // ...
 *     { path: "/reports/revenue", element: <RevenueScreen /> }
 *
 * The `Suspense` boundary is the shell's, one for the whole route switch
 * (src/app/Shell.tsx), so a feature never declares its own fallback and two
 * features cannot disagree about what a loading screen looks like.
 *
 * Only use it for a screen the owner reaches by choosing to: a lazy route on
 * the boot path would trade a smaller download for a blank frame on launch,
 * which is the wrong side of that bargain.
 */
export function lazyScreen<M>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<Record<string, never>>,
): ComponentType<Record<string, never>> {
  return lazy(async () => ({ default: pick(await load()) }));
}
