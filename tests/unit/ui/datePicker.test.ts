// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installRadixStubs } from "./radixSetup";
import { renderDatePicker } from "./datePicker.fixtures";
import { addDaysToDateString, formatDateDisplay, todayLocal } from "@/lib/dates";

installRadixStubs();

afterEach(() => {
  cleanup();
});

const today = todayLocal();

describe("DatePicker", () => {
  it("renders the placeholder when value is null, and the formatted date when set", () => {
    renderDatePicker({ value: null, placeholder: "Due date" });
    const trigger = screen.getByTestId("date-picker");
    expect(trigger.textContent).toContain("Due date");

    cleanup();

    renderDatePicker({ value: "2026-09-19" });
    const triggerWithValue = screen.getByTestId("date-picker");
    expect(triggerWithValue.textContent).toContain(formatDateDisplay("2026-09-19", "en-US"));
  });

  it("opening the popover shows the grid; clicking a day calls onChange with the exact YYYY-MM-DD and closes the popover", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderDatePicker({ value: null, onChange });

    await user.click(screen.getByTestId("date-picker"));
    await screen.findByTestId("date-picker-grid");

    const todayCell = screen
      .getAllByTestId("date-picker-day")
      .find((el) => el.getAttribute("data-date") === today);
    expect(todayCell).toBeTruthy();
    expect(todayCell?.getAttribute("data-today")).toBe("true");

    await user.click(todayCell as HTMLElement);

    expect(onChange).toHaveBeenCalledWith(today);
    await waitFor(() => {
      expect(screen.queryByTestId("date-picker-grid")).toBeNull();
    });
  });

  it("arrow-key navigation moves the focused day and Enter selects it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderDatePicker({ value: null, onChange });

    await user.click(screen.getByTestId("date-picker"));
    await screen.findByTestId("date-picker-grid");

    // The popover opens with today focused (no value is set yet).
    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.getAttribute("data-date")).toBe(today);
    });

    const tomorrow = addDaysToDateString(today, 1);
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect((document.activeElement as HTMLElement | null)?.getAttribute("data-date")).toBe(tomorrow);
    });

    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(tomorrow);
    await waitFor(() => {
      expect(screen.queryByTestId("date-picker-grid")).toBeNull();
    });
  });

  it("Escape closes without calling onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderDatePicker({ value: null, onChange });

    await user.click(screen.getByTestId("date-picker"));
    await screen.findByTestId("date-picker-grid");

    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("date-picker-grid")).toBeNull();
    });
  });

  it("min/max disable out-of-range days", async () => {
    const user = userEvent.setup();
    const min = today;
    const max = addDaysToDateString(today, 3);
    renderDatePicker({ value: null, min, max });

    await user.click(screen.getByTestId("date-picker"));
    await screen.findByTestId("date-picker-grid");

    const cells = screen.getAllByTestId("date-picker-day");
    const dayBefore = cells.find((el) => el.getAttribute("data-date") === addDaysToDateString(today, -1));
    const dayAfterMax = cells.find((el) => el.getAttribute("data-date") === addDaysToDateString(today, 4));
    const todayCell = cells.find((el) => el.getAttribute("data-date") === today);
    const lastEnabledCell = cells.find((el) => el.getAttribute("data-date") === max);

    expect((dayBefore as HTMLButtonElement).disabled).toBe(true);
    expect((dayAfterMax as HTMLButtonElement).disabled).toBe(true);
    expect((todayCell as HTMLButtonElement).disabled).toBe(false);
    expect((lastEnabledCell as HTMLButtonElement).disabled).toBe(false);
  });

  it("clearable calls onChange(null)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderDatePicker({ value: "2026-09-19", onChange, clearable: true });

    const clearButton = screen.getByRole("button", { name: "Clear date" });
    await user.click(clearButton);

    expect(onChange).toHaveBeenCalledWith(null);
    // Clicking the clear affordance must not also open the popover.
    expect(screen.queryByTestId("date-picker-grid")).toBeNull();
  });

  it("renders no hard-coded hex colour and no Tailwind palette colour class", async () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/ui/DatePicker.tsx"), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\btext-blue\b|\btext-purple\b|\bbg-blue\b|\bbg-purple\b/);

    const user = userEvent.setup();
    renderDatePicker({ value: "2026-09-19", clearable: true });

    await user.click(screen.getByTestId("date-picker"));
    await screen.findByTestId("date-picker-grid");

    const classNames = [
      screen.getByTestId("date-picker").className,
      ...screen.getAllByTestId("date-picker-day").map((el) => el.className),
    ].join(" ");

    expect(classNames).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(classNames).not.toMatch(/\btext-blue\b|\btext-purple\b|\bbg-blue\b|\bbg-purple\b/);
  });
});
