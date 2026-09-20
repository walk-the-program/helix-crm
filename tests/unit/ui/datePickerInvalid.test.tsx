// @vitest-environment jsdom
/**
 * `Field` sets `aria-invalid` on whatever control it wraps, and the DatePicker
 * was the one control in the kit that took it and drew nothing — a required
 * date failed validation, the message appeared under the field, and the field
 * itself looked exactly as it had a moment before. It shows what every other
 * control shows: the border turns --color-danger and nothing else does
 * (docs/DESIGN.md §5 — the ink stays the ink).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DatePicker } from "@/ui/DatePicker";
import { Input } from "@/ui";

afterEach(() => {
  cleanup();
});

describe("DatePicker invalid", () => {
  it("turns its border --color-danger when aria-invalid is set", () => {
    render(
      <DatePicker value={null} onChange={() => {}} locale="en-US" aria-invalid aria-label="Due" />,
    );
    const trigger = screen.getByTestId("date-picker");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.className).toContain("border-[var(--color-danger)]");
    expect(trigger.className).not.toContain("border-[var(--color-border-strong)]");
  });

  it("keeps the ordinary border when it is not", () => {
    render(<DatePicker value={null} onChange={() => {}} locale="en-US" aria-label="Due" />);
    const trigger = screen.getByTestId("date-picker");
    expect(trigger.hasAttribute("aria-invalid")).toBe(false);
    expect(trigger.className).toContain("border-[var(--color-border-strong)]");
    expect(trigger.className).not.toContain("border-[var(--color-danger)]");
  });

  /** The whole point: one invalid look across the kit, not two. */
  it("uses the same danger border token the Input uses", () => {
    const { container } = render(<Input invalid aria-label="Name" />);
    const input = container.querySelector("input") as HTMLElement;
    expect(input.className).toContain("border-[var(--color-danger)]");
  });

  it("recolours nothing but the border", () => {
    render(
      <DatePicker value={null} onChange={() => {}} locale="en-US" aria-invalid aria-label="Due" />,
    );
    const trigger = screen.getByTestId("date-picker");
    expect(trigger.className).toContain("text-[var(--color-text)]");
    expect(trigger.className).not.toContain("text-[var(--color-danger)]");
    expect(trigger.className).not.toContain("bg-[var(--color-danger)]");
  });
});
