// @vitest-environment jsdom
/**
 * LA-W3 J8j: the crash screen's consent copy — read what it actually says,
 * and confirm the behaviour matches: nothing is sent anywhere.
 *
 * F-SEC-9 (sec.md) added one sentence to `AppErrorBoundary` in
 * src/app/BootScreens.tsx: "Read them first - an error can quote a name, an
 * address or a note from your own records." — informed consent before the
 * owner is invited to copy `error.message` (which can echo a record's own
 * field values) and send it to Walker. No existing test in the repo pinned
 * this string or exercised the boundary at all (`grep -rl "Read them
 * first|AppErrorBoundary" tests/` found nothing before this file), so this
 * closes that gap independently rather than trusting sec.md's prose.
 *
 * This test also goes one step past reading the source: it arms `fetch`,
 * `XMLHttpRequest.send` and `navigator.sendBeacon` as spies BEFORE the crash,
 * triggers the boundary, clicks every control on the screen that does not
 * navigate away (Copy the details, Back to the app), and asserts none of the
 * three fired. Reading `ReportIssueButton`'s source shows it only calls the
 * Tauri opener plugin on click and never auto-fires; this proves the crash
 * screen sends nothing on its own, behaviourally, not just by inspection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderCrashedApp } from "./crashScreenConsent.fixtures";

const CONSENT_SENTENCE =
  "Read them first - an error can quote a name, an address or a note from your own records.";

describe("AppErrorBoundary: the crash screen's consent copy (J8j)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let xhrSendSpy: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  let beaconSpy: ReturnType<typeof vi.fn>;
  let clipboardWriteText: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    xhrSendSpy = vi.fn<(...args: unknown[]) => void>();
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        open() {}
        setRequestHeader() {}
        send(...args: unknown[]) {
          xhrSendSpy(...args);
        }
      },
    );

    beaconSpy = vi.fn(() => true);
    Object.defineProperty(window.navigator, "sendBeacon", {
      value: beaconSpy,
      configurable: true,
    });

    clipboardWriteText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });

    // React (and this component's own componentDidCatch) log the caught
    // error; expected noise, not the thing under test.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("says the consent sentence, word for word, before the error detail", () => {
    renderCrashedApp();
    expect(screen.getByRole("heading").textContent).toContain("Something broke");
    expect(document.body.textContent).toContain(CONSENT_SENTENCE);

    // The sentence has to come before the reader would act on the detail
    // below it — i.e. it is not appended as an afterthought under the
    // button row.
    const paragraph = screen.getByText(/Helix hit an error it did not expect/);
    expect(paragraph.textContent).toContain(CONSENT_SENTENCE);
  });

  it("shows the raw error detail the consent sentence is warning about", () => {
    renderCrashedApp("secret record detail: Jane Doe, 42 Elm St");
    expect(document.body.textContent).toContain("secret record detail: Jane Doe, 42 Elm St");
  });

  it("does not touch the network on render, and does not touch it when the owner copies the details", async () => {
    renderCrashedApp("boom");

    // Rendering the crash itself must not phone home.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSendSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();

    // The one action a worried owner is likely to take before reading the
    // consent sentence: hit the button that looks like "send this to them".
    const copyButton = screen.getByRole("button", { name: "Copy the details" });
    fireEvent.click(copyButton);
    await Promise.resolve();
    await Promise.resolve();

    expect(clipboardWriteText).toHaveBeenCalledTimes(1);
    // Clipboard only — still nothing over the network.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSendSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });

  it("'Back to the app' resets the boundary without any network activity", () => {
    renderCrashedApp("boom");
    const backButton = screen.getByRole("button", { name: "Back to the app" });
    fireEvent.click(backButton);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSendSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });

  it("offers the GitHub report path, but only as a manual, explicit action (never auto-fired)", () => {
    renderCrashedApp("boom");
    // Present, so the owner has somewhere to go...
    expect(
      screen.getByRole("button", { name: "Report an issue on GitHub" }),
    ).toBeTruthy();
    // ...but nothing has been sent just by the screen existing.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  });
});
