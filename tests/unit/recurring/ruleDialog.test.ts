// @vitest-environment jsdom
/**
 * RuleDialog's start date: the r3 round replaced the native
 * `<input type="date">` with the in-app DatePicker. The dialog's own
 * validation ("Pick the first date this is due.") has to still be reachable
 * through the new control, and the value it saves is still the same
 * "YYYY-MM-DD" string `recurring.create`/`update` always took.
 *
 * Written with `createElement` rather than JSX because vitest.config.ts
 * collects `tests/unit/**\/*.test.ts` only, same convention as
 * tests/unit/records/inlineEdit.test.ts.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installRadixStubs } from "../ui/radixSetup";
import { todayLocal } from "@/lib/dates";
import { advanceDate } from "@/db/repos/recurring";

installRadixStubs();

const createMutateAsync = vi.fn().mockResolvedValue({ id: "r1" });
const updateMutateAsync = vi.fn().mockResolvedValue({ id: "r1" });

vi.mock("@/features/recurring/lib/hooks", () => ({
  useCreateRule: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateRule: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

import { RuleDialog } from "@/features/recurring/components/RuleDialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RuleDialog: first one due", () => {
  it("has no native date input; the field is the DatePicker", () => {
    render(createElement(RuleDialog, { open: true, onOpenChange: vi.fn(), target: {} }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByTestId("date-picker")).toBeTruthy();
  });

  it("defaults to a real date and saves it as-is", async () => {
    const user = userEvent.setup();
    render(createElement(RuleDialog, { open: true, onOpenChange: vi.fn(), target: {} }));

    await user.type(screen.getByLabelText("What is it"), "Spring cleanup");
    await user.click(screen.getByRole("button", { name: "Add reminder" }));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const call = createMutateAsync.mock.calls[0][0] as { nextDueOn: string };
    expect(call.nextDueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("picking a day in the grid is what the dialog saves as nextDueOn", async () => {
    const user = userEvent.setup();
    render(createElement(RuleDialog, { open: true, onOpenChange: vi.fn(), target: {} }));

    // The dialog opens with the grid focused on its own default - a year
    // from today, since no rule was passed - so that default date's own
    // cell is the one on screen without paging the calendar first.
    const defaultStart = advanceDate(todayLocal(), 1, "year");

    await user.click(screen.getByTestId("date-picker"));
    const grid = await screen.findByTestId("date-picker-grid");
    const cell = within(grid)
      .getAllByTestId("date-picker-day")
      .find((day) => day.getAttribute("data-date") === defaultStart);
    expect(cell).toBeTruthy();
    await user.click(cell as HTMLElement);

    await user.type(screen.getByLabelText("What is it"), "Spring cleanup");
    await user.click(screen.getByRole("button", { name: "Add reminder" }));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Spring cleanup", nextDueOn: defaultStart }),
    );
  });

  it("clearing the date blocks save with the same message the native input gave", async () => {
    const user = userEvent.setup();
    render(createElement(RuleDialog, { open: true, onOpenChange: vi.fn(), target: {} }));

    await user.type(screen.getByLabelText("What is it"), "Spring cleanup");

    await user.click(screen.getByTestId("date-picker"));
    await user.click(await screen.findByRole("button", { name: "Clear date" }));

    await user.click(screen.getByRole("button", { name: "Add reminder" }));

    expect(await screen.findByText("Pick the first date this is due.")).toBeTruthy();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });
});
