/**
 * F-LC-16: the Phone region row's hint used to parse one hardcoded US sample
 * number ("8015550147") against whichever region was selected.
 * `normalizePhone` never rejects a number — an unparseable one keeps its raw
 * digits and answers `e164: null` — so parsing a US number as, say, a United
 * Kingdom one fell through to that fallback, and the hint told a UK owner
 * that Helix stores phone numbers as a bare unformatted string, which it
 * never does. Each region now gets its own genuinely valid sample number.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { queryClient } from "@/app/queryClient";
import { createHarness, type Harness } from "../../repo/harness";
import { renderWorkspaceScreen } from "./fixtures";

let h: Harness | null = null;

afterEach(() => {
  cleanup();
  queryClient.clear();
  h?.dispose();
  h = null;
});

async function renderWithRegion(region: string) {
  const settingsRepo = await import("@/db/repos/settings");
  await settingsRepo.set("defaultRegion", region);
  renderWorkspaceScreen();
  return screen.findByText(/A number typed as/);
}

describe("WorkspaceScreen: Phone region hint", () => {
  it("reads exactly as it does today for the US default", async () => {
    h = await createHarness();
    const hint = await renderWithRegion("US");
    expect(hint.textContent).toBe(
      "A number typed as (801) 555-0147 is stored as +18015550147.",
    );
  });

  it("shows a real E.164 number, not raw digits, for United Kingdom", async () => {
    h = await createHarness();
    const hint = await renderWithRegion("GB");
    expect(hint.textContent).toMatch(/is stored as \+44\d+\.$/);
    expect(hint.textContent).not.toContain("8015550147");
  });

  it("shows a real E.164 number for Australia", async () => {
    h = await createHarness();
    const hint = await renderWithRegion("AU");
    expect(hint.textContent).toMatch(/is stored as \+61\d+\.$/);
  });

  it("shows a real E.164 number for Canada", async () => {
    h = await createHarness();
    const hint = await renderWithRegion("CA");
    expect(hint.textContent).toMatch(/is stored as \+1\d+\.$/);
  });
});
