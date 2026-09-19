import { $, browser, expect } from '@wdio/globals';

// Named *.e2e.ts (not *.spec.ts) so Vitest's default `include` glob - which
// only looks for *.spec.ts / *.test.ts under tests/unit and tests/repo -
// never picks these files up; wdio.conf.ts points `specs` at this pattern
// explicitly instead of relying on Vitest ignoring it by accident.
//
// This is a smoke test only: it exists to prove the harness itself works
// (real binary launches, WebView2 attaches, the shell renders) before any
// real flow is written against it. The fuller flows from docs/PLAN.md's
// "Tests" section belong here once the corresponding UI lands:
//   - first launch (fresh workspace, onboarding)
//   - quick add
//   - import a HubSpot export
//   - drag a deal
//   - complete a task from Today
//   - restore a backup
//   - switch workspace
//   - AI off/on against a local fake endpoint

describe('Helix CRM smoke', () => {
  it('launches and titles the window with the product name', async () => {
    // tauri.conf.json's app.windows[0].title and productName are both
    // "Helix CRM"; the window title is the cheapest possible proof that the
    // real app.window - not a blank WebView2 host - came up.
    const title = await browser.getTitle();
    expect(title).toBe('Helix CRM');
  });

  it('renders the sidebar with a Today item', async () => {
    // docs/CONTRACTS.md's sidebar order lists "Today" as the first nav entry
    // (order 10). Select by accessible name rather than a CSS class so this
    // survives styling/markup changes to the sidebar.
    const nav = await $('nav');
    await nav.waitForDisplayed({ timeout: 30000 });

    const todayNavItem = await nav.$('aria/Today');
    await todayNavItem.waitForDisplayed();
  });

  it('renders the Today screen heading', async () => {
    // Today is the default/landing route, so its heading should already be
    // on screen after the window finishes loading (see wdio.conf.ts's
    // `before` hook).
    const heading = await $('h1*=Today');
    await heading.waitForDisplayed();
  });
});
