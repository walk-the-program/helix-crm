/**
 * The application shell: sidebar, topbar, router outlet, command palette and
 * toaster. Everything it renders comes from the feature registry, so a feature
 * agent adds a screen without touching this file.
 *
 * Three things here are wave-3 seams rather than shell mechanics, and they are
 * all lookups rather than imports, so the shell never depends on a feature:
 *
 * 1. **One search.** Cmd/Ctrl+K runs the registered command with the id
 *    "search" when there is one (the Today feature's dialog) and opens the
 *    palette when there is not. The palette moves to Cmd/Ctrl+Shift+K and the
 *    search dialog links back to it, so the command list is never unreachable.
 * 2. **The workspace footer** runs the command with the id "switch-workspace"
 *    if the registry has one, looked up at click time so nothing breaks while
 *    the settings feature is still being built.
 * 3. **The "Views" group** comes from `FeatureModule.navProvider`, called on
 *    every render, which is how pinned saved views reach the sidebar.
 *
 * Two more things the shell does for every feature rather than each feature
 * doing it for itself:
 *
 * 4. **The keys.** One handler binds every registered `FeatureCommand.shortcut`
 *    (`useCommandShortcuts`). A command's shortcut used to be a label the
 *    palette printed, so a feature that promised `mod+,` had to mount its own
 *    React root from `onBoot` just to listen for it.
 * 5. **The overlays.** `FeatureModule.overlays` renders inside this tree, which
 *    is where a dialog that has to exist on every screen belongs — instead of a
 *    second React root on `<body>` with the providers rebuilt around it.
 */
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Route, Router, Switch, useLocation } from "wouter";
import { Toaster } from "sonner";
import { MagnifyingGlass, MoonStars, Sun } from "@/ui/icons";
import {
  allCommands,
  allNavItems,
  allNavProviders,
  allOverlays,
  allRoutes,
  findCommand,
} from "@/app/registry";
import {
  CommandPalette,
  OPEN_PALETTE_EVENT,
  PALETTE_SHORTCUT,
} from "@/app/CommandPalette";
import type { FeatureNavItem, FeatureNavSection, FeatureRoute } from "@/app/feature";
import { useAppearance, useShortcut, useWriteState } from "@/app/hooks";
import { useCommandShortcuts } from "@/app/shortcuts";
import {
  isMacOS,
  nextTheme,
  resolveTheme,
  type HelixRegistry,
  type Theme,
  type WorkspaceEntry,
} from "@/app/appSettings";
import {
  Badge,
  Brand,
  EmptyState,
  IconButton,
  Kbd,
  NavItem,
  Sidebar,
  SidebarSection,
  Topbar,
  Tooltip,
  TooltipProvider,
} from "@/ui";

export type ShellProps = {
  registry: HelixRegistry;
  workspace: WorkspaceEntry;
};

function NotFound() {
  return (
    <EmptyState
      title="That screen does not exist"
      description="Use the sidebar, or press the search key to jump somewhere."
    />
  );
}

/**
 * The two things the top bar has to be able to say.
 *
 * A switch or a restore closes the database, which is not a write and so never
 * shows up as one: the screen used to sit there with no explanation while every
 * read answered DB_CLOSED. It takes precedence over the write badge, because
 * nothing else can be true at that moment, and it is a quiet line rather than a
 * badge — it is an explanation, not an alert.
 */
function WriteStatus() {
  const { busy, label, queued, transition } = useWriteState();
  if (transition) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]"
      >
        {transition}
      </span>
    );
  }
  if (!busy) return null;
  return (
    <Badge tone="neutral">
      {label ?? "Working"}
      {queued > 0 ? ` · ${queued} waiting` : ""}
    </Badge>
  );
}

/**
 * Every feature's `navProvider`, called in registry order. The providers are
 * hooks in all but name, which is why this is a component-level helper and why
 * the provider list has to be stable — it is: the registry is fixed at module
 * load (see `FeatureModule.navProvider`).
 */
