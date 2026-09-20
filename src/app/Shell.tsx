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
import type { FeatureNavItem, FeatureNavSection } from "@/app/feature";
import { useAppearance, useShortcut, useWriteState } from "@/app/hooks";
import { useCommandShortcuts } from "@/app/shortcuts";
import type { HelixRegistry, WorkspaceEntry } from "@/app/appSettings";
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

export function Shell({ registry, workspace }: ShellProps) {
  const [location, navigate] = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const routes = useMemo(() => allRoutes(), []);
  const navItems = useMemo(() => allNavItems(), []);
  const navSections = useDynamicNavSections();
  const commands = useMemo(() => allCommands(), []);
  const overlays = useMemo(() => allOverlays(), []);
  const appearance = useAppearance(registry);

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

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-screen min-w-[1024px] bg-[var(--color-bg)] text-[var(--color-text)]">
        <Sidebar
          brand={
            /* The lockup: the mark with its accent sticker shadow and the
               word in Zilla Slab. The one place in the running application
               that wears --shadow-sticker. */
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

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            left={
              /* The macOS search field: a soft grey field, no border, the
                 glyph in tertiary ink, the shortcut on the right. It is a
                 button rather than an input because pressing it opens the
                 search dialog — the field is the affordance, not the target. */
              <button
                type="button"
                onClick={openSearch}
                className="flex h-[var(--control-h)] min-w-[260px] items-center gap-[var(--space-2)] bg-[var(--color-accent-soft)] px-[var(--space-3)] text-left text-[length:var(--text-sm)] text-[var(--color-text-faint)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
              >
                <MagnifyingGlass size={16} weight="bold" aria-hidden />
                <span className="flex-1">Search</span>
                <Kbd keys="mod+k" />
              </button>
            }
            right={
              <div className="flex items-center gap-[var(--space-2)]">
                <WriteStatus />
                <IconButton
                  label={appearance.theme === "dark" ? "Switch to light" : "Switch to dark"}
                  onClick={() =>
                    void appearance.setTheme(
                      appearance.theme === "dark" ? "light" : "dark",
                    )
                  }
                  icon={
                    appearance.theme === "dark" ? (
                      <Sun size={16} weight="bold" aria-hidden />
                    ) : (
                      <MoonStars size={16} weight="bold" aria-hidden />
                    )
                  }
                />
              </div>
            }
          />

          <main className="min-w-0 flex-1 overflow-y-auto px-[var(--space-7)] py-[var(--space-6)]">
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
