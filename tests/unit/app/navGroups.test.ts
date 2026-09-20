// @vitest-environment jsdom
/**
 * The sidebar's shape (round 3, criteria 21 and 23).
 *
 * Eleven rows in one column, ordered by when each feature happened to be
 * built, made the sidebar a list to read rather than a shape to recognise.
 * `buildNavBlocks` is the pure function that groups them; this exercises it
 * directly rather than through the registry, which every other lead is editing
 * at the same time.
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

import { buildNavBlocks } from "@/app/Shell";
import { NAV_GROUPS, NAV_ORDER, navGroupPosition } from "@/app/feature";
import type { FeatureNavItem, FeatureNavSection } from "@/app/feature";

function item(label: string, to: string, order: number): FeatureNavItem {
  return { label, to, order };
}

/** Every row the shipped product registers, in the arbitrary numeric order
 *  the features themselves give them — which is the input this has to fix. */
const REAL_ITEMS: FeatureNavItem[] = [
  item("Today", "/", NAV_ORDER.today),
  item("Contacts", "/contacts", NAV_ORDER.contacts),
  item("Companies", "/companies", NAV_ORDER.companies),
  item("Tasks", "/tasks", 50),
  item("Reminders", "/recurring", 55),
  item("Invoices", "/invoices", 58),
  item("Reports", "/reports", 60),
  item("Import", "/import", NAV_ORDER.import),
  item("Trash", "/trash", 85),
  item("Settings", "/settings", NAV_ORDER.settings),
  item("Help", "/help", 95),
];

const PIPELINE_SECTION: FeatureNavSection = {
  order: NAV_ORDER.pipeline,
  items: [item("Deals", "/pipeline", NAV_ORDER.pipeline)],
};

function labels(blocks: ReturnType<typeof buildNavBlocks>): string[][] {
  return blocks.map((block) => block.items.map((i) => i.label));
}

describe("navGroupPosition", () => {
  it("knows every route the groups name, and nothing else", () => {
    expect(navGroupPosition("/")).toEqual({ group: 0, index: 0 });
    expect(navGroupPosition("/companies")).toEqual({ group: 1, index: 1 });
    expect(navGroupPosition("/services")).toEqual({ group: 2, index: 1 });
    expect(navGroupPosition("/nowhere")).toBeNull();
  });

  it("lists no route twice", () => {
    const all = NAV_GROUPS.flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("buildNavBlocks", () => {
  it("groups related rows together, in the order Walker asked for", () => {
    // Today · Contacts, Companies · Deals, Invoices, Reports · Tasks,
    // Reminders · Import · Trash · Settings, Help.
    const blocks = buildNavBlocks(REAL_ITEMS, [PIPELINE_SECTION]);
    expect(labels(blocks)).toEqual([
      ["Today"],
      ["Contacts", "Companies"],
      ["Deals", "Invoices", "Reports"],
      ["Tasks", "Reminders"],
      ["Import"],
      ["Trash"],
      ["Settings", "Help"],
    ]);
  });

  it("ignores the numeric order a feature picked, because three of them pick their own", () => {
    // Invoices registers 58 and Tasks 50, so by number Tasks would land
    // between Deals and Invoices. Grouping by route is what stops a feature
    // from knocking the sidebar out of shape.
    const blocks = buildNavBlocks(REAL_ITEMS, [PIPELINE_SECTION]);
    const money = blocks.find((b) => b.items.some((i) => i.label === "Invoices"));
    expect(money?.items.map((i) => i.label)).toEqual(["Deals", "Invoices", "Reports"]);
  });

  it("puts the services catalogue between Deals and Invoices (criterion 23)", () => {
    const withServices = [...REAL_ITEMS, item("Services", "/services", NAV_ORDER.services)];
    const blocks = buildNavBlocks(withServices, [PIPELINE_SECTION]);
    const money = blocks.find((b) => b.items.some((i) => i.label === "Services"));
    expect(money?.items.map((i) => i.label)).toEqual([
      "Deals",
      "Services",
      "Invoices",
      "Reports",
    ]);
  });

  it("gives a labelled dynamic section its own group, placed by its order", () => {
    const pinned: FeatureNavSection = {
      order: NAV_ORDER.views,
      label: "Pinned views",
      items: [item("Gone quiet", "/today?view=quiet", NAV_ORDER.views)],
    };
    const blocks = buildNavBlocks(REAL_ITEMS, [PIPELINE_SECTION, pinned]);
    const index = blocks.findIndex((b) => b.kind === "section" && b.label === "Pinned views");
    // Between Today and the Contacts/Companies pair, which is what order 15 means.
    expect(index).toBe(1);
    expect(labels(blocks)[0]).toEqual(["Today"]);
    expect(labels(blocks)[2]).toEqual(["Contacts", "Companies"]);
  });

  it("never drops a row whose route the group list has not heard of", () => {
    const stranger = item("Fleet", "/fleet", 34);
    const blocks = buildNavBlocks([...REAL_ITEMS, stranger], [PIPELINE_SECTION]);
    const flat = blocks.flatMap((b) => b.items.map((i) => i.label));
    expect(flat).toContain("Fleet");
    // Placed by its own number: 34 sits after Companies (group rank 1000) and
    // before the money group (rank 2000)... which is to say, in its own group,
    // wherever its order puts it — the point is only that it is still there.
    expect(flat).toHaveLength(REAL_ITEMS.length + 2);
  });

  it("answers an empty sidebar with no groups rather than a blank one", () => {
    expect(buildNavBlocks([], [])).toEqual([]);
  });
});