function useDynamicNavSections(): FeatureNavSection[] {
  const providers = useMemo(() => allNavProviders(), []);
  const sections: FeatureNavSection[] = [];
  for (const provider of providers) sections.push(...provider());
  return sections.sort((a, b) => a.order - b.order);
}

/**
 * The keys the shell binds for itself, which the generic command binder must
 * leave alone so a keystroke is never handled twice. Both are lookups rather
 * than commands: mod+k runs whichever feature owns search and falls back to the
 * palette, and the palette is not a feature at all.
 */
const SHELL_OWN_SHORTCUTS = ["mod+k", PALETTE_SHORTCUT] as const;

/**
 * The toolbar's appearance button (HIG review finding 5).
 *
 * Before this, the icon and label read the raw `theme`, not the *resolved*
 * one: on a Mac set to dark with Helix on Auto, the app was already dark
 * while the button said "Switch to dark" and showed a moon, and pressing it
 * pinned the app to dark with no way back to Auto except through Settings.
 *
 * The two strings this returns are deliberately not the same sentence:
 * - `actionLabel` becomes `IconButton`'s `label` — the accessible name — and
 *   says what pressing the button will DO: the next stop in `nextTheme`'s
 *   Auto -> Light -> Dark -> Auto cycle, so Auto is always one press away.
 * - `stateLabel` is the visible `Tooltip` content and says what the
 *   appearance IS right now — qualified with the resolved appearance when
 *   Helix is on Auto ("Auto (dark)"), since "Auto" alone does not tell a Mac
 *   owner what they are actually looking at.
 *
 * Keeping the wording apart matters for VoiceOver: Radix's tooltip wires
 * `aria-describedby` to its content, so a screen reader announces the
 * accessible name and then the tooltip as a description. If the two said the
 * same thing, that announcement would repeat itself.
 */
export function themeButtonLabels(theme: Theme): {
  actionLabel: string;
  stateLabel: string;
  resolved: "light" | "dark";
} {
  const resolved = resolveTheme(theme);
  const next = nextTheme(theme);
  const actionLabel =
    next === "light" ? "Switch to light" : next === "dark" ? "Switch to dark" : "Switch to auto";
  const stateLabel = theme === "auto" ? `Auto (${resolved})` : theme === "light" ? "Light" : "Dark";
  return { actionLabel, stateLabel, resolved };
}

/**
 * Names for a route no nav item owns (HIG review finding 9). Most of the app
 * needs nothing here — a nav item's own prefix match already covers its
 * sub-routes, "/settings/appearance" included — but a few screens are linked
 * to from inside another screen rather than from the sidebar, and a deal's
 * own page lives at "/deals/:id" while the pipeline board that lists it is
 * "/pipeline", so no nav item's prefix reaches it.
 */
const FALLBACK_VIEW_TITLES: Record<string, string> = {
  trash: "Trash",
  deals: "Deal",
  export: "Export",
  duplicates: "Review duplicates",
  setup: "Set up Helix",
};

/** A wouter-style path match ("/contacts/:id" against "/contacts/42"), good enough to tell a real screen from a genuine 404. */
function matchesRoutePath(routePath: string, location: string): boolean {
  const routeSegments = routePath.split("/").filter(Boolean);
  const locationSegments = location.split("/").filter(Boolean);
  if (routeSegments.length !== locationSegments.length) return false;
  return routeSegments.every(
    (segment, index) => segment.startsWith(":") || segment === locationSegments[index],
  );
}

