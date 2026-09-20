// @vitest-environment jsdom
/**
 * CustomFieldsPanel's "date" field kind: it used to render InlineText with
 * `type="date"` (a native input); the r3 round moves it to `InlineDate`
 * (the in-app DatePicker) while the panel's own save/clear contract with
 * `customFieldsRepo` is untouched - a set value still calls `setValue` with
 * the "YYYY-MM-DD" string, an unset one still calls `clearValue`.
 *
 * Written with `createElement` rather than JSX, same convention as
 * tests/unit/records/inlineEdit.test.ts.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installRadixStubs } from "../ui/radixSetup";
import { todayLocal } from "@/lib/dates";
import type { CustomField, CustomValueWithField } from "@/db/repos/customFields";

installRadixStubs();

const setValue = vi.fn().mockResolvedValue(undefined);
const clearValue = vi.fn().mockResolvedValue(undefined);
vi.mock("@/db/repos/customFields", () => ({
  setValue: (...args: unknown[]) => setValue(...args),
  clearValue: (...args: unknown[]) => clearValue(...args),
}));
vi.mock("@/features/records/lib/mutations", () => ({
  invalidateRecords: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/app/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

const DATE_FIELD: CustomField = {
  id: "f-install-date",
  entityType: "contact",
  name: "Install date",
  kind: "date",
  optionsJson: null,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
} as unknown as CustomField;

let fields: CustomField[] = [DATE_FIELD];
let values: CustomValueWithField[] = [];

// A partial mock: `InlineDate` (rendered inside this panel) reaches into this
// same module for `useAutosave`, so only the two queries this panel itself
// calls are replaced - everything else keeps its real implementation.
vi.mock("@/features/records/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/records/lib/hooks")>();
  return {
    ...actual,
    useCustomFields: () => ({ data: fields }),
    useCustomValues: () => ({ data: values }),
  };
});

import { CustomFieldsPanel } from "@/features/records/components/CustomFieldsPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fields = [DATE_FIELD];
  values = [];
});

function findTodayCell(): HTMLElement {
  const grid = screen.getByTestId("date-picker-grid");
  const today = within(grid)
    .getAllByTestId("date-picker-day")
    .find((day) => day.getAttribute("data-today") === "true");
  if (!today) throw new Error("no day cell marked as today");
  return today;
}

describe("CustomFieldsPanel: a date field", () => {
  it("has no native date input for a date-kind field", () => {
    render(createElement(CustomFieldsPanel, { entityType: "contact", entityId: "c1" }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByTestId("date-picker")).toBeTruthy();
  });

  it("shows an unset field empty, and picking a day calls setValue with that date", async () => {
    const user = userEvent.setup();
    render(createElement(CustomFieldsPanel, { entityType: "contact", entityId: "c1" }));

    await user.click(screen.getByTestId("date-picker"));
    await user.click(findTodayCell());

    await waitFor(() => expect(setValue).toHaveBeenCalledTimes(1));
    expect(setValue).toHaveBeenCalledWith("f-install-date", "c1", { date: todayLocal() });
    expect(clearValue).not.toHaveBeenCalled();
  });

  it("shows a previously-set value, and clearing it calls clearValue", async () => {
    values = [
      {
        id: "v1",
        entityId: "c1",
        fieldId: "f-install-date",
        valueText: null,
        valueNum: null,
        valueDate: "2026-04-12",
      } as unknown as CustomValueWithField,
    ];
    const user = userEvent.setup();
    render(createElement(CustomFieldsPanel, { entityType: "contact", entityId: "c1" }));

    expect(screen.getByTestId("date-picker").textContent).not.toBe("");

    await user.click(screen.getByTestId("date-picker"));
    await user.click(await screen.findByRole("button", { name: "Clear date" }));

    await waitFor(() => expect(clearValue).toHaveBeenCalledTimes(1));
    expect(clearValue).toHaveBeenCalledWith("f-install-date", "c1");
  });
});
