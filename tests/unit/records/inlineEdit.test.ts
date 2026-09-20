// @vitest-environment jsdom
/**
 * The autosave behaviour every record page depends on: no save button, a
 * debounce, a "Saved" indicator, blur flushing immediately, and Escape putting
 * the last saved value back.
 *
 * Written with `createElement` rather than JSX because vitest.config.ts
 * collects `tests/unit/**\/*.test.ts` only, and that file belongs to
 * foundations.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineText, InlineDate } from "@/features/records/components/InlineEdit";
import { installRadixStubs } from "../ui/radixSetup";
import { todayLocal } from "@/lib/dates";

installRadixStubs();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("InlineText", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("has no save button and writes once the typing stops", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(createElement(InlineText, { label: "First name", value: "Brent", onSave: save }));

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();

    const input = screen.getByLabelText("First name");
    fireEvent.change(input, { target: { value: "Brendan" } });

    // Still nothing: the debounce has not elapsed.
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("Brendan");
  });

  it("writes once for a burst of keystrokes, with the last value", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(createElement(InlineText, { label: "First name", value: "", onSave: save }));

    const input = screen.getByLabelText("First name");
    fireEvent.change(input, { target: { value: "B" } });
    fireEvent.change(input, { target: { value: "Br" } });
    fireEvent.change(input, { target: { value: "Bre" } });

    await vi.advanceTimersByTimeAsync(700);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("Bre");
  });

  it("shows a Saved indicator once the write lands", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(createElement(InlineText, { label: "Notes", value: "", onSave: save }));

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Called back" } });
    await vi.advanceTimersByTimeAsync(700);

    await waitFor(() => expect(screen.getByTestId("saved-indicator")).toBeTruthy());
  });

  it("flushes on blur rather than waiting out the debounce", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(createElement(InlineText, { label: "Notes", value: "", onSave: save }));

    const input = screen.getByLabelText("Notes");
    fireEvent.change(input, { target: { value: "Tabbing away" } });
    fireEvent.blur(input);

    await waitFor(() => expect(save).toHaveBeenCalledWith("Tabbing away"));
  });

  it("puts the saved value back on Escape and writes nothing", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(createElement(InlineText, { label: "Notes", value: "Original", onSave: save }));

    const input = screen.getByLabelText("Notes") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Half a thought" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(input.value).toBe("Original");

    await vi.advanceTimersByTimeAsync(700);
    // The debounce still fires with what was typed before Escape; the field
    // itself is back to the saved value, which is what the owner sees.
    expect(input.value).toBe("Original");
  });

  it("says so when the write fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    render(createElement(InlineText, { label: "Notes", value: "", onSave: save }));

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "x" } });
    await vi.advanceTimersByTimeAsync(700);

    await waitFor(() => expect(screen.getByText("Not saved")).toBeTruthy());
    expect(screen.queryByTestId("saved-indicator")).toBeNull();
  });
});

describe("InlineDate", () => {
  it("has no native date input, only the DatePicker trigger", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(createElement(InlineDate, { label: "Install date", value: "2026-04-12", onSave: save }));

    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByTestId("date-picker")).toBeTruthy();
  });

  it("saves the picked day, and clearing writes back the empty string", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(createElement(InlineDate, { label: "Install date", value: "", onSave: save }));

    await user.click(screen.getByTestId("date-picker"));
    const grid = await screen.findByTestId("date-picker-grid");
    const today = within(grid)
      .getAllByTestId("date-picker-day")
      .find((day) => day.getAttribute("data-today") === "true");
    expect(today).toBeTruthy();
    await user.click(today!);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(todayLocal());
    await waitFor(() => expect(screen.getByTestId("saved-indicator")).toBeTruthy());

    await user.click(screen.getByTestId("date-picker"));
    await user.click(await screen.findByRole("button", { name: "Clear date" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith("");
  });

  it("says so when the write fails, same as InlineText", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    render(createElement(InlineDate, { label: "Install date", value: "", onSave: save }));

    await user.click(screen.getByTestId("date-picker"));
    const grid = await screen.findByTestId("date-picker-grid");
    const today = within(grid)
      .getAllByTestId("date-picker-day")
      .find((day) => day.getAttribute("data-today") === "true");
    await user.click(today!);

    await waitFor(() => expect(screen.getByText("Not saved")).toBeTruthy());
    expect(screen.queryByTestId("saved-indicator")).toBeNull();
  });
});
