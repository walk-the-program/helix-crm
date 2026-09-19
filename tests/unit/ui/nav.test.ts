// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NavItem } from "@/ui";

afterEach(() => {
  cleanup();
});

function renderNavItem(props: Partial<React.ComponentProps<typeof NavItem>> = {}) {
  return render(React.createElement(NavItem, { label: "Companies", ...props }));
}

describe("NavItem", () => {
  it("active: paints the single confident block and never the quiet selected tint", () => {
    // The brand guide allows the primary exactly once per view, and the
    // selected sidebar row is where the app spends it. --color-selected is
    // the quiet tint reserved for menus and table rows instead, so an active
    // row must never carry it alongside the accent block.
    renderNavItem({ active: true });

    const item = screen.getByRole("button", { name: "Companies" });
    expect(item.className).toContain("bg-[var(--color-accent)]");
    expect(item.className).toContain("text-[var(--color-accent-text)]");
    expect(item.className).not.toContain("bg-[var(--color-selected)]");
  });

  it("active: keeps the block on hover", () => {
    renderNavItem({ active: true });

    const item = screen.getByRole("button", { name: "Companies" });
    expect(item.className).toContain("hover:bg-[var(--color-accent-hover)]");
  });

  it("inactive: carries neither accent class and uses the muted ink", () => {
    renderNavItem({ active: false });

    const item = screen.getByRole("button", { name: "Companies" });
    expect(item.className).not.toContain("bg-[var(--color-accent)]");
    expect(item.className).not.toContain("text-[var(--color-accent-text)]");
    expect(item.className).toContain("text-[var(--color-text-muted)]");
  });

  it("sets aria-current=page when active, and omits it when inactive", () => {
    const { unmount } = renderNavItem({ active: true });
    expect(screen.getByRole("button", { name: "Companies" }).getAttribute("aria-current")).toBe("page");
    unmount();

    renderNavItem({ active: false });
    expect(screen.getByRole("button", { name: "Companies" }).hasAttribute("aria-current")).toBe(false);
  });

  it("renders an <a> when given an href, and a <button type=button> otherwise", () => {
    // Guard against a regression in the element choice: a nav row that links
    // somewhere must be a real link, not a button styled to look like one.
    const { unmount } = renderNavItem({ href: "/companies" });
    const link = screen.getByRole("link", { name: "Companies" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/companies");
    unmount();

    renderNavItem({});
    const button = screen.getByRole("button", { name: "Companies" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });
});
