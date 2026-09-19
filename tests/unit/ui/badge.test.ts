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
  it("tone=brand renders the brand primary tint pair", () => {
    renderBadge({ tone: "brand", children: "Brand" });

    const badge = screen.getByText("Brand");
    expect(badge.className).toContain("bg-[var(--color-brand-primary-soft)]");
    expect(badge.className).toContain("text-[var(--color-brand-primary-ink)]");
  });

  it("tone=secondary renders the brand secondary tint pair", () => {
    renderBadge({ tone: "secondary", children: "Secondary" });

    const badge = screen.getByText("Secondary");
    expect(badge.className).toContain("bg-[var(--color-brand-secondary-soft)]");
    expect(badge.className).toContain("text-[var(--color-brand-secondary-ink)]");
  });

  it("tone=highlight renders the brand accent tint pair", () => {
    renderBadge({ tone: "highlight", children: "Highlight" });

    const badge = screen.getByText("Highlight");
    expect(badge.className).toContain("bg-[var(--color-brand-accent-soft)]");
    expect(badge.className).toContain("text-[var(--color-brand-accent-ink)]");
  });

  it("is square: carries rounded-[var(--radius-full)]", () => {
    // The class name is historical (a holdover from a pill-shaped badge) but
    // the token it points at resolves to 0 under the brand guide's corner
    // language, so every badge renders as a hard-edged rectangle. Do not
    // "fix" this by swapping in a different radius class.
    renderBadge({ tone: "neutral", children: "Square" });

    const badge = screen.getByText("Square");
    expect(badge.className).toContain("rounded-[var(--radius-full)]");
  });
});
