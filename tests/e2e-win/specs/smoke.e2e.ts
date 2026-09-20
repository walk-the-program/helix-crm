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
  /**
   * commit 106aafc added a first-run setup flow (src/features/onboarding) in
   * front of any workspace that has never been used: gate.ts sends a brand
   * new workspace to three screens - "Your business", "How you'll track
   * work", "Bring your customers in" - instead of straight to Today, and
   * while it is showing there is no sidebar at all (OnboardingFrame replaces
   * the whole window). A workspace this runner already set up skips the flow
   * and lands on Today directly, so this detects which of the two happened
   * rather than assuming either.
   *
   * The flow is driven for real (not skipped) because this is the one place
   * in the suite that proves first run works against a real WebView2, the
   * same way tests/e2e-mac/specs/onboarding.e2e.ts drives it against the
   * mocked IPC layer. Selectors are roles and visible text - the `tag*=text`
   * partial-text idiom already used below for the Today heading - never ids
   * or CSS classes.
   */
  before(async () => {
    const businessHeading = await $("h1*=Your business");
    const todayHeading = await $('h1*=Today');

    const screen = await browser.waitUntil(
      async () => {
        if (await businessHeading.isExisting()) return 'onboarding';
        if (await todayHeading.isExisting()) return 'today';
        return false;
      },
      {
        timeout: 30000,
        timeoutMsg:
          'Neither the onboarding "Your business" screen nor the Today screen appeared after launch',
      },
    );

    if (screen === 'today') return;

    // Screen 1, "Your business" (src/features/onboarding/screens/BusinessScreen.tsx):
    // the name is prefilled from the workspace's own name, except a
    // workspace that has never been renamed comes back blank
    // (readDefaultBusinessName in src/features/onboarding/lib/settings.ts
    // treats the "My business" default as no name at all) - fill it in
    // whenever that happens, since a blank name blocks Continue. The trade
    // grid has no default selection either, so a tile has to be picked
    // before Continue is enabled.
    const businessNameField = await $('aria/What is the business called?');
    await businessNameField.waitForDisplayed({
      timeout: 15000,
      timeoutMsg: 'The business name field never appeared on the "Your business" screen',
    });
    if ((await businessNameField.getValue()) === '') {
      await businessNameField.setValue('Smoke Test Co.');
    }

    const landscapingTile = await $('button*=Landscaping');
    await landscapingTile.waitForClickable({
      timeout: 15000,
      timeoutMsg: 'The "Landscaping" trade tile never became clickable',
    });
    await landscapingTile.click();

    const continueButton = await $('button*=Continue');
    await continueButton.waitForClickable({
      timeout: 15000,
      timeoutMsg: 'The "Continue" button on the "Your business" screen never became clickable',
    });
    await continueButton.click();

    // Screen 2, "How you'll track work" (TrackingScreen.tsx): the trade's
    // preset, prefilled and editable. "Use this setup" writes it as-is.
    const trackingHeading = await $("h1*=How you'll track work");
    await trackingHeading.waitForDisplayed({
      timeout: 15000,
      timeoutMsg: `"How you'll track work" heading never appeared after Continue`,
    });

    const useThisSetupButton = await $('button*=Use this setup');
    await useThisSetupButton.waitForClickable({
      timeout: 15000,
      timeoutMsg: 'The "Use this setup" button never became clickable',
    });
    await useThisSetupButton.click();

    // Screen 3, "Bring your customers in" (CustomersScreen.tsx): four equal
    // choices, each its own button. "Start empty" is the one that leaves the
    // workspace with nothing seeded, which is what the rest of this suite
    // expects.
    const customersHeading = await $('h1*=Bring your customers in');
    await customersHeading.waitForDisplayed({
      timeout: 15000,
      timeoutMsg: '"Bring your customers in" heading never appeared after Use this setup',
    });

    const startEmptyButton = await $('button*=Start empty');
    await startEmptyButton.waitForClickable({
      timeout: 15000,
      timeoutMsg: 'The "Start empty" button never became clickable',
    });
    await startEmptyButton.click();

    await todayHeading.waitForDisplayed({
      timeout: 15000,
      timeoutMsg: 'The Today screen never appeared after finishing setup',
    });
  });

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
