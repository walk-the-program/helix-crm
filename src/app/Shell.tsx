/**
 * The application shell: sidebar, topbar, router outlet, command palette and
 * toaster. Everything it renders comes from the feature registry, so a feature
 * agent adds a screen without touching this file.
 */
import { useCallback, useMemo, useState } from "react";
import { Route, Router, Switch, useLocation } from "wouter";
import { Toaster } from "sonner";
import { Search } from "lucide-react";
import { allNavItems, allRoutes } from "@/app/registry";
import { CommandPalette } from "@/app/CommandPalette";
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

export function Shell({ registry, workspace }: ShellProps) {
  const [location, navigate] = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const routes = useMemo(() => allRoutes(), []);
  const navItems = useMemo(() => allNavItems(), []);
  const appearance = useAppearance(registry);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useShortcut("mod+k", openPalette);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-screen min-w-[1024px] bg-[var(--color-bg)] text-[var(--color-text)]">
        <Sidebar
          footer={
            <div className="px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--color-text-faint)]">
              {workspace.name}
            </div>
          }
        >
          <SidebarSection>
            {navItems.map((item) => (
              <NavItem
                key={item.to}
                label={item.label}
                icon={item.icon ? <item.icon size={18} aria-hidden /> : undefined}
                active={
                  item.to === "/"
                    ? location === "/" || location === "/today"
                    : location === item.to || location.startsWith(`${item.to}/`)
                }
                href={item.to}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.to);
                }}
                badge={item.badge}
              />
            ))}
          </SidebarSection>
        </Sidebar>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            left={
              <button
                type="button"
                onClick={openPalette}
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
      <Toaster position="bottom-right" closeButton richColors={false} />
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
