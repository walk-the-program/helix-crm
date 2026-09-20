// @vitest-environment jsdom
/**
 * Round 3, criterion 17 (docs/rounds/2026-09-20-round-3.md): the trade grid's
 * tiles render at one height regardless of a hint, the sources step is gone
 * from screen 2 while its data keeps flowing into applyPlan untouched, and
 * the website wording on screen 3 speaks to any owner, not only ClearPath
 * clients.
 *
 * jsdom does not lay out CSS, so the actual equal-height claim for the trade
 * grid is proven in the browser by tests/e2e-mac/specs/onboarding.e2e.ts
 * ("trade tiles are equal height..."). What is checked here is the one thing
 * jsdom can see: every ChoiceTile — with a hint or without one — carries the
 * exact same className, so nothing but content differs between them.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { installRadixStubs } from "../ui/radixSetup";
import {
  renderChoiceTile,
  renderTrackingScreen,
  renderCustomersScreen,
} from "./round3.fixtures";
import { PRESETS } from "../../../src/features/onboarding/presets";

installRadixStubs();

afterEach(() => {
  cleanup();
});

const SITE_SENTENCE =
  "Leads from your website land here on their own. ClearPath sites work straight away; Help covers any other site.";

describe("ChoiceTile sizing", () => {
  it("carries the same min-height class whether or not it has a hint", () => {
    const withHint = renderChoiceTile("Plumbing, HVAC, electrical");
    const hintedClass = withHint.container.querySelector("button")!.className;
    withHint.unmount();

    const withoutHint = renderChoiceTile(undefined);
    const bareClass = withoutHint.container.querySelector("button")!.className;

    expect(hintedClass).toContain("min-h-[calc(var(--row-h)_+_var(--space-6))]");
    expect(hintedClass).toContain("h-full");
    expect(hintedClass).toBe(bareClass);
  });
});

describe("TrackingScreen: the sources step is gone", () => {
  it("renders no 'Where the work comes from' section and no 'Add a source' button", () => {
    renderTrackingScreen();
    expect(screen.queryByText("Where the work comes from")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a source" })).toBeNull();
  });

  it("still renders the stage editor, the vocabulary tiles and the custom-fields editor", () => {
    renderTrackingScreen();
    expect(screen.getByRole("group", { name: "What you call the work" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a stage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a detail" })).toBeTruthy();
  });

  it("keeps the preset's sources in the plan untouched, ready for applyPlan", () => {
    const { plan } = renderTrackingScreen();
    const preset = PRESETS.landscaping;
    expect(plan.sources.map((s) => s.name)).toEqual(preset.sources.map((s) => s.name));
    expect(plan.sources).toHaveLength(4);
  });
});

describe("CustomersScreen: public website wording", () => {
  it("the site card speaks to any owner, not only ClearPath clients", () => {
    renderCustomersScreen();
    expect(screen.getByText(SITE_SENTENCE)).toBeTruthy();
  });
});

describe("Today's connect-website copy", () => {
  // Rendering TodayScreen/ConnectSiteCard needs react-query and wouter
  // providers this package does not own (R3-L1's shell), so this checks the
  // wording the same way the task packet allows: the string is in the file.
  // tests/e2e-mac/specs/today.e2e.ts is untouched — it only asserts the
  // "Connect website" link name, which this wording change does not affect.
  // Vite's `new URL('...', import.meta.url)` asset-URL rewriting only
  // understands a string literal first argument; handed a template literal
  // with a variable in it, it silently rewrites the URL to "undefined"
  // instead of throwing (see tests/unit/app/menuIds.test.ts for the same
  // fileURLToPath + path.join pattern used to avoid that).
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  function readSource(relativePath: string): string {
    return readFileSync(join(REPO_ROOT, relativePath), "utf8");
  }

  it("TodayScreen's first-run 'Connect a website' card carries the sentence", () => {
    expect(readSource("src/features/today/TodayScreen.tsx")).toContain(SITE_SENTENCE);
  });

  it("ConnectSiteCard's explanatory line carries the sentence", () => {
    const source = readSource("src/features/today/sections/ConnectSite.tsx").replace(
      /\s+/g,
      " ",
    );
    expect(source).toContain(SITE_SENTENCE);
  });
});