/** "some-thing" -> "Some thing" — a plain name rather than the literal path, for a registered route the fallback map above does not know about. */
function humanizeSegment(segment: string): string {
  const words = segment.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The toolbar's view title (HIG review finding 9): the leading edge used to
 * hold the search field, and with `hiddenTitle: true` nothing stood in for
 * the window title that removes.
 *
 * This picks the *most specific* nav item whose `to` the current location
 * matches — the same `isActive` the sidebar itself renders from, over both
 * the static `navItems` and every feature's dynamic `navSections` — so a
 * pinned view's own name wins over the generic "Today" it lives under. A
 * route no nav item owns gets a plain, sensible name instead of an empty
 * slot or the literal path: a known one (a record detail page, /trash, and
 * the couple of screens reached only from inside another screen) from the
 * map above, an unknown-but-real route from its own path, and a genuine 404
 * says so rather than guessing.
 */
export function deriveViewTitle(
  navItems: readonly FeatureNavItem[],
  navSections: readonly FeatureNavSection[],
  routes: readonly FeatureRoute[],
  location: string,
  isActive: (to: string) => boolean,
): string {
  const candidates: FeatureNavItem[] = [
    ...navItems,
    ...navSections.flatMap((section) => section.items),
  ];
  let best: FeatureNavItem | null = null;
  for (const item of candidates) {
    if (!isActive(item.to)) continue;
    if (!best || item.to.length > best.to.length) best = item;
  }
  if (best) return best.label;

  const segment = location.split("/").find(Boolean) ?? "";
  const known = FALLBACK_VIEW_TITLES[segment];
  if (known) return known;

  const isRegisteredRoute = routes.some((route) => matchesRoutePath(route.path, location));
  if (isRegisteredRoute) return segment ? humanizeSegment(segment) : "Helix";
  return "Not found";
}

export function Shell({ registry, workspace }: ShellProps) {
  const [location, navigate] = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const routes = useMemo(() => allRoutes(), []);
  const navItems = useMemo(() => allNavItems(), []);
  const navSections = useDynamicNavSections();
  const commands = useMemo(() => allCommands(), []);
  const overlays = useMemo(() => allOverlays(), []);
  const appearance = useAppearance(registry);

  /**
   * `useAppearance` (src/app/hooks.ts) already watches the OS preference for
   * as long as Auto is selected, so `<html data-theme>` stays live — but that
   * effect calls `applyAppearance` directly and never touches React state, so
   * it does not by itself cause the shell to re-render. Without this, the
   * toolbar button below could keep showing the appearance from *before* the
   * Mac's own setting changed until something unrelated re-rendered the
   * shell. This tick exists only to force that re-render, so
   * `resolveTheme(appearance.theme)` — read fresh on every render — is never
   * stale while Auto is selected.
   */
  const [systemThemeTick, forceRerenderOnSystemThemeChange] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => forceRerenderOnSystemThemeChange((tick) => tick + 1);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  /**
   * One search key. The lookup happens on the keypress, not at mount, so a
   * feature that registers its search command later (or not at all) is handled
   * without the shell knowing which feature owns search.
   */
  const openSearch = useCallback(() => {
    const command = findCommand("search");
    if (command) void command.run();
    else setPaletteOpen(true);
  }, []);

  useShortcut("mod+k", openSearch);
  useShortcut(PALETTE_SHORTCUT, openPalette);

  /**
   * Every other key in the product. Registered after the two above so those
   * two answer first, and skipping their shortcuts so a feature that also
   * registers a "search" command cannot get it twice.
   */
  useCommandShortcuts(commands, { reserved: SHELL_OWN_SHORTCUTS });

  // The search dialog renders in its own React root and asks for the palette
  // through an event rather than reaching into this component's state.
  useEffect(() => {
    const handler = () => setPaletteOpen(true);
    window.addEventListener(OPEN_PALETTE_EVENT, handler);
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, handler);
  }, []);

  const switchWorkspace = useCallback(() => {
    const command = findCommand("switch-workspace");
    if (command) void command.run();
  }, []);

  const isActive = useCallback(
    (to: string): boolean => {
      if (to === "/") return location === "/" || location === "/today";
      // A pinned view's link carries a `?view=` query, which wouter's location
      // leaves out, so compare the whole thing for those.
      if (to.includes("?")) {
        const here = `${location}${typeof window === "undefined" ? "" : window.location.search}`;
        return here === to;
      }
      return location === to || location.startsWith(`${to}/`);
    },
    [location],
  );

  /** The toolbar's leading-edge view title (HIG review finding 9). */
  const viewTitle = useMemo(
    () => deriveViewTitle(navItems, navSections, routes, location, isActive),
    [navItems, navSections, routes, location, isActive],
  );

  /**
   * The toolbar's appearance button (HIG review finding 5). `systemThemeTick`
   * is not read, only depended on: it is what makes this recompute when the
   * OS preference flips while Auto is selected and nothing else about this
   * render would otherwise change (see the effect above).
   */
  const themeButton = useMemo(
    () => themeButtonLabels(appearance.theme),
    [appearance.theme, systemThemeTick],
  );

  const renderItem = useCallback(
    (item: FeatureNavItem) => (
      <NavItem
        key={item.to}
        label={item.label}
        icon={item.icon ? <item.icon size={18} aria-hidden /> : undefined}
        active={isActive(item.to)}
        href={item.to}
        onClick={(e) => {
          e.preventDefault();
          navigate(item.to);
        }}
        badge={item.badge}
      />
    ),
    [isActive, navigate],
  );

  /**
   * The static items, with each dynamic group spliced in at its own order, so
   * "Views" (15) lands between Today (10) and Contacts (20).
   *
   * A LABELLED group is a visual group: it gets its own `SidebarSection`, with
   * the caption heading above it and the section's own padding around it.
   *
   * An UNLABELLED group is not. Its rows join the run of static rows around
   * them, in their own order, and no extra gap appears — which is the whole
   * point of it: a feature whose row has to be read from the database (the
   * pipeline row, whose label is Deals, Jobs or Quotes) can contribute it
   * through `navProvider` without cutting the sidebar in two at that row.
   */
  const sidebar = useMemo(() => {
    const blocks: ReactNode[] = [];
    let run: FeatureNavItem[] = [];
    let runKey = "static-0";
    let cursor = 0;

    const flushRun = () => {
      if (run.length === 0) return;
      blocks.push(<SidebarSection key={runKey}>{run.map(renderItem)}</SidebarSection>);
      run = [];
    };

    navSections.forEach((section, index) => {
      while (cursor < navItems.length && navItems[cursor].order <= section.order) {
        run.push(navItems[cursor++]);
      }
      if (section.items.length === 0) return;
      if (section.label) {
        flushRun();
        blocks.push(
          <SidebarSection key={`section-${section.label}-${index}`} label={section.label}>
            {section.items.map(renderItem)}
          </SidebarSection>,
        );
        runKey = `static-${index + 1}`;
        return;
      }
      run.push(...section.items);
    });

    run.push(...navItems.slice(cursor));
    flushRun();
    // An application with no sidebar items at all still draws the empty group,
    // so the nav element is never childless.
    if (blocks.length === 0) {
      blocks.push(<SidebarSection key="static-empty">{null}</SidebarSection>);
    }
    return blocks;
  }, [navItems, navSections, renderItem]);

  const hasWorkspaceSwitcher = findCommand("switch-workspace") !== null;

  /* macOS runs an integrated title bar, so the window has to be draggable by
     our own chrome — the top bar and the slot beside the traffic lights. On
     Windows the native bar does that job and these stay off. Read once: the
     platform does not change while the app is running. */
  const macOS = isMacOS();

  return (
    <TooltipProvider>
      {/* The shell owns the whole window. html, body and #root are all 100%
          (globals.css), so `h-full` here is a definite viewport height rather
          than "as tall as the content" — which is what used to leave the
          sidebar and the canvas stopping short and the bare window showing
          through underneath. The main column scrolls inside that height; the
          body never scrolls. */}
      <div className="flex h-full min-h-screen min-w-[1024px] overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
        <Sidebar
          dragRegion={macOS}
          brand={
            /* The lockup: the mark with its offset sticker outline and the
               word in the heading face. The one place in the running
               application that always wears --shadow-sticker. */
            <div className="flex min-h-[var(--control-h)] w-full items-center px-[var(--space-3)]">
              <Brand size="sm" />
            </div>
          }
          footer={
            hasWorkspaceSwitcher ? (
              <button
                type="button"
                onClick={switchWorkspace}
                title="Switch workspace"
                className="flex min-h-[var(--control-h-sm)] w-full items-center px-[var(--space-3)] text-left text-[length:var(--text-sm)] text-[var(--color-text-faint)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none hover:bg-[var(--color-hover)] hover:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
              >
                <span className="truncate">{workspace.name}</span>
              </button>
            ) : (
              <div className="flex min-h-[var(--control-h-sm)] items-center px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-text-faint)]">
                {workspace.name}
              </div>
            )
          }
        >
          {sidebar}
        </Sidebar>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar
            dragRegion={macOS}
            left={
              /* The view title (HIG review finding 9): the leading edge is
                 for the sidebar toggle and the window title, not the search
                 field, and with `hiddenTitle: true` this is the only title
                 that ever appears. Plain ink, the body face — this is toolbar
                 chrome, not a heading, so it is not `PageHeader` and it does
                 not spend the brand's one confident block. Non-interactive:
                 it stays part of the drag region a click on the bar starts. */
              <span
                className="max-w-[280px] truncate text-[length:var(--text-sm)] font-medium text-[var(--color-text)]"
                title={viewTitle}
              >
                {viewTitle}
              </span>
            }
            right={
              <div className="flex items-center gap-[var(--space-2)]">
                <WriteStatus />
                <Tooltip content={themeButton.stateLabel}>
                  <IconButton
                    label={themeButton.actionLabel}
                    // The visible tooltip above already says what the state
                    // is; a second, native browser tooltip from this same
                    // button would either repeat it or — worse — show the
                    // action instead and read as two disagreeing tooltips
                    // stacked on top of each other.
                    title={undefined}
                    onClick={() => void appearance.setTheme(nextTheme(appearance.theme))}
                    icon={
                      themeButton.resolved === "dark" ? (
                        <MoonStars size={16} weight="bold" aria-hidden />
                      ) : (
                        <Sun size={16} weight="bold" aria-hidden />
                      )
                    }
                  />
                </Tooltip>
                {/* The macOS search field, moved to the trailing edge
                    (HIG review finding 9: search-fields.md asks for it here,
                    not the leading edge). It is a button rather than an
                    input because pressing it opens the search dialog — the
                    field is the affordance, not the target — and it carries
                    no drag-region attribute of its own, so it stays clickable
                    inside the bar's drag region (Topbar only drags from the
                    element the pointer actually lands on). */}
                <button
                  type="button"
                  onClick={openSearch}
                  className="flex h-[var(--control-h)] min-w-[260px] items-center gap-[var(--space-2)] bg-[var(--color-accent-soft)] px-[var(--space-3)] text-left text-[length:var(--text-sm)] text-[var(--color-text-faint)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                >
                  <MagnifyingGlass size={16} weight="bold" aria-hidden />
                  <span className="flex-1">Search</span>
                  <Kbd keys="mod+k" />
                </button>
              </div>
            }
          />

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-[var(--space-7)] py-[var(--space-6)]">
            <Switch>
              {routes.map((route) => (
                <Route key={route.path} path={route.path}>
                  {route.element}
                </Route>
              ))}
              <Route>
                <NotFound />
              </Route>
            </Switch>
          </main>
        </div>
      </div>

      {/*
        Every feature's always-mounted content: the dialogs that open from any
        screen. Inside the providers, below the routed screen, so a feature no
        longer needs its own React root on <body> (FeatureModule.overlays).
      */}
      {overlays.map(({ id, node }) => (
        <Fragment key={id}>{node}</Fragment>
      ))}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {/*
        sonner does not read the app's theme on its own, so a dark app got
        light toasts. "auto" is sonner's "system", which follows the same media
        query `applyAppearance` does.
      */}
      <Toaster
        position="bottom-right"
        closeButton
        richColors={false}
        theme={appearance.theme === "auto" ? "system" : appearance.theme}
      />
    </TooltipProvider>
  );
}

/** The router wrapper, so main.tsx mounts one component. */
export function ShellRoot(props: ShellProps) {
  return (
    <Router>
      <Shell {...props} />
    </Router>
  );
}
