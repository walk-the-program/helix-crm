/**
 * F-LC-13: FieldsScreen's Create-field and Edit-field dialogs had the same
 * nested-footer defect as TagsScreen's (see tagsScreenDialogs.test.ts for the
 * full explanation of `DialogContent`'s hoist and why a `<form>` wrapping
 * `DialogFooter` defeats it).
 *
 * F-LC-8: the delete-field confirm used to say deleted custom values "go
 * too", which `customFields.softDelete` never does — it only sets
 * `custom_fields.deleted_at`. The rewritten sentence is checked against a
 * field that genuinely has values, counted from real `custom_values` rows
 * rather than a stubbed number.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { queryClient } from "@/app/queryClient";
import { installRadixStubs } from "../ui/radixSetup";
import { createHarness, type Harness } from "../../repo/harness";
import { renderFieldsScreen } from "./fixtures";

installRadixStubs();

let h: Harness | null = null;

afterEach(() => {
  cleanup();
  queryClient.clear();
  h?.dispose();
  h = null;
});

describe("FieldsScreen: Create field dialog hoist and submit", () => {
  it("hoists its footer and still submits on Enter", async () => {
    h = await createHarness();
    const user = userEvent.setup();
    renderFieldsScreen();

    await screen.findByText("No custom fields for contacts yet");
    await user.click(screen.getByTestId("field-add-open"));

    const footer = await screen.findByTestId("dialog-footer");
    expect(footer.getAttribute("data-hoisted")).toBe("true");

    const nameInput = screen.getByTestId("field-name-input");
    await user.type(nameInput, "Gate code");
    fireEvent.submit(nameInput.closest("form")!);

    await waitFor(async () => {
      expect(await screen.findByTestId("field-row")).toBeTruthy();
    });
    expect(screen.getByText("Gate code")).toBeTruthy();
  });
});

describe("FieldsScreen: Edit field dialog hoist", () => {
  it("hoists its footer and saves a rename", async () => {
    h = await createHarness();
    const customFieldsRepo = await import("@/db/repos/customFields");
    await customFieldsRepo.create({
      entityType: "contact",
      name: "Original field",
      kind: "text",
      position: 0,
    });

    const user = userEvent.setup();
    renderFieldsScreen();

    const row = await screen.findByTestId("field-row");
    await user.click(within(row).getByRole("button", { name: /^Edit/ }));

    const footer = await screen.findByTestId("dialog-footer");
    expect(footer.getAttribute("data-hoisted")).toBe("true");

    const nameInput = screen.getByDisplayValue("Original field");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed field");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByText("Renamed field")).toBeTruthy();
    });
  });
});

describe("FieldsScreen: delete confirm copy (F-LC-8)", () => {
  it("never claims a value is deleted, and shows the real custom_values count", async () => {
    h = await createHarness();
    const customFieldsRepo = await import("@/db/repos/customFields");
    const field = await customFieldsRepo.create({
      entityType: "contact",
      name: "Gate code",
      kind: "text",
      position: 0,
    });
    // Two contacts really do carry a value for this field.
    await customFieldsRepo.setValue(field.id, "contact-a", { text: "1234" });
    await customFieldsRepo.setValue(field.id, "contact-b", { text: "5678" });

    const user = userEvent.setup();
    renderFieldsScreen();

    const row = await screen.findByTestId("field-row");
    await user.click(within(row).getByTestId("field-delete"));

    const confirmText = await screen.findByText(/Delete "Gate code"\?/);
    const text = confirmText.textContent ?? "";

    // The count matches the real custom_values rows for this field.
    expect(text).toContain("2 contacts");
    // Truthful: values are kept, never claimed as deleted.
    expect(text).not.toMatch(/values go too/i);
    expect(text.toLowerCase()).toContain("keep their value");
    // Sentence case, no exclamation mark.
    expect(text).not.toContain("!");
  });

  it("does not claim a value when the field has none", async () => {
    h = await createHarness();
    const customFieldsRepo = await import("@/db/repos/customFields");
    await customFieldsRepo.create({
      entityType: "contact",
      name: "Unused field",
      kind: "text",
      position: 0,
    });

    const user = userEvent.setup();
    renderFieldsScreen();

    const row = await screen.findByTestId("field-row");
    await user.click(within(row).getByTestId("field-delete"));

    const confirmText = await screen.findByText(/Delete "Unused field"\?/);
    expect(confirmText.textContent).not.toMatch(/values go too/i);
  });
});
