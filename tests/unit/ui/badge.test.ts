// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "@/ui";
import type { ComponentProps } from "react";

afterEach(() => {
  cleanup();
});

function renderBadge(props: ComponentProps<typeof Badge>) {
  return render(React.createElement(Badge, props));
}

describe("Badge", () => {
  it("tone=brand wears the brand primary tint but labels it in ink", () => {
    renderBadge({ tone: "brand", children: "Brand" });

    const badge = screen.getByText("Brand");
    expect(badge.className).toContain("bg-[var(--color-brand-primary-soft)]");
    expect(badge.className).toContain("text-[var(--color-text)]");
    expect(badge.className).not.toContain("text-[var(--color-brand-primary-ink)]");
  });

  it("tone=secondary wears the brand secondary tint but labels it in ink, not purple", () => {
    // Round 3, criterion 2: the tint says which tag it is; the word does not
    // have to be tinted as well, and no text in the product is purple.
    renderBadge({ tone: "secondary", children: "Secondary" });

    const badge = screen.getByText("Secondary");
    expect(badge.className).toContain("bg-[var(--color-brand-secondary-soft)]");
    expect(badge.className).toContain("text-[var(--color-text)]");
    expect(badge.className).not.toContain("text-[var(--color-brand-secondary-ink)]");
  });

  it("tone=highlight wears the brand accent tint but labels it in ink, not yellow", () => {
    renderBadge({ tone: "highlight", children: "Highlight" });

    const badge = screen.getByText("Highlight");
    expect(badge.className).toContain("bg-[var(--color-brand-accent-soft)]");
    expect(badge.className).toContain("text-[var(--color-text)]");
    expect(badge.className).not.toContain("text-[var(--color-brand-accent-ink)]");
  });

  it("is square: carries no rounded- utility", () => {
    // The brand guide's corner language is a hard edge everywhere, including
    // on badges and count pills (docs/DESIGN.md §6), so the component never
    // reaches for a rounded- utility in the first place. Do not "fix" this by
    // adding one back, even a no-op one pointed at a zero radius token.
    renderBadge({ tone: "neutral", children: "Square" });

    const badge = screen.getByText("Square");
    expect(badge.className).not.toMatch(/rounded-/);
  });
});
