// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installRadixStubs } from "./radixSetup";
import { renderTimePicker } from "./timePicker.fixtures";
import { parseTimeInput } from "@/ui/TimePicker";

installRadixStubs();

afterEach(() => {
  cleanup();
});

function getInput(): HTMLInputElement {
  return screen.getByTestId("time-picker") as HTMLInputElement;
}

/** The same locale formatting TimePicker uses internally, computed here so
 *  assertions never hard-code an AM/PM string that would break in another
 *  locale's CI run. */
function expectedLabel(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const d = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
}

describe("parseTimeInput", () => {
  const cases: Array<[string, string | null]> = [
    ["9", "09:00"],
    ["9a", "09:00"],
    ["9am", "09:00"],
    ["9 AM", "09:00"],
    ["9p", "21:00"],
    ["9pm", "21:00"],
    ["930", "09:30"],
    ["0930", "09:30"],
    ["9:30", "09:30"],
    ["9:30 pm", "21:30"],
    ["21:30", "21:30"],
    ["2400", null],
    ["25:00", null],
    ["9:75", null],
    ["banana", null],
    ["", null],
  ];

  it.each(cases)("parses %p as %p", (input, expected) => {
    expect(parseTimeInput(input)).toBe(expected);
  });

  it("prefer24h rejects a meridiem suffix instead of reinterpreting it", () => {
    expect(parseTimeInput("9pm", { prefer24h: true })).toBeNull();
    expect(parseTimeInput("21:00", { prefer24h: true })).toBe("21:00");
  });
});

describe("TimePicker", () => {
  it("renders the placeholder when value is null and the locale-formatted time when set", () => {
    renderTimePicker({ placeholder: "Select a time" });
    expect(getInput().getAttribute("placeholder")).toBe("Select a time");
    expect(getInput().value).toBe("");

    cleanup();
    renderTimePicker({ initialValue: "09:30" });
    expect(getInput().value).toBe(expectedLabel("09:30"));
  });

  it("lists options at the requested step when opened", async () => {
    const user = userEvent.setup();
    renderTimePicker({ step: 30 });

    await user.click(getInput());

    expect(screen.getAllByTestId("time-picker-option")).toHaveLength(48);
  });

  it("clicking an option calls onChange with the exact HH:MM", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderTimePicker({ onChangeSpy });

    await user.click(getInput());
    const options = screen.getAllByTestId("time-picker-option");
    const target = options.find((el) => el.getAttribute("data-time") === "10:00");
    expect(target).toBeTruthy();

    await user.click(target!);

    expect(onChangeSpy).toHaveBeenCalledWith("10:00");
    expect(getInput().value).toBe(expectedLabel("10:00"));
  });

  it('the selected option carries aria-selected="true"', async () => {
    const user = userEvent.setup();
    renderTimePicker({ initialValue: "10:00" });

    await user.click(getInput());
    const options = screen.getAllByTestId("time-picker-option");
    const selected = options.find((el) => el.getAttribute("data-time") === "10:00");
    const other = options.find((el) => el.getAttribute("data-time") === "10:15");

    expect(selected?.getAttribute("aria-selected")).toBe("true");
    expect(other?.getAttribute("aria-selected")).toBe("false");
  });

  it("typing filters the option list", async () => {
    const user = userEvent.setup();
    renderTimePicker({});

    const input = getInput();
    await user.click(input);
    await user.type(input, "09:30");

    const options = screen.getAllByTestId("time-picker-option");
    expect(options).toHaveLength(1);
    expect(options[0].getAttribute("data-time")).toBe("09:30");
  });

  it("ArrowDown moves the highlight and Enter commits it", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderTimePicker({ onChangeSpy });

    const input = getInput();
    await user.click(input);
    // Default highlight with no value set is 09:00; one ArrowDown moves to
    // the next 15-minute option, 09:15.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(onChangeSpy).toHaveBeenCalledWith("09:15");
    expect(input.value).toBe(expectedLabel("09:15"));
  });

  it("Escape closes and reverts the typed text without calling onChange", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderTimePicker({ initialValue: "10:00", onChangeSpy });

    const input = getInput();
    await user.click(input);
    await user.clear(input);
    await user.type(input, "banana");
    await user.keyboard("{Escape}");

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(input.value).toBe(expectedLabel("10:00"));
  });

  it("blur commits whatever the parser makes of the typed text, or reverts if unparseable", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderTimePicker({ initialValue: "10:00", onChangeSpy });

    const input = getInput();
    await user.click(input);
    await user.clear(input);
    await user.type(input, "930p");
    await user.tab();

    expect(onChangeSpy).toHaveBeenCalledWith("21:30");
  });

  it("min/max disable out-of-range options and reject out-of-range typed input", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderTimePicker({ min: "09:00", max: "17:00", onChangeSpy });

    const input = getInput();
    await user.click(input);
    const early = screen
      .getAllByTestId("time-picker-option")
      .find((el) => el.getAttribute("data-time") === "08:00");
    expect(early?.getAttribute("aria-disabled")).toBe("true");

    await user.clear(input);
    await user.type(input, "6am");
    await user.tab();

    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it('clearable calls onChange(null) with accessible name "Clear time" and does not open the popover', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderTimePicker({ initialValue: "10:00", clearable: true, onChangeSpy });

    const clearButton = screen.getByRole("button", { name: "Clear time" });
    await user.click(clearButton);

    expect(onChangeSpy).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("uses no hard-coded hex colour and no Tailwind palette class anywhere in the rendered markup", async () => {
    const user = userEvent.setup();
    renderTimePicker({});
    await user.click(getInput());

    const html = document.body.innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/text-blue|text-purple|bg-blue|bg-purple/);
  });
});
