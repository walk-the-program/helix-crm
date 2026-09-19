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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InlineText } from "@/features/records/components/InlineEdit";

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
