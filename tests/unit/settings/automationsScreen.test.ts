/**
 * Settings > Automations (LR-PX-C, PART 2), in the style of
 * tests/unit/settings/tagsScreenDialogs.test.ts: a real in-memory database
 * (the repo harness) backs the render, so "the screen actually saves" is
 * exercised, not just its markup. No JSX here - the file is a plain `.ts`
 * (vitest.config.ts also picks up `.tsx`, but the task packet names this file
 * with a `.ts` extension), so the component tree is built with
 * `React.createElement` instead.
 *
 * Covers: the days<->minutes round trip on the two day-denominated rules, the
 * token helper text naming the workspace's own word for a job, and the live
 * "Reads like" example rendered through `renderTemplate`.
 */
// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/app/queryClient";
import { installRadixStubs } from "../ui/radixSetup";
import { createHarness, type Harness } from "../../repo/harness";
import { AutomationsScreen } from "@/features/settings/components/AutomationsScreen";
import * as automationsRepo from "@/db/repos/automations";
import * as settingsRepo from "@/db/repos/settings";

installRadixStubs();

function renderAutomationsScreen() {
  return render(
    createElement(QueryClientProvider, { client: queryClient }, createElement(AutomationsScreen)),
  );
}

let h: Harness | null = null;

afterEach(() => {
  cleanup();
  queryClient.clear();
  h?.dispose();
  h = null;
});

describe("AutomationsScreen: days <-> minutes round trip", () => {
  it("shows the quote-follow-up rule's default 4320 minutes as 3 days", async () => {
    h = await createHarness();
    renderAutomationsScreen();

    const delay = await screen.findByTestId("automation-quote_sent-delay");
    await waitFor(() => {
      expect((delay as HTMLInputElement).value).toBe("3");
    });
  });

  it("saves 3 days typed into a day-denominated rule as 4320 minutes", async () => {
    h = await createHarness();
    // Start from a different value so the save below is not a same-value no-op.
    await automationsRepo.update("quote_sent", { delayMinutes: 1440 });

    const user = userEvent.setup();
    renderAutomationsScreen();

    const delay = await screen.findByTestId("automation-quote_sent-delay");
    await waitFor(() => expect((delay as HTMLInputElement).value).toBe("1"));

    await user.clear(delay);
    await user.type(delay, "3");
    await user.tab();

    await waitFor(async () => {
      const saved = await automationsRepo.get("quote_sent");
      expect(saved?.delayMinutes).toBe(4320);
    });
  });

  it("shows the lead-arrived rule's delay in minutes, not days", async () => {
    h = await createHarness();
    renderAutomationsScreen();

    const delay = await screen.findByTestId("automation-lead_arrived-delay");
    // Seeded at 60 minutes (drizzle/0008_automations.sql); a minutes-unit
    // rule must never be divided by 1440 the way the two day rules are.
    await waitFor(() => {
      expect((delay as HTMLInputElement).value).toBe("60");
    });
  });
});

describe("AutomationsScreen: vocabulary-aware token helper text", () => {
  it("names the workspace's own word for a job in the {job} explanation", async () => {
    h = await createHarness();
    await settingsRepo.set("vocabulary", "jobs");
    renderAutomationsScreen();

    const group = await screen.findByTestId("automation-lead_arrived");
    await waitFor(() => {
      expect(group.textContent).toContain("{job} is the job.");
    });
    expect(group.textContent).not.toContain("{job} is the deal.");
  });

  it("reads back to the default word for a deal when the vocabulary is unset", async () => {
    h = await createHarness();
    renderAutomationsScreen();

    const group = await screen.findByTestId("automation-lead_arrived");
    await waitFor(() => {
      expect(group.textContent).toContain("{job} is the deal.");
    });
  });

  it("does not offer a {job} token on the invoice-overdue rule, which never fills one in", async () => {
    h = await createHarness();
    renderAutomationsScreen();

    const group = await screen.findByTestId("automation-invoice_overdue");
    await waitFor(() => {
      expect(group.textContent).toContain("{number} is the invoice number.");
    });
    expect(group.textContent).not.toContain("{job}");
  });
});

describe("AutomationsScreen: the live example", () => {
  it("renders the quote-follow-up default title through renderTemplate with sample tokens", async () => {
    h = await createHarness();
    renderAutomationsScreen();

    const example = await screen.findByTestId("automation-quote_sent-example");
    // The seeded title is "Follow up on quote {number} with {name}".
    await waitFor(() => {
      expect(example.textContent).toBe("Reads like: Follow up on quote Q-1042 with Jamie Rivera");
    });
  });

  it("updates the example live after the title is edited and saved", async () => {
    h = await createHarness();
    renderAutomationsScreen();

    // fireEvent.change/blur rather than user.type/tab: userEvent v14 treats
    // "{" as the start of a special-key sequence, and escaping it reliably
    // for a literal "{name}" token is more trouble than the direct DOM
    // events are worth here.
    const title = await screen.findByTestId("automation-lead_arrived-title");
    fireEvent.change(title, { target: { value: "Say hi to {name}" } });
    fireEvent.blur(title);

    const example = await screen.findByTestId("automation-lead_arrived-example");
    await waitFor(() => {
      expect(example.textContent).toBe("Reads like: Say hi to Jamie Rivera");
    });
  });
});
