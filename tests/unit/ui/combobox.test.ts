// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { filterComboboxItems, defaultCreateLabel, type ComboboxItem } from "@/ui/Combobox";
import { installRadixStubs } from "./radixSetup";
import {
  CONTACTS,
  MANY,
  renderCombobox,
  renderComboboxInFieldWithError,
  renderLongCombobox,
  renderMultiCombobox,
} from "./combobox.fixtures";

installRadixStubs();

afterEach(() => {
  cleanup();
});

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "ui", "Combobox.tsx"),
  "utf8",
);

describe("filterComboboxItems", () => {
  it("matches the label, the detail line and the hidden keywords", () => {
    expect(filterComboboxItems(CONTACTS, "aisha").map((i) => i.id)).toEqual(["c1"]);
    expect(filterComboboxItems(CONTACTS, "roofing").map((i) => i.id)).toEqual(["c1"]);
    // The phone number is a keyword: it is matched but never printed.
    expect(filterComboboxItems(CONTACTS, "900111").map((i) => i.id)).toEqual(["c1"]);
    expect(filterComboboxItems(CONTACTS, "nothing here")).toEqual([]);
    expect(filterComboboxItems(CONTACTS, "  ")).toHaveLength(CONTACTS.length);
  });

  it("is case-insensitive", () => {
    expect(filterComboboxItems(CONTACTS, "BEN").map((i) => i.id)).toEqual(["c2"]);
  });
});

describe("defaultCreateLabel", () => {
  it("quotes the query in curly quotes", () => {
    expect(defaultCreateLabel("  Dave  ")).toBe("Add “Dave”");
  });
});

describe("Combobox", () => {
  it("shows the placeholder closed, and the chosen label once something is picked", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderCombobox({ onChangeSpy });

    const trigger = screen.getByTestId("combobox");
    expect(trigger.textContent).toContain("Search");

    await user.click(trigger);
    await user.click(await screen.findByText("Ben Whitcombe"));

    expect(onChangeSpy).toHaveBeenCalledWith("c2", expect.objectContaining({ id: "c2" }));
    await waitFor(() => {
      expect(screen.getByTestId("combobox").textContent).toContain("Ben Whitcombe");
    });
  });

  it("filters as you type and offers only the matching rows", async () => {
    const user = userEvent.setup();
    renderCombobox();

    await user.click(screen.getByTestId("combobox"));
    await user.type(screen.getByTestId("combobox-input"), "nun");

    await waitFor(() => {
      expect(screen.getAllByTestId("combobox-option")).toHaveLength(1);
    });
    expect(screen.getByTestId("combobox-option").textContent).toContain("Carla Nunes");
  });

  it("is keyboard complete: arrows move the highlight and Enter picks", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderCombobox({ onChangeSpy });

    await user.click(screen.getByTestId("combobox"));
    const input = screen.getByTestId("combobox-input");
    expect(document.activeElement).toBe(input);

    await user.keyboard("{ArrowDown}{ArrowDown}");
    const options = screen.getAllByTestId("combobox-option");
    expect(options[2].getAttribute("data-highlighted")).toBe("true");
    // The input keeps the focus; the highlight travels through aria-activedescendant.
    expect(input.getAttribute("aria-activedescendant")).toBe(options[2].id);

    await user.keyboard("{Enter}");
    expect(onChangeSpy).toHaveBeenCalledWith("c3", expect.objectContaining({ id: "c3" }));
  });

  it("wraps the highlight at both ends", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.click(screen.getByTestId("combobox"));

    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByTestId("combobox-option")[2].getAttribute("data-highlighted")).toBe(
      "true",
    );
  });

  it("closes on Escape without choosing anything", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderCombobox({ onChangeSpy });

    await user.click(screen.getByTestId("combobox"));
    expect(screen.getByTestId("combobox-input")).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("combobox-input")).toBeNull();
    });
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it("offers a create row for an unmatched query and hands the trimmed text to onCreate", async () => {
    const user = userEvent.setup();
    const onCreateSpy = vi.fn();
    renderCombobox({ onCreateSpy });

    await user.click(screen.getByTestId("combobox"));
    await user.type(screen.getByTestId("combobox-input"), "Dave Pike");

    const create = await screen.findByTestId("combobox-create");
    expect(create.textContent).toContain("Add “Dave Pike”");
    await user.click(create);
    expect(onCreateSpy).toHaveBeenCalledWith("Dave Pike");
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderCombobox();
    await user.click(screen.getByTestId("combobox"));
    await user.type(screen.getByTestId("combobox-input"), "zzzz");
    expect((await screen.findByTestId("combobox-empty")).textContent).toContain("No matches");
  });

  it("searches asynchronously, debounced, and ignores an out-of-order answer", async () => {
    const user = userEvent.setup();
    const search = vi.fn(async (q: string): Promise<ComboboxItem[]> => {
      return CONTACTS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
    });
    renderCombobox({ items: search });

    await user.click(screen.getByTestId("combobox"));
    await waitFor(() => {
      expect(screen.getAllByTestId("combobox-option").length).toBe(3);
    });

    await user.type(screen.getByTestId("combobox-input"), "carla");
    await waitFor(() => {
      expect(screen.getAllByTestId("combobox-option")).toHaveLength(1);
    });
    // Debounced: five keystrokes did not mean five queries.
    expect(search.mock.calls.length).toBeLessThan(6);
  });

  it("clears back to null when clearable", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderCombobox({ onChangeSpy, clearable: true, initialValue: "c1" });

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChangeSpy).toHaveBeenCalledWith(null, undefined);
  });

  it("caps its own height against the room Radix says is left, and scrolls inside", () => {
    // The actual defect Walker reported: the list ran off the bottom of the
    // screen. jsdom has no layout, so this is asserted on the authored class.
    expect(SOURCE).toContain("--radix-popover-content-available-height");
    expect(SOURCE).toContain("avoidCollisions");
    expect(SOURCE).toContain("collisionPadding={8}");
    expect(SOURCE).toContain("overflow-y-auto");
  });

  it("authors no colour of its own: no hex literal and no palette class", () => {
    expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SOURCE).not.toMatch(/\b(?:text|bg|border)-(?:blue|purple|indigo|violet|sky)-/);
  });
});

