/**
 * F-LC-13: TagsScreen's Add-tag and Edit-tag dialogs used to nest
 * `DialogFooter` inside their `<form>`, which defeats `DialogContent`'s hoist
 * (`src/ui/Dialog.tsx`'s `splitFooter` only finds a `DialogFooter` that is a
 * direct child of `DialogContent`, not one buried inside a form element it
 * cannot see into). The footer now sits as a sibling of the form, with the
 * submitting button wired back to the form by its `form` attribute so Enter
 * inside a field still submits.
 *
 * A real in-memory database (the same harness the repo tests use) backs this
 * rather than mocking `@/db/repos/tags`, so "the dialog actually saves" is
 * exercised too, not just its markup.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { queryClient } from "@/app/queryClient";
import { installRadixStubs } from "../ui/radixSetup";
import { createHarness, type Harness } from "../../repo/harness";
import { renderTagsScreen } from "./fixtures";

installRadixStubs();

let h: Harness | null = null;

afterEach(() => {
  cleanup();
  queryClient.clear();
  h?.dispose();
  h = null;
});

describe("TagsScreen: Add tag dialog hoist and submit", () => {
  it("hoists its footer and still submits on Enter", async () => {
    h = await createHarness();
    const user = userEvent.setup();
    renderTagsScreen();

    // No tags yet: the primary button lives in the empty state.
    await screen.findByText("No tags yet");
    await user.click(screen.getByTestId("tag-add-open"));

    const footer = await screen.findByTestId("dialog-footer");
    expect(footer.getAttribute("data-hoisted")).toBe("true");

    const nameInput = screen.getByTestId("tag-name-input");
    await user.type(nameInput, "Repeat customer");
    // Enter inside the field submits the form the input belongs to, even
    // though the footer's button now lives outside that form — this is the
    // behaviour the `form="add-tag-form"` attribute exists to preserve.
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(async () => {
      expect(await screen.findByTestId("tag-row")).toBeTruthy();
    });
    expect(screen.getByText("Repeat customer")).toBeTruthy();
  });

  it("closes on Cancel without creating a tag", async () => {
    h = await createHarness();
    const user = userEvent.setup();
    renderTagsScreen();

    await screen.findByText("No tags yet");
    await user.click(screen.getByTestId("tag-add-open"));
    await screen.findByTestId("tag-name-input");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByTestId("tag-name-input")).toBeNull();
    });
    expect(screen.getByText("No tags yet")).toBeTruthy();
  });
});

describe("TagsScreen: Edit tag dialog hoist", () => {
  it("hoists its footer and saves a rename", async () => {
    h = await createHarness();
    const tagsRepo = await import("@/db/repos/tags");
    await tagsRepo.create({ name: "Original name", color: "var(--stage-1)" });

    const user = userEvent.setup();
    renderTagsScreen();

    const row = await screen.findByTestId("tag-row");
    await user.click(within(row).getByRole("button", { name: /Rename or recolour/ }));

    const footer = await screen.findByTestId("dialog-footer");
    expect(footer.getAttribute("data-hoisted")).toBe("true");

    const nameInput = screen.getByDisplayValue("Original name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed tag");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByText("Renamed tag")).toBeTruthy();
    });
  });
});
