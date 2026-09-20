// @vitest-environment jsdom
/**
 * The sidebar's round-3 behaviour: it resizes, it collapses to a rail of
 * icons, its header is pinned and always reserves the macOS title-bar inset,
 * and only the nav area between header and footer scrolls (criteria 7 and 27).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  clampSidebarWidth,
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_DEFAULT_W,
  SIDEBAR_MAX_W,
  SIDEBAR_MIN_W,
} from "@/ui/Nav";
import { installRadixStubs } from "./radixSetup";
import { renderSidebar, renderTopbar } from "./sidebar.fixtures";

installRadixStubs();

afterEach(() => {
  cleanup();
});

describe("clampSidebarWidth", () => {
  it("holds the drag between 200 and 360, and rounds to whole pixels", () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_MIN_W);
    expect(clampSidebarWidth(1200)).toBe(SIDEBAR_MAX_W);
    expect(clampSidebarWidth(287.6)).toBe(288);
    expect(clampSidebarWidth(SIDEBAR_MIN_W)).toBe(SIDEBAR_MIN_W);
    expect(clampSidebarWidth(SIDEBAR_MAX_W)).toBe(SIDEBAR_MAX_W);
  });

  it("falls back to the default rather than producing a sidebar nothing can grab", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_W);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_W);
  });
});

describe("Sidebar", () => {
  it("renders at the width it is given", () => {
    renderSidebar({ initialWidth: 300 });
    expect(screen.getByTestId("sidebar").getAttribute("style")).toContain("width: 300px");
  });

  it("collapses to the 48px rail and drops the group caption", () => {
    renderSidebar({ collapsed: true });
    const aside = screen.getByTestId("sidebar");
    expect(aside.getAttribute("data-collapsed")).toBe("true");
    expect(aside.getAttribute("style")).toContain(`width: ${SIDEBAR_COLLAPSED_W}px`);
    // A caption truncated to four letters is noise; the hairlines carry the
    // grouping on their own once the labels are gone.
    expect(screen.queryByText("Pinned views")).toBeNull();
    // The rows are still reachable by name, through aria-label.
    expect(screen.getByRole("button", { name: "Contacts" })).toBeTruthy();
  });

  it("offers no drag handle while collapsed: there is nothing to size", () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByTestId("sidebar-resize")).toBeNull();
  });

  it("resizes from the keyboard and reports the final width once", async () => {
    const user = userEvent.setup();
    const onResizeEnd = vi.fn();
    renderSidebar({ initialWidth: 240, onResizeEnd });

    const handle = screen.getByTestId("sidebar-resize");
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-valuenow")).toBe("240");

    handle.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("sidebar").getAttribute("style")).toContain("width: 248px");
    expect(onResizeEnd).toHaveBeenLastCalledWith(248);

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByTestId("sidebar").getAttribute("style")).toContain("width: 232px");

    // Home and End go straight to the bounds.
    await user.keyboard("{End}");
    expect(onResizeEnd).toHaveBeenLastCalledWith(SIDEBAR_MAX_W);
    await user.keyboard("{Home}");
    expect(onResizeEnd).toHaveBeenLastCalledWith(SIDEBAR_MIN_W);
  });

  it("cannot be dragged or keyed outside its bounds", async () => {
    const user = userEvent.setup();
    renderSidebar({ initialWidth: SIDEBAR_MAX_W });
    screen.getByTestId("sidebar-resize").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(screen.getByTestId("sidebar").getAttribute("style")).toContain(
      `width: ${SIDEBAR_MAX_W}px`,
    );
  });

  it("drags on pointer move and persists once, at the end", () => {
    const onResizeEnd = vi.fn();
    renderSidebar({ initialWidth: 240, onResizeEnd });
    const handle = screen.getByTestId("sidebar-resize");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 240 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 320 });
    // jsdom reports every rect as 0x0, so the left edge is 0 and clientX IS
    // the width. What this asserts is the wiring, not the arithmetic: the
    // sidebar follows the pointer, and the file is written once.
    expect(screen.getByTestId("sidebar").getAttribute("style")).toContain("width: 320px");
    expect(onResizeEnd).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 320 });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledWith(320);
  });

  it("pins the header, reserves the title-bar inset, and scrolls only the nav area", () => {
    // Criterion 27. The header is outside the scroller and always rendered, so
    // a nav row can never reach the top of the window and slide under the
    // macOS traffic lights; the nav area is the one thing in the column that
    // scrolls.
    renderSidebar();
    const header = screen.getByTestId("sidebar-header");
    expect(header.hasAttribute("data-titlebar-inset")).toBe(true);
    expect(header.className).toContain("flex-none");

    const nav = screen.getByTestId("sidebar-nav");
    expect(nav.className).toContain("overflow-y-auto");
    expect(nav.className).toContain("min-h-0");
    expect(nav.contains(header)).toBe(false);

    expect(screen.getByTestId("sidebar").className).toContain("h-full");
  });

  it("draws a hairline between groups and nothing louder", () => {
    renderSidebar();
    const rule = screen.getByTestId("sidebar-separator");
    expect(rule.className).toContain("border-t");
    expect(rule.className).toContain("border-[var(--color-border)]");
  });
});

describe("Topbar", () => {
  it("buys the traffic lights their room when the sidebar is collapsed on macOS", () => {
    // The lights reach about 78px in from the window's leading edge. At every
    // sidebar width except the 48px rail they sit entirely over the sidebar's
    // own header; collapsed, the top bar has to pay the difference or the
    // sidebar-toggle button ends up underneath the close button.
    renderTopbar({ trafficLightInset: true });
    const bar = screen.getByTestId("topbar");
    expect(bar.hasAttribute("data-traffic-light-inset")).toBe(true);
    const spacer = bar.firstElementChild;
    expect(spacer?.className).toContain("w-[calc(var(--titlebar-lights-w)-48px)]");
  });

  it("pays nothing when the sidebar is open, or on Windows", () => {
    renderTopbar();
    const bar = screen.getByTestId("topbar");
    expect(bar.hasAttribute("data-traffic-light-inset")).toBe(false);
    expect(bar.firstElementChild?.className ?? "").not.toContain("--titlebar-lights-w");
  });

  it("is the drag region itself, and the button inside it is not", () => {
    renderTopbar();
    expect(screen.getByTestId("topbar").hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Search" }).hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
  });
});