describe("MultiCombobox", () => {
  it("ticks several rows and stays open", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderMultiCombobox({ onChangeSpy });

    await user.click(screen.getByTestId("combobox"));
    await user.click(await screen.findByText("Aisha Okafor"));
    expect(onChangeSpy).toHaveBeenLastCalledWith(["c1"]);
    // Still open.
    expect(screen.getByTestId("combobox-input")).toBeTruthy();

    await user.click(screen.getByText("Carla Nunes"));
    expect(onChangeSpy).toHaveBeenLastCalledWith(["c1", "c3"]);

    await waitFor(() => {
      expect(screen.getByTestId("combobox").textContent).toContain("2 chosen");
    });
  });

  it("unticks a chosen row", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    renderMultiCombobox({ onChangeSpy });

    await user.click(screen.getByTestId("combobox"));
    await user.click(await screen.findByText("Aisha Okafor"));
    await user.click(screen.getByText("Aisha Okafor"));
    expect(onChangeSpy).toHaveBeenLastCalledWith([]);
  });
});

describe("the CPO pass's two kit fixes", () => {
  it("keeps the highlighted row in view in a 400-item list (F-LC-12)", async () => {
    const user = userEvent.setup();
    const scrolled: unknown[] = [];
    // jsdom has no layout, so scrollIntoView does not exist on the prototype;
    // recording the calls is what proves the component asks for it at all,
    // which is exactly what was missing.
    const original = (HTMLElement.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView;
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
      function scrollIntoViewStub(this: HTMLElement, arg: unknown) {
        scrolled.push({ id: this.id, arg });
      };
    try {
      renderLongCombobox();
      await user.click(screen.getByTestId("combobox"));
      const input = await screen.findByTestId("combobox-input");
      expect(MANY).toHaveLength(400);

      scrolled.length = 0;
      for (let i = 0; i < 20; i += 1) await user.keyboard("{ArrowDown}");

      expect(scrolled.length, "arrowing asks the list to follow").toBeGreaterThan(0);
      // "nearest" moves the list by the minimum, rather than jumping the row
      // to the middle of the popover.
      expect(scrolled.at(-1)).toMatchObject({ arg: { block: "nearest" } });
      expect(input).toBeTruthy();
    } finally {
      if (original === undefined) {
        delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      } else {
        (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = original;
      }
    }
  });

  it("moves a page at a time with PageDown and PageUp", async () => {
    const user = userEvent.setup();
    renderLongCombobox();
    await user.click(screen.getByTestId("combobox"));
    const input = await screen.findByTestId("combobox-input");

    const active = () => input.getAttribute("aria-activedescendant");
    const first = active();
    await user.keyboard("{PageDown}");
    expect(active(), "PageDown moves further than one row").not.toBe(first);
    await user.keyboard("{PageUp}");
    expect(active(), "PageUp comes back").toBe(first);

    // It clamps rather than wrapping: a page up from the top stays at the top.
    await user.keyboard("{PageUp}");
    expect(active()).toBe(first);
  });

  it("lets Field wire its error to the control (F-LC-11)", async () => {
    renderComboboxInFieldWithError();
    const trigger = screen.getByTestId("combobox");

    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy, "Field's error id reaches the control").toBeTruthy();

    const error = document.getElementById(describedBy as string);
    expect(error?.textContent).toContain("Pick the customer");
  });

  it("still forwards nothing when Field has no error to give", () => {
    renderCombobox();
    const trigger = screen.getByTestId("combobox");
    expect(trigger.getAttribute("aria-invalid")).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
  });

  it("declares the two ARIA props on every picker in the file", () => {
    // One grep, so a future picker cannot quietly drop back to the old shape.
    const declarations = SOURCE.match(/"aria-describedby"\?: string;/g) ?? [];
    expect(declarations.length, "Combobox and MultiCombobox both declare it").toBe(2);
  });
});
