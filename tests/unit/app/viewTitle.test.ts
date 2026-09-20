// @vitest-environment jsdom
/**
 * The toolbar's view title (HIG review finding 9, top-ten item 5): the
 * leading edge used to hold the search field, and with `hiddenTitle: true`
 * nothing stood in for the window title that removes.
 *
 * `deriveViewTitle` is the pure function Shell.tsx renders the toolbar's
 * leading slot from: the most specific nav item whose `to` the location
 * matches — static `navItems` and every feature's dynamic `navSections`
 * together, through the same `isActive` the sidebar itself uses — and a
 * sensible name for a route no nav item owns.
 *
 * `@/app/Shell` pulls in `@/app/registry`, which loads every feature area.
 * The registry is mocked below exactly as tests/unit/app/shellFooter.test.ts
 * does it, since this test never renders the shell.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/registry", () => ({
  allRoutes: () => [],
  allNavItems: () => [],
  allNavProviders: () => [],
  allCommands: () => [],
  allOverlays: () => [],
  findCommand: () => null,
}));

import { deriveViewTitle } from "@/app/Shell";
import type { FeatureNavItem, FeatureNavSection, FeatureRoute } from "@/app/feature";

const NAV_ITEMS: FeatureNavItem[] = [
  { label: "Today", to: "/", order: 10 },
  { label: "Contacts", to: "/contacts", order: 20 },
  { label: "Settings", to: "/settings", order: 90 },
];

const ROUTES: FeatureRoute[] = [
  { path: "/", element: null },
  { path: "/today", element: null },
  { path: "/contacts", element: null },
  { path: "/contacts/:id", element: null },
  { path: "/settings", element: null },
  { path: "/settings/appearance", element: null },
  { path: "/deals/:id", element: null },
  { path: "/trash", element: null },
];

/** The same prefix match `isActive` in Shell.tsx renders the sidebar from. */
function isActiveFor(location: string) {
  return (to: string): boolean => {
    if (to === "/") return location === "/" || location === "/today";
    return location === to || location.startsWith(`${to}/`);
  };
}

describe("deriveViewTitle", () => {
  it("names the view from the nav item that owns the location", () => {
    expect(deriveViewTitle(NAV_ITEMS, [], ROUTES, "/contacts", isActiveFor("/contacts"))).toBe(
      "Contacts",
    );
    expect(deriveViewTitle(NAV_ITEMS, [], ROUTES, "/", isActiveFor("/"))).toBe("Today");
  });

  it("covers a sub-route through its nav item's own prefix, with no fallback needed", () => {
    expect(
      deriveViewTitle(NAV_ITEMS, [], ROUTES, "/settings/appearance", isActiveFor("/settings/appearance")),
    ).toBe("Settings");
  });

  it("picks the most specific match when both a static item and a dynamic section item match", () => {
    const sections: FeatureNavSection[] = [
      { order: 15, items: [{ label: "Overdue", to: "/?view=overdue", order: 15 }] },
    ];
    // Simulates being on the pinned view's own URL: both "Today" ("/") and
    // the pinned view's own (longer) `to` are active for it.
    const isActive = (to: string) => to === "/" || to === "/?view=overdue";
    expect(deriveViewTitle(NAV_ITEMS, sections, ROUTES, "/", isActive)).toBe("Overdue");
  });

  it("names a record detail page no nav item's prefix reaches", () => {
    // The pipeline board is "/pipeline"; a single deal's own page is
    // "/deals/:id", a different path no nav item owns.
    expect(deriveViewTitle(NAV_ITEMS, [], ROUTES, "/deals/42", isActiveFor("/deals/42"))).toBe("Deal");
  });

  it("names /trash, which is linked from Settings and never registered as a nav item", () => {
    expect(deriveViewTitle(NAV_ITEMS, [], ROUTES, "/trash", isActiveFor("/trash"))).toBe("Trash");
  });

  it("names a registered-but-unmapped route from its own path rather than the literal path", () => {
    const routesWithExtra: FeatureRoute[] = [...ROUTES, { path: "/gizmos", element: null }];
    expect(
      deriveViewTitle(NAV_ITEMS, [], routesWithExtra, "/gizmos", isActiveFor("/gizmos")),
    ).toBe("Gizmos");
  });

  it("falls back to a plain not-found title for a location no route registers", () => {
    expect(deriveViewTitle(NAV_ITEMS, [], ROUTES, "/nonexistent", isActiveFor("/nonexistent"))).toBe(
      "Not found",
    );
  });
});
