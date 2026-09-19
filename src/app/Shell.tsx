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
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Route, Router, Switch, useLocation } from "wouter";
import { Toaster } from "sonner";
import { Search } from "lucide-react";
import {
  allNavItems,
  allNavProviders,
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
import type { HelixRegistry, WorkspaceEntry } from "@/app/appSettings";
import {
  Badge,
  EmptyState,
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

/** "Queued behind the import" and friends. */
function WriteStatus() {
  const { busy, label, queued } = useWriteState();
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

export function Shell({ registry, workspace }: ShellProps) {
  const [location, navigate] = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const routes = useMemo(() => allRoutes(), []);
  const navItems = useMemo(() => allNavItems(), []);
  const navSections = useDynamicNavSections();
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
   */
  const sidebar = useMemo(() => {
    const blocks: ReactNode[] = [];
    let cursor = 0;

    navSections.forEach((section, index) => {
      const before: FeatureNavItem[] = [];
      while (cursor < navItems.length && navItems[cursor].order <= section.order) {
        before.push(navItems[cursor++]);
      }
      if (before.length > 0) {
        blocks.push(
          <SidebarSection key={`static-${index}`}>
            {before.map(renderItem)}
          </SidebarSection>,
        );
      }
      if (section.items.length > 0) {
        blocks.push(
          <SidebarSection key={`section-${section.label ?? index}`} label={section.label}>
            {section.items.map(renderItem)}
          </SidebarSection>,
        );
      }
    });

    const tail = navItems.slice(cursor);
    if (tail.length > 0 || blocks.length === 0) {
      blocks.push(<SidebarSection key="static-tail">{tail.map(renderItem)}</SidebarSection>);
    }
    return blocks;
  }, [navItems, navSections, renderItem]);

  const hasWorkspaceSwitcher = findCommand("switch-workspace") !== null;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-screen min-w-[1024px] bg-[var(--color-bg)] text-[var(--color-text)]">
        <Sidebar
          footer={
            hasWorkspaceSwitcher ? (
              <button
                type="button"
                onClick={switchWorkspace}
                title="Switch workspace"
                className="flex w-full items-center rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[length:var(--text-xs)] text-[var(--color-text-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                <span className="truncate">{workspace.name}</span>
              </button>
            ) : (
              <div className="px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
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
              <button
                type="button"
                onClick={openSearch}
                className="flex h-[40px] min-w-[280px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] text-left text-[length:var(--text-sm)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                <Search size={16} aria-hidden />
                <span className="flex-1">Search everything</span>
                <Kbd keys="mod+k" />
              </button>
            }
            right={
              <div className="flex items-center gap-[var(--space-3)]">
                <WriteStatus />
                <button
                  type="button"
                  onClick={() =>
                    void appearance.setTheme(
                      appearance.theme === "dark" ? "light" : "dark",
                    )
                  }
                  className="h-[40px] rounded-[var(--radius-md)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
                >
                  {appearance.theme === "dark" ? "Light" : "Dark"}
                </button>
              </div>
            }
          />

          <main className="min-w-0 flex-1 overflow-y-auto p-[var(--space-6)]">
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
