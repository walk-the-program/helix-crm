// @vitest-environment jsdom
/**
 * TaskComposer's due date and due time: the r3 round replaced both native
 * inputs (`<input type="date">`, `<input type="time">`) with the in-app
 * DatePicker / TimePicker, and the external contract has to be exactly what
 * it was — `tasksRepo.create` still gets the same `dueOn` / `dueAt` shape via
 * `dueFromForm`, and the empty state is still "nothing picked".
 *
 * Written with `createElement` rather than JSX because vitest.config.ts
 * collects `tests/unit/**\/*.test.ts` only, same convention as
 * inlineEdit.test.ts next to this file.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installRadixStubs } from "../ui/radixSetup";
import { todayLocal } from "@/lib/dates";

installRadixStubs();

const createTask = vi.fn().mockResolvedValue({ id: "t1" });
vi.mock("@/db/repos/tasks", () => ({
  create: (...args: unknown[]) => createTask(...args),
}));
vi.mock("@/features/records/lib/mutations", () => ({
  invalidateRecords: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn(),
}));

import { TaskComposer } from "@/features/records/components/TaskComposer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function findTodayCell(): HTMLElement {
  const grid = screen.getByTestId("date-picker-grid");
  const today = within(grid)
    .getAllByTestId("date-picker-day")
    .find((day) => day.getAttribute("data-today") === "true");
  if (!today) throw new Error("no day cell marked as today");
  return today;
}

describe("TaskComposer: due date and due time", () => {
  it("has no native date or time input", () => {
    render(createElement(TaskComposer, {}));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(screen.getByTestId("date-picker")).toBeTruthy();
    expect(screen.getByTestId("time-picker")).toBeTruthy();
  });

  it("saves with no due date or time when neither is touched, same as before", async () => {
    const user = userEvent.setup();
    render(createElement(TaskComposer, {}));

    await user.type(screen.getByLabelText("Title"), "Call Brent back");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Call Brent back", dueOn: null, dueAt: null }),
    );
  });

  it("the time field is disabled until a due date is picked", () => {
    render(createElement(TaskComposer, {}));
    expect((screen.getByTestId("time-picker") as HTMLInputElement).disabled).toBe(true);
  });

  it("picking a date and a time round-trips into dueOn/dueAt exactly as dueFromForm would build them", async () => {
    const user = userEvent.setup();
    render(createElement(TaskComposer, {}));

    await user.type(screen.getByLabelText("Title"), "Follow up on the estimate");

    await user.click(screen.getByTestId("date-picker"));
    await user.click(findTodayCell());

    const timePicker = screen.getByTestId("time-picker") as HTMLInputElement;
    expect(timePicker.disabled).toBe(false);
    await user.click(timePicker);
    await user.click(await screen.findByText("9:00 AM"));

    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    const call = createTask.mock.calls[0][0] as { dueOn: string | null; dueAt: string | null };
    expect(call.dueOn).toBe(todayLocal());
    expect(call.dueAt).not.toBeNull();
    expect(new Date(call.dueAt as string).getHours()).toBe(9);
    expect(new Date(call.dueAt as string).getMinutes()).toBe(0);
  });

  it("clears back to no due date/time and re-disables the time field", async () => {
    const user = userEvent.setup();
    render(createElement(TaskComposer, {}));

    await user.click(screen.getByTestId("date-picker"));
    await user.click(findTodayCell());
    expect((screen.getByTestId("time-picker") as HTMLInputElement).disabled).toBe(false);

    await user.click(screen.getByTestId("date-picker"));
    await user.click(await screen.findByRole("button", { name: "Clear date" }));

    expect((screen.getByTestId("time-picker") as HTMLInputElement).disabled).toBe(true);

    await user.type(screen.getByLabelText("Title"), "No date task");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ dueOn: null, dueAt: null }));
  });
});
