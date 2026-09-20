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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Route, Router, Switch, useLocation } from "wouter";
import { cn } from "@/ui/cn";
import { Toaster } from "sonner";
import { MagnifyingGlass, MoonStars, SidebarSimple, Sun } from "@/ui/icons";
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
import { TOGGLE_SIDEBAR_EVENT, TOGGLE_SIDEBAR_SHORTCUT } from "@/app/sidebarCommand";
import {
  navGroupPosition,
  type FeatureNavItem,
  type FeatureNavSection,
  type FeatureRoute,
} from "@/app/feature";
import { useAppearance, useShortcut, useWriteState } from "@/app/hooks";
import { useCommandShortcuts } from "@/app/shortcuts";
import {
  isMacOS,
  nextTheme,
  resolveTheme,
  setSidebar,
  subscribeToRegistry,
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
  SidebarSeparator,
  SIDEBAR_DEFAULT_W,
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
const SHELL_OWN_SHORTCUTS = ["mod+k", PALETTE_SHORTCUT, TOGGLE_SIDEBAR_SHORTCUT] as const;

/**
 * The toolbar's appearance button (round 3, criterion 6).
 *
 * IT IS A TOGGLE NOW, not a cycle. It used to run Auto -> Light -> Dark ->
 * Auto, which was defensible on paper — Auto is always one press away — and
 * wrong in the hand: Walker's Mac is on dark, Helix was on Auto and therefore
 * dark, and turning the app light took two presses (Auto -> Light was the
 * first, but from Dark it was Dark -> Auto -> Light). A toolbar button that
 * sometimes needs one press and sometimes two is a broken button.
 *
 * So the button flips between Light and Dark and nothing else. From Auto, the
 * first press goes to the OPPOSITE of what is on screen, which is the only
 * reading of "toggle" that does what the eye expects. Auto did not disappear;
 * it moved to the one place a preference belongs, Settings > Appearance, where
 * it is a named choice rather than a stop on a carousel.
 *
 * The two strings are deliberately not the same sentence:
 * - `actionLabel` becomes `IconButton`'s `label` — the accessible name — and
 *   says what pressing it will DO.
 * - `stateLabel` is the visible `Tooltip` and says what the appearance IS,
 *   qualified when Helix is on Auto ("Auto (dark)"), since "Auto" alone does
 *   not tell a Mac owner what they are looking at.
 *
 * Keeping them apart matters for VoiceOver: Radix wires the tooltip as
 * `aria-describedby`, so a screen reader reads the name and then the
 * description. Identical strings would stutter.
 */
export function themeButtonLabels(theme: Theme): {
  actionLabel: string;
  stateLabel: string;
  target: "light" | "dark";
  resolved: "light" | "dark";
} {
  const resolved = resolveTheme(theme);
  // One function decides this, so the toolbar button, the View menu's "Toggle
  // theme" and the palette can never move in different directions.
  const target = nextTheme(theme) as "light" | "dark";
  const actionLabel = target === "light" ? "Switch to light" : "Switch to dark";
  const stateLabel = theme === "auto" ? `Auto (${resolved})` : theme === "light" ? "Light" : "Dark";
  return { actionLabel, stateLabel, target, resolved };
}

/**
 * The sidebar, assembled into groups (round 3, criterion 21).
 *
 * Every nav item the product has, static or from a `navProvider`, lands in one
 * of `NAV_GROUPS`' runs by its route. What is left over — a pinned saved view,
 * a feature added since that list was written — gets a group of its own,
 * placed by its numeric `order`, so nothing is ever dropped for not being on
 * the list. A labelled dynamic section stays its own group with its caption.
 *
 * The result is a list of groups; the shell draws one hairline between each
 * pair. Exported for its unit test, which is the only way to check the shape
 * without rendering the whole registry.
 */
export type NavBlock =
  | { kind: "items"; key: string; items: FeatureNavItem[] }
  | { kind: "section"; key: string; label: string; items: FeatureNavItem[] };

export function buildNavBlocks(
  navItems: readonly FeatureNavItem[],
  navSections: readonly FeatureNavSection[],
): NavBlock[] {
  type Bucket = {
    key: string;
    /** Where the whole group sits against every other group. */
    rank: number;
    label?: string;
    entries: { item: FeatureNavItem; position: number }[];
  };
  const buckets = new Map<string, Bucket>();

  const bucket = (key: string, rank: number, label?: string): Bucket => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: Bucket = { key, rank, label, entries: [] };
    buckets.set(key, created);
    return created;
  };

  const place = (item: FeatureNavItem) => {
    const known = navGroupPosition(item.to);
    if (known) {
      // A known route: the group's rank is the group's index, scaled so an
      // unknown item's `order` can still slot between two groups.
      bucket(`g${known.group}`, known.group * 1000).entries.push({
        item,
        position: known.index,
      });
      return;
    }
    bucket(`u${item.order}`, item.order).entries.push({ item, position: item.order });
  };

  for (const item of navItems) place(item);
  for (const section of navSections) {
    if (section.items.length === 0) continue;
    if (section.label) {
      const b = bucket(`s${section.label}-${section.order}`, section.order, section.label);
      section.items.forEach((item, index) => b.entries.push({ item, position: index }));
      continue;
    }
    for (const item of section.items) place(item);
  }

  return [...buckets.values()]
    .sort((a, b) => a.rank - b.rank)
    .map((b) => {
      const items = b.entries
        .sort((x, y) => x.position - y.position)
        .map((entry) => entry.item);
      return b.label
        ? ({ kind: "section", key: b.key, label: b.label, items } as const)
        : ({ kind: "items", key: b.key, items } as const);
    });
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
   * The sidebar's width and collapsed state (round 3, criterion 7).
   *
   * Held in React so a drag repaints at 60fps, written to helix.json only when
   * the drag ends or the toggle is pressed — 200 file writes while an owner
   * drags an edge is not a thing to do to a spinning disk.
   */
  const [sidebarWidth, setSidebarWidth] = useState(
    registry.sidebar?.width ?? SIDEBAR_DEFAULT_W,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    registry.sidebar?.collapsed ?? false,
  );

  /**
   * The workspace's live name (round 3, criterion 8).
   *
   * `workspace` is the boot result: captured once, at launch. Renaming the
   * workspace in Settings wrote helix.json and left the footer saying the old
   * name until the next relaunch. `subscribeToRegistry` fires on every write
   * to that file, so the footer is right the moment the rename lands.
   */
  const [liveWorkspace, setLiveWorkspace] = useState<WorkspaceEntry>(workspace);
  const workspaceIdRef = useRef(workspace.id);
  workspaceIdRef.current = workspace.id;

  useEffect(() => {
    setLiveWorkspace(workspace);
  }, [workspace]);

  useEffect(
    () =>
      subscribeToRegistry((next) => {
        const found = next.workspaces.find((w) => w.id === workspaceIdRef.current);
        if (found) setLiveWorkspace(found);
      }),
    [],
  );

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
        collapsed={sidebarCollapsed}
        onClick={(e) => {
          e.preventDefault();
          navigate(item.to);
        }}
        badge={item.badge}
      />
    ),
    [isActive, navigate, sidebarCollapsed],
  );

  /**
   * The sidebar's groups, with a hairline between each pair (criterion 21).
   * `buildNavBlocks` above decides the shape; this only renders it. Collapsed,
   * a group's caption is dropped — four letters of a truncated word is noise —
   * and the hairlines carry the grouping alone.
   */
  const sidebar = useMemo(() => {
    const blocks = buildNavBlocks(navItems, navSections);
    if (blocks.length === 0) {
      return [<SidebarSection key="static-empty">{null}</SidebarSection>];
    }
    return blocks.flatMap((block, index) => {
      const rendered =
        block.kind === "section" ? (
          <SidebarSection key={block.key} label={block.label} collapsed={sidebarCollapsed}>
            {block.items.map(renderItem)}
          </SidebarSection>
        ) : (
          <SidebarSection key={block.key} collapsed={sidebarCollapsed}>
            {block.items.map(renderItem)}
          </SidebarSection>
        );
      if (index === 0) return [rendered];
      return [<SidebarSeparator key={`${block.key}-rule`} />, rendered];
    });
  }, [navItems, navSections, renderItem, sidebarCollapsed]);

  /**
   * Collapse and expand. The width is left alone on collapse, so expanding
   * brings back the width the owner chose rather than the default.
   */
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      void setSidebar({ collapsed: next });
      return next;
    });
  }, []);

  useShortcut(TOGGLE_SIDEBAR_SHORTCUT, toggleSidebar);

  // The palette's "Hide or show the sidebar" comes through here: the command
  // is built before anything renders and cannot reach this component's state.
  useEffect(() => {
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, toggleSidebar);
    return () => window.removeEventListener(TOGGLE_SIDEBAR_EVENT, toggleSidebar);
  }, [toggleSidebar]);

  const onSidebarResizeEnd = useCallback((width: number) => {
    void setSidebar({ width });
  }, []);

  const hasWorkspaceSwitcher = findCommand("switch-workspace") !== null;

  /* macOS runs an integrated title bar, so the window has to be draggable by
     our own chrome — the top bar and the slot beside the traffic lights. On
     Windows the native bar does that job and these stay off. Read once: the
     platform does not change while the app is running. */
  const macOS = isMacOS();

  return (
    <TooltipProvider>
      {/* The shell owns the whole window and is the only thing that does.
          html and body are `overflow: hidden` and #root is fixed to the
          viewport (globals.css), so `h-full` here is a definite viewport
          height and NOTHING outside this element can scroll. That is round 3
          criterion 27: a tall deal page used to scroll the body, which put a
          second scrollbar down the right, stopped the sidebar at the content's
          height, and slid the nav rows up under the macOS traffic lights.
          There is now exactly one scroller in the content column (<main>) and
          one in the sidebar's nav area. Note `min-h-screen` is GONE: it was
          the thing that let this element grow past the window. */}
      <div className="flex h-full min-w-[1024px] overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
        <Sidebar
          dragRegion={macOS}
          width={sidebarWidth}
          collapsed={sidebarCollapsed}
          onResize={setSidebarWidth}
          onResizeEnd={onSidebarResizeEnd}
          brand={
            /* The lockup: the plain mark and the word, no sticker and no
               outline (criterion 1). Collapsed, the word goes and the mark
               stands alone in the 48px rail. */
            <div
              className={
                sidebarCollapsed
                  ? "flex min-h-[var(--control-h)] w-full items-center justify-center"
                  : "flex min-h-[var(--control-h)] w-full items-center px-[var(--space-3)]"
              }
            >
              <Brand size="sm" wordmark={!sidebarCollapsed} />
            </div>
          }
          footer={
            /* The live workspace name (criterion 8). Collapsed, the footer
               becomes the workspace's initial with the full name in a
               tooltip — the row still has to say which business is open. */
            hasWorkspaceSwitcher ? (
              <Tooltip content={`${liveWorkspace.name} — switch workspace`} side="right">
                <button
                  type="button"
                  data-testid="workspace-footer"
                  onClick={switchWorkspace}
                  className={cn(
                    "flex min-h-[var(--control-h-sm)] w-full items-center text-[length:var(--text-sm)]",
                    "text-[var(--color-text-faint)] transition-colors duration-[var(--dur-fast)]",
                    "ease-[var(--ease-out)] motion-reduce:transition-none",
                    "hover:bg-[var(--color-hover)] hover:text-[var(--color-text-muted)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]",
                    sidebarCollapsed ? "justify-center px-0" : "px-[var(--space-3)] text-left",
                  )}
                >
                  <span className="truncate">
                    {sidebarCollapsed
                      ? (liveWorkspace.name.trim()[0] ?? "?").toUpperCase()
                      : liveWorkspace.name}
                  </span>
                </button>
              </Tooltip>
            ) : (
              <div
                data-testid="workspace-footer"
                title={liveWorkspace.name}
                className={cn(
                  "flex min-h-[var(--control-h-sm)] items-center text-[length:var(--text-sm)]",
                  "text-[var(--color-text-faint)]",
                  sidebarCollapsed ? "justify-center px-0" : "px-[var(--space-3)]",
                )}
              >
                <span className="truncate">
                  {sidebarCollapsed
                    ? (liveWorkspace.name.trim()[0] ?? "?").toUpperCase()
                    : liveWorkspace.name}
                </span>
              </div>
            )
          }
        >
          {sidebar}
        </Sidebar>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar
            dragRegion={macOS}
            trafficLightInset={macOS && sidebarCollapsed}
            left={
              <>
                {/* The sidebar toggle, at the leading edge where every macOS
                    app puts it. It carries no drag-region attribute, so it
                    stays clickable inside the bar's drag region. */}
                <Tooltip content={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}>
                  <IconButton
                    label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
                    title={undefined}
                    data-testid="toggle-sidebar"
                    onClick={toggleSidebar}
                    icon={<SidebarSimple size={16} weight="bold" aria-hidden />}
                  />
                </Tooltip>
                {/* The view title (HIG review finding 9): the leading edge
                    is for the sidebar toggle and the window title, not the
                    search field, and with `hiddenTitle: true` this is the
                    only title that ever appears. Plain ink, the body face —
                    toolbar chrome, not a heading, so it is not `PageHeader`
                    and it does not spend the brand's one confident block.
                    Non-interactive: it stays part of the drag region a click
                    on the bar starts. */}
                <span
                  className="max-w-[280px] truncate text-[length:var(--text-sm)] font-medium text-[var(--color-text)]"
                  title={viewTitle}
                >
                  {viewTitle}
                </span>
              </>
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
                    onClick={() => void appearance.setTheme(themeButton.target)}
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
