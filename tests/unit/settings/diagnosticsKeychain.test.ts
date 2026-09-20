/**
 * F-LC-15: `keychainAvailable()` (src/features/ai/lib/secrets.ts, not owned
 * here) reads "the invoke call did not throw" as "the keychain is present".
 * Outside a real Tauri build — this test's jsdom environment included — the
 * call always throws and always resolves to `false`, which used to render as
 * the definitive "No keychain on this machine" rather than "cannot tell",
 * unlike its neighbouring Encryption rows on the same screen. The fix reuses
 * `isTauri()` (src/app/appSettings.ts, already exported) to gate the claim.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { queryClient } from "@/app/queryClient";
import { createHarness, type Harness } from "../../repo/harness";
import { renderDiagnosticsScreen } from "./fixtures";

let h: Harness | null = null;

afterEach(() => {
  cleanup();
  queryClient.clear();
  h?.dispose();
  h = null;
});

describe("DiagnosticsScreen: Key storage row", () => {
  it("reads Unknown under the harness, matching its neighbouring rows, not a definitive claim", async () => {
    h = await createHarness();
    renderDiagnosticsScreen();

    const keyStorageLabel = await screen.findByText("Key storage");
    const row = keyStorageLabel.parentElement as HTMLElement;

    // It never renders either definitive badge under a build this test's
    // jsdom environment cannot possibly confirm a keychain in.
    expect(screen.queryByText("Keychain available")).toBeNull();
    expect(screen.queryByText("No keychain on this machine")).toBeNull();
    expect(row.textContent).toContain("Unknown");
  });
});
